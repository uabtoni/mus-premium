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
const { BotController, BOT_NAMES, chooseDiscard } = require('./src/bots/BotController');
const { SIGNALS, PHASES, BETTING_PHASES, QUICK_PHRASES, partnerOf } = require('./src/game/constants');
const auth = require('./src/auth');

// ════════════════════════════════════════════════════════════════════════
//  HTTP
// ════════════════════════════════════════════════════════════════════════

const app = express();
app.disable('x-powered-by');
// Orígenes permitidos: la lista de CLIENT_ORIGIN y, en desarrollo, cualquier
// página servida desde la red local (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x).
const LAN_ORIGIN = /^https?:\/\/(localhost|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2})(:\d+)?$/;
function originAllowed(origin) {
  if (!origin) return true; // peticiones sin origen (curl, misma app)
  return config.clientOrigins.includes(origin) || (config.allowLan && LAN_ORIGIN.test(origin));
}
const corsOrigin = (origin, cb) => cb(null, originAllowed(origin));

app.use(cors({ origin: corsOrigin }));
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

// ─────────────────────────── Cuentas ───────────────────────────

const bearer = (req) => {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

// Límite por IP para registro y login (frena ataques de fuerza bruta).
const authLimiters = new Map();
function authRateLimit(req, _res, next) {
  const ip = req.ip || 'unknown';
  if (!authLimiters.has(ip)) authLimiters.set(ip, createRateLimiter({ capacity: config.rateLimit.authBurst, refillPerSecond: 0.2 }));
  if (!authLimiters.get(ip)()) return next(new AppError('TOO_MANY_ATTEMPTS', 'Demasiados intentos. Espera un momento.'));
  next();
}

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  const result = await auth.register(req.body?.username, req.body?.password);
  console.log(`✨ Nueva cuenta: ${result.user.username}`);
  res.status(201).json(result);
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const result = await auth.login(req.body?.username, req.body?.password);
  console.log(`🔑 ${result.user.username} inicia sesión${result.claimed ? ' (contraseña nueva en cuenta antigua)' : ''}`);
  res.json(result);
});

app.post('/api/auth/logout', async (req, res) => {
  await auth.logout(bearer(req));
  res.status(204).end();
});

app.get('/api/auth/me', async (req, res) => {
  const user = await auth.userFromToken(bearer(req));
  if (!user) throw new AppError('UNAUTHORIZED', 'Sesión caducada');
  res.json({ user, features: { devTools: config.devTools } });
});

app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  USERNAME_TAKEN: 409,
  TOO_MANY_ATTEMPTS: 429,
};

// Express 5 enruta aquí también los errores de handlers async.
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) return res.status(HTTP_STATUS[err.code] ?? 400).json(toClientError(err));
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_PAYLOAD', message: 'JSON no válido' });
  console.error('❌ Error HTTP:', err);
  res.status(500).json(toClientError(err));
});

const server = http.createServer(app);

// ════════════════════════════════════════════════════════════════════════
//  Socket.io
// ════════════════════════════════════════════════════════════════════════

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
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
const lastEmoteAt = new Map(); // playerId -> timestamp
const EMOTE_COOLDOWN_MS = 2500;

const bots = new BotController({ ...config.bots, onAction: (room) => broadcastGame(room) });

// ─────────────────────────── Difusión de estado ───────────────────────────

function emitToPlayer(playerId, event, payload) {
  io.to(playerChannel(playerId)).emit(event, payload);
}

function broadcastRoom(room) {
  const data = room.toPublic();
  for (const member of room.members()) {
    emitToPlayer(member.playerId, 'room:update', data);
    if (!member.isBot) notifyPresence(member.playerId);
  }
}

// ─────────────────────────── Entre manos y fin de partida ───────────────────────────

const nextHandTimers = new Map(); // code -> Timeout
const recordedGames = new WeakSet(); // partidas ya guardadas en BD

