'use strict';

const { PHASES, BETTING_PHASES, MIN_DISCARD } = require('../game/constants');
const { paresInfo, juegoInfo, sumPoints } = require('../game/handEvaluator');

const BOT_NAMES = ['Nora', 'Iker', 'Lúa', 'Bruno', 'Vera', 'Teo', 'Alba', 'Gael'];

/** Agrupa la mano por valor de Grande/Chica (con 8 reyes, el 3 cuenta como rey). */
function handFeatures(hand) {
  const counts = new Map();
  for (const c of hand) counts.set(c.strength, (counts.get(c.strength) ?? 0) + 1);
  const groups = [...counts.values()];
  const points = hand.reduce((sum, c) => sum + c.points, 0);
  return {
    counts,
    hasPairs: groups.some((n) => n >= 2),
    hasMedias: groups.some((n) => n >= 3),
    hasDuples: groups.filter((n) => n >= 2).length >= 2 || groups.some((n) => n === 4),
    points,
    reyes: counts.get(12) ?? 0,
  };
}

/** ¿Quiere mus? Corta con buenas manos y, si no, casi siempre pide mus. */
function decideMus(hand, random = Math.random) {
  const f = handFeatures(hand);
  if (f.points === 31 || f.hasMedias || f.hasDuples || f.reyes >= 3) return false;
  if (f.hasPairs && f.points >= 31) return false;
  return random() < 0.85;
}

/** Se queda con reyes y parejas; descarta el resto (mínimo una carta). */
function chooseDiscard(hand) {
  const { counts } = handFeatures(hand);
  const keep = (c) => c.strength === 12 || (counts.get(c.strength) ?? 0) >= 2;
  let discard = hand.filter((c) => !keep(c));
  if (discard.length < MIN_DISCARD) {
    // Mano "perfecta" para él: suelta la carta de menos valor.
    discard = [...hand].sort((a, b) => a.strength - b.strength).slice(0, MIN_DISCARD);
  }
  return discard.map((c) => c.id);
}

/** Fuerza estimada (0–1) de una mano para un lance. */
function lanceStrength(lance, hand) {
  const count = (v) => hand.filter((c) => c.strength === v).length;
  switch (lance) {
    case PHASES.GRANDE:
      return [0.12, 0.42, 0.74, 0.92, 1][count(12)];
    case PHASES.CHICA:
      return [0.12, 0.42, 0.74, 0.92, 1][count(1)];
    case PHASES.PARES: {
      const p = paresInfo(hand);
      if (!p) return 0;
      const r = p.ranks[0] / 12;
      if (p.kind === 'duples') return 0.86 + r * 0.12;
      if (p.kind === 'medias') return 0.66 + r * 0.2;
      return 0.25 + r * 0.4;
    }
    case PHASES.JUEGO: {
      const { points } = juegoInfo(hand);
      if (points === 31) return 0.95;
      if (points === 32) return 0.78;
      if (points === 40) return 0.62;
      return 0.42;
    }
    case PHASES.PUNTO:
      return (sumPoints(hand) / 30) * 0.92;
    default:
      return 0.3;
  }
}

/**
 * Decide una apuesta: [acción, piedras?]. Arriesga con manos buenas, acepta
 * envites pequeños con manos medias y rara vez lanza órdago.
 */
function decideBet(game, seat, random = Math.random) {
  const round = game.betting;
  const s = lanceStrength(game.phase, game.hands[seat]);
  if (round.stage === 'SPEAKING') {
    if (s > 0.9 && random() < 0.12) return ['ordago'];
    if (s > 0.62) return ['envido', s > 0.82 && random() < 0.5 ? 4 : 2];
    return ['paso'];
  }
  const { bet } = round;
  if (bet.ordago) return [s > 0.84 ? 'quiero' : 'no_quiero'];
  if (s > 0.86 && bet.current < 10 && random() < 0.35) return ['subir', 2];
  const threshold = bet.current <= 2 ? 0.45 : bet.current <= 5 ? 0.6 : 0.74;
  return [s >= threshold ? 'quiero' : 'no_quiero'];
}

