'use strict';

/**
 * Evaluación de manos de Mus. Todas las funciones trabajan con cartas que ya
 * traen `strength` (valor para Grande/Chica/Pares, con 8 reyes aplicado) y
 * `points` (valor para Juego/Punto).
 *
 * Las comparaciones devuelven > 0 si `a` es mejor que `b`, < 0 si es peor y 0
 * en empate (los empates los resuelve la cercanía a la mano, ver `bestSeat`).
 */

// Orden del juego: la 31 es la mejor, luego la 32, la 40 y de 37 a 33.
const JUEGO_ORDER = Object.freeze([31, 32, 40, 37, 36, 35, 34, 33]);

const PARES_BONUS = Object.freeze({ par: 1, medias: 2, duples: 3 });

const sumPoints = (hand) => hand.reduce((s, c) => s + c.points, 0);

function lexCompare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ─────────────────────────────── Grande / Chica ───────────────────────────────

const grandeKey = (hand) => hand.map((c) => c.strength).sort((x, y) => y - x);
const chicaKey = (hand) => hand.map((c) => c.strength).sort((x, y) => x - y);

/** Gana quien tenga la carta más alta; si empatan, la siguiente, etc. */
const compareGrande = (a, b) => lexCompare(grandeKey(a), grandeKey(b));
/** Gana quien tenga la carta más baja; si empatan, la siguiente, etc. */
const compareChica = (a, b) => -lexCompare(chicaKey(a), chicaKey(b));

// ─────────────────────────────── Pares ───────────────────────────────

/**
 * @returns {null | { kind: 'par'|'medias'|'duples', bonus: number, key: number[], ranks: number[] }}
 *  - duples: dos parejas o cuatro iguales (key: [3, alta, baja])
 *  - medias: tres iguales (key: [2, rango])
 *  - par: una pareja (key: [1, rango])
 */
function paresInfo(hand) {
  const counts = new Map();
  for (const c of hand) counts.set(c.strength, (counts.get(c.strength) ?? 0) + 1);
  const groups = [...counts.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[0] - x[0]);
  if (groups.length === 0) return null;

  const [[topRank, topCount]] = groups;
  if (topCount === 4) return { kind: 'duples', bonus: PARES_BONUS.duples, key: [3, topRank, topRank], ranks: [topRank, topRank] };
  if (groups.length === 2) {
    const ranks = [groups[0][0], groups[1][0]];
    return { kind: 'duples', bonus: PARES_BONUS.duples, key: [3, ...ranks], ranks };
  }
  if (topCount === 3) return { kind: 'medias', bonus: PARES_BONUS.medias, key: [2, topRank], ranks: [topRank] };
  return { kind: 'par', bonus: PARES_BONUS.par, key: [1, topRank], ranks: [topRank] };
}

const hasPares = (hand) => paresInfo(hand) !== null;

function comparePares(a, b) {
  const pa = paresInfo(a);
  const pb = paresInfo(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  return lexCompare(pa.key, pb.key);
}

// ─────────────────────────────── Juego / Punto ───────────────────────────────

function juegoInfo(hand) {
  const points = sumPoints(hand);
  const hasJuego = points >= 31;
  return {
    points,
    hasJuego,
    // Índice en JUEGO_ORDER: menor = mejor. Sin juego no compite.
    rank: hasJuego ? JUEGO_ORDER.indexOf(points) : Infinity,
    bonus: !hasJuego ? 0 : points === 31 ? 3 : 2,
  };
}

const hasJuego = (hand) => sumPoints(hand) >= 31;

function compareJuego(a, b) {
  return juegoInfo(b).rank - juegoInfo(a).rank;
}

/** Al punto gana la suma más alta (todas por debajo de 31). */
const comparePunto = (a, b) => sumPoints(a) - sumPoints(b);

const COMPARATORS = Object.freeze({
  GRANDE: compareGrande,
  CHICA: compareChica,
  PARES: comparePares,
  JUEGO: compareJuego,
  PUNTO: comparePunto,
});

/**
 * Asiento ganador de un lance entre `seats`, que deben venir ordenados desde
 * la mano: en empate gana el primero (el más cercano a la mano).
 */
function bestSeat(lance, hands, seats) {
  const compare = COMPARATORS[lance];
  if (!compare) throw new Error(`Lance desconocido: ${lance}`);
  let best = null;
  for (const seat of seats) {
    if (best === null || compare(hands[seat], hands[best]) > 0) best = seat;
  }
  return best;
}

/** Piedras extra que cobra un jugador por su jugada en Pares o Juego. */
function lanceBonus(lance, hand) {
  if (lance === 'PARES') return paresInfo(hand)?.bonus ?? 0;
  if (lance === 'JUEGO') return juegoInfo(hand).bonus;
  return 0;
}

/** Descripción corta de una jugada (para el conteo en el cliente). */
function describe(lance, hand) {
  const names = { 1: 'ases', 4: 'cuatros', 5: 'cincos', 6: 'seises', 7: 'sietes', 10: 'sotas', 11: 'caballos', 12: 'reyes' };
  switch (lance) {
    case 'PARES': {
      const p = paresInfo(hand);
      if (!p) return 'Sin pares';
      if (p.kind === 'duples') return p.ranks[0] === p.ranks[1] ? `Duples de ${names[p.ranks[0]]}` : `Duples ${names[p.ranks[0]]} y ${names[p.ranks[1]]}`;
      if (p.kind === 'medias') return `Medias de ${names[p.ranks[0]]}`;
      return `Par de ${names[p.ranks[0]]}`;
    }
    case 'JUEGO': {
      const j = juegoInfo(hand);
      return j.points === 31 ? 'La 31' : `Juego de ${j.points}`;
    }
    case 'PUNTO':
      return `${sumPoints(hand)} al punto`;
    default:
      return null;
  }
}

module.exports = {
  JUEGO_ORDER,
  sumPoints,
  grandeKey,
  chicaKey,
  compareGrande,
  compareChica,
  paresInfo,
  hasPares,
  comparePares,
  juegoInfo,
  hasJuego,
  compareJuego,
  comparePunto,
  bestSeat,
  lanceBonus,
  describe,
};
