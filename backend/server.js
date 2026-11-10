'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./src/config');
const db = require('./src/db');
const validate = require('./src/utils/validate');
const { createRateLimiter } = require('./src/utils/rateLimiter');
const { AppError, toClientError } = require('./src/errors');
const { RoomManager } = require('./src/rooms/RoomManager');
const { ROOM_STATUS } = require('./src/rooms/Room');
const { SessionStore } = require('./src/sessions');
const { BotController, BOT_NAMES } = require('./src/bots/BotController');
const { SIGNALS, partnerOf } = require('./src/game/constants');

// ════════════════════════════════════════════════════════════════════════
//  HTTP
// ════════════════════════════════════════════════════════════════════════

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.clientOrigins }));
app.use(express.json({ limit: '16kb' }));

const rooms = new RoomManager();
const sessions = new SessionStore();

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    db: db.isAvailable(),
    rooms: rooms.size,
    sessions: sessions.size,
  });
});

app.get('/api/rooms', (_req, res) => {
  res.json(rooms.listPublicRooms());
});

app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

// Express 5 enruta aquí también los errores de handlers async.
app.use((err, _req, res, _next) => {
  console.error('❌ Error HTTP:', err);
  res.status(err.status || 500).json(toClientError(err));
});

const server = http.createServer(app);

// ════════════════════════════════════════════════════════════════════════
//  Socket.io
// ════════════════════════════════════════════════════════════════════════

const io = new Server(server, {
  cors: { origin: config.clientOrigins, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 16 * 1024, // ningún mensaje legítimo se acerca a esto
  pingInterval: 20_000,
  pingTimeout: 20_000,
});

// Cada jugador tiene su propio canal: así los mensajes privados (su mano)
// le llegan aunque se haya reconectado con otro socket.
const playerChannel = (playerId) => `player:${playerId}`;

const disconnectTimers = new Map(); // playerId -> Timeout
const lastSignalAt = new Map(); // playerId -> timestamp (anti-spam de señas)
const SIGNAL_COOLDOWN_MS = 800;

const bots = new BotController({ onAction: (room) => broadcastGame(room) });

// ─────────────────────────── Difusión de estado ───────────────────────────

function emitToPlayer(playerId, event, payload) {
  io.to(playerChannel(playerId)).emit(event, payload);
}

function broadcastRoom(room) {
  const data = room.toPublic();
  for (const member of room.members()) emitToPlayer(member.playerId, 'room:update', data);
}

/** Envía a cada jugador SU vista de la partida (solo ve sus propias cartas). */
function broadcastGame(room) {
  if (!room.game) return;
  for (const p of room.game.players) emitToPlayer(p.playerId, 'game:state', room.game.getStateFor(p.seat));
  bots.onState(room);
}

function gameStateFor(room, playerId) {
  if (!room?.game) return null;
  return room.game.getStateFor(room.game.seatOf(playerId));
}

// ─────────────────────────── Ciclo de vida de sala ───────────────────────────

function cancelDisconnectTimer(playerId) {
  const timer = disconnectTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(playerId);
  }
}

function scheduleDisconnectTimer(playerId, ms) {
  cancelDisconnectTimer(playerId);
  const timer = setTimeout(() => {
    disconnectTimers.delete(playerId);
    const session = sessions.getByPlayer(playerId);
    if (session?.connected) return; // volvió a tiempo
    removePlayerFromRoom(playerId, 'disconnected');
  }, ms);
  timer.unref();
  disconnectTimers.set(playerId, timer);
}

/** Saca a un jugador de su sala. Si había partida en curso, se cancela. */
function removePlayerFromRoom(playerId, reason) {
  cancelDisconnectTimer(playerId);
  const room = rooms.getRoomByPlayer(playerId);
  if (!room) return null;

  if (room.status === ROOM_STATUS.PLAYING) {
    const member = room.getMember(playerId);
    bots.cancel(room.code);
    room.abortGame();
    for (const m of room.members()) {
      if (m.playerId !== playerId) {
        emitToPlayer(m.playerId, 'game:aborted', { reason, playerId, username: member?.username });
      }
    }
  }

  const { closed } = rooms.leaveRoom(playerId);
  if (closed) bots.cancel(room.code);
  emitToPlayer(playerId, 'room:left', { code: room.code, reason });
  if (!closed) broadcastRoom(room);
  console.log(`🚪 ${playerId} sale de la sala ${room.code} (${reason})${closed ? ' — sala cerrada' : ''}`);
  return room;
}

