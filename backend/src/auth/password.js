'use strict';

const { scrypt, randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(scrypt);

// Parámetros de scrypt (OWASP: N=2^14, r=8, p=1 como mínimo razonable).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Hash con sal aleatoria. Formato: scrypt$N$r$p$salt$hash (base64). */
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Comparación en tiempo constante. Devuelve false ante cualquier formato raro. */
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Token de sesión opaco (se entrega al cliente) y su huella (se guarda en BD). */
function newToken() {
  return randomBytes(32).toString('base64url');
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

module.exports = { hashPassword, verifyPassword, newToken, tokenHash };
