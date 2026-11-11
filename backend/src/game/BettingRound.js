'use strict';

const { SEATS, teamOf, nextSeat } = require('./constants');
const { AppError } = require('../errors');

const ACTIONS = Object.freeze({
  PASO: 'paso',
  ENVIDO: 'envido',
  SUBIR: 'subir',
  ORDAGO: 'ordago',
  QUIERO: 'quiero',
  NO_QUIERO: 'no_quiero',
});

const MIN_ENVIDO = 2;
const MAX_BET = 99;

/**
 * Apuestas de un lance.
 *
 *  SPEAKING: los jugadores elegibles hablan en orden desde la mano y pueden
 *            pasar, envidar o lanzar órdago. Si todos pasan → lance "en paso".
 *  RESPONDING: tras un envite, responde la pareja contraria (primero el
 *            siguiente en el orden de juego, luego su compañero). Si uno no
 *            quiere, aún puede querer o subir el compañero. Una subida (o un
 *            órdago) da la vuelta a la tortilla: ahora responde la otra pareja.
 *
 * Al cerrarse, `result` es uno de:
 *   { type: 'PASO' }
 *   { type: 'QUERIDO', stake, ordago }
 *   { type: 'NO_QUERIDO', team, stones }   ← la pareja `team` cobra `stones` ya
 */
class BettingRound {
  /**
   * @param {object} opts
   * @param {string} opts.lance
   * @param {number[]} opts.eligible  asientos que pueden hablar, ordenados desde la mano
   */
  constructor({ lance, eligible }) {
    if (!Array.isArray(eligible) || eligible.length === 0) {
      throw new AppError('INVALID_BETTING', 'No hay jugadores para apostar');
    }
    this.lance = lance;
    this.eligible = [...eligible];
    this.stage = 'SPEAKING';
    this.speakIndex = 0;
    this.turn = this.eligible[0];
    this.bet = null; // { team, current, previous, ordago, bettor }
    this.responders = [];
    this.history = []; // { seat, action, amount? }
    this.result = null;
  }

  get closed() {
    return this.result !== null;
  }

  /** Acciones permitidas para el asiento en turno (vacío si no le toca). */
  allowedActions(seat) {
    if (this.closed || seat !== this.turn) return [];
    if (this.stage === 'SPEAKING') return [ACTIONS.PASO, ACTIONS.ENVIDO, ACTIONS.ORDAGO];
    if (this.bet.ordago) return [ACTIONS.QUIERO, ACTIONS.NO_QUIERO];
    return [ACTIONS.QUIERO, ACTIONS.NO_QUIERO, ACTIONS.SUBIR, ACTIONS.ORDAGO];
  }

  act(seat, action, amount) {
    if (this.closed) throw new AppError('BETTING_CLOSED', 'Este lance ya está cerrado');
    if (seat !== this.turn) throw new AppError('NOT_YOUR_TURN', 'No es tu turno', { turn: this.turn });
    if (!this.allowedActions(seat).includes(action)) {
      throw new AppError('INVALID_ACTION', 'Esa acción no está permitida ahora');
    }

    const needsAmount = action === ACTIONS.ENVIDO || action === ACTIONS.SUBIR;
    let n;
    if (needsAmount) {
      n = amount === undefined || amount === null ? MIN_ENVIDO : amount;
      if (!Number.isInteger(n) || n < MIN_ENVIDO || n > MAX_BET) {
        throw new AppError('INVALID_AMOUNT', `El envite debe ser de ${MIN_ENVIDO} a ${MAX_BET} piedras`);
      }
    }
    this.history.push(needsAmount ? { seat, action, amount: n } : { seat, action });

    switch (action) {
      case ACTIONS.PASO:
        this.speakIndex += 1;
        if (this.speakIndex >= this.eligible.length) this._close({ type: 'PASO' });
        else this.turn = this.eligible[this.speakIndex];
        break;

      case ACTIONS.ENVIDO:
        this.bet = { team: teamOf(seat), current: n, previous: 1, ordago: false, bettor: seat };
        this._startResponding(seat);
        break;

      case ACTIONS.SUBIR:
        this.bet = { team: teamOf(seat), current: this.bet.current + n, previous: this.bet.current, ordago: false, bettor: seat };
        this._startResponding(seat);
        break;

      case ACTIONS.ORDAGO:
        this.bet = { team: teamOf(seat), current: null, previous: this.bet ? this.bet.current : 1, ordago: true, bettor: seat };
        this._startResponding(seat);
        break;

      case ACTIONS.QUIERO:
        this._close({ type: 'QUERIDO', stake: this.bet.current, ordago: this.bet.ordago });
        break;

      case ACTIONS.NO_QUIERO:
        this.responders.shift();
        if (this.responders.length > 0) this.turn = this.responders[0];
        else this._close({ type: 'NO_QUERIDO', team: this.bet.team, stones: this.bet.previous });
        break;

      default:
        throw new AppError('INVALID_ACTION', 'Acción desconocida');
    }
    return this.result;
  }

  /**
   * Da el turno directamente a `seat` (los anteriores no llegan a hablar).
   * Se usa en "corto y envido": quienes pidieron mus antes del que corta no
   * pueden envidar ya en la Grande.
   */
  skipTo(seat) {
    if (this.stage !== 'SPEAKING' || this.bet || this.history.length > 0) {
      throw new AppError('INVALID_ACTION', 'Solo se puede saltar el turno antes de que nadie hable');
    }
    const index = this.eligible.indexOf(seat);
    if (index === -1) throw new AppError('INVALID_SEAT', 'Ese jugador no habla en este lance');
    this.speakIndex = index;
    this.turn = seat;
  }

  _startResponding(fromSeat) {
    this.stage = 'RESPONDING';
    const order = [];
    let s = nextSeat(fromSeat);
    for (let i = 0; i < SEATS - 1; i += 1) {
      if (this.eligible.includes(s) && teamOf(s) !== this.bet.team) order.push(s);
      s = nextSeat(s);
    }
    this.responders = order;
    // No debería ocurrir (solo se apuesta si ambas parejas tienen elegibles).
    if (order.length === 0) this._close({ type: 'NO_QUERIDO', team: this.bet.team, stones: this.bet.previous });
    else this.turn = order[0];
  }

  _close(result) {
    this.result = result;
    this.turn = null;
    this.responders = [];
  }

  toPublic() {
    return {
      lance: this.lance,
      stage: this.stage,
      turn: this.turn,
      eligible: [...this.eligible],
      bet: this.bet ? { ...this.bet } : null,
      history: this.history.map((h) => ({ ...h })),
      result: this.result ? { ...this.result } : null,
    };
  }
}

module.exports = { BettingRound, ACTIONS, MIN_ENVIDO, MAX_BET };
