'use strict';

const { randomBytes } = require('node:crypto');

/**
 * Sesiones en memoria. Un jugador se identifica por `playerId` (estable entre
 * reconexiones), nunca por `socket.id`. El `token` es secreto: el cliente lo
 * guarda y lo envía en `io({ auth: { sessionToken } })` para recuperar su
 * asiento tras recargar la página o perder la conexión.
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
