'use strict';

process.env.DB_DISABLED = 'true'; // cuentas en memoria
process.env.LOBBY_RECONNECT_MS = '200';
process.env.GAME_RECONNECT_MS = '200';
process.env.BOT_MIN_DELAY_MS = '5';
process.env.BOT_MAX_DELAY_MS = '15';
process.env.BOT_PAUSE_SCALE = '0';
process.env.NEXT_HAND_MS = '60000';
process.env.AUTH_RATE_BURST = '1000';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { start, stop, server } = require('../server');

let url;
const clients = [];

async function http(method, path, body, token) {
  const res = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

/** Conecta un socket con el token; resuelve con el socket y su 'session:ready'. */
function open(token) {
  return new Promise((resolve, reject) => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token } });
    clients.push(socket);
    socket.once('session:ready', (ready) => resolve({ socket, ready }));
    socket.once('connect_error', reject);
  });
}

/** Crea una cuenta y la conecta. */
async function player(username, password = 'secreto1') {
  const res = await http('POST', '/api/auth/register', { username, password });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { socket, ready } = await open(res.body.token);
  return { ...res.body, socket, ready };
}

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

// ───────────────────────────── Cuentas ─────────────────────────────

test('registro, login, sesión y cierre de sesión', async () => {
  const reg = await http('POST', '/api/auth/register', { username: 'Ainhoa', password: 'mus12345' });
  assert.equal(reg.status, 201);
  assert.ok(reg.body.token);
  assert.equal(reg.body.user.username, 'Ainhoa');
  assert.equal(reg.body.user.password_hash, undefined, 'el hash nunca sale del servidor');

  assert.equal((await http('POST', '/api/auth/register', { username: 'ainhoa', password: 'otra1234' })).body.code, 'USERNAME_TAKEN');
  assert.equal((await http('POST', '/api/auth/register', { username: 'Corto', password: '123' })).body.code, 'INVALID_PASSWORD');

  const bad = await http('POST', '/api/auth/login', { username: 'Ainhoa', password: 'incorrecta' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'INVALID_CREDENTIALS');
  assert.equal((await http('POST', '/api/auth/login', { username: 'Nadie', password: 'mus12345' })).status, 401);

  const ok = await http('POST', '/api/auth/login', { username: 'AINHOA', password: 'mus12345' });
  assert.equal(ok.status, 200);
  const me = await http('GET', '/api/auth/me', undefined, ok.body.token);
  assert.equal(me.body.user.username, 'Ainhoa');

  assert.equal((await http('POST', '/api/auth/logout', undefined, ok.body.token)).status, 204);
  assert.equal((await http('GET', '/api/auth/me', undefined, ok.body.token)).status, 401);
});

test('sin token válido no se puede abrir el socket', async () => {
  await assert.rejects(open('token-falso-token-falso-token-falso'), /UNAUTHORIZED/);
  await assert.rejects(open(undefined), /UNAUTHORIZED/);
});

// ───────────────────────────── Partida ─────────────────────────────

test('4 jugadores crean/entran en sala, se ponen listos y reciben solo su mano', async () => {
  const ps = [];
  for (let i = 0; i < 4; i += 1) ps.push(await player(`Mesa${i}`));
  const sockets = ps.map((p) => p.socket);

  const created = await call(sockets[0], 'room:create', { isPrivate: true });
  assert.equal(created.ok, true);
  const { code } = created.data;
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal((await call(sockets[1], 'room:join', { code: 'ZZZZZZ' })).error.code, 'ROOM_NOT_FOUND');
  for (const s of sockets.slice(1)) assert.equal((await call(s, 'room:join', { code })).ok, true);

  const statesPromise = Promise.all(sockets.map((s) => nextEvent(s, 'game:state')));
  for (const s of sockets) assert.equal((await call(s, 'room:ready', { ready: true })).ok, true);
  const states = await statesPromise;
  for (const [seat, state] of states.entries()) {
    assert.equal(state.phase, 'MUS');
    assert.equal(state.you.seat, seat);
    assert.equal(state.you.hand.length, 4);
  }
  assert.equal(new Set(states.flatMap((st) => st.you.hand.map((c) => c.id))).size, 16);

  const turn = states[0].turn;
  assert.equal((await call(sockets[(turn + 1) % 4], 'game:mus', { mus: true })).error.code, 'NOT_YOUR_TURN');
  const update = nextEvent(sockets[0], 'game:state', (s) => s.phase === 'GRANDE');
  assert.equal((await call(sockets[turn], 'game:mus', { mus: false })).ok, true);
  assert.equal((await update).turn, states[0].mano);

  const fifth = await player('Intruso');
  assert.equal((await call(fifth.socket, 'room:join', { code })).error.code, 'ROOM_IN_GAME');

  // Reconexión con el mismo token: recupera asiento y mano.
  const oldHand = states[2].you.hand.map((c) => c.id).sort();
  sockets[2].disconnect();
  const again = await open(ps[2].token);
  assert.equal(again.ready.user.playerId, `user:${ps[2].user.id}`);
  assert.deepEqual(again.ready.game.you.hand.map((c) => c.id).sort(), oldHand);

  // Señas: solo las recibe el compañero (asiento 0 → asiento 2)
  const signal = nextEvent(again.socket, 'game:signal');
  let rivalGotSignal = false;
  sockets[1].on('game:signal', () => (rivalGotSignal = true));
  assert.equal((await call(sockets[0], 'game:signal', { signal: 'duples' })).ok, true);
  assert.equal((await signal).from, 0);
  assert.equal((await call(sockets[0], 'game:signal', { signal: 'duples' })).error.code, 'SIGNAL_COOLDOWN');
  assert.equal((await call(again.socket, 'game:signal', { signal: 'trampa' })).error.code, 'INVALID_SIGNAL');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(rivalGotSignal, false);

  // Frases rápidas: las recibe toda la mesa.
  const phrase = nextEvent(sockets[1], 'game:emote');
  assert.equal((await call(sockets[0], 'game:emote', { id: 'farol' })).ok, true);
  assert.deepEqual([(await phrase).seat, (await phrase).id], [0, 'farol']);
  assert.equal((await call(sockets[0], 'game:emote', { id: 'jaja' })).error.code, 'EMOTE_COOLDOWN');
  assert.equal((await call(sockets[1], 'game:emote', { id: 'insulto' })).error.code, 'INVALID_PHRASE');

  // Abandonar ya no cancela la partida: un bot ocupa el asiento y se sigue jugando.
  const notice = nextEvent(sockets[0], 'room:notice');
  const seatUpdate = nextEvent(sockets[0], 'room:update', (r) => r.seats[1]?.isBot);
  assert.equal((await call(sockets[1], 'room:leave')).ok, true);
  assert.deepEqual([(await notice).kind, (await notice).reason], ['substituted', 'left']);
  const room = await seatUpdate;
  assert.equal(room.status, 'playing');
  assert.equal(room.seats[1].substitute, true);
  for (const s of [sockets[0], again.socket, sockets[3]]) await call(s, 'room:leave');
});

test('tiempo por turno: al agotarse se juega solo; desconexión → bot y vuelta al asiento', async () => {
  const config = require('../src/config');
  const original = config.timers.turnMs;
  config.timers.turnMs = 300;
  try {
    const ps = [];
    for (let i = 0; i < 4; i += 1) ps.push(await player(`Reloj${i}`));
    const { data: room } = await call(ps[0].socket, 'room:create', { isPrivate: true });
    for (const p of ps.slice(1)) await call(p.socket, 'room:join', { code: room.code });
    const first = nextEvent(ps[0].socket, 'game:state');
    for (const p of ps) await call(p.socket, 'room:ready', { ready: true });
    const st = await first;
    assert.ok(st.turnRemainingMs > 0 && st.turnRemainingMs <= 300, 'el estado trae el tiempo restante');

    // Nadie habla: el que tiene el turno pide mus automáticamente.
    const who = st.turn;
    const timeout = nextEvent(ps[who].socket, 'game:timeout');
    const after = await nextEvent(ps[0].socket, 'game:state', (s) => s.version > st.version);
    await timeout;
    assert.equal(after.players[who].saidMus, true);

    // Un jugador se cae: pasado el margen, un bot juega por él; al volver, recupera el asiento.
    config.timers.turnMs = 60000;
    const subbed = nextEvent(ps[0].socket, 'room:notice', (n) => n.kind === 'substituted');
    ps[2].socket.disconnect();
    assert.equal((await subbed).reason, 'disconnected');
    const returned = nextEvent(ps[0].socket, 'room:notice', (n) => n.kind === 'returned');
    const back = await open(ps[2].token);
    assert.equal((await returned).username, 'Reloj2');
    assert.equal(back.ready.room.seats[2].isBot, false);
    assert.equal(back.ready.game.you.hand.length, 4);
    for (const p of [ps[0], ps[1], ps[3]]) await call(p.socket, 'room:leave');
    await call(back.socket, 'room:leave');
  } finally {
    config.timers.turnMs = original;
  }
});

test('matchmaking rápido agrupa jugadores en la misma sala pública', async () => {
  const a = await player('RapidoA');
  const b = await player('RapidoB');
  const ra = await call(a.socket, 'room:quickMatch');
  const rb = await call(b.socket, 'room:quickMatch');
  assert.equal(ra.data.room.code, rb.data.room.code);
  assert.equal(rb.data.room.playerCount, 2);
  const list = await (await fetch(`${url}/api/rooms`)).json();
  assert.ok(list.some((r) => r.code === ra.data.room.code));
  await call(a.socket, 'room:leave');
  await call(b.socket, 'room:leave');
});

test('datos inválidos se rechazan', async () => {
  const { socket: s } = await player('Valido');
  assert.equal((await call(s, 'room:join', { code: 'abc' })).error.code, 'INVALID_ROOM_CODE');
  assert.equal((await call(s, 'room:create', { isPrivate: 'yes' })).error.code, 'INVALID_PAYLOAD');
  assert.equal((await call(s, 'game:mus', { mus: true })).error.code, 'NOT_IN_ROOM');
  assert.equal((await call(s, 'friends:request', { username: 'NoExiste' })).error.code, 'USER_NOT_FOUND');
  assert.equal((await call(s, 'friends:request', { username: 'Valido' })).error.code, 'CANNOT_FRIEND_SELF');
});

// ───────────────────────────── Amigos ─────────────────────────────

test('amigos: solicitud, aceptación, presencia e invitación como compañero', async () => {
  const ana = await player('Ana');
  const beto = await player('Beto');

  const notified = nextEvent(beto.socket, 'friends:changed');
  const req = await call(ana.socket, 'friends:request', { username: 'beto' });
  assert.equal(req.ok, true, JSON.stringify(req));
  assert.equal(req.data.relation, 'outgoing');
  assert.equal((await notified).reason, 'request');
  assert.equal((await call(ana.socket, 'friends:request', { username: 'Beto' })).error.code, 'REQUEST_EXISTS');

  const incoming = (await call(beto.socket, 'friends:list')).data;
  assert.deepEqual(incoming.map((f) => [f.username, f.relation]), [['Ana', 'incoming']]);

  const accepted = nextEvent(ana.socket, 'friends:changed');
  await call(beto.socket, 'friends:respond', { userId: ana.user.id, accept: true });
  assert.equal((await accepted).reason, 'accepted');
  const anaFriends = (await call(ana.socket, 'friends:list')).data;
  assert.deepEqual(anaFriends.map((f) => [f.username, f.relation, f.presence]), [['Beto', 'friend', 'online']]);

  // Ana invita a Beto: se crea su mesa y Beto se sienta enfrente (compañero).
  const invited = nextEvent(beto.socket, 'invite:received');
  const presence = nextEvent(beto.socket, 'friends:presence', (p) => p.userId === ana.user.id && p.presence === 'room');
  const inv = await call(ana.socket, 'friends:invite', { userId: beto.user.id });
  assert.equal(inv.ok, true, JSON.stringify(inv));
  const invite = await invited;
  assert.equal(invite.from.username, 'Ana');
  await presence;

  const joined = await call(beto.socket, 'invite:respond', { id: invite.id, accept: true });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  const room = joined.data.room;
  const seatOf = (name) => room.seats.findIndex((s) => s?.username === name);
  assert.equal((seatOf('Ana') + 2) % 4, seatOf('Beto'));
  assert.equal((await call(beto.socket, 'invite:respond', { id: invite.id, accept: true })).error.code, 'INVITE_EXPIRED');

  // No se puede invitar a quien no es amigo.
  const extra = await player('Extra');
  assert.equal((await call(ana.socket, 'friends:invite', { userId: extra.user.id })).error.code, 'NOT_FRIENDS');

  await call(ana.socket, 'room:leave');
  await call(beto.socket, 'room:leave');
  await call(ana.socket, 'friends:remove', { userId: beto.user.id });
  assert.equal((await call(beto.socket, 'friends:list')).data.length, 0);
});

test('buscar rivales: dos parejas se juntan en una mesa y empieza la partida', async () => {
  async function pair(a, b) {
    const pa = await player(a);
    const pb = await player(b);
    await call(pa.socket, 'friends:request', { username: b });
    await call(pb.socket, 'friends:respond', { userId: pa.user.id, accept: true });
    const invited = nextEvent(pb.socket, 'invite:received');
    await call(pa.socket, 'friends:invite', { userId: pb.user.id });
    await call(pb.socket, 'invite:respond', { id: (await invited).id, accept: true });
    return [pa, pb];
  }
  const [a1, a2] = await pair('ParA1', 'ParA2');
  const [b1, b2] = await pair('ParB1', 'ParB2');

  const s1 = await call(a1.socket, 'room:search', { on: true });
  assert.equal(s1.data.searching, true);
  assert.equal(s1.data.isPrivate, false);

  const movedB = nextEvent(b1.socket, 'room:update', (r) => r.playerCount === 4);
  const s2 = await call(b2.socket, 'room:search', { on: true });
  assert.equal(s2.data.playerCount, 4, 'la segunda pareja entra en la mesa de la primera');
  const merged = await movedB;
  const team = (name) => merged.seats.findIndex((s) => s?.username === name) % 2;
  assert.equal(team('ParA1'), team('ParA2'));
  assert.equal(team('ParB1'), team('ParB2'));
  assert.notEqual(team('ParA1'), team('ParB1'));
  assert.equal(merged.searching, false);

  const started = nextEvent(a1.socket, 'game:state');
  for (const p of [a1, a2, b1, b2]) await call(p.socket, 'room:ready', { ready: true });
  assert.equal((await started).phase, 'MUS');
  for (const p of [a1, a2, b1, b2]) await call(p.socket, 'room:leave');
});

// ───────────────────────────── Bots ─────────────────────────────

test('los bots completan la mesa y juegan el mus y el descarte', async () => {
  const { socket: s } = await player('Solitario');
  const { data: room } = await call(s, 'room:create', { isPrivate: true });
  await call(s, 'room:ready', { ready: true });

  const started = nextEvent(s, 'game:state');
  const res = await call(s, 'room:addBots');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.seats.filter((x) => x?.isBot).length, 3);
  let state = await started;
  assert.equal(state.phase, 'MUS');

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && state.phase === 'MUS') {
    if (state.turn === state.you.seat) await call(s, 'game:mus', { mus: true });
    state = await nextEvent(s, 'game:state');
  }
  assert.ok(['DISCARD', 'GRANDE', 'CHICA'].includes(state.phase), state.phase);

  const redeal = nextEvent(s, 'game:state', (st) => st.lastAction?.type === 'HAND_STARTED');
  assert.equal((await call(s, 'game:devRedeal')).ok, true);
  assert.equal((await redeal).handNumber, 2);

  await call(s, 'room:leave');
  const list = await (await fetch(`${url}/api/rooms`)).json();
  assert.ok(!list.some((r) => r.code === room.code));
});

