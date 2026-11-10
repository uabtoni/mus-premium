'use strict';

process.env.DB_DISABLED = 'true';
process.env.LOBBY_RECONNECT_MS = '200';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { start, stop, server } = require('../server');

let url;
const clients = [];

const open = (auth) =>
  new Promise((resolve, reject) => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, auth });
    clients.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

const call = (socket, event, payload) =>
  new Promise((resolve) => (payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve)));

const nextEvent = (socket, event, predicate = () => true) =>
  new Promise((resolve) => {
    const handler = (data) => {
      if (!predicate(data)) return;
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });

test.before(async () => {
  await start(0);
  url = `http://localhost:${server.address().port}`;
});

test.after(async () => {
  for (const c of clients) c.disconnect();
  await stop();
});

test('4 jugadores crean/entran en sala, se ponen listos y reciben solo su mano', async () => {
  const sockets = await Promise.all([0, 1, 2, 3].map(() => open()));
  const users = [];
  for (const [i, s] of sockets.entries()) {
    const res = await call(s, 'login_user', { username: `Tekko${i}` });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.data.user.sessionToken);
    users.push(res.data.user);
  }

  const created = await call(sockets[0], 'room:create', { isPrivate: true });
  assert.equal(created.ok, true);
  const { code } = created.data;
  assert.match(code, /^[A-Z0-9]{6}$/);

  const bad = await call(sockets[1], 'room:join', { code: 'ZZZZZZ' });
  assert.equal(bad.error.code, 'ROOM_NOT_FOUND');

  for (const s of sockets.slice(1)) {
    const res = await call(s, 'room:join', { code });
    assert.equal(res.ok, true, JSON.stringify(res));
  }

  const statesPromise = Promise.all(sockets.map((s) => nextEvent(s, 'game:state')));
  for (const s of sockets) assert.equal((await call(s, 'room:ready', { ready: true })).ok, true);
  const states = await statesPromise;

  for (const [seat, state] of states.entries()) {
    assert.equal(state.phase, 'MUS');
    assert.equal(state.you.seat, seat);
    assert.equal(state.you.hand.length, 4);
  }
  const allIds = states.flatMap((st) => st.you.hand.map((c) => c.id));
  assert.equal(new Set(allIds).size, 16);

  // Fuera de turno → rechazado por el servidor
  const turn = states[0].turn;
  const wrong = (turn + 1) % 4;
  assert.equal((await call(sockets[wrong], 'game:mus', { mus: true })).error.code, 'NOT_YOUR_TURN');

  // El jugador en turno corta → Grande
  const update = nextEvent(sockets[0], 'game:state', (s) => s.phase === 'GRANDE');
  assert.equal((await call(sockets[turn], 'game:mus', { mus: false })).ok, true);
  assert.equal((await update).turn, states[0].mano);

  // Un quinto jugador no puede entrar
  const fifth = await open();
  await call(fifth, 'login_user', 'Intruso');
  assert.equal((await call(fifth, 'room:join', { code })).error.code, 'ROOM_IN_GAME');

  // Reconexión con token: recupera asiento y mano
  const oldHand = states[2].you.hand.map((c) => c.id).sort();
  sockets[2].disconnect();
  // Se escucha antes de conectar: el servidor emite 'session:restored' en el handshake.
  const restoredSocket = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { sessionToken: users[2].sessionToken },
  });
  clients.push(restoredSocket);
  const restored = await nextEvent(restoredSocket, 'session:restored');
  assert.equal(restored.user.playerId, users[2].playerId);
  assert.deepEqual(restored.game.you.hand.map((c) => c.id).sort(), oldHand);

  // Señas: solo las recibe el compañero (asiento 0 → asiento 2)
  const signal = nextEvent(restoredSocket, 'game:signal');
  let rivalGotSignal = false;
  sockets[1].on('game:signal', () => (rivalGotSignal = true));
  assert.equal((await call(sockets[0], 'game:signal', { signal: 'duples' })).ok, true);
  assert.deepEqual(
    { from: (await signal).from, signal: 'duples' },
    { from: 0, signal: 'duples' },
  );
  assert.equal((await call(sockets[0], 'game:signal', { signal: 'duples' })).error.code, 'SIGNAL_COOLDOWN');
  assert.equal((await call(restoredSocket, 'game:signal', { signal: 'trampa' })).error.code, 'INVALID_SIGNAL');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(rivalGotSignal, false);

  // Abandono durante la partida → se cancela para el resto
  const aborted = nextEvent(sockets[0], 'game:aborted');
  assert.equal((await call(sockets[1], 'room:leave')).ok, true);
  assert.equal((await aborted).playerId, users[1].playerId);
});

