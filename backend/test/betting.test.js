'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCard } = require('../src/game/Deck');
const ev = require('../src/game/handEvaluator');
const { BettingRound } = require('../src/game/BettingRound');
const { MusGame } = require('../src/game/MusGame');
const { PHASES } = require('../src/game/constants');

const SUITS = ['oros', 'copas', 'espadas', 'bastos'];
/** Mano a partir de rangos; los palos rotan para que no haya ids repetidos. */
const hand = (...ranks) => ranks.map((r, i) => createCard(SUITS[i % 4], r, true));

const players = () => [0, 1, 2, 3].map((i) => ({ playerId: `p${i}`, username: `J${i}` }));

/** Partida en fase GRANDE con manos fijadas. La mano es el asiento 0. */
function gameWithHands(hands, opts = {}) {
  const game = new MusGame({ players: players(), firstMano: 0, ...opts });
  game.startHand();
  game.hands = hands;
  game.declareMus(0, false); // corta la mano → Grande
  return game;
}

// ───────────────────────────── Evaluador ─────────────────────────────

test('grande y chica comparan carta a carta', () => {
  assert.ok(ev.compareGrande(hand(12, 12, 4, 4), hand(12, 11, 11, 11)) > 0);
  assert.ok(ev.compareGrande(hand(12, 1, 1, 1), hand(11, 11, 11, 11)) > 0);
  assert.ok(ev.compareChica(hand(1, 1, 4, 5), hand(1, 4, 4, 4)) > 0);
  assert.equal(ev.compareGrande(hand(12, 7, 6, 5), hand(12, 7, 6, 5)), 0);
  // Con 8 reyes el 3 es rey y el 2 es as.
  assert.equal(ev.compareGrande(hand(3, 3, 1, 1), hand(12, 12, 2, 2)), 0);
});

test('pares: duples > medias > par, y dentro de cada uno manda el rango', () => {
  assert.equal(ev.paresInfo(hand(4, 5, 6, 7)), null);
  assert.equal(ev.paresInfo(hand(12, 12, 4, 5)).kind, 'par');
  assert.equal(ev.paresInfo(hand(12, 12, 12, 5)).kind, 'medias');
  assert.equal(ev.paresInfo(hand(12, 12, 5, 5)).kind, 'duples');
  assert.equal(ev.paresInfo(hand(7, 7, 7, 7)).kind, 'duples');
  assert.equal(ev.paresInfo(hand(3, 12, 4, 5)).kind, 'par'); // 3 + rey = pareja de reyes
  assert.ok(ev.comparePares(hand(4, 4, 5, 5), hand(12, 12, 12, 1)) > 0);
  assert.ok(ev.comparePares(hand(12, 12, 12, 1), hand(1, 1, 4, 5)) > 0);
  assert.ok(ev.comparePares(hand(12, 12, 4, 5), hand(11, 11, 12, 10)) > 0);
  assert.ok(ev.comparePares(hand(12, 12, 4, 4), hand(12, 12, 1, 1)) > 0); // reyes y cuatros > reyes y ases
});

test('juego: 31 > 32 > 40 > 37 > … > 33; sin juego no compite', () => {
  assert.deepEqual(ev.juegoInfo(hand(12, 11, 10, 1)), { points: 31, hasJuego: true, rank: 0, bonus: 3 });
  assert.equal(ev.juegoInfo(hand(12, 12, 12, 10)).points, 40);
  assert.ok(ev.compareJuego(hand(12, 11, 7, 5), hand(12, 12, 12, 12)) > 0); // 32 > 40
  assert.ok(ev.compareJuego(hand(12, 12, 12, 12), hand(12, 12, 7, 6)) > 0); // 40 > 33
  assert.equal(ev.hasJuego(hand(7, 7, 7, 7)), false); // 28
  assert.ok(ev.comparePunto(hand(7, 7, 7, 7), hand(7, 7, 7, 6)) > 0); // 28 > 27
});

test('en empate gana el más cercano a la mano', () => {
  const hands = [hand(12, 4, 5, 6), hand(12, 4, 5, 6), hand(1, 1, 4, 4), hand(1, 1, 4, 4)];
  assert.equal(ev.bestSeat('GRANDE', hands, [0, 1, 2, 3]), 0);
  assert.equal(ev.bestSeat('GRANDE', hands, [1, 2, 3, 0]), 1);
  assert.equal(ev.bestSeat('CHICA', hands, [3, 0, 1, 2]), 3);
});

