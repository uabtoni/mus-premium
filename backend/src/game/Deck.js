'use strict';

const { randomInt } = require('node:crypto');
const { SUITS, RANKS, RANK_NAMES } = require('./constants');
const { AppError } = require('../errors');

/**
 * Valor de la carta según las reglas del Mus.
 *  - `strength`: valor para Grande/Chica/Pares (con 8 reyes, el 3 vale como rey y el 2 como as).
 *  - `points`:   valor para Juego/Punto (figuras = 10).
 */
function musValues(rank, ochoReyes) {
  let strength = rank;
  if (ochoReyes && rank === 3) strength = 12;
  if (ochoReyes && rank === 2) strength = 1;
  const points = strength >= 10 ? 10 : strength;
  return { strength, points };
}

function createCard(suit, rank, ochoReyes) {
  const { strength, points } = musValues(rank, ochoReyes);
  return Object.freeze({
    id: `${suit}-${rank}`,
    suit,
    rank,
    name: `${RANK_NAMES[rank]} de ${suit}`,
    strength,
    points,
  });
}

class Deck {
  /**
   * @param {object}   [opts]
   * @param {boolean}  [opts.ochoReyes=true]
   * @param {function} [opts.random] (min, max) => entero en [min, max). Por defecto crypto.randomInt
   *                                 (CSPRNG: el reparto no es predecible desde fuera).
   */
  constructor({ ochoReyes = true, random = randomInt } = {}) {
    this.ochoReyes = ochoReyes;
    this.random = random;
    this.drawPile = [];
    this.discardPile = [];
    this.reset();
  }

  static buildCards(ochoReyes = true) {
    const cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push(createCard(suit, rank, ochoReyes));
    }
    return cards;
  }

  /** Baraja nueva de 40 cartas, mezclada. */
  reset() {
    this.drawPile = Deck.buildCards(this.ochoReyes);
    this.discardPile = [];
    Deck.shuffleInPlace(this.drawPile, this.random);
    return this;
  }

  /** Fisher–Yates. */
  static shuffleInPlace(cards, random = randomInt) {
    for (let i = cards.length - 1; i > 0; i -= 1) {
      const j = random(0, i + 1);
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  get remaining() {
    return this.drawPile.length;
  }

  get discarded() {
    return this.discardPile.length;
  }

  /** Roba `count` cartas de la parte superior del mazo. */
  draw(count = 1) {
    if (!Number.isInteger(count) || count < 0) {
      throw new AppError('INVALID_DRAW', 'Número de cartas a robar no válido');
    }
    if (count > this.drawPile.length) {
      throw new AppError('DECK_EXHAUSTED', 'No quedan cartas suficientes en el mazo');
    }
    return count === 0 ? [] : this.drawPile.splice(this.drawPile.length - count, count).reverse();
  }

  discard(cards) {
    this.discardPile.push(...cards);
  }

  /**
   * Cuando el mazo se agota durante el mus, los descartes se barajan y se
   * colocan debajo de las cartas que aún queden.
   * @returns {number} cartas recicladas
   */
  recycleDiscards() {
    const recycled = Deck.shuffleInPlace(this.discardPile, this.random);
    this.discardPile = [];
    this.drawPile = recycled.concat(this.drawPile);
    return recycled.length;
  }
}

module.exports = { Deck, createCard, musValues };
