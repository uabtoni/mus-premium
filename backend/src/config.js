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
  // Acepta también páginas servidas desde la red local (móviles en el mismo Wi-Fi).
  allowLan: toBool(process.env.ALLOW_LAN, (process.env.NODE_ENV || 'development') !== 'production'),

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
    gamesToWin: toInt(process.env.GAMES_TO_WIN, 1),
  },

  timers: {
    // Tiempo de gracia para reconectar antes de perder el asiento.
    lobbyReconnectMs: toInt(process.env.LOBBY_RECONNECT_MS, 15_000),
    // En partida: pasado este tiempo sin volver, un bot ocupa el asiento (el jugador puede regresar).
    gameReconnectMs: toInt(process.env.GAME_RECONNECT_MS, 20_000),
    // Tiempo para decidir en cada turno; al agotarse se juega automáticamente.
    turnMs: toInt(process.env.TURN_MS, 30_000),
    // Turnos seguidos agotados tras los que se considera ausente al jugador.
    afkLimit: toInt(process.env.AFK_LIMIT, 3),
    // Sesiones sin socket ni sala se eliminan pasado este tiempo.
    sessionIdleMs: toInt(process.env.SESSION_IDLE_MS, 6 * 60 * 60 * 1000),
    // Pausa del conteo antes de repartir la siguiente mano.
    nextHandMs: toInt(process.env.NEXT_HAND_MS, 12_000),
  },

  bots: {
    minDelayMs: toInt(process.env.BOT_MIN_DELAY_MS, 1300),
    maxDelayMs: toInt(process.env.BOT_MAX_DELAY_MS, 2300),
    // Multiplicador de las pausas tras repartir, descartar o cerrar un lance.
    pauseScale: Number.parseFloat(process.env.BOT_PAUSE_SCALE ?? '1') || 0,
  },

  elo: {
    initial: 1200,
    k: toInt(process.env.ELO_K, 32),
  },

  // Herramientas de prueba (bots, re-reparto). Desactivadas en producción.
  devTools: toBool(process.env.DEV_TOOLS, (process.env.NODE_ENV || 'development') !== 'production'),

  rateLimit: {
    capacity: toInt(process.env.RATE_LIMIT_BURST, 20),
    refillPerSecond: toInt(process.env.RATE_LIMIT_PER_SEC, 10),
    // Registro / login por IP: ráfaga y reposición (1 intento cada 5 s).
    authBurst: toInt(process.env.AUTH_RATE_BURST, 10),
  },
};

module.exports = Object.freeze(config);
