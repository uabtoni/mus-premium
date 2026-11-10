'use strict';

const { PHASES, MIN_DISCARD } = require('../game/constants');

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

/**
 * Hace jugar a los asientos ocupados por bots. Tras cada cambio de estado se
 * programa como mucho una acción por sala, con un retardo "humano"; cuando se
 * ejecuta, `onAction` vuelve a difundir el estado y el ciclo continúa.
 */
class BotController {
  constructor({ onAction, minDelayMs = 650, maxDelayMs = 1500, random = Math.random } = {}) {
    this.onAction = onAction;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
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
      return () => game.declareMus(seat, decideMus(game.hands[seat], this.random));
    }
    if (game.phase === PHASES.DISCARD) {
      const seat = game.playOrder().find((s) => isBot(s) && !game.pendingDiscards.has(s));
      if (seat !== undefined) return () => game.discard(seat, chooseDiscard(game.hands[seat]));
    }
    return null;
  }

  onState(room) {
    this.cancel(room.code);
    const action = this._nextAction(room);
    if (!action) return;

    const game = room.game;
    const version = game.version;
    const delay = this.minDelayMs + this.random() * (this.maxDelayMs - this.minDelayMs);
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

module.exports = { BotController, BOT_NAMES, decideMus, chooseDiscard, handFeatures };
