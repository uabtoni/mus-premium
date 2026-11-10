'use strict';

const { randomInt } = require('node:crypto');
const { Room, ROOM_STATUS } = require('./Room');
const { AppError } = require('../errors');

// Sin caracteres ambiguos (0/O, 1/I/L) para que los códigos se puedan dictar.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/**
 * Registro en memoria de salas y de qué jugador está en qué sala.
 * Un jugador solo puede estar en una sala a la vez.
 */
class RoomManager {
  constructor({ random = randomInt } = {}) {
    this.random = random;
    this.rooms = new Map(); // code -> Room
    this.playerRoom = new Map(); // playerId -> code
  }

  get size() {
    return this.rooms.size;
  }

  generateCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[this.random(0, CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new AppError('CODE_GENERATION_FAILED', 'No se pudo generar un código de sala');
  }

  getRoom(code) {
    return this.rooms.get(code) ?? null;
  }

  getRoomByPlayer(playerId) {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  _assertNotInOtherRoom(playerId, code) {
    const current = this.playerRoom.get(playerId);
    if (current && current !== code) {
      throw new AppError('ALREADY_IN_ROOM', 'Ya estás en otra sala. Sal de ella primero.', { code: current });
    }
  }

  createRoom(player, { isPrivate = false } = {}) {
    this._assertNotInOtherRoom(player.playerId);
    const room = new Room({ code: this.generateCode(), isPrivate });
    room.addPlayer(player);
    this.rooms.set(room.code, room);
    this.playerRoom.set(player.playerId, room.code);
    return room;
  }

  joinRoom(player, code, preferredSeat) {
    this._assertNotInOtherRoom(player.playerId, code);
    const room = this.rooms.get(code);
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'No existe ninguna sala con ese código');
    room.addPlayer(player, preferredSeat);
    this.playerRoom.set(player.playerId, room.code);
    return room;
  }

  /**
   * Matchmaking: entra en la sala pública en espera con más jugadores (para
   * llenar mesas cuanto antes) o crea una nueva si no hay ninguna.
   */
  quickMatch(player) {
    const current = this.getRoomByPlayer(player.playerId);
    if (current) return current;

    const candidate = [...this.rooms.values()]
      .filter((r) => !r.isPrivate && r.status === ROOM_STATUS.WAITING && !r.isFull)
      .sort((a, b) => b.playerCount - a.playerCount || a.createdAt - b.createdAt)[0];

    return candidate ? this.joinRoom(player, candidate.code) : this.createRoom(player, { isPrivate: false });
  }

  /** @returns {{ room: Room|null, closed: boolean }} */
  leaveRoom(playerId) {
    const room = this.getRoomByPlayer(playerId);
    this.playerRoom.delete(playerId);
    if (!room) return { room: null, closed: false };

    room.removePlayer(playerId);
    // Una sala sin humanos se cierra aunque queden bots sentados.
    if (room.humanCount === 0) {
      for (const bot of room.bots()) {
        room.removePlayer(bot.playerId);
        this.playerRoom.delete(bot.playerId);
      }
      this.rooms.delete(room.code);
      return { room, closed: true };
    }
    return { room, closed: false };
  }

  /** Rellena los asientos libres con bots. @returns {number} bots añadidos */
  fillWithBots(code, names) {
    const room = this.rooms.get(code);
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'No existe ninguna sala con ese código');
    const used = new Set(room.members().map((m) => m.username));
    const pool = names.filter((n) => !used.has(n));
    let added = 0;
    while (!room.isFull) {
      const name = pool.length ? pool.splice(this.random(0, pool.length), 1)[0] : `Bot ${added + 1}`;
      const playerId = `bot:${room.code}:${this.random(0, 1e9)}`;
      room.addBot({ playerId, username: name });
      this.playerRoom.set(playerId, room.code);
      added += 1;
    }
    return added;
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate && r.status === ROOM_STATUS.WAITING)
      .map((r) => ({ code: r.code, playerCount: r.playerCount, createdAt: r.createdAt }));
  }
}

module.exports = { RoomManager, CODE_ALPHABET, CODE_LENGTH };
