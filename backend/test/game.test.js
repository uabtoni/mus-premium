'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Deck } = require('../src/game/Deck');
const { MusGame } = require('../src/game/MusGame');
const { PHASES } = require('../src/game/constants');

const players = () => [0, 1, 2, 3].map((i) => ({ playerId: `p${i}`, username: `Jugador ${i}` }));

const allCardIds = (game) => [
  ...game.hands.flat(),
  ...game.deck.drawPile,
  ...game.deck.discardPile,
].map((c) => c.id);

test('la baraja tiene 40 cartas únicas sin 8 ni 9', () => {
  const deck = new Deck();
  assert.equal(deck.remaining, 40);
  assert.equal(new Set(deck.drawPile.map((c) => c.id)).size, 40);
  assert.ok(deck.drawPile.every((c) => c.rank !== 8 && c.rank !== 9));
});

test('con 8 reyes el 3 vale como rey y el 2 como as', () => {
  const cards = Deck.buildCards(true);
  const tres = cards.find((c) => c.id === 'oros-3');
  const dos = cards.find((c) => c.id === 'oros-2');
  assert.deepEqual([tres.strength, tres.points], [12, 10]);
  assert.deepEqual([dos.strength, dos.points], [1, 1]);
  const sota = cards.find((c) => c.id === 'copas-10');
  assert.equal(sota.points, 10);
  const tresNormal = Deck.buildCards(false).find((c) => c.id === 'oros-3');
  assert.deepEqual([tresNormal.strength, tresNormal.points], [3, 3]);
});

test('el reparto da 4 cartas a cada jugador y empieza la mano en la fase de Mus', () => {
  const game = new MusGame({ players: players(), firstMano: 1 });
  game.startHand();
  assert.equal(game.phase, PHASES.MUS);
  assert.equal(game.turn, 1);
  assert.equal(game.dealer, 0);
  assert.ok(game.hands.every((h) => h.length === 4));
  assert.equal(game.deck.remaining, 24);
  assert.equal(new Set(allCardIds(game)).size, 40);
});

test('solo puede hablar el jugador en turno y cortar abre Grande', () => {
  const game = new MusGame({ players: players(), firstMano: 0 });
  game.startHand();
  assert.throws(() => game.declareMus(2, true), { code: 'NOT_YOUR_TURN' });
  game.declareMus(0, true);
  assert.equal(game.turn, 1);
  assert.throws(() => game.declareMus(1, 'si'), { code: 'INVALID_PAYLOAD' });
  game.declareMus(1, false);
  assert.equal(game.phase, PHASES.GRANDE);
  assert.equal(game.turn, 0);
  assert.throws(() => game.declareMus(2, true), { code: 'INVALID_PHASE' });
});

test('el descarte valida las cartas y repone la mano', () => {
  const game = new MusGame({ players: players(), firstMano: 0 });
  game.startHand();
  for (let s = 0; s < 4; s += 1) game.declareMus(s, true);
  assert.equal(game.phase, PHASES.DISCARD);
  assert.equal(game.turn, null);

  const foreign = game.hands[1][0].id;
  assert.throws(() => game.discard(0, [foreign]), { code: 'CARD_NOT_IN_HAND' });
  assert.throws(() => game.discard(0, []), { code: 'INVALID_DISCARD_COUNT' });
  const own = game.hands[0][0].id;
  assert.throws(() => game.discard(0, [own, own]), { code: 'DUPLICATE_CARDS' });

  game.discard(0, [own]);
  assert.throws(() => game.discard(0, [game.hands[0][1].id]), { code: 'ALREADY_DISCARDED' });
  game.discard(1, game.hands[1].slice(0, 2).map((c) => c.id));
  game.discard(2, game.hands[2].slice(0, 3).map((c) => c.id));
  game.discard(3, game.hands[3].map((c) => c.id));

  assert.equal(game.phase, PHASES.MUS);
  assert.equal(game.turn, 0);
  assert.deepEqual(game.lastDiscardCounts, [1, 2, 3, 4]);
  assert.ok(game.hands.every((h) => h.length === 4));
  assert.ok(!game.hands[0].some((c) => c.id === own));
  assert.equal(game.deck.remaining, 24 - 10);
  assert.equal(game.deck.discarded, 10);
  assert.equal(new Set(allCardIds(game)).size, 40);
});

test('muchas rondas de mus reciclan los descartes sin perder ni duplicar cartas', () => {
  const game = new MusGame({ players: players(), firstMano: 2 });
  game.startHand();
  for (let round = 0; round < 10; round += 1) {
    for (const s of game.playOrder()) game.declareMus(s, true);
    for (let s = 0; s < 4; s += 1) game.discard(s, game.hands[s].map((c) => c.id));
    assert.ok(game.hands.every((h) => h.length === 4));
    const ids = allCardIds(game);
    assert.equal(ids.length, 40);
    assert.equal(new Set(ids).size, 40);
  }
  assert.equal(game.musRounds, 10);
});

test('la vista de un jugador nunca incluye las cartas de los demás', () => {
  const game = new MusGame({ players: players(), firstMano: 0 });
  game.startHand();
  const view = game.getStateFor(2);
  assert.equal(view.you.hand.length, 4);
  assert.equal(view.you.partner, 0);
  const json = JSON.stringify(view);
  for (const seat of [0, 1, 3]) {
    for (const card of game.hands[seat]) assert.ok(!json.includes(`"${card.id}"`), `fuga de ${card.id}`);
  }
  assert.equal(game.getStateFor(null).you, null);
});

test('la mano rota y el marcador cuenta juegos', () => {
  const game = new MusGame({ players: players(), firstMano: 3, stonesPerGame: 40, gamesToWin: 2 });
  game.startHand();
  game.phase = PHASES.SCORING; // simulamos el final de una mano
  game.startHand();
  assert.equal(game.mano, 0);
  assert.equal(game.handNumber, 2);

  assert.deepEqual(game.addStones(1, 39), { gameWon: false, matchWon: false });
  assert.deepEqual(game.addStones(1, 5), { gameWon: true, matchWon: false });
  assert.deepEqual(game.stones, [0, 0]);
  assert.deepEqual(game.addStones(1, 40), { gameWon: true, matchWon: true });
  assert.equal(game.winnerTeam, 1);
  assert.equal(game.phase, PHASES.FINISHED);
  assert.throws(() => game.addStones(0, 1), { code: 'GAME_FINISHED' });
});

test('rechaza jugadores repetidos o incompletos', () => {
  assert.throws(() => new MusGame({ players: players().slice(0, 3) }), { code: 'INVALID_PLAYERS' });
  const dup = players();
  dup[3].playerId = 'p0';
  assert.throws(() => new MusGame({ players: dup }), { code: 'INVALID_PLAYERS' });
});
