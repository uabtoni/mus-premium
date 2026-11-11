'use strict';

const { AppError } = require('../errors');
const { SEATS } = require('../game/constants');

const USERNAME_RE = /^[\p{L}\p{N} _.-]{2,20}$/u;
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;

function username(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!USERNAME_RE.test(name)) {
    throw new AppError(
      'INVALID_USERNAME',
      'El nombre debe tener entre 2 y 20 caracteres (letras, números, espacio, _ . -)',
    );
  }
  return name;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 6 || value.length > 72) {
    throw new AppError('INVALID_PASSWORD', 'La contraseña debe tener entre 6 y 72 caracteres');
  }
  return value;
}

function positiveInt(value, field) {
  if (!Number.isInteger(value) || value <= 0) throw new AppError('INVALID_PAYLOAD', `"${field}" no es válido`);
  return value;
}

function roomCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ROOM_CODE_RE.test(code)) throw new AppError('INVALID_ROOM_CODE', 'Código de sala no válido');
  return code;
}

function seat(value, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return undefined;
  if (!Number.isInteger(value) || value < 0 || value >= SEATS) {
    throw new AppError('INVALID_SEAT', 'Asiento no válido');
  }
  return value;
}

function bool(value, field) {
  if (typeof value !== 'boolean') throw new AppError('INVALID_PAYLOAD', `"${field}" debe ser booleano`);
  return value;
}

function object(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('INVALID_PAYLOAD', 'Formato de datos no válido');
  }
  return value;
}

module.exports = { username, password, positiveInt, roomCode, seat, bool, object };