test('matchmaking rápido agrupa jugadores en la misma sala pública', async () => {
  const a = await open();
  const b = await open();
  await call(a, 'login_user', 'RapidoA');
  await call(b, 'login_user', 'RapidoB');
  const ra = await call(a, 'room:quickMatch');
  const rb = await call(b, 'room:quickMatch');
  assert.equal(ra.data.room.code, rb.data.room.code);
  assert.equal(rb.data.room.playerCount, 2);

  const res = await fetch(`${url}/api/rooms`);
  const list = await res.json();
  assert.ok(list.some((r) => r.code === ra.data.room.code));
});

test('acciones sin sesión o con datos inválidos se rechazan', async () => {
  const s = await open();
  assert.equal((await call(s, 'room:create', {})).error.code, 'NOT_AUTHENTICATED');
  assert.equal((await call(s, 'login_user', { username: 'x' })).error.code, 'INVALID_USERNAME');
  await call(s, 'login_user', 'Valido');
  assert.equal((await call(s, 'room:join', { code: 'abc' })).error.code, 'INVALID_ROOM_CODE');
  assert.equal((await call(s, 'room:create', { isPrivate: 'yes' })).error.code, 'INVALID_PAYLOAD');
  assert.equal((await call(s, 'game:mus', { mus: true })).error.code, 'NOT_IN_ROOM');
});

test('los bots completan la mesa y juegan el mus y el descarte', async () => {
  const s = await open();
  await call(s, 'login_user', 'Solitario');
  const { data: room } = await call(s, 'room:create', { isPrivate: true });
  await call(s, 'room:ready', { ready: true });

  const started = nextEvent(s, 'game:state');
  const res = await call(s, 'room:addBots');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.seats.filter((x) => x?.isBot).length, 3);
  let state = await started;
  assert.equal(state.phase, 'MUS');

  // Siempre pedimos mus cuando nos toca; esperamos a que los bots corten o
  // a que lleguemos al descarte.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && state.phase === 'MUS') {
    if (state.turn === state.you.seat) await call(s, 'game:mus', { mus: true });
    state = await nextEvent(s, 'game:state');
  }
  assert.ok(['DISCARD', 'GRANDE'].includes(state.phase), state.phase);

  if (state.phase === 'DISCARD') {
    const after = nextEvent(s, 'game:state', (st) => st.lastAction?.type === 'DISCARD_RESOLVED');
    await call(s, 'game:discard', { cardIds: [state.you.hand[0].id] });
    const resolved = await after;
    assert.equal(resolved.lastDiscardCounts.length, 4);
    assert.equal(resolved.you.hand.length, 4);
  }

  // Re-reparto de pruebas
  const redeal = nextEvent(s, 'game:state', (st) => st.lastAction?.type === 'HAND_STARTED');
  assert.equal((await call(s, 'game:devRedeal')).ok, true);
  assert.equal((await redeal).handNumber, 2);

  // Si el único humano se va, la sala se cierra
  await call(s, 'room:leave');
  const list = await (await fetch(`${url}/api/rooms`)).json();
  assert.ok(!list.some((r) => r.code === room.code));
});
