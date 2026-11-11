import { io } from 'socket.io-client'

// Por defecto, el backend está en la misma máquina que sirve la página (puerto
// 3000): así funciona igual en http://localhost:5173 que desde un móvil de la
// red local en http://192.168.x.x:5173. En producción se fija con VITE_SERVER_URL.
export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? `${window.location.protocol}//${window.location.hostname}:3000`

// El token de la cuenta se guarda en localStorage: la sesión se mantiene al
// cerrar el navegador (30 días). Abrir la misma cuenta en otra pestaña cierra
// la anterior (una cuenta = un asiento).
const TOKEN_KEY = 'mus.authToken'

export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* almacenamiento bloqueado: la sesión solo dura lo que la pestaña */
    }
  },
}

// Solo se conecta tras iniciar sesión (el servidor rechaza sockets sin token).
export const socket = io(SERVER_URL, {
  transports: ['websocket'],
  autoConnect: false,
  auth: (cb) => cb({ token: tokenStore.get() }),
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

/** Llamada HTTP al API → { ok, data } | { ok:false, error } */
export async function api(method, path, body) {
  const token = tokenStore.get()
  try {
    const res = await fetch(SERVER_URL + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = res.status === 204 ? null : await res.json().catch(() => null)
    if (!res.ok) return { ok: false, status: res.status, error: data ?? { message: 'Error del servidor' } }
    return { ok: true, data }
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'No hay conexión con el servidor' } }
  }
}