/**
 * Hace jugar a los asientos ocupados por bots. Tras cada cambio de estado se
 * programa como mucho una acción por sala, con un retardo "humano"; cuando se
 * ejecuta, `onAction` vuelve a difundir el estado y el ciclo continúa.
 */
// Pausas extra (ms) para que un humano pueda seguir la partida: el reparto y
// el descarte tienen animación, y al cerrarse un lance conviene leer qué pasó.
const PAUSES = Object.freeze({
  HAND_STARTED: 2400,
  DISCARD_RESOLVED: 1800,
  MUS_CUT: 1400,
  LANCE_CLOSED: 1500,
  ORDAGO: 1800,
});

function extraPause(action) {
  if (!action) return 0;
  if (action.type === 'HAND_STARTED') return PAUSES.HAND_STARTED;
  if (action.type === 'DISCARD_RESOLVED') return PAUSES.DISCARD_RESOLVED;
  if (action.type === 'MUS_CUT') return PAUSES.MUS_CUT;
  if (action.type === 'BET' && action.action === 'ordago') return PAUSES.ORDAGO;
  if (action.type === 'BET' && action.closed) return PAUSES.LANCE_CLOSED;
  return 0;
}

class BotController {
  /**
   * @param {object} opts
   * @param {number} [opts.minDelayMs]  tiempo mínimo de "pensar"
   * @param {number} [opts.maxDelayMs]  tiempo máximo de "pensar"
   * @param {number} [opts.pauseScale]  multiplicador de las pausas extra (0 = sin pausas)
   */
  constructor({ onAction, minDelayMs = 1300, maxDelayMs = 2300, pauseScale = 1, random = Math.random } = {}) {
    this.onAction = onAction;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.pauseScale = pauseScale;
    this.random = random;
    this.timers = new Map(); // code -> Timeout
  }

  cancel(code) {
    const t = this.timers.get(code);
    if (t) clearTimeout(t);
    this.timers.delete(code);
  }

  cancelAll() {
    for (const code of this.timers.keys()) this.cancel(code);
  }

  _nextAction(room) {
    const game = room.game;
    if (!game) return null;
    const isBot = (seat) => room.seats[seat]?.isBot;

    if (game.phase === PHASES.MUS && game.turn !== null && isBot(game.turn)) {
      const seat = game.turn;
      return () => {
        const wantsMus = decideMus(game.hands[seat], this.random);
        // Con buena Grande, a veces corta envidando directamente.
        if (!wantsMus && lanceStrength(PHASES.GRANDE, game.hands[seat]) > 0.7 && this.random() < 0.5) {
          game.cutAndBet(seat, 2);
        } else {
          game.declareMus(seat, wantsMus);
        }
      };
    }
    if (game.phase === PHASES.DISCARD) {
      const seat = game.playOrder().find((s) => isBot(s) && !game.pendingDiscards.has(s));
      if (seat !== undefined) return () => game.discard(seat, chooseDiscard(game.hands[seat]));
    }
    if (BETTING_PHASES.includes(game.phase) && game.betting && game.turn !== null && isBot(game.turn)) {
      const seat = game.turn;
      return () => {
        const [action, amount] = decideBet(game, seat, this.random);
        game.bet(seat, action, amount);
      };
    }
    return null;
  }

  onState(room) {
    this.cancel(room.code);
    const action = this._nextAction(room);
    if (!action) return;

    const game = room.game;
    const version = game.version;
    const delay =
      this.minDelayMs +
      this.random() * (this.maxDelayMs - this.minDelayMs) +
      extraPause(game.lastAction) * this.pauseScale;
    const timer = setTimeout(() => {
      this.timers.delete(room.code);
      // El estado puede haber cambiado mientras "pensaba".
      if (room.game !== game || game.version !== version) return;
      try {
        action();
        this.onAction(room);
      } catch (err) {
        console.error(`🤖 Error de bot en la sala ${room.code}:`, err.message);
      }
    }, delay);
    timer.unref();
    this.timers.set(room.code, timer);
  }
}

module.exports = { BotController, BOT_NAMES, decideMus, chooseDiscard, decideBet, lanceStrength, handFeatures };
