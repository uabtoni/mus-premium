'use strict';

const { randomBytes } = require('node:crypto');

/**
 * Sesiones de juego en memoria (una por jugador conectado). La identidad la da
 * el token de cuenta, guardado en BD; aquí solo se relaciona el jugador con su
 * socket actual, su perfil y su lista de amigos.
 */
class SessionStore {
  constructor() {
    this.byToken = new Map();
    this.byPlayer = new Map();
  }

  get size() {
    return this.byToken.size;
  }

  create({ playerId, profile }) {
    const token = randomBytes(32).toString('base64url');
    const session = {
      token,
      playerId,
      username: profile.username,
      profile,
      socketId: null,
      connected: false,
      friendIds: new Set(),
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    this.byToken.set(token, session);
    this.byPlayer.set(playerId, session);
    return session;
  }

  get(token) {
    if (typeof token !== 'string' || token.length > 128) return null;
    return this.byToken.get(token) ?? null;
  }

  getByPlayer(playerId) {
    return this.byPlayer.get(playerId) ?? null;
  }

  delete(session) {
    this.byToken.delete(session.token);
    if (this.byPlayer.get(session.playerId) === session) this.byPlayer.delete(session.playerId);
  }

  /** Elimina sesiones desconectadas e inactivas que no estén en uso. */
  sweep(maxIdleMs, isInUse = () => false) {
    const cutoff = Date.now() - maxIdleMs;
    let removed = 0;
    for (const session of this.byToken.values()) {
      if (!session.connected && session.lastSeen < cutoff && !isInUse(session)) {
        this.delete(session);
        removed += 1;
      }
    }
    return removed;
  }
}

module.exports = { SessionStore };
