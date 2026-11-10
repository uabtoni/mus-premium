'use strict';

const { Pool } = require('pg');
const config = require('../config');

/**
 * Esquema idempotente. Respeta la tabla `users` que ya existía y le añade las
 * columnas de estadísticas/ELO sin perder datos.
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
`;

let pool = null;
let available = false;

async function init() {
  if (!config.db.enabled) {
    console.warn('⚠️  PostgreSQL desactivado (DB_DISABLED=true). Modo invitado.');
    return false;
  }

  const { connectionString, host, port, user, password, database, ssl } = config.db;
  pool = new Pool(
    connectionString
      ? { connectionString, ssl, max: 10 }
      : { host, port, user, password, database, ssl, max: 10 },
  );

  // Un cliente inactivo que falla no debe tumbar el proceso.
  pool.on('error', (err) => console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message));

  try {
    await pool.query('SELECT 1');
    await pool.query(SCHEMA_SQL);
    available = true;
    console.log('🟢 PostgreSQL conectado y esquema verificado');
  } catch (err) {
    available = false;
    console.error(`❌ No se pudo conectar a PostgreSQL (${err.message}). Se continúa en modo invitado.`);
    await pool.end().catch(() => {});
    pool = null;
  }
  return available;
}

function isAvailable() {
  return available;
}

/**
 * Crea el usuario si no existe y actualiza su último login. Atómico frente a
 * logins simultáneos gracias a ON CONFLICT.
 * Devuelve `null` si la BD no está disponible.
 */
async function findOrCreateUser(username) {
  if (!available) return null;
  const { rows } = await pool.query(
    `INSERT INTO users (username, last_login_at)
     VALUES ($1, NOW())
     ON CONFLICT (username) DO UPDATE SET last_login_at = NOW()
     RETURNING id, username, coins, gems, elo, games_played, games_won, created_at`,
    [username],
  );
  return rows[0];
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    available = false;
  }
}

module.exports = { init, isAvailable, findOrCreateUser, close };