function maybeStartGame(room) {
  if (!room.canStart()) return false;
  room.startGame(config.game);
  console.log(`🃏 Partida iniciada en la sala ${room.code}`);
  broadcastRoom(room);
  broadcastGame(room);
  return true;
}

function requireRoom(playerId) {
  const room = rooms.getRoomByPlayer(playerId);
  if (!room) throw new AppError('NOT_IN_ROOM', 'No estás en ninguna sala');
  return room;
}

function requireGame(playerId) {
  const room = requireRoom(playerId);
  if (!room.game) throw new AppError('NO_ACTIVE_GAME', 'No hay ninguna partida en curso');
  return { room, game: room.game, seat: room.game.seatOf(playerId) };
}

// ─────────────────────────── Sesión ↔ socket ───────────────────────────

function toProfile(row, username) {
  if (row) {
    return {
      id: row.id,
      username: row.username,
      coins: row.coins,
      gems: row.gems,
      elo: row.elo,
      gamesPlayed: row.games_played,
      gamesWon: row.games_won,
      isGuest: false,
    };
  }
  return { id: null, username, coins: 1000, gems: 50, elo: 1200, gamesPlayed: 0, gamesWon: 0, isGuest: true };
}

function sessionPayload(session) {
  return {
    ...session.profile,
    playerId: session.playerId,
    sessionToken: session.token,
    features: { devTools: config.devTools },
  };
}

/**
 * Vincula una sesión a este socket. Si la sesión ya estaba abierta en otra
 * pestaña, la anterior se desconecta (una sesión = un socket).
 */
function attachSession(socket, session) {
  const previousId = session.socketId;
  const previous = previousId && previousId !== socket.id ? io.sockets.sockets.get(previousId) : null;

  session.socketId = socket.id;
  session.connected = true;
  session.lastSeen = Date.now();
  socket.data.session = session;
  socket.join(playerChannel(session.playerId));

  if (previous) {
    previous.data.session = null; // evita que su 'disconnect' marque al jugador como ausente
    previous.emit('session:replaced');
    previous.disconnect(true);
  }

  cancelDisconnectTimer(session.playerId);
  const room = rooms.getRoomByPlayer(session.playerId);
  if (room) {
    room.setConnected(session.playerId, true);
    broadcastRoom(room);
  }
  return room;
}

function detachSession(socket) {
  const session = socket.data.session;
  if (!session) return;
  socket.leave(playerChannel(session.playerId));
  socket.data.session = null;
  if (session.socketId === socket.id) {
    session.socketId = null;
    session.connected = false;
    session.lastSeen = Date.now();
  }
}

// ─────────────────────────── Middleware de socket ───────────────────────────

// Reanudación automática: el cliente envía el token en el handshake.
io.use((socket, next) => {
  const session = sessions.get(socket.handshake.auth?.sessionToken);
  if (session) socket.data.pendingSession = session;
  next();
});

/**
 * Registra un handler con:
 *  - payload opcional + acknowledgement `{ ok, data }` / `{ ok: false, error }`
 *  - comprobación de sesión
 *  - captura de errores (nunca se filtra un stack al cliente)
 */
function handle(socket, event, fn, { requireSession = true } = {}) {
  socket.on(event, async (payload, ack) => {
    if (typeof payload === 'function') {
      ack = payload;
      payload = undefined;
    }
    const reply = typeof ack === 'function' ? ack : null;
    try {
      const session = socket.data.session;
      if (requireSession && !session) throw new AppError('NOT_AUTHENTICATED', 'Inicia sesión primero');
      if (session) session.lastSeen = Date.now();
      const data = await fn({ session, payload });
      reply?.({ ok: true, data: data ?? null });
    } catch (err) {
      if (!(err instanceof AppError)) console.error(`❌ Error en "${event}":`, err);
      const error = toClientError(err);
      if (reply) reply({ ok: false, error });
      else socket.emit('app:error', { event, ...error });
    }
  });
}

