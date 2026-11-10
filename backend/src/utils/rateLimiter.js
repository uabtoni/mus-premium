'use strict';

/**
 * Token bucket por socket. Devuelve una función que responde `true` si el
 * evento puede procesarse y `false` si el cliente está inundando el servidor.
 */
function createRateLimiter({ capacity = 20, refillPerSecond = 10, now = Date.now } = {}) {
  let tokens = capacity;
  let last = now();

  return function consume() {
    const t = now();
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSecond);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

module.exports = { createRateLimiter };
