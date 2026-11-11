'use strict';

const { randomInt } = require('node:crypto');
const { Deck } = require('./Deck');
const {
  SEATS,
  HAND_SIZE,
  MIN_DISCARD,
  MAX_DISCARD,
  PHASES,
  BETTING_PHASES,
  teamOf,
  partnerOf,
  nextSeat,
  prevSeat,
} = require('./constants');
const { BettingRound, MIN_ENVIDO, MAX_BET } = require('./BettingRound');
const { bestSeat, hasPares, hasJuego, lanceBonus, describe } = require('./handEvaluator');
const { AppError } = require('../errors');

const LANCE_NEXT = Object.freeze({ GRANDE: 'CHICA', CHICA: 'PARES' });

/**
 * Gestor de estado autoritativo de una partida de Mus (4 jugadores, 2 vs 2).
 *
 *  - Baraja española de 40 cartas y reparto aleatorio (CSPRNG).
 *  - Rotación de la "mano" entre manos y control estricto del turno.
 *  - Fase de Mus (pedir mus / cortar) y Descarte, incluido el reciclaje de
 *    descartes cuando se agota el mazo.
 *  - Lances con apuestas (Grande, Chica, Pares, Juego o Punto): paso, envido,
 *    subida, órdago, quiero y no quiero (ver BettingRound).
 *  - Conteo al final de la mano en orden de lances; el órdago querido se
 *    resuelve al instante y da el juego al ganador del lance.
 *  - Marcador de piedras y juegos.
 *  - Vistas filtradas por jugador: nadie ve las cartas de otro hasta el conteo.
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
    gamesToWin = 1,
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

    this.betting = null; // BettingRound del lance en curso
    this.lances = {}; // lance -> resultado de sus apuestas
    this.declarations = { pares: null, juego: null }; // qué asientos llevan pares / juego
    this.betLog = []; // todas las acciones de apuesta de la mano
    this.handResult = null; // conteo de la mano (fase SCORING / FINISHED)
    this.nextHandAt = null; // marca de tiempo de la próxima mano (la fija el servidor)
    this.continueVotes = []; // asientos que han pulsado "continuar" en el conteo
    this.turnDeadline = null; // marca de tiempo en que vence el turno actual (la fija el servidor)
    this.startedAt = Date.now();

    this.stones = [0, 0];
    this.games = [0, 0];
    this.gameHistory = []; // piedras con que terminó cada juego: [{ winner, stones: [a, b] }]
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
    this.lances = {};
    this.declarations = { pares: null, juego: null };
    this.betLog = [];
    this.handResult = null;
    this.nextHandAt = null;
    this.continueVotes = [];

    const order = this.playOrder();
    for (let round = 0; round < HAND_SIZE; round += 1) {
      for (const seat of order) this.hands[seat].push(...this.deck.draw(1));
    }

    this.phase = PHASES.MUS;
    this.turn = this.mano;
    this._commit({ type: 'HAND_STARTED', handNumber: this.handNumber, mano: this.mano, dealer: this.dealer });
  }

  /** Solo para pruebas: abandona la mano en curso y reparte una nueva. */
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

  /**
   * "Corto y envido": el jugador en turno corta el mus y envida a la Grande en
   * el mismo acto. Los que pidieron mus antes que él ya no hablan en la Grande.
   */
  cutAndBet(seat, amount = MIN_ENVIDO) {
    this._assertPhase(PHASES.MUS);
    this._assertTurn(seat);
    // Se valida antes de tocar nada: un envite inválido no debe cortar el mus.
    if (!Number.isInteger(amount) || amount < MIN_ENVIDO || amount > MAX_BET) {
      throw new AppError('INVALID_AMOUNT', `El envite debe ser de ${MIN_ENVIDO} a ${MAX_BET} piedras`);
    }
    this.musVotes = [];
    this._beginBetting();
    const round = this.betting;
    round.skipTo(seat);
    round.act(seat, 'envido', amount);
    const entry = round.history[round.history.length - 1];
    this.betLog.push({ lance: PHASES.GRANDE, ...entry });
    this.turn = round.turn;
    this._commit({ type: 'BET', lance: PHASES.GRANDE, ...entry, cut: true, bet: { ...round.bet } });
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

  // ─────────────────────────────── Lances ───────────────────────────────

  _beginBetting() {
    this._startLance(PHASES.GRANDE);
  }

  /**
   * Abre un lance. En Pares y Juego solo hablan quienes tienen jugada; si
   * nadie tiene, el lance no se juega, y si solo una pareja tiene, esa pareja
   * se lo lleva sin apuestas (cobra en el conteo).
   */
  _startLance(lance) {
    this.phase = lance;
    this.betting = null;
    const order = this.playOrder();
    let eligible = order;
    if (lance === PHASES.PARES) {
      this.declarations.pares = this.hands.map(hasPares);
      eligible = order.filter((s) => this.declarations.pares[s]);
    } else if (lance === PHASES.JUEGO) {
      eligible = order.filter((s) => this.declarations.juego[s]);
    }

    if (eligible.length === 0) {
      this.lances[lance] = { lance, status: 'SKIPPED' };
      this._nextLance(lance);
      return;
    }
    const teams = new Set(eligible.map(teamOf));
    if (teams.size === 1) {
      this.lances[lance] = { lance, status: 'NO_BET', team: teamOf(eligible[0]) };
      this._nextLance(lance);
      return;
    }
    this.betting = new BettingRound({ lance, eligible });
    this.turn = this.betting.turn;
  }

  _nextLance(current) {
    if (current === PHASES.PARES) {
      this.declarations.juego = this.hands.map(hasJuego);
      this._startLance(this.declarations.juego.some(Boolean) ? PHASES.JUEGO : PHASES.PUNTO);
    } else if (current === PHASES.JUEGO || current === PHASES.PUNTO) {
      this._scoreHand();
    } else {
      this._startLance(LANCE_NEXT[current]);
    }
  }

  /** Asientos que compiten en un lance, ordenados desde la mano. */
  _contenders(lance) {
    const order = this.playOrder();
    if (lance === PHASES.PARES) return order.filter((s) => this.declarations.pares[s]);
    if (lance === PHASES.JUEGO) return order.filter((s) => this.declarations.juego[s]);
    return order;
  }

  // ─────────────────────────────── Apuestas ───────────────────────────────

  /**
   * Acción de apuesta del jugador en turno.
   * @param {number} seat
   * @param {'paso'|'envido'|'subir'|'ordago'|'quiero'|'no_quiero'} action
   * @param {number} [amount] piedras para envido/subir (por defecto 2)
   */
  bet(seat, action, amount) {
    if (!this.betting || !BETTING_PHASES.includes(this.phase)) {
      throw new AppError('INVALID_PHASE', `Acción no permitida en la fase ${this.phase}`, { phase: this.phase });
    }
    this._assertTurn(seat);
    if (typeof action !== 'string') throw new AppError('INVALID_PAYLOAD', 'Acción no válida');

    const lance = this.phase;
    const round = this.betting;
    const result = round.act(seat, action, amount);
    const entry = round.history[round.history.length - 1];
    this.betLog.push({ lance, ...entry });

    if (!result) {
      this.turn = round.turn;
      this._commit({ type: 'BET', lance, ...entry, bet: round.bet ? { ...round.bet } : null });
      return;
    }

    this.lances[lance] = {
      lance,
      status: result.type,
      stake: result.stake ?? null,
      ordago: Boolean(round.bet?.ordago),
      team: result.team ?? null,
      stones: result.stones ?? null,
    };
    this.turn = null;

    if (result.type === 'NO_QUERIDO') {
      // La pareja que envidó cobra "lo de antes" en el acto.
      const { gameWon } = this._addStones(result.team, result.stones);
      if (gameWon) {
        this._finishHand({
          items: [{ lance, kind: 'deje', team: result.team, seat: null, stones: result.stones, counted: true }],
          gameWinner: result.team,
        });
      } else {
        this._nextLance(lance);
      }
    } else if (result.type === 'QUERIDO' && result.ordago) {
      this._resolveOrdago(lance);
    } else {
      this._nextLance(lance);
    }

    this._commit({ type: 'BET', lance, ...entry, closed: result.type, bet: round.bet ? { ...round.bet } : null });
  }

  /** Órdago querido: se enseñan las cartas y el ganador del lance gana el juego. */
  _resolveOrdago(lance) {
    const winner = bestSeat(lance, this.hands, this._contenders(lance));
    const team = teamOf(winner);
    const stones = this.options.stonesPerGame - this.stones[team];
    this._addStones(team, stones);
    this._finishHand({
      ordago: { lance, team, seat: winner },
      items: [{ lance, kind: 'ordago', team, seat: winner, stones, detail: describe(lance, this.hands[winner]), counted: true }],
      gameWinner: team,
    });
  }

  // ─────────────────────────────── Conteo ───────────────────────────────

  /**
   * Conteo al final de la mano, en orden: Grande, Chica, Pares, Juego/Punto.
   *  - En paso: Grande, Chica y Punto valen 1; Pares y Juego solo sus jugadas.
   *  - Querido: el envite al ganador, más sus jugadas (Pares/Juego) o +1 (Punto).
   *  - No querido: el deje ya se cobró; la pareja que envidó cobra sus jugadas.
   *  - Sin apuestas (solo una pareja tenía): esa pareja cobra sus jugadas.
   * Si una pareja llega a las piedras del juego, se deja de contar.
   */
  _scoreHand() {
    const lances = [PHASES.GRANDE, PHASES.CHICA, PHASES.PARES, this.lances.JUEGO ? PHASES.JUEGO : PHASES.PUNTO];
    const items = [];
    let gameWinner = null;

    for (const lance of lances) {
      const rec = this.lances[lance];
      if (!rec || rec.status === 'SKIPPED') {
        items.push({ lance, kind: 'skipped', team: null, seat: null, stones: 0, counted: false });
        continue;
      }
      const contenders = this._contenders(lance);
      let team;
      let kind;
      let base = 0;
      if (rec.status === 'NO_QUERIDO') {
        team = rec.team;
        kind = 'deje';
      } else if (rec.status === 'NO_BET') {
        team = rec.team;
        kind = 'solo';
      } else {
        team = teamOf(bestSeat(lance, this.hands, contenders));
        kind = rec.status === 'PASO' ? 'paso' : 'querido';
        if (kind === 'querido') base = rec.stake;
        else if (lance !== PHASES.PARES && lance !== PHASES.JUEGO) base = 1;
      }

      const teamSeats = contenders.filter((s) => teamOf(s) === team);
      const seat = bestSeat(lance, this.hands, teamSeats);
      let bonus = 0;
      if (lance === PHASES.PARES || lance === PHASES.JUEGO) {
        bonus = teamSeats.reduce((sum, s) => sum + lanceBonus(lance, this.hands[s]), 0);
      } else if (lance === PHASES.PUNTO && kind === 'querido') {
        bonus = 1;
      }

      const stones = base + bonus;
      const item = {
        lance,
        kind,
        team,
        seat,
        stones,
        base,
        bonus,
        deje: kind === 'deje' ? rec.stones : 0,
        stake: rec.stake ?? null,
        detail: describe(lance, this.hands[seat]),
        counted: gameWinner === null,
      };
      if (item.counted && stones > 0 && this._addStones(team, stones).gameWon) gameWinner = team;
      items.push(item);
    }

    this._finishHand({ items, gameWinner });
  }

  _finishHand({ items, gameWinner = null, ordago = null }) {
    this.handResult = {
      handNumber: this.handNumber,
      items,
      ordago,
      gameWinner,
      matchWinner: this.winnerTeam,
      revealed: this.hands.map((h) => h.map((c) => ({ ...c }))),
      stones: [...this.stones],
      games: [...this.games],
    };
    this.betting = null;
    this.turn = null;
    this.phase = this.winnerTeam !== null ? PHASES.FINISHED : PHASES.SCORING;
  }

  // ─────────────────────────────── Tanteo ───────────────────────────────

  /**
   * Suma piedras sin cambiar de fase. Al llegar a `stonesPerGame` se gana un
   * juego y se reinician las piedras; al llegar a `gamesToWin`, la partida.
   */
  _addStones(team, amount) {
    this.stones[team] += amount;
    let gameWon = false;
    if (this.stones[team] >= this.options.stonesPerGame) {
      this.games[team] += 1;
      this.gameHistory.push({
        winner: team,
        // Se muestra como mucho el objetivo (un órdago o un envite grande pueden pasarse).
        stones: this.stones.map((v) => Math.min(v, this.options.stonesPerGame)),
      });
      this.stones = [0, 0];
      gameWon = true;
      if (this.games[team] >= this.options.gamesToWin) this.winnerTeam = team;
    }
    return { gameWon, matchWon: this.winnerTeam !== null };
  }

  /** Suma piedras manualmente (tests / herramientas). */
  addStones(team, amount) {
    if (team !== 0 && team !== 1) throw new AppError('INVALID_TEAM', 'Pareja no válida');
    if (!Number.isInteger(amount) || amount < 0) throw new AppError('INVALID_AMOUNT', 'Cantidad no válida');
    if (this.winnerTeam !== null) throw new AppError('GAME_FINISHED', 'La partida ya ha terminado');

    const result = this._addStones(team, amount);
    if (result.matchWon) {
      this.phase = PHASES.FINISHED;
      this.turn = null;
    }
    this._commit({ type: 'STONES', team, amount, gameWon: result.gameWon });
    return result;
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
        history: this.gameHistory.map((g) => ({ winner: g.winner, stones: [...g.stones] })),
      },
      winnerTeam: this.winnerTeam,
      lastAction: this.lastAction,
      betting: this.betting ? this.betting.toPublic() : null,
      lances: Object.fromEntries(Object.entries(this.lances).map(([k, v]) => [k, { ...v }])),
      declarations: {
        pares: this.declarations.pares ? [...this.declarations.pares] : null,
        juego: this.declarations.juego ? [...this.declarations.juego] : null,
      },
      betLog: this.betLog.map((b) => ({ ...b })),
      // Las cartas de todos solo se enseñan en el conteo.
      handResult: this.handResult,
      nextHandAt: this.nextHandAt,
      continueVotes: [...this.continueVotes],
      // Milisegundos que le quedan al turno (relativo: no depende del reloj del cliente).
      turnRemainingMs: this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : null,
      turnTotalMs: this.turnTotalMs ?? null,
      you: isPlayer
        ? {
            seat,
            team: teamOf(seat),
            partner: partnerOf(seat),
            hand: this.hands[seat].map((c) => ({ ...c })),
            pendingDiscard: this.pendingDiscards.get(seat) ?? null,
            actions: this.betting ? this.betting.allowedActions(seat) : [],
          }
        : null,
    };
  }
}

module.exports = { MusGame };
