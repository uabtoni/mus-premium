'use strict';

const { randomInt } = require('node:crypto');
const { Deck } = require('./Deck');
const {
  SEATS,
  HAND_SIZE,
  MIN_DISCARD,
  MAX_DISCARD,
  PHASES,
  teamOf,
  partnerOf,
  nextSeat,
  prevSeat,
} = require('./constants');
const { AppError } = require('../errors');

/**
 * Gestor de estado autoritativo de una partida de Mus (4 jugadores, 2 vs 2).
 *
 * Responsabilidades de esta fase:
 *  - Baraja española de 40 cartas y reparto aleatorio (CSPRNG).
 *  - Rotación de la "mano" entre manos y control estricto del turno.
 *  - Fase de Mus (pedir mus / cortar) y Descarte, incluido el reciclaje de
 *    descartes cuando se agota el mazo.
 *  - Marcador de piedras y juegos.
 *  - Vistas filtradas por jugador: nadie recibe nunca las cartas de otro.
 *
 * Las fases de apuesta (Grande, Chica, Pares, Juego/Punto) se implementan en la
 * siguiente fase; de momento el corte del mus deja la partida en GRANDE.
 *
 * Toda acción válida incrementa `version`, de modo que el cliente puede
 * descartar estados antiguos que lleguen desordenados.
 */
class MusGame {
  /**
   * @param {object}   opts
   * @param {{playerId: string, username: string}[]} opts.players  4 jugadores, índice = asiento
   * @param {boolean}  [opts.ochoReyes=true]
   * @param {number}   [opts.stonesPerGame=40]
   * @param {number}   [opts.gamesToWin=3]
   * @param {number}   [opts.firstMano]  asiento que es mano en la primera mano (aleatorio si se omite)
   * @param {function} [opts.random]     (min, max) => entero; inyectable para tests
   */
  constructor({
    players,
    ochoReyes = true,
    stonesPerGame = 40,
    gamesToWin = 3,
    firstMano,
    random = randomInt,
  } = {}) {
    if (
      !Array.isArray(players) ||
      players.length !== SEATS ||
      players.some((p) => !p || typeof p.playerId !== 'string') ||
      new Set(players.map((p) => p.playerId)).size !== SEATS
    ) {
      throw new AppError('INVALID_PLAYERS', 'Se necesitan exactamente 4 jugadores distintos');
    }
    if (firstMano !== undefined && !(Number.isInteger(firstMano) && firstMano >= 0 && firstMano < SEATS)) {
      throw new AppError('INVALID_SEAT', 'Asiento de mano inicial no válido');
    }

    this.players = players.map((p, seat) =>
      Object.freeze({ seat, team: teamOf(seat), playerId: p.playerId, username: p.username }),
    );
    this.options = Object.freeze({ ochoReyes, stonesPerGame, gamesToWin });
    this.random = random;
    this.deck = new Deck({ ochoReyes, random });

    this.phase = PHASES.WAITING;
    this.handNumber = 0;
    this.mano = firstMano ?? random(0, SEATS);
    this.turn = null;
    this.hands = [[], [], [], []];

    this.musVotes = []; // asientos que han pedido mus en la ronda actual
    this.pendingDiscards = new Map(); // asiento -> ids de cartas a descartar
    this.musRounds = 0; // nº de descartes completados en esta mano
    this.lastDiscardCounts = null; // cuántas cartas pidió cada asiento en el último descarte

    this.betting = null; // estado de la ronda de apuestas (Fase 2)

    this.stones = [0, 0];
    this.games = [0, 0];
    this.winnerTeam = null;

    this.version = 0;
    this.lastAction = null;
  }

  // ───────────────────────────── Utilidades ─────────────────────────────

  get dealer() {
    return prevSeat(this.mano);
  }

  seatOf(playerId) {
    const seat = this.players.findIndex((p) => p.playerId === playerId);
    if (seat === -1) throw new AppError('NOT_IN_GAME', 'No participas en esta partida');
    return seat;
  }

  /** Orden de juego de la mano actual: empieza por la mano. */
  playOrder() {
    return Array.from({ length: SEATS }, (_, i) => (this.mano + i) % SEATS);
  }

