'use strict';

const SUITS = Object.freeze(['oros', 'copas', 'espadas', 'bastos']);

// Baraja española de 40 cartas: sin 8 ni 9.
const RANKS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 10, 11, 12]);

const RANK_NAMES = Object.freeze({
  1: 'As',
  2: 'Dos',
  3: 'Tres',
  4: 'Cuatro',
  5: 'Cinco',
  6: 'Seis',
  7: 'Siete',
  10: 'Sota',
  11: 'Caballo',
  12: 'Rey',
});

const SEATS = 4;
const HAND_SIZE = 4;
const MIN_DISCARD = 1;
const MAX_DISCARD = 4;

/**
 * Máquina de estados de una mano. El servidor es la única fuente de verdad:
 * cualquier acción fuera de su fase se rechaza.
 *
 *   WAITING ─▶ MUS ─┬─(todos "mus")─▶ DISCARD ─▶ MUS ...
 *                   └─(alguien corta)─▶ GRANDE ─▶ CHICA ─▶ PARES ─▶ JUEGO|PUNTO ─▶ SCORING ─▶ MUS (nueva mano)
 *                                                                                         └─▶ FINISHED
 */
const PHASES = Object.freeze({
  WAITING: 'WAITING',
  MUS: 'MUS',
  DISCARD: 'DISCARD',
  GRANDE: 'GRANDE',
  CHICA: 'CHICA',
  PARES: 'PARES',
  JUEGO: 'JUEGO',
  PUNTO: 'PUNTO',
  SCORING: 'SCORING',
  FINISHED: 'FINISHED',
});

const BETTING_PHASES = Object.freeze([PHASES.GRANDE, PHASES.CHICA, PHASES.PARES, PHASES.JUEGO, PHASES.PUNTO]);

// Señas que un jugador puede pasar a su compañero (solo él las ve).
const SIGNALS = Object.freeze([
  'dos-reyes',
  'tres-reyes',
  'duples',
  'dos-ases',
  'tres-ases',
  'treinta-y-una',
  'juego',
  'ciego',
]);

// Frases rápidas para toda la mesa (el texto vive en el cliente).
const QUICK_PHRASES = Object.freeze([
  'buena', 'bien-jugado', 'suerte', 'venga-ya', 'me-la-juego', 'piensalo', 'gracias', 'uy', 'jaja', 'aplausos',
  'todo-lo-que-llevas', 'calentitos', 'farol', 'dos-reyes', 'sufrir', 'echa-el-resto', 'juegas-o-miras',
  'temblar', 'perdido', 'llorad',
]);

// Asientos 0 y 2 forman la pareja 0; asientos 1 y 3, la pareja 1.
// El turno avanza en orden creciente de asiento (sentido antihorario en la mesa).
const teamOf = (seat) => seat % 2;
const partnerOf = (seat) => (seat + 2) % SEATS;
const nextSeat = (seat) => (seat + 1) % SEATS;
const prevSeat = (seat) => (seat + SEATS - 1) % SEATS;

module.exports = {
  SUITS,
  RANKS,
  RANK_NAMES,
  SEATS,
  HAND_SIZE,
  MIN_DISCARD,
  MAX_DISCARD,
  PHASES,
  BETTING_PHASES,
  SIGNALS,
  QUICK_PHRASES,
  teamOf,
  partnerOf,
  nextSeat,
  prevSeat,
};