// ───────────────────────────── Apuestas ─────────────────────────────

test('si todos pasan el lance queda en paso', () => {
  const r = new BettingRound({ lance: 'GRANDE', eligible: [0, 1, 2, 3] });
  for (const s of [0, 1, 2, 3]) r.act(s, 'paso');
  assert.deepEqual(r.result, { type: 'PASO' });
});

test('envido no querido por ambos rivales: el que envida cobra 1', () => {
  const r = new BettingRound({ lance: 'GRANDE', eligible: [0, 1, 2, 3] });
  r.act(0, 'envido', 2);
  assert.equal(r.turn, 1);
  assert.deepEqual(r.allowedActions(1), ['quiero', 'no_quiero', 'subir', 'ordago']);
  assert.throws(() => r.act(2, 'quiero'), { code: 'NOT_YOUR_TURN' });
  r.act(1, 'no_quiero');
  assert.equal(r.turn, 3, 'el compañero aún puede querer');
  r.act(3, 'no_quiero');
  assert.deepEqual(r.result, { type: 'NO_QUERIDO', team: 0, stones: 1 });
});

test('subida: si no se quiere se cobra lo de antes; el compañero puede querer', () => {
  const r = new BettingRound({ lance: 'CHICA', eligible: [0, 1, 2, 3] });
  r.act(0, 'paso');
  r.act(1, 'envido', 2); // pareja 1
  assert.equal(r.turn, 2);
  r.act(2, 'subir', 3); // 5 en total
  assert.equal(r.bet.current, 5);
  assert.equal(r.turn, 3);
  r.act(3, 'no_quiero');
  assert.equal(r.turn, 1);
  r.act(1, 'quiero');
  assert.deepEqual(r.result, { type: 'QUERIDO', stake: 5, ordago: false });

  const r2 = new BettingRound({ lance: 'CHICA', eligible: [0, 1, 2, 3] });
  r2.act(0, 'envido', 2);
  r2.act(1, 'subir', 2);
  r2.act(2, 'no_quiero');
  r2.act(0, 'no_quiero');
  assert.deepEqual(r2.result, { type: 'NO_QUERIDO', team: 1, stones: 2 });
});

test('órdago: solo se puede querer o no querer', () => {
  const r = new BettingRound({ lance: 'GRANDE', eligible: [0, 1, 2, 3] });
  r.act(0, 'envido', 2);
  r.act(1, 'ordago');
  assert.deepEqual(r.allowedActions(2), ['quiero', 'no_quiero']);
  assert.throws(() => r.act(2, 'subir', 2), { code: 'INVALID_ACTION' });
  r.act(2, 'no_quiero');
  r.act(0, 'no_quiero');
  assert.deepEqual(r.result, { type: 'NO_QUERIDO', team: 1, stones: 2 });
});

test('envites fuera de rango se rechazan', () => {
  const r = new BettingRound({ lance: 'GRANDE', eligible: [0, 1, 2, 3] });
  assert.throws(() => r.act(0, 'envido', 1), { code: 'INVALID_AMOUNT' });
  assert.throws(() => r.act(0, 'envido', 2.5), { code: 'INVALID_AMOUNT' });
  assert.throws(() => r.act(0, 'quiero'), { code: 'INVALID_ACTION' });
});

// ───────────────────────────── Mano completa ─────────────────────────────

