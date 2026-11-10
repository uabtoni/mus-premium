import { io } from 'socket.io-client'

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

// sessionStorage (no localStorage): cada pestaña es un jugador distinto, lo que
// permite probar varios jugadores en el mismo navegador, y el token sobrevive
// a recargar la página.
const TOKEN_KEY = 'mus.sessionToken'

export const tokenStore = {
  get() {
    try {
      return sessionStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token)
      else sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* almacenamiento bloqueado: la sesión solo dura lo que la pestaña */
    }
  },
}

export const socket = io(SERVER_URL, {
  transports: ['websocket'],
  // Se evalúa en cada (re)conexión: siempre envía el token más reciente.
  auth: (cb) => cb({ sessionToken: tokenStore.get() }),
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
})

/** emit con acknowledgement y timeout → Promise<{ ok, data } | { ok:false, error }> */
export function request(event, payload, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const done = (err, res) => {
      if (err) resolve({ ok: false, error: { code: 'TIMEOUT', message: 'El servidor no responde' } })
      else resolve(res ?? { ok: false, error: { code: 'NO_RESPONSE', message: 'Sin respuesta' } })
    }
    if (payload === undefined) socket.timeout(timeoutMs).emit(event, done)
    else socket.timeout(timeoutMs).emit(event, payload, done)
  })
}