function clearHandFlow(code) {
  const t = nextHandTimers.get(code);
  if (t) clearTimeout(t);
  nextHandTimers.delete(code);
}

function startNextHand(room, game) {
  clearHandFlow(room.code);
  if (room.game !== game || game.phase !== PHASES.SCORING) return;
  game.startHand();
  broadcastGame(room);
}

/** Programa la siguiente mano tras el conteo y guarda la partida al terminar. */
function scheduleHandFlow(room) {
  const game = room.game;
  if (!game) return;
  if (game.phase === PHASES.SCORING && !nextHandTimers.has(room.code)) {
    const delay = config.timers.nextHandMs;
    game.nextHandAt = Date.now() + delay;
    const timer = setTimeout(() => startNextHand(room, game), delay);
    timer.unref();
    nextHandTimers.set(room.code, timer);
  }
  if (game.phase === PHASES.FINISHED && !recordedGames.has(game)) {
    recordedGames.add(game);
    recordMatch(room, game);
  }
}

async function recordMatch(room, game) {
  const players = game.players.map((p) => ({
    seat: p.seat,
    team: p.team,
    playerId: p.playerId,
    userId: p.playerId.startsWith('user:') ? Number(p.playerId.slice(5)) : null,
  }));
  console.log(`🏆 Partida terminada en ${room.code}: gana la pareja ${game.winnerTeam} (${game.games.join('-')})`);
  // Las partidas de entrenamiento (con bots) no cuentan para el ELO ni las estadísticas.
  if (room.bots().length > 0) return;
  try {
    const results = await db.recordMatch({
      roomCode: room.code,
      startedAt: game.startedAt,
      winnerTeam: game.winnerTeam,
      games: game.games,
      players,
    });
    for (const r of results) {
      const session = sessions.getByPlayer(r.playerId);
      if (!session) continue;
      session.profile = { ...session.profile, elo: r.eloAfter, gamesPlayed: r.gamesPlayed, gamesWon: r.gamesWon };
      emitToPlayer(r.playerId, 'profile:update', { user: sessionPayload(session), eloDelta: r.delta });
    }
  } catch (err) {
    console.error('❌ No se pudo guardar la partida:', err.message);
  }
}

// ─────────────────────────── Tiempo por turno ───────────────────────────

const turnTimers = new Map(); // code -> { timer, key }

function clearTurnTimer(code) {
  const t = turnTimers.get(code);
  if (t) clearTimeout(t.timer);
  turnTimers.delete(code);
}

/** Asientos humanos que tienen que decidir ahora. */
function humansToAct(room, game) {
  const human = (seat) => room.seats[seat] && !room.seats[seat].isBot;
  if (game.phase === PHASES.DISCARD) return [0, 1, 2, 3].filter((s) => human(s) && !game.pendingDiscards.has(s));
  if ((game.phase === PHASES.MUS || BETTING_PHASES.includes(game.phase)) && game.turn !== null && human(game.turn)) {
    return [game.turn];
  }
  return [];
}

/** Juega por un asiento cuyo tiempo se agotó: lo más prudente en cada fase. */
function autoAct(game, seat) {
  if (game.phase === PHASES.MUS) return game.declareMus(seat, true);
  if (game.phase === PHASES.DISCARD) return game.discard(seat, chooseDiscard(game.hands[seat]));
  const round = game.betting;
  return game.bet(seat, round.stage === 'SPEAKING' ? 'paso' : 'no_quiero');
}

/**
 * Programa (o mantiene) el plazo del turno. La clave identifica "quién tiene
 * que decidir qué": en el descarte, que es simultáneo, el plazo no se reinicia
 * cada vez que alguien descarta.
 */
