'use strict';

/**
 * Error de dominio con un código estable que el cliente puede interpretar
 * (p. ej. para mostrar un toast traducido). Todo lo que no sea AppError se
 * considera un fallo interno y nunca se filtra al cliente.
 */
class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function toClientError(err) {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  }
  return { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' };
}

module.exports = { AppError, toClientError };
