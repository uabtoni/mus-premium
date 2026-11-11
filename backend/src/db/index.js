'use strict';

const { Pool } = require('pg');
const config = require('../config');
const { newToken, tokenHash } = require('../auth/password');
const { AppError } = require('../errors');

/**
 * Capa de datos. Con PostgreSQL disponible se usa la BD; si está desactivada
 * (tests) o no responde, se usa un almacén en memoria con la misma interfaz
 * (las cuentas se pierden al reiniciar: solo para desarrollo).
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(50) UNIQUE NOT NULL,
  coins       INT DEFAULT 1000,
  gems        INT DEFAULT 50,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS elo           INT NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS games_played  INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS games_won     INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash    CHAR(64)    PRIMARY KEY,
  user_id       INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
  requester_id  INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at  TIMESTAMPTZ,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id           SERIAL PRIMARY KEY,
  room_code    VARCHAR(8)  NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  winner_team  SMALLINT CHECK (winner_team IN (0, 1)),
  games_team0  SMALLINT NOT NULL DEFAULT 0,
  games_team1  SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id    INT      NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat        SMALLINT NOT NULL CHECK (seat BETWEEN 0 AND 3),
  user_id     INT      REFERENCES users(id) ON DELETE SET NULL,
  team        SMALLINT NOT NULL CHECK (team IN (0, 1)),
  elo_before  INT,
  elo_after   INT,
  PRIMARY KEY (match_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_users_elo ON users (elo DESC);
CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id);
`;

const USER_COLUMNS = 'id, username, coins, gems, elo, games_played, games_won, password_hash';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

// ───────────────────────────── PostgreSQL ─────────────────────────────

function pgStore(pool) {
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null;

  return {
    mode: 'postgres',

    async createUser(username, passwordHash) {
      try {
        return await one(
          `INSERT INTO users (username, password_hash, last_login_at) VALUES ($1, $2, NOW()) RETURNING ${USER_COLUMNS}`,
          [username, passwordHash],
        );
      } catch (err) {
        if (err.code === '23505') throw new AppError('USERNAME_TAKEN', 'Ese nombre de usuario ya existe');
        throw err;
      }
    },

    // Coincidencia exacta primero (hay BD antiguas con "Tekko" y "tekko").
    findUserByUsername: (username) =>
      one(
        `SELECT ${USER_COLUMNS} FROM users WHERE LOWER(username) = LOWER($1)
         ORDER BY (username = $1) DESC, id LIMIT 1`,
        [username],
      ),

    getUserById: (id) => one(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]),

    async setPasswordHash(id, hash) {
      await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
    },

    async touchLogin(id) {
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [id]);
    },

    async createToken(userId) {
      const token = newToken();
      await pool.query(
        'INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [tokenHash(token), userId, new Date(Date.now() + TOKEN_TTL_MS)],
      );
      return token;
    },

    async userByToken(token) {
      const row = await one(
        `UPDATE auth_tokens SET last_used_at = NOW()
         WHERE token_hash = $1 AND expires_at > NOW()
         RETURNING user_id`,
        [tokenHash(token)],
      );
      return row ? this.getUserById(row.user_id) : null;
    },

    async deleteToken(token) {
      await pool.query('DELETE FROM auth_tokens WHERE token_hash = $1', [tokenHash(token)]);
    },

    async listFriends(userId) {
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.elo, f.status,
                CASE WHEN f.requester_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
         WHERE f.requester_id = $1 OR f.addressee_id = $1
         ORDER BY u.username`,
        [userId],
      );
      return rows.map((r) => ({
        id: r.id,
        username: r.username,
        elo: r.elo,
        relation: r.status === 'accepted' ? 'friend' : r.direction,
      }));
    },

    async friendIds(userId) {
      const { rows } = await pool.query(
        `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
         FROM friendships WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
        [userId],
      );
      return rows.map((r) => r.id);
    },

    async requestFriend(fromId, toUsername) {
      const target = await this.findUserByUsername(toUsername);
      if (!target) throw new AppError('USER_NOT_FOUND', 'No existe ningún jugador con ese nombre');
      if (target.id === fromId) throw new AppError('CANNOT_FRIEND_SELF', 'No puedes añadirte a ti mismo');
      const existing = await one(
        `SELECT requester_id, status FROM friendships
         WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
        [fromId, target.id],
      );
      if (existing?.status === 'accepted') throw new AppError('ALREADY_FRIENDS', 'Ya sois amigos');
      if (existing && existing.requester_id === fromId) throw new AppError('REQUEST_EXISTS', 'Ya le enviaste una solicitud');
      if (existing) {
        // Él ya te la había enviado: queda aceptada.
        await pool.query(
          `UPDATE friendships SET status = 'accepted', responded_at = NOW() WHERE requester_id = $1 AND addressee_id = $2`,
          [target.id, fromId],
        );
        return { user: target, relation: 'friend' };
      }
      await pool.query('INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)', [fromId, target.id]);
      return { user: target, relation: 'outgoing' };
    },

    async respondFriend(userId, requesterId, accept) {
      const sql = accept
        ? `UPDATE friendships SET status = 'accepted', responded_at = NOW()
           WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`
        : `DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`;
      const { rowCount } = await pool.query(sql, [requesterId, userId]);
      if (rowCount === 0) throw new AppError('REQUEST_NOT_FOUND', 'Esa solicitud ya no existe');
    },

    async removeFriend(userId, otherId) {
      await pool.query(
        `DELETE FROM friendships
         WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
        [userId, otherId],
      );
    },

    async recordMatch({ roomCode, startedAt, winnerTeam, games, players }) {
      const { initial, k } = config.elo;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const userIds = players.map((p) => p.userId).filter(Boolean);
        const { rows } = userIds.length
          ? await client.query('SELECT id, elo FROM users WHERE id = ANY($1::int[]) FOR UPDATE', [userIds])
          : { rows: [] };
        const eloOf = new Map(rows.map((r) => [r.id, r.elo]));
        const known = (p) => Boolean(p.userId && eloOf.has(p.userId));
        const rating = (p) => (known(p) ? eloOf.get(p.userId) : initial);
        const avg = (team) => {
          const list = players.filter((p) => p.team === team).map(rating);
          return list.reduce((a, b) => a + b, 0) / list.length;
        };
        const teamElo = [avg(0), avg(1)];

        const {
          rows: [match],
        } = await client.query(
          `INSERT INTO matches (room_code, started_at, finished_at, winner_team, games_team0, games_team1)
           VALUES ($1, $2, NOW(), $3, $4, $5) RETURNING id`,
          [roomCode, new Date(startedAt), winnerTeam, games[0], games[1]],
        );

        const results = [];
        for (const p of players) {
          const before = rating(p);
          const expected = 1 / (1 + 10 ** ((teamElo[1 - p.team] - teamElo[p.team]) / 400));
          const won = p.team === winnerTeam ? 1 : 0;
          const after = Math.max(100, Math.round(before + k * (won - expected)));
          if (known(p)) {
            const {
              rows: [u],
            } = await client.query(
              `UPDATE users SET elo = $2, games_played = games_played + 1, games_won = games_won + $3
               WHERE id = $1 RETURNING games_played, games_won`,
              [p.userId, after, won],
            );
            results.push({
              userId: p.userId,
              playerId: p.playerId,
              eloBefore: before,
              eloAfter: after,
              delta: after - before,
              gamesPlayed: u.games_played,
              gamesWon: u.games_won,
            });
          }
          await client.query(
            `INSERT INTO match_players (match_id, seat, user_id, team, elo_before, elo_after)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [match.id, p.seat, known(p) ? p.userId : null, p.team, before, after],
          );
        }
        await client.query('COMMIT');
        return results;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// ───────────────────────────── Memoria ─────────────────────────────

function memoryStore() {
  const users = new Map(); // id -> row
  const tokens = new Map(); // hash -> { userId, expiresAt }
  const friendships = new Map(); // "a:b" (requester:addressee) -> status
  let seq = 0;

  const byName = (name) => [...users.values()].find((u) => u.username.toLowerCase() === name.toLowerCase()) ?? null;
  const key = (a, b) => `${a}:${b}`;
  const copy = (u) => (u ? { ...u } : null);

  return {
    mode: 'memory',

    async createUser(username, passwordHash) {
      if (byName(username)) throw new AppError('USERNAME_TAKEN', 'Ese nombre de usuario ya existe');
      seq += 1;
      const row = { id: seq, username, coins: 1000, gems: 50, elo: 1200, games_played: 0, games_won: 0, password_hash: passwordHash };
      users.set(row.id, row);
      return copy(row);
    },
    findUserByUsername: async (username) => copy(byName(username)),
    getUserById: async (id) => copy(users.get(id)),
    async setPasswordHash(id, hash) {
      const u = users.get(id);
      if (u) u.password_hash = hash;
    },
    async touchLogin() {},
    async createToken(userId) {
      const token = newToken();
      tokens.set(tokenHash(token), { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
      return token;
    },
    async userByToken(token) {
      const t = tokens.get(tokenHash(token));
      return t && t.expiresAt > Date.now() ? copy(users.get(t.userId)) : null;
    },
    async deleteToken(token) {
      tokens.delete(tokenHash(token));
    },
    async listFriends(userId) {
      const out = [];
      for (const [k, status] of friendships) {
        const [a, b] = k.split(':').map(Number);
        if (a !== userId && b !== userId) continue;
        const other = users.get(a === userId ? b : a);
        if (!other) continue;
        out.push({
          id: other.id,
          username: other.username,
          elo: other.elo,
          relation: status === 'accepted' ? 'friend' : a === userId ? 'outgoing' : 'incoming',
        });
      }
      return out.sort((x, y) => x.username.localeCompare(y.username));
    },
    async friendIds(userId) {
      return (await this.listFriends(userId)).filter((f) => f.relation === 'friend').map((f) => f.id);
    },
    async requestFriend(fromId, toUsername) {
      const target = byName(toUsername);
      if (!target) throw new AppError('USER_NOT_FOUND', 'No existe ningún jugador con ese nombre');
      if (target.id === fromId) throw new AppError('CANNOT_FRIEND_SELF', 'No puedes añadirte a ti mismo');
      const mine = friendships.get(key(fromId, target.id));
      const theirs = friendships.get(key(target.id, fromId));
      if (mine === 'accepted' || theirs === 'accepted') throw new AppError('ALREADY_FRIENDS', 'Ya sois amigos');
      if (mine) throw new AppError('REQUEST_EXISTS', 'Ya le enviaste una solicitud');
      if (theirs) {
        friendships.set(key(target.id, fromId), 'accepted');
        return { user: copy(target), relation: 'friend' };
      }
      friendships.set(key(fromId, target.id), 'pending');
      return { user: copy(target), relation: 'outgoing' };
    },
    async respondFriend(userId, requesterId, accept) {
      const k = key(requesterId, userId);
      if (friendships.get(k) !== 'pending') throw new AppError('REQUEST_NOT_FOUND', 'Esa solicitud ya no existe');
      if (accept) friendships.set(k, 'accepted');
      else friendships.delete(k);
    },
    async removeFriend(userId, otherId) {
      friendships.delete(key(userId, otherId));
      friendships.delete(key(otherId, userId));
    },
    async recordMatch() {
      return [];
    },
  };
}

// ───────────────────────────── Arranque ─────────────────────────────

let pool = null;
let store = memoryStore();

async function init() {
  if (!config.db.enabled) {
    console.warn('⚠️  PostgreSQL desactivado (DB_DISABLED=true): cuentas en memoria.');
    store = memoryStore();
    return false;
  }
  const { connectionString, host, port, user, password, database, ssl } = config.db;
  pool = new Pool(connectionString ? { connectionString, ssl, max: 10 } : { host, port, user, password, database, ssl, max: 10 });
  pool.on('error', (err) => console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message));

  try {
    await pool.query('SELECT 1');
    await pool.query(SCHEMA_SQL);
    // Nombres únicos sin distinguir mayúsculas (puede fallar si ya hay duplicados).
    await pool
      .query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))')
      .catch((err) => console.warn('⚠️  No se pudo crear el índice de nombres únicos:', err.message));
    store = pgStore(pool);
    console.log('🟢 PostgreSQL conectado y esquema verificado');
    return true;
  } catch (err) {
    console.error(`❌ No se pudo conectar a PostgreSQL (${err.message}). Cuentas en memoria: se perderán al reiniciar.`);
    await pool.end().catch(() => {});
    pool = null;
    store = memoryStore();
    return false;
  }
}

async function close() {
  if (pool) await pool.end();
  pool = null;
}

const isAvailable = () => store.mode === 'postgres';

// Delegación: el resto del servidor solo conoce estas funciones.
const api = {};
for (const name of [
  'createUser',
  'findUserByUsername',
  'getUserById',
  'setPasswordHash',
  'touchLogin',
  'createToken',
  'userByToken',
  'deleteToken',
  'listFriends',
  'friendIds',
  'requestFriend',
  'respondFriend',
  'removeFriend',
  'recordMatch',
]) {
  api[name] = (...args) => store[name](...args);
}

module.exports = { init, close, isAvailable, mode: () => store.mode, ...api };
