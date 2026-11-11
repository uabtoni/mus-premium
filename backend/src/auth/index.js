'use strict';

const db = require('../db');
const validate = require('../utils/validate');
const { hashPassword, verifyPassword } = require('./password');
const { AppError } = require('../errors');

const MAX_FAILS = 8;
const LOCK_MS = 5 * 60 * 1000;
const failures = new Map(); // username (minúsculas) -> { count, until }

function toProfile(row) {
  return {
    id: row.id,
    username: row.username,
    coins: row.coins ?? 1000,
    gems: row.gems ?? 50,
    elo: row.elo ?? 1200,
    gamesPlayed: row.games_played ?? 0,
    gamesWon: row.games_won ?? 0,
  };
}

function assertNotLocked(name) {
  const f = failures.get(name);
  if (f && f.until > Date.now()) {
    const mins = Math.ceil((f.until - Date.now()) / 60000);
    throw new AppError('TOO_MANY_ATTEMPTS', `Demasiados intentos fallidos. Prueba en ${mins} min.`);
  }
}

function recordFailure(name) {
  const f = failures.get(name) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) {
    f.until = Date.now() + LOCK_MS;
    f.count = 0;
  }
  failures.set(name, f);
}

async function register(rawUsername, rawPassword) {
  const username = validate.username(rawUsername);
  const password = validate.password(rawPassword);
  const row = await db.createUser(username, await hashPassword(password));
  const token = await db.createToken(row.id);
  return { token, user: toProfile(row) };
}

/**
 * Inicio de sesión. Las cuentas creadas antes de existir contraseñas (sin
 * hash) quedan "reclamadas" con la primera contraseña que se use.
 */
async function login(rawUsername, rawPassword) {
  const username = validate.username(rawUsername);
  const password = validate.password(rawPassword);
  const key = username.toLowerCase();
  assertNotLocked(key);

  const row = await db.findUserByUsername(username);
  const invalid = () => new AppError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos');
  if (!row) {
    recordFailure(key);
    throw invalid();
  }

  let claimed = false;
  if (!row.password_hash) {
    await db.setPasswordHash(row.id, await hashPassword(password));
    claimed = true;
  } else if (!(await verifyPassword(password, row.password_hash))) {
    recordFailure(key);
    throw invalid();
  }

  failures.delete(key);
  await db.touchLogin(row.id);
  const token = await db.createToken(row.id);
  return { token, user: toProfile(row), claimed };
}

async function userFromToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const row = await db.userByToken(token);
  return row ? toProfile(row) : null;
}

async function logout(token) {
  if (typeof token === 'string' && token) await db.deleteToken(token);
}

module.exports = { register, login, logout, userFromToken, toProfile };