test('mano completa contra bots: apuestas, conteo y siguiente mano', async () => {
  const { socket: s } = await player('Apostador');
  await call(s, 'room:create', { isPrivate: true });
  await call(s, 'room:ready', { ready: true });
  const first = nextEvent(s, 'game:state');
  await call(s, 'room:addBots');
  let state = await first;

  const reachScoring = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`atascado en ${state.phase}`)), 15000);
    const onState = async (st) => {
      state = st;
      if (st.phase === 'SCORING' || st.phase === 'FINISHED') {
        clearTimeout(timer);
        s.off('game:state', onState);
        return resolve(st);
      }
      const me = st.you.seat;
      if (st.phase === 'MUS' && st.turn === me) await call(s, 'game:mus', { mus: false });
      else if (st.phase === 'DISCARD' && !st.you.pendingDiscard) await call(s, 'game:discard', { cardIds: [st.you.hand[0].id] });
      else if (st.turn === me && st.you.actions.length) {
        const action = st.you.actions.includes('paso') ? 'paso' : 'quiero';
        const res = await call(s, 'game:bet', { action });
        if (!res.ok) reject(new Error(JSON.stringify(res.error)));
      }
    };
    s.on('game:state', onState);
    onState(state);
  });

  const scored = await reachScoring;
  assert.equal(scored.handResult.revealed.length, 4);
  if (scored.phase === 'SCORING') {
    assert.ok(scored.nextHandAt > Date.now());
    assert.equal((await call(s, 'room:reset')).error.code, 'INVALID_PHASE');
    const next = nextEvent(s, 'game:state', (st) => st.lastAction?.type === 'HAND_STARTED');
    assert.equal((await call(s, 'game:continue')).ok, true);
    assert.equal((await next).handNumber, 2);
  }
  await call(s, 'room:leave');
});