function scheduleTurnTimer(room) {
  const game = room.game;
  if (!game) return clearTurnTimer(room.code);
  const seats = humansToAct(room, game);
  const key = seats.length ? `${game.handNumber}:${game.musRounds}:${game.phase}:${game.phase === PHASES.DISCARD ? 'all' : game.turn}` : null;
  const current = turnTimers.get(room.code);
  if (current && current.key === key) return;
  clearTurnTimer(room.code);
  game.turnDeadline = null;
  if (!key) return;

  const ms = config.timers.turnMs;
  game.turnDeadline = Date.now() + ms;
  game.turnTotalMs = ms;
  const timer = setTimeout(() => onTurnTimeout(room, game, key), ms);
  timer.unref();
  turnTimers.set(room.code, { timer, key });
}

function onTurnTimeout(room, game, key) {
  if (turnTimers.get(room.code)?.key !== key || room.game !== game) return;
  turnTimers.delete(room.code);
  for (const seat of humansToAct(room, game)) {
    const member = room.seats[seat];
    try {
      autoAct(game, seat);
    } catch (err) {
      console.error(`⏱️  No se pudo jugar automáticamente por ${member?.username}:`, err.message);
      continue;
    }
    member.timeouts = (member.timeouts ?? 0) + 1;
    emitToPlayer(member.playerId, 'game:timeout', { auto: true });
    console.log(`⏱️  ${member.username} agota su tiempo (${member.timeouts}/${config.timers.afkLimit})`);
    if (member.timeouts >= config.timers.afkLimit) substituteWithBot(room, member.playerId, 'afk', { broadcast: false });
  }
  if (!rooms.getRoom(room.code)) return; // la mesa se cerró
  broadcastRoom(room);
  broadcastGame(room);
}

/** Una acción hecha a mano reinicia el contador y, si estaba ausente, le devuelve el asiento. */
function markActive(room, playerId) {
  const member = room.getMember(playerId);
  if (!member) return;
  member.timeouts = 0;
  if (member.substitute && room.restore(playerId)) {
    roomNotice(room, { kind: 'returned', username: member.username }, playerId);
    broadcastRoom(room);
  }
}

// ─────────────────────────── Bot sustituto ───────────────────────────

function roomNotice(room, notice, exceptPlayerId) {
  for (const m of room.members()) {
    if (!m.isBot && m.playerId !== exceptPlayerId) emitToPlayer(m.playerId, 'room:notice', notice);
  }
}

/** Cierra una mesa en la que ya no queda ningún humano. */
function closeRoom(room) {
  bots.cancel(room.code);
  clearHandFlow(room.code);
  clearTurnTimer(room.code);
  for (const m of room.members()) {
    room.removePlayer(m.playerId);
    rooms.playerRoom.delete(m.playerId);
  }
  room.abortGame(); // sin partida: los bots dejan de jugar
  rooms.rooms.delete(room.code);
  console.log(`🗑️  Sala ${room.code} cerrada: no quedan jugadores`);
}

/**
 * Un bot juega por un jugador que se ha desconectado, está ausente o ha
 * abandonado. Si abandona, pierde el asiento; si no, lo recupera al volver.
 */
function substituteWithBot(room, playerId, reason, { broadcast = true } = {}) {
  const member = room.substitute(playerId);
  if (!member) return;
  console.log(`🤖 Un bot sustituye a ${member.username} en ${room.code} (${reason})`);
  if (reason === 'left') {
    rooms.playerRoom.delete(playerId);
    emitToPlayer(playerId, 'room:left', { code: room.code, reason });
    notifyPresence(playerId);
  }
  if (room.humanCount === 0) return closeRoom(room);
  roomNotice(room, { kind: 'substituted', reason, username: member.username }, playerId);
  if (broadcast) {
    broadcastRoom(room);
    broadcastGame(room);
  }
}

/** Al terminar la partida: vuelven los que estén conectados; los demás dejan su sitio libre. */
function settleSubstitutes(room) {
  for (const m of room.members()) {
    if (!m.substitute) continue;
    const session = sessions.getByPlayer(m.playerId);
    const stillHere = rooms.getRoomByPlayer(m.playerId) === room && session?.connected;
    if (stillHere) room.restore(m.playerId);
    else {
      room.removePlayer(m.playerId);
      if (rooms.getRoomByPlayer(m.playerId) === room) rooms.playerRoom.delete(m.playerId);
    }
  }
}