test('mano completa: lances, declaraciones y conteo', () => {
  const game = gameWithHands([
    hand(12, 12, 11, 1), // 0 (pareja 0): par de reyes, la 31
    hand(1, 1, 4, 5), //    1 (pareja 1): par de ases, 11
    hand(7, 6, 5, 4), //    2 (pareja 0): nada, 22
    hand(10, 10, 7, 7), //  3 (pareja 1): duples, 34
  ]);
  assert.equal(game.phase, PHASES.GRANDE);
  for (const s of [0, 1, 2, 3]) game.bet(s, 'paso'); // Grande en paso
  assert.equal(game.phase, PHASES.CHICA);
  for (const s of [0, 1, 2, 3]) game.bet(s, 'paso'); // Chica en paso

  assert.equal(game.phase, PHASES.PARES);
  assert.deepEqual(game.declarations.pares, [true, true, false, true]);
  assert.equal(game.turn, 0);
  game.bet(0, 'envido', 2);
  assert.equal(game.turn, 1);
  game.bet(1, 'quiero');

  assert.equal(game.phase, PHASES.JUEGO);
  assert.deepEqual(game.declarations.juego, [true, false, false, true]);
  game.bet(0, 'paso');
  assert.throws(() => game.bet(1, 'paso'), { code: 'NOT_YOUR_TURN' }); // el 1 no tiene juego
  game.bet(3, 'paso');

  assert.equal(game.phase, PHASES.SCORING);
  const r = game.handResult;
  const byLance = Object.fromEntries(r.items.map((i) => [i.lance, i]));
  assert.deepEqual([byLance.GRANDE.team, byLance.GRANDE.stones], [0, 1]);
  assert.deepEqual([byLance.CHICA.team, byLance.CHICA.stones], [1, 1]);
  assert.deepEqual([byLance.PARES.team, byLance.PARES.stones], [1, 2 + 1 + 3]); // envite + par + duples
  assert.deepEqual([byLance.JUEGO.team, byLance.JUEGO.stones], [0, 3]); // la 31
  assert.deepEqual(game.stones, [4, 7]);
  assert.equal(r.revealed.length, 4);

  // La vista del conteo enseña todas las cartas.
  assert.equal(game.getStateFor(2).handResult.revealed[1].length, 4);
  game.startHand();
  assert.equal(game.handNumber, 2);
  assert.equal(game.handResult, null);
});

test('no querido: el deje se cobra en el acto', () => {
  const game = gameWithHands([hand(12, 12, 4, 5), hand(7, 6, 5, 4), hand(7, 6, 4, 1), hand(7, 6, 5, 1)]);
  game.bet(0, 'envido', 3);
  game.bet(1, 'no_quiero');
  game.bet(3, 'no_quiero');
  assert.equal(game.phase, PHASES.CHICA);
  assert.deepEqual(game.stones, [1, 0]);
  assert.equal(game.lances.GRANDE.status, 'NO_QUERIDO');
});

test('sin juego en la mesa se juega el punto (+1 al querido)', () => {
  const game = gameWithHands([hand(7, 6, 5, 4), hand(7, 7, 6, 1), hand(4, 5, 6, 1), hand(5, 6, 4, 1)]);
  for (let i = 0; i < 2; i += 1) for (const s of [0, 1, 2, 3]) game.bet(s, 'paso');
  // Pares: solo el 1 tiene → sin apuestas; Juego: nadie → Punto
  assert.equal(game.lances.PARES.status, 'NO_BET');
  assert.equal(game.phase, PHASES.PUNTO);
  game.bet(0, 'envido', 2);
  game.bet(1, 'quiero');
  const punto = game.handResult.items.find((i) => i.lance === 'PUNTO');
  // 0 → 22, 1 → 21: gana la pareja 0 con 2 + 1
  assert.deepEqual([punto.team, punto.stones], [0, 3]);
});

test('órdago querido: se resuelve al instante y da el juego', () => {
  const game = gameWithHands([hand(12, 12, 12, 4), hand(11, 11, 5, 4), hand(7, 6, 5, 4), hand(7, 6, 5, 1)], { gamesToWin: 3 });
  game.bet(0, 'ordago');
  game.bet(1, 'quiero');
  assert.equal(game.phase, PHASES.SCORING);
  assert.deepEqual(game.handResult.ordago, { lance: 'GRANDE', team: 0, seat: 0 });
  assert.equal(game.handResult.gameWinner, 0);
  assert.deepEqual(game.games, [1, 0]);
  assert.deepEqual(game.stones, [0, 0]);
});