io.on('connection', (socket) => {
  const consume = createRateLimiter(config.rateLimit);
  socket.use((packet, next) => {
    if (consume()) return next();
    const ack = packet[packet.length - 1];
    if (typeof ack === 'function') ack({ ok: false, error: { code: 'RATE_LIMITED', message: 'Demasiadas acciones, espera un momento' } });
    // No se llama a next(): el evento se descarta.
  });

  const pending = socket.data.pendingSession;
  delete socket.data.pendingSession;
  if (pending) {
    const room = attachSession(socket, pending);
    socket.emit('session:restored', {
      user: sessionPayload(pending),
      room: room ? room.toPublic() : null,
      game: gameStateFor(room, pending.playerId),
    });
    console.log(`🔁 ${pending.username} recupera su sesión (${socket.id})`);
  } else {
    console.log(`🟢 Socket conectado: ${socket.id}`);
  }

  // ───────────── Autenticación ─────────────

  // Compatible con el cliente actual: socket.emit('login_user', 'nombre')
  handle(
    socket,
    'login_user',
    async ({ payload }) => {
      try {
        const username = validate.username(typeof payload === 'string' ? payload : payload?.username);
        const current = socket.data.session;

        if (current && current.username !== username && rooms.getRoomByPlayer(current.playerId)) {
          throw new AppError('ALREADY_IN_ROOM', 'Sal de la sala antes de cambiar de usuario');
        }

        let row = null;
        try {
          row = await db.findOrCreateUser(username);
        } catch (err) {
          console.error('❌ Error de BD en login, se continúa como invitado:', err.message);
        }

        const profile = toProfile(row, username);
        const playerId = row ? `user:${row.id}` : `guest:${randomUUID()}`;

        // Mismo usuario ya conectado (otra pestaña / reconexión): se reutiliza
        // la sesión para conservar su asiento.
        let session = sessions.getByPlayer(playerId);
        if (session) session.profile = profile;
        else session = sessions.create({ playerId, profile });

        if (current && current !== session) detachSession(socket);
        const room = attachSession(socket, session);

        const user = sessionPayload(session);
        socket.emit('login_success', user);
        console.log(`👋 ${username} inicia sesión (${playerId})`);
        return { user, room: room ? room.toPublic() : null, game: gameStateFor(room, playerId) };
      } catch (err) {
        socket.emit('login_error', toClientError(err).message);
        throw err;
      }
    },
    { requireSession: false },
  );

  handle(socket, 'logout', async ({ session }) => {
    removePlayerFromRoom(session.playerId, 'logout');
    lastSignalAt.delete(session.playerId);
    detachSession(socket);
    sessions.delete(session);
    return null;
  });

  // ───────────── Lobby / salas ─────────────

  handle(socket, 'room:create', async ({ session, payload }) => {
    const { isPrivate = false } = validate.object(payload);
    const room = rooms.createRoom(
      { playerId: session.playerId, username: session.username },
      { isPrivate: validate.bool(isPrivate, 'isPrivate') },
    );
    console.log(`🏠 ${session.username} crea la sala ${room.code}${room.isPrivate ? ' (privada)' : ''}`);
    broadcastRoom(room);
    return room.toPublic();
  });

  handle(socket, 'room:join', async ({ session, payload }) => {
    const { code, seat } = validate.object(payload);
    const room = rooms.joinRoom(
      { playerId: session.playerId, username: session.username },
      validate.roomCode(code),
      validate.seat(seat, { optional: true }),
    );
    console.log(`➡️  ${session.username} entra en la sala ${room.code} (${room.playerCount}/4)`);
    broadcastRoom(room);
    return { room: room.toPublic(), game: gameStateFor(room, session.playerId) };
  });

  handle(socket, 'room:quickMatch', async ({ session }) => {
    const room = rooms.quickMatch({ playerId: session.playerId, username: session.username });
    console.log(`⚡ ${session.username} → matchmaking en ${room.code} (${room.playerCount}/4)`);
    broadcastRoom(room);
    return { room: room.toPublic(), game: gameStateFor(room, session.playerId) };
  });

  handle(socket, 'room:leave', async ({ session }) => {
    requireRoom(session.playerId);
    removePlayerFromRoom(session.playerId, 'left');
    return null;
  });

  handle(socket, 'room:changeSeat', async ({ session, payload }) => {
    const { seat } = validate.object(payload);
    const room = requireRoom(session.playerId);
    room.changeSeat(session.playerId, validate.seat(seat));
    broadcastRoom(room);
    return room.toPublic();
  });

  handle(socket, 'room:ready', async ({ session, payload }) => {
    const { ready = true } = validate.object(payload);
    const room = requireRoom(session.playerId);
    room.setReady(session.playerId, validate.bool(ready, 'ready'));
    if (!maybeStartGame(room)) broadcastRoom(room);
    return room.toPublic();
  });

  // Solo pruebas: completa la mesa con bots para poder jugar en solitario.
  handle(socket, 'room:addBots', async ({ session }) => {
    if (!config.devTools) throw new AppError('FORBIDDEN', 'Los bots están desactivados');
    const room = requireRoom(session.playerId);
    const added = rooms.fillWithBots(room.code, BOT_NAMES);
    console.log(`🤖 ${session.username} añade ${added} bots a la sala ${room.code}`);
    if (!maybeStartGame(room)) broadcastRoom(room);
    return room.toPublic();
  });

  handle(socket, 'room:sync', async ({ session }) => {
    const room = rooms.getRoomByPlayer(session.playerId);
    return { room: room ? room.toPublic() : null, game: gameStateFor(room, session.playerId) };
  });

  // ───────────── Partida ─────────────

  handle(socket, 'game:mus', async ({ session, payload }) => {
    const { mus } = validate.object(payload);
    const { room, game, seat } = requireGame(session.playerId);
    game.declareMus(seat, mus);
    broadcastGame(room);
    return null;
  });

  handle(socket, 'game:discard', async ({ session, payload }) => {
    const { cardIds } = validate.object(payload);
    const { room, game, seat } = requireGame(session.playerId);
    game.discard(seat, cardIds);
    broadcastGame(room);
    return null;
  });

  // Señas: solo las recibe el compañero.
  handle(socket, 'game:signal', async ({ session, payload }) => {
    const { signal } = validate.object(payload);
    if (!SIGNALS.includes(signal)) throw new AppError('INVALID_SIGNAL', 'Seña no válida');
    const { room, seat } = requireGame(session.playerId);

    const now = Date.now();
    if (now - (lastSignalAt.get(session.playerId) ?? 0) < SIGNAL_COOLDOWN_MS) {
      throw new AppError('SIGNAL_COOLDOWN', 'Espera un instante antes de otra seña');
    }
    lastSignalAt.set(session.playerId, now);

    const partner = room.seats[partnerOf(seat)];
    if (partner && !partner.isBot) emitToPlayer(partner.playerId, 'game:signal', { from: seat, signal, at: now });
    return null;
  });

  // Solo pruebas: reparte una mano nueva (mientras no existan las apuestas).
  handle(socket, 'game:devRedeal', async ({ session }) => {
    if (!config.devTools) throw new AppError('FORBIDDEN', 'Herramientas de prueba desactivadas');
    const { room, game } = requireGame(session.playerId);
    game.forceNewHand();
    broadcastGame(room);
    return null;
  });

  handle(socket, 'game:sync', async ({ session }) => {
    const { game, seat } = requireGame(session.playerId);
    return game.getStateFor(seat);
  });

  // ───────────── Desconexión ─────────────

  socket.on('disconnect', (reason) => {
    const session = socket.data.session;
    if (!session || session.socketId !== socket.id) {
      console.log(`🔴 Socket desconectado: ${socket.id} (${reason})`);
      return;
    }

    session.socketId = null;
    session.connected = false;
    session.lastSeen = Date.now();
    console.log(`🔴 ${session.username} desconectado (${reason})`);

    const room = rooms.getRoomByPlayer(session.playerId);
    if (!room) return;

    room.setConnected(session.playerId, false);
    broadcastRoom(room);
    const grace =
      room.status === ROOM_STATUS.PLAYING ? config.timers.gameReconnectMs : config.timers.lobbyReconnectMs;
    scheduleDisconnectTimer(session.playerId, grace);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Arranque y parada
// ════════════════════════════════════════════════════════════════════════

const sweepTimer = setInterval(() => {
  const removed = sessions.sweep(config.timers.sessionIdleMs, (s) => Boolean(rooms.getRoomByPlayer(s.playerId)));
  if (removed) console.log(`🧹 ${removed} sesiones inactivas eliminadas`);
}, 10 * 60 * 1000);
sweepTimer.unref();

async function start(port = config.port) {
  await db.init();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });
  console.log(`🚀 Mus Premium escuchando en el puerto ${server.address().port}`);
  return server;
}

async function stop() {
  for (const timer of disconnectTimers.values()) clearTimeout(timer);
  disconnectTimers.clear();
  bots.cancelAll();
  clearInterval(sweepTimer);
  await new Promise((resolve) => io.close(() => resolve())); // cierra también el servidor HTTP
  await db.close();
}

if (require.main === module) {
  start().catch((err) => {
    console.error('💥 No se pudo arrancar el servidor:', err);
    process.exit(1);
  });

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} recibido, cerrando…`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    stop()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { app, server, io, rooms, sessions, start, stop };