  _assertSeat(seat) {
    if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) {
      throw new AppError('INVALID_SEAT', 'Asiento no válido');
    }
  }

  _assertPhase(...phases) {
    if (!phases.includes(this.phase)) {
      throw new AppError('INVALID_PHASE', `Acción no permitida en la fase ${this.phase}`, {
        phase: this.phase,
      });
    }
  }

  _assertTurn(seat) {
    this._assertSeat(seat);
    if (this.turn !== seat) {
      throw new AppError('NOT_YOUR_TURN', 'No es tu turno', { turn: this.turn });
    }
  }

  _commit(action) {
    this.version += 1;
    this.lastAction = { ...action, at: Date.now() };
  }

  // ─────────────────────────────── Reparto ───────────────────────────────

  /**
   * Comienza una nueva mano: baraja, reparte 4 cartas a cada jugador (de una
   * en una, empezando por la mano) y abre la fase de Mus.
   * A partir de la segunda mano, la mano pasa al siguiente asiento.
   */
  startHand() {
    this._assertPhase(PHASES.WAITING, PHASES.SCORING);

    if (this.handNumber > 0) this.mano = nextSeat(this.mano);
    this.handNumber += 1;

    this.deck.reset();
    this.hands = [[], [], [], []];
    this.musVotes = [];
    this.pendingDiscards.clear();
    this.musRounds = 0;
    this.lastDiscardCounts = null;
    this.betting = null;

    const order = this.playOrder();
    for (let round = 0; round < HAND_SIZE; round += 1) {
      for (const seat of order) this.hands[seat].push(...this.deck.draw(1));
    }

    this.phase = PHASES.MUS;
    this.turn = this.mano;
    this._commit({ type: 'HAND_STARTED', handNumber: this.handNumber, mano: this.mano, dealer: this.dealer });
  }

  /**
   * Solo para pruebas: abandona la mano en curso y reparte una nueva.
   * Mientras no existan las apuestas, permite repetir el ciclo Mus/Descarte.
   */
  forceNewHand() {
    if (this.phase === PHASES.FINISHED) throw new AppError('GAME_FINISHED', 'La partida ya ha terminado');
    this.phase = PHASES.SCORING;
    this.startHand();
  }

  // ───────────────────────────── Fase de Mus ─────────────────────────────

  /**
   * El jugador en turno pide mus (`true`) o corta (`false`).
   * Si alguien corta, empiezan las apuestas. Si los cuatro piden mus, se pasa
   * al descarte.
   */
  declareMus(seat, wantsMus) {
    this._assertPhase(PHASES.MUS);
    this._assertTurn(seat);
    if (typeof wantsMus !== 'boolean') {
      throw new AppError('INVALID_PAYLOAD', 'Debes indicar si quieres mus o no');
    }

    if (!wantsMus) {
      this.musVotes = [];
      this._beginBetting();
      this._commit({ type: 'MUS_CUT', seat });
      return;
    }

    this.musVotes.push(seat);
    if (this.musVotes.length === SEATS) {
      this.phase = PHASES.DISCARD;
      this.turn = null; // el descarte es simultáneo
      this.pendingDiscards.clear();
      this._commit({ type: 'MUS_AGREED', seat });
    } else {
      this.turn = nextSeat(seat);
      this._commit({ type: 'MUS', seat });
    }
  }

  // ─────────────────────────────── Descarte ───────────────────────────────

  /**
   * Cada jugador elige de 1 a 4 cartas para descartar. Los descartes se
   * aplican cuando los cuatro han elegido; luego se reponen las cartas en
   * orden empezando por la mano y se vuelve a la fase de Mus.
   */
  discard(seat, cardIds) {
    this._assertPhase(PHASES.DISCARD);
    this._assertSeat(seat);

    if (this.pendingDiscards.has(seat)) {
      throw new AppError('ALREADY_DISCARDED', 'Ya has elegido tu descarte');
    }
    if (!Array.isArray(cardIds) || cardIds.some((id) => typeof id !== 'string')) {
      throw new AppError('INVALID_PAYLOAD', 'Lista de cartas no válida');
    }
    const unique = new Set(cardIds);
    if (unique.size !== cardIds.length) {
      throw new AppError('DUPLICATE_CARDS', 'Has repetido una carta en el descarte');
    }
    if (unique.size < MIN_DISCARD || unique.size > MAX_DISCARD) {
      throw new AppError('INVALID_DISCARD_COUNT', `Debes descartar entre ${MIN_DISCARD} y ${MAX_DISCARD} cartas`);
    }
    const handIds = new Set(this.hands[seat].map((c) => c.id));
    for (const id of unique) {
      if (!handIds.has(id)) throw new AppError('CARD_NOT_IN_HAND', 'Esa carta no está en tu mano');
    }

    this.pendingDiscards.set(seat, [...unique]);

    if (this.pendingDiscards.size === SEATS) {
      const counts = this._resolveDiscards();
      this._commit({ type: 'DISCARD_RESOLVED', counts });
    } else {
      this._commit({ type: 'DISCARD_SUBMITTED', seat });
    }
  }

  _resolveDiscards() {
    const counts = [0, 0, 0, 0];
    const thisRound = [];

    for (let seat = 0; seat < SEATS; seat += 1) {
      const ids = new Set(this.pendingDiscards.get(seat));
      const kept = [];
      for (const card of this.hands[seat]) (ids.has(card.id) ? thisRound : kept).push(card);
      counts[seat] = HAND_SIZE - kept.length;
      this.hands[seat] = kept;
    }

    // Reposición en orden de juego. Si el mazo no alcanza, se reciclan primero
    // los descartes de rondas anteriores y, solo si aun así faltan, los de esta.
    // Siempre hay cartas suficientes: fuera de las manos quedan 24 + descartes.
    let currentRecycled = false;
    for (const seat of this.playOrder()) {
      const need = counts[seat];
      if (this.deck.remaining < need) this.deck.recycleDiscards();
      if (this.deck.remaining < need && !currentRecycled) {
        this.deck.discard(thisRound);
        currentRecycled = true;
        this.deck.recycleDiscards();
      }
      this.hands[seat].push(...this.deck.draw(need));
    }
    if (!currentRecycled) this.deck.discard(thisRound);

    this.pendingDiscards.clear();
    this.musVotes = [];
    this.musRounds += 1;
    this.lastDiscardCounts = counts;
    this.phase = PHASES.MUS;
    this.turn = this.mano;
    return counts;
  }

  // ─────────────────────────────── Apuestas ───────────────────────────────

  _beginBetting() {
    this.phase = PHASES.GRANDE;
    this.turn = this.mano;
    // Fase 2: aquí se instanciará la ronda de apuestas (envidos, órdago, etc.).
    this.betting = { lance: PHASES.GRANDE };
  }

  // ─────────────────────────────── Tanteo ───────────────────────────────

  /**
   * Suma piedras a una pareja. Al llegar a `stonesPerGame` se gana un juego y
   * se reinician las piedras; al llegar a `gamesToWin` juegos, la partida acaba.
   */
  addStones(team, amount) {
    if (team !== 0 && team !== 1) throw new AppError('INVALID_TEAM', 'Pareja no válida');
    if (!Number.isInteger(amount) || amount < 0) throw new AppError('INVALID_AMOUNT', 'Cantidad no válida');
    if (this.winnerTeam !== null) throw new AppError('GAME_FINISHED', 'La partida ya ha terminado');

    this.stones[team] += amount;
    let gameWon = false;
    if (this.stones[team] >= this.options.stonesPerGame) {
      this.games[team] += 1;
      this.stones = [0, 0];
      gameWon = true;
      if (this.games[team] >= this.options.gamesToWin) {
        this.winnerTeam = team;
        this.phase = PHASES.FINISHED;
        this.turn = null;
      }
    }
    this._commit({ type: 'STONES', team, amount, gameWon });
    return { gameWon, matchWon: this.winnerTeam !== null };
  }

  // ─────────────────────────────── Vistas ───────────────────────────────

  /**
   * Estado visible para un asiento concreto (o `null` para espectadores).
   * Solo incluye las cartas del propio jugador; del resto, solo el número.
   */
  getStateFor(seat = null) {
    const isPlayer = Number.isInteger(seat) && seat >= 0 && seat < SEATS;
    return {
      version: this.version,
      phase: this.phase,
      handNumber: this.handNumber,
      mano: this.mano,
      dealer: this.dealer,
      turn: this.turn,
      musRounds: this.musRounds,
      lastDiscardCounts: this.lastDiscardCounts,
      deckRemaining: this.deck.remaining,
      players: this.players.map((p) => ({
        seat: p.seat,
        team: p.team,
        playerId: p.playerId,
        username: p.username,
        cardCount: this.hands[p.seat].length,
        saidMus: this.musVotes.includes(p.seat),
        hasDiscarded: this.phase === PHASES.DISCARD && this.pendingDiscards.has(p.seat),
      })),
      score: {
        stones: [...this.stones],
        games: [...this.games],
        stonesPerGame: this.options.stonesPerGame,
        gamesToWin: this.options.gamesToWin,
      },
      winnerTeam: this.winnerTeam,
      lastAction: this.lastAction,
      you: isPlayer
        ? {
            seat,
            team: teamOf(seat),
            partner: partnerOf(seat),
            hand: this.hands[seat].map((c) => ({ ...c })),
            pendingDiscard: this.pendingDiscards.get(seat) ?? null,
          }
        : null,
    };
  }
}

module.exports = { MusGame };