test('llegar a 40 en el conteo corta el resto y puede acabar la partida', () => {
  const game = gameWithHands(
    [hand(12, 12, 11, 1), hand(1, 1, 4, 5), hand(7, 6, 5, 4), hand(10, 10, 7, 7)],
    { gamesToWin: 1 },
  );
  game.stones = [39, 0];
  for (const s of [0, 1, 2, 3]) game.bet(s, 'paso'); // Grande: +1 → 40
  for (const s of [0, 1, 2, 3]) game.bet(s, 'paso');
  game.bet(0, 'paso');
  game.bet(1, 'paso');
  game.bet(3, 'paso');
  game.bet(0, 'paso');
  game.bet(3, 'paso');
  const r = game.handResult;
  assert.equal(r.gameWinner, 0);
  assert.equal(r.matchWinner, 0);
  assert.equal(game.phase, PHASES.FINISHED);
  assert.equal(r.items.find((i) => i.lance === 'CHICA').counted, false);
  assert.throws(() => game.startHand(), { code: 'INVALID_PHASE' });
});

test('estrés: partidas completas con acciones aleatorias válidas', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const random = (min, max) => min + Math.floor(rnd() * (max - min));

  for (let match = 0; match < 25; match += 1) {
    const game = new MusGame({ players: players(), random });
    game.startHand();
    let steps = 0;
    while (game.phase !== PHASES.FINISHED) {
      steps += 1;
      assert.ok(steps < 20000, 'la partida no avanza');
      if (game.phase === PHASES.SCORING) {
        const total = game.handResult.items.reduce((s, i) => s + (i.counted ? i.stones : 0), 0);
        assert.ok(total >= 0);
        game.startHand();
      } else if (game.phase === PHASES.MUS) {
        game.declareMus(game.turn, rnd() < 0.4);
      } else if (game.phase === PHASES.DISCARD) {
        for (let s = 0; s < 4; s += 1) {
          if (!game.pendingDiscards.has(s)) game.discard(s, game.hands[s].slice(0, 1 + random(0, 4)).map((c) => c.id));
        }
      } else {
        const seat = game.turn;
        const actions = game.betting.allowedActions(seat);
        const action = actions[random(0, actions.length)];
        game.bet(seat, action, action === 'envido' || action === 'subir' ? 2 + random(0, 4) : undefined);
      }
      assert.ok(game.stones.every((v) => v >= 0 && v < 40));
      for (const h of game.hands) assert.equal(h.length, 4);
    }
    assert.equal(Math.max(...game.games), game.options.gamesToWin);
    assert.ok(game.winnerTeam === 0 || game.winnerTeam === 1);
  }
});

test('corto y envido: corta el mus y envida a la Grande en el mismo acto', () => {
  const game = new MusGame({ players: players(), firstMano: 0 });
  game.startHand();
  game.declareMus(0, true); // la mano pide mus
  assert.throws(() => game.cutAndBet(1, 1), { code: 'INVALID_AMOUNT' });
  assert.equal(game.phase, PHASES.MUS, 'un envite inválido no corta');
  game.cutAndBet(1, 3);
  assert.equal(game.phase, PHASES.GRANDE);
  assert.equal(game.betting.bet.current, 3);
  assert.equal(game.betting.bet.team, 1);
  assert.equal(game.turn, 2, 'responde la pareja contraria, empezando por el siguiente');
  assert.deepEqual(game.betting.history, [{ seat: 1, action: 'envido', amount: 3 }]);
  assert.equal(game.lastAction.cut, true);
  game.bet(2, 'no_quiero');
  game.bet(0, 'no_quiero');
  assert.deepEqual(game.stones, [0, 1]);
  assert.equal(game.phase, PHASES.CHICA);
});

test('la partida termina al llegar a 40 y guarda las piedras finales', () => {
  const game = new MusGame({ players: players(), firstMano: 0 });
  game.startHand();
  game.hands = [hand(12, 12, 12, 4), hand(11, 11, 5, 4), hand(7, 6, 5, 4), hand(7, 6, 5, 1)];
  game.stones = [35, 22];
  game.cutAndBet(0, 10);
  game.bet(1, 'quiero');
  while (game.betting) game.bet(game.turn, 'paso');

  // La Grande querida (10) lleva a la pareja 0 a 40: fin de partida, sin más manos.
  assert.equal(game.phase, PHASES.FINISHED);
  assert.equal(game.winnerTeam, 0);
  assert.equal(game.handResult.items.find((i) => i.lance === 'CHICA').counted, false);
  assert.deepEqual(game.getStateFor(0).score.history, [{ winner: 0, stones: [40, 22] }]);
  assert.throws(() => game.startHand(), { code: 'INVALID_PHASE' });
});
