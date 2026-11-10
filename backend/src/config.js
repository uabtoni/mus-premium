'use strict';

require('dotenv').config({ quiet: true });

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),

  // Orígenes permitidos para CORS (separados por comas).
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  db: {
    enabled: !toBool(process.env.DB_DISABLED, false),
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.PGHOST || 'localhost',
    port: toInt(process.env.PGPORT, 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || 'mus_premium',
    ssl: toBool(process.env.PGSSL, false) ? { rejectUnauthorized: false } : undefined,
  },

  game: {
    ochoReyes: toBool(process.env.OCHO_REYES, true), // treses = reyes, doses = ases
    stonesPerGame: toInt(process.env.STONES_PER_GAME, 40),
    gamesToWin: toInt(process.env.GAMES_TO_WIN, 3),
  },

  timers: {
    // Tiempo de gracia para reconectar antes de perder el asiento.
    lobbyReconnectMs: toInt(process.env.LOBBY_RECONNECT_MS, 15_000),
    gameReconnectMs: toInt(process.env.GAME_RECONNECT_MS, 90_000),
    // Sesiones sin socket ni sala se eliminan pasado este tiempo.
    sessionIdleMs: toInt(process.env.SESSION_IDLE_MS, 6 * 60 * 60 * 1000),
  },

  // Herramientas de prueba (bots, re-reparto). Desactivadas en producción.
  devTools: toBool(process.env.DEV_TOOLS, (process.env.NODE_ENV || 'development') !== 'production'),

  rateLimit: {
    capacity: toInt(process.env.RATE_LIMIT_BURST, 20),
    refillPerSecond: toInt(process.env.RATE_LIMIT_PER_SEC, 10),
  },
};

module.exports = Object.freeze(config);