/** Envía a cada jugador SU vista de la partida (solo ve sus propias cartas). */
function broadcastGame(room) {
  if (!room.game) return;
  scheduleHandFlow(room);
  scheduleTurnTimer(room);
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

/**
 * Saca a un jugador de su sala. Con la partida en marcha no se cancela: un bot
 * juega por él (y si solo se ha desconectado, recupera el asiento al volver).
 */
function removePlayerFromRoom(playerId, reason) {
  cancelDisconnectTimer(playerId);
  const room = rooms.getRoomByPlayer(playerId);
  if (!room) return null;

  if (room.status === ROOM_STATUS.PLAYING && room.game?.phase !== PHASES.FINISHED) {
    substituteWithBot(room, playerId, reason === 'logout' ? 'left' : reason);
    return room;
  }

  if (room.status === ROOM_STATUS.PLAYING) {
    const member = room.getMember(playerId);
    const finished = room.game?.phase === PHASES.FINISHED;
    bots.cancel(room.code);
    clearHandFlow(room.code);
    clearTurnTimer(room.code);
    room.abortGame();
    for (const m of room.members()) {
      if (m.playerId !== playerId && !finished) {
        emitToPlayer(m.playerId, 'game:aborted', { reason, playerId, username: member?.username });
      }
    }
  }

  const { closed } = rooms.leaveRoom(playerId);
  if (closed) {
    bots.cancel(room.code);
    clearHandFlow(room.code);
  }
  emitToPlayer(playerId, 'room:left', { code: room.code, reason });
  notifyPresence(playerId);
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

function sessionPayload(session) {
  return {
    ...session.profile,
    playerId: session.playerId,
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
    if (room.status === ROOM_STATUS.PLAYING && room.restore(session.playerId)) {
      console.log(`🔙 ${session.username} vuelve y recupera su asiento en ${room.code}`);
      roomNotice(room, { kind: 'returned', username: session.username }, session.playerId);
      bots.onState(room);
    }
    room.setConnected(session.playerId, true);
    broadcastRoom(room);
    if (room.game) scheduleTurnTimer(room);
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

// ─────────────────────────── Amigos y presencia ───────────────────────────

const INVITE_TTL_MS = 2 * 60 * 1000;
const invites = new Map(); // id -> { fromPid, fromName, toPid, code, expiresAt }

const userIdOf = (playerId) => Number(playerId.slice('user:'.length));

/** offline | online | room (en una mesa esperando) | playing */
function presenceOf(playerId) {
  const session = sessions.getByPlayer(playerId);
  if (!session?.connected) return 'offline';
  const room = rooms.getRoomByPlayer(playerId);
  if (!room) return 'online';
  return room.status === ROOM_STATUS.PLAYING ? 'playing' : 'room';
}

async function loadFriendIds(session) {
  const ids = await db.friendIds(userIdOf(session.playerId));
  session.friendIds = new Set(ids.map((id) => `user:${id}`));
}

async function linkFriends(aPid, bPid) {
  sessions.getByPlayer(aPid)?.friendIds.add(bPid);
  sessions.getByPlayer(bPid)?.friendIds.add(aPid);
}

/** Avisa a los amigos conectados del estado actual de un jugador. */
function notifyPresence(playerId) {
  const session = sessions.getByPlayer(playerId);
  if (!session) return;
  const payload = { userId: userIdOf(playerId), presence: presenceOf(playerId) };
  for (const friendPid of session.friendIds) emitToPlayer(friendPid, 'friends:presence', payload);
}

async function listFriendsFor(session) {
  const list = await db.listFriends(userIdOf(session.playerId));
  return list.map((f) => ({ ...f, presence: f.relation === 'friend' ? presenceOf(`user:${f.id}`) : 'offline' }));
}

// ─────────────────────────── Middleware de socket ───────────────────────────

// Solo entran sockets con un token de cuenta válido (se obtiene en /api/auth/login).
io.use(async (socket, next) => {
  try {
    const user = await auth.userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('UNAUTHORIZED'));
    socket.data.user = user;
    next();
  } catch (err) {
    console.error('❌ Error validando el token del socket:', err.message);
    next(new Error('SERVER_ERROR'));
  }
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

  // ───────────── Sesión (identidad verificada en el handshake) ─────────────

  {
    const user = socket.data.user;
    const playerId = `user:${user.id}`;
    let session = sessions.getByPlayer(playerId);
    if (session) {
      session.profile = { ...session.profile, ...user };
      session.username = user.username;
    } else {
      session = sessions.create({ playerId, profile: user });
    }
    const room = attachSession(socket, session);
    socket.emit('session:ready', {
      user: sessionPayload(session),
      room: room ? room.toPublic() : null,
      game: gameStateFor(room, playerId),
    });
    console.log(`🟢 ${user.username} conectado (${socket.id})`);
    loadFriendIds(session)
      .then(() => notifyPresence(session.playerId))
      .catch((err) => console.error('❌ Error cargando amigos:', err.message));
  }

  handle(socket, 'logout', async ({ session }) => {
    removePlayerFromRoom(session.playerId, 'logout');
    lastSignalAt.delete(session.playerId);
    detachSession(socket);
    notifyPresence(session.playerId);
    sessions.delete(session);
    return null;
  });

  // ───────────── Amigos ─────────────

  handle(socket, 'friends:list', async ({ session }) => listFriendsFor(session));

  handle(socket, 'friends:request', async ({ session, payload }) => {
    const { username } = validate.object(payload);
    const result = await db.requestFriend(userIdOf(session.playerId), validate.username(username));
    const otherPid = `user:${result.user.id}`;
    if (result.relation === 'friend') await linkFriends(session.playerId, otherPid);
    emitToPlayer(otherPid, 'friends:changed', {
      reason: result.relation === 'friend' ? 'accepted' : 'request',
      username: session.username,
    });
    return { relation: result.relation, username: result.user.username, friends: await listFriendsFor(session) };
  });

  handle(socket, 'friends:respond', async ({ session, payload }) => {
    const { userId, accept } = validate.object(payload);
    await db.respondFriend(userIdOf(session.playerId), validate.positiveInt(userId, 'userId'), validate.bool(accept, 'accept'));
    const otherPid = `user:${userId}`;
    if (accept) await linkFriends(session.playerId, otherPid);
    emitToPlayer(otherPid, 'friends:changed', { reason: accept ? 'accepted' : 'declined', username: session.username });
    return listFriendsFor(session);
  });

  handle(socket, 'friends:remove', async ({ session, payload }) => {
    const { userId } = validate.object(payload);
    await db.removeFriend(userIdOf(session.playerId), validate.positiveInt(userId, 'userId'));
    const otherPid = `user:${userId}`;
    session.friendIds.delete(otherPid);
    sessions.getByPlayer(otherPid)?.friendIds.delete(session.playerId);
    emitToPlayer(otherPid, 'friends:changed', { reason: 'removed' });
    return listFriendsFor(session);
  });

  // Invita a un amigo a tu mesa (se crea una privada si no estás en ninguna).
  handle(socket, 'friends:invite', async ({ session, payload }) => {
    const { userId } = validate.object(payload);
    const friendPid = `user:${validate.positiveInt(userId, 'userId')}`;
    if (!session.friendIds.has(friendPid)) throw new AppError('NOT_FRIENDS', 'Solo puedes invitar a tus amigos');
    const presence = presenceOf(friendPid);
    if (presence === 'offline') throw new AppError('FRIEND_OFFLINE', 'Tu amigo no está conectado');
    if (presence === 'playing') throw new AppError('FRIEND_BUSY', 'Tu amigo está en mitad de una partida');

    let room = rooms.getRoomByPlayer(session.playerId);
    if (!room) {
      room = rooms.createRoom({ playerId: session.playerId, username: session.username }, { isPrivate: true });
      broadcastRoom(room);
    }
    if (room.status !== ROOM_STATUS.WAITING) throw new AppError('ROOM_IN_GAME', 'Tu mesa ya está jugando');
    if (room.has(friendPid)) throw new AppError('ALREADY_IN_ROOM', 'Tu amigo ya está en tu mesa');
    if (room.isFull) throw new AppError('ROOM_FULL', 'Tu mesa está completa');

    const invite = {
      id: randomUUID(),
      fromPid: session.playerId,
      fromName: session.username,
      toPid: friendPid,
      code: room.code,
      expiresAt: Date.now() + INVITE_TTL_MS,
    };
    invites.set(invite.id, invite);
    setTimeout(() => invites.delete(invite.id), INVITE_TTL_MS).unref();
    emitToPlayer(friendPid, 'invite:received', {
      id: invite.id,
      from: { id: userIdOf(session.playerId), username: session.username },
      code: room.code,
      expiresAt: invite.expiresAt,
    });
    console.log(`💌 ${session.username} invita a ${friendPid} a la mesa ${room.code}`);
    return { room: room.toPublic(), inviteId: invite.id };
  });

  handle(socket, 'invite:respond', async ({ session, payload }) => {
    const { id, accept } = validate.object(payload);
    const invite = typeof id === 'string' ? invites.get(id) : null;
    if (!invite || invite.toPid !== session.playerId || invite.expiresAt < Date.now()) {
      throw new AppError('INVITE_EXPIRED', 'La invitación ha caducado');
    }
    invites.delete(invite.id);
    if (!validate.bool(accept, 'accept')) {
      emitToPlayer(invite.fromPid, 'invite:declined', { username: session.username });
      return null;
    }

    const room = rooms.getRoom(invite.code);
    if (!room || room.status !== ROOM_STATUS.WAITING) throw new AppError('ROOM_NOT_FOUND', 'Esa mesa ya no está disponible');
    const current = rooms.getRoomByPlayer(session.playerId);
    if (current && current !== room) {
      if (current.status !== ROOM_STATUS.WAITING) throw new AppError('ROOM_IN_GAME', 'Estás en mitad de una partida');
      removePlayerFromRoom(session.playerId, 'left');
    }
    // Se sienta de compañero de quien le invita, si ese asiento está libre.
    const inviterSeat = room.seatOf(invite.fromPid);
    const partnerSeat = inviterSeat === -1 ? undefined : partnerOf(inviterSeat);
    const seat = partnerSeat !== undefined && !room.seats[partnerSeat] ? partnerSeat : undefined;
    rooms.joinRoom({ playerId: session.playerId, username: session.username }, room.code, seat);
    console.log(`🤝 ${session.username} acepta la invitación a ${room.code}`);
    broadcastRoom(room);
    return { room: room.toPublic(), game: gameStateFor(room, session.playerId) };
  });

  // Abre la mesa al matchmaking: entran jugadores sueltos o se empareja con otra pareja.
  handle(socket, 'room:search', async ({ session, payload }) => {
    const { on = true } = validate.object(payload);
    const room = requireRoom(session.playerId);
    room.setSearching(validate.bool(on, 'on'));
    const merged = on ? rooms.tryMergePairs(room) : null;
    if (merged) console.log(`🔗 Parejas emparejadas en ${room.code} (cerrada ${merged.closedCode})`);
    if (!maybeStartGame(room)) broadcastRoom(room);
    return room.toPublic();
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
    markActive(room, session.playerId);
    broadcastGame(room);
    return null;
  });

  // "Corto y envido": corta el mus y envida a la Grande a la vez.
  handle(socket, 'game:cutAndBet', async ({ session, payload }) => {
    const { amount } = validate.object(payload);
    const { room, game, seat } = requireGame(session.playerId);
    game.cutAndBet(seat, amount);
    markActive(room, session.playerId);
    broadcastGame(room);
    return null;
  });

  handle(socket, 'game:discard', async ({ session, payload }) => {
    const { cardIds } = validate.object(payload);
    const { room, game, seat } = requireGame(session.playerId);
    game.discard(seat, cardIds);
    markActive(room, session.playerId);
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

  // El jugador ausente vuelve a tomar el control de su asiento.
  handle(socket, 'game:resume', async ({ session }) => {
    const { room } = requireGame(session.playerId);
    markActive(room, session.playerId);
    broadcastGame(room);
    return null;
  });

  // Frases rápidas: las ve toda la mesa.
  handle(socket, 'game:emote', async ({ session, payload }) => {
    const { id } = validate.object(payload);
    if (!QUICK_PHRASES.includes(id)) throw new AppError('INVALID_PHRASE', 'Frase no válida');
    const room = requireRoom(session.playerId);
    const seat = room.seatOf(session.playerId);
    const now = Date.now();
    if (now - (lastEmoteAt.get(session.playerId) ?? 0) < EMOTE_COOLDOWN_MS) {
      throw new AppError('EMOTE_COOLDOWN', 'Espera un poco antes de otra frase');
    }
    lastEmoteAt.set(session.playerId, now);
    for (const m of room.members()) {
      if (!m.isBot) emitToPlayer(m.playerId, 'game:emote', { seat, id, at: now, username: session.username });
    }
    return null;
  });

  // Apuestas: paso, envido, subir, órdago, quiero, no quiero.
  handle(socket, 'game:bet', async ({ session, payload }) => {
    const { action, amount } = validate.object(payload);
    const { room, game, seat } = requireGame(session.playerId);
    game.bet(seat, action, amount);
    markActive(room, session.playerId);
    broadcastGame(room);
    return null;
  });

  // Conteo: cuando todos los humanos pulsan "continuar" se reparte sin esperar.
  handle(socket, 'game:continue', async ({ session }) => {
    const { room, game, seat } = requireGame(session.playerId);
    if (game.phase !== PHASES.SCORING) throw new AppError('INVALID_PHASE', 'No hay ninguna mano que continuar');
    if (!game.continueVotes.includes(seat)) game.continueVotes.push(seat);
    const humans = room.members().filter((m) => !m.isBot).map((m) => room.seatOf(m.playerId));
    if (humans.every((s) => game.continueVotes.includes(s))) startNextHand(room, game);
    else broadcastGame(room);
    return null;
  });

  // Tras el final de la partida, la mesa vuelve a la sala de espera.
  handle(socket, 'room:reset', async ({ session }) => {
    const room = requireRoom(session.playerId);
    if (!room.game || room.game.phase !== PHASES.FINISHED) {
      throw new AppError('INVALID_PHASE', 'La partida todavía no ha terminado');
    }
    clearHandFlow(room.code);
    clearTurnTimer(room.code);
    bots.cancel(room.code);
    settleSubstitutes(room);
    room.abortGame();
    if (room.humanCount === 0) {
      closeRoom(room);
      return null;
    }
    broadcastRoom(room);
    return room.toPublic();
  });

  // Solo pruebas: reparte una mano nueva.
  handle(socket, 'game:devRedeal', async ({ session }) => {
    if (!config.devTools) throw new AppError('FORBIDDEN', 'Herramientas de prueba desactivadas');
    const { room, game } = requireGame(session.playerId);
    clearHandFlow(room.code);
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
    notifyPresence(session.playerId);

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
  for (const code of nextHandTimers.keys()) clearHandFlow(code);
  for (const code of turnTimers.keys()) clearTurnTimer(code);
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
