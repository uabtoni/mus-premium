'use strict';

const { MusGame } = require('../game/MusGame');
const { SEATS, teamOf } = require('../game/constants');
const { AppError } = require('../errors');

const ROOM_STATUS = Object.freeze({ WAITING: 'waiting', PLAYING: 'playing' });

/**
 * Sala de 4 asientos. Asientos 0/2 = pareja 0 y 1/3 = pareja 1, por lo que
 * elegir asiento equivale a elegir pareja.
 */
class Room {
  constructor({ code, isPrivate = false }) {
    this.code = code;
    this.isPrivate = isPrivate;
    this.hostId = null;
    this.seats = Array(SEATS).fill(null);
    this.status = ROOM_STATUS.WAITING;
    this.game = null;
    this.createdAt = Date.now();
  }

  get playerCount() {
    return this.seats.filter(Boolean).length;
  }

  get isFull() {
    return this.playerCount === SEATS;
  }

  get isEmpty() {
    return this.playerCount === 0;
  }

  get humanCount() {
    return this.seats.filter((s) => s && !s.isBot).length;
  }

  members() {
    return this.seats.filter(Boolean);
  }

  seatOf(playerId) {
    return this.seats.findIndex((s) => s?.playerId === playerId);
  }

  has(playerId) {
    return this.seatOf(playerId) !== -1;
  }

  getMember(playerId) {
    const seat = this.seatOf(playerId);
    return seat === -1 ? null : this.seats[seat];
  }

  _assertWaiting() {
    if (this.status !== ROOM_STATUS.WAITING) {
      throw new AppError('ROOM_IN_GAME', 'La partida ya ha empezado');
    }
  }

  _requireMember(playerId) {
    const member = this.getMember(playerId);
    if (!member) throw new AppError('NOT_IN_ROOM', 'No estás en esta sala');
    return member;
  }

  /** Sienta a un jugador. Idempotente si ya estaba sentado. */
  addPlayer({ playerId, username }, preferredSeat) {
    const existing = this.seatOf(playerId);
    if (existing !== -1) return existing;

    this._assertWaiting();
    if (this.isFull) throw new AppError('ROOM_FULL', 'La sala está completa');

    let seat;
    if (preferredSeat !== undefined) {
      if (this.seats[preferredSeat]) throw new AppError('SEAT_TAKEN', 'Ese asiento está ocupado');
      seat = preferredSeat;
    } else {
      seat = this.seats.indexOf(null);
    }

    this.seats[seat] = { playerId, username, isBot: false, ready: false, connected: true, joinedAt: Date.now() };
    if (!this.hostId) this.hostId = playerId;
    return seat;
  }

  /** Ocupa un asiento libre con un bot (siempre conectado y listo). */
  addBot({ playerId, username }) {
    this._assertWaiting();
    const seat = this.seats.indexOf(null);
    if (seat === -1) throw new AppError('ROOM_FULL', 'La sala está completa');
    this.seats[seat] = { playerId, username, isBot: true, ready: true, connected: true, joinedAt: Date.now() };
    return seat;
  }

  bots() {
    return this.members().filter((m) => m.isBot);
  }

  removePlayer(playerId) {
    const seat = this.seatOf(playerId);
    if (seat === -1) return false;
    this.seats[seat] = null;
    if (this.hostId === playerId) {
      const next = this.members()
        .filter((m) => !m.isBot)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = next ? next.playerId : null;
    }
    return true;
  }

  changeSeat(playerId, seat) {
    this._assertWaiting();
    const from = this.seatOf(playerId);
    if (from === -1) throw new AppError('NOT_IN_ROOM', 'No estás en esta sala');
    if (from === seat) return;
    if (this.seats[seat]) throw new AppError('SEAT_TAKEN', 'Ese asiento está ocupado');
    const member = this.seats[from];
    member.ready = false;
    this.seats[seat] = member;
    this.seats[from] = null;
  }

  setReady(playerId, ready) {
    this._assertWaiting();
    this._requireMember(playerId).ready = ready;
  }

  setConnected(playerId, connected) {
    const member = this.getMember(playerId);
    if (member) member.connected = connected;
  }

  canStart() {
    return (
      this.status === ROOM_STATUS.WAITING &&
      this.isFull &&
      this.seats.every((s) => s.ready && s.connected)
    );
  }

  startGame(gameOptions = {}) {
    if (!this.canStart()) {
      throw new AppError('CANNOT_START', 'Hacen falta 4 jugadores conectados y listos');
    }
    this.game = new MusGame({
      ...gameOptions,
      players: this.seats.map((s) => ({ playerId: s.playerId, username: s.username })),
    });
    this.game.startHand();
    this.status = ROOM_STATUS.PLAYING;
    return this.game;
  }

  abortGame() {
    this.game = null;
    this.status = ROOM_STATUS.WAITING;
    for (const member of this.members()) member.ready = member.isBot;
  }

  toPublic() {
    return {
      code: this.code,
      isPrivate: this.isPrivate,
      status: this.status,
      hostId: this.hostId,
      playerCount: this.playerCount,
      canStart: this.canStart(),
      createdAt: this.createdAt,
      seats: this.seats.map((s, seat) =>
        s
          ? {
              seat,
              team: teamOf(seat),
              playerId: s.playerId,
              username: s.username,
              isBot: s.isBot,
              ready: s.ready,
              connected: s.connected,
              isHost: s.playerId === this.hostId,
            }
          : null,
      ),
    };
  }
}

module.exports = { Room, ROOM_STATUS };
