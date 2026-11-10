import { useSyncExternalStore } from 'react'
import { socket, request, tokenStore } from './socket'

/**
 * Store global mínimo (sin dependencias). El servidor es la fuente de verdad:
 * aquí solo se refleja lo que llega por socket.
 */
const initialState = {
  connection: socket.connected ? 'online' : 'connecting', // online | connecting | offline
  restoring: Boolean(tokenStore.get()),
  user: null,
  room: null,
  game: null,
  partnerSignal: null, // { from, signal, at }
  toasts: [],
}

let state = initialState
const listeners = new Set()

function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export function getState() {
  return state
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Selector: debe devolver referencias existentes del estado (no objetos nuevos). */
export function useStore(selector = (s) => s) {
  return useSyncExternalStore(subscribe, () => selector(state))
}

// ───────────────────────────── Toasts ─────────────────────────────

let toastSeq = 0
export function toast(message, tone = 'neutral', ttl = 3800) {
  const id = ++toastSeq
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }))
  setTimeout(() => dismissToast(id), ttl)
  return id
}

export function dismissToast(id) {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

// ───────────────────────────── Socket → store ─────────────────────────────

function applyUser(user) {
  if (user?.sessionToken) tokenStore.set(user.sessionToken)
  setState({ user })
}

function applyGame(game) {
  if (!game) return setState({ game: null })
  setState((s) => {
    // Descarta estados antiguos que lleguen desordenados (misma partida).
    if (s.game && game.version < s.game.version && game.handNumber <= s.game.handNumber) return {}
    return { game }
  })
}

socket.on('connect', async () => {
  setState({ connection: 'online' })
  if (!tokenStore.get()) return setState({ restoring: false })
  // Si el token ya no es válido (p. ej. el servidor se reinició) lo olvidamos.
  const res = await request('room:sync')
  if (!res.ok && res.error?.code === 'NOT_AUTHENTICATED') {
    tokenStore.set(null)
    setState({ user: null, room: null, game: null })
  } else if (res.ok) {
    setState({ room: res.data.room })
    applyGame(res.data.game)
  }
  setState({ restoring: false })
})

socket.on('disconnect', () => setState({ connection: 'offline' }))
socket.io.on('reconnect_attempt', () => setState({ connection: 'connecting' }))

socket.on('login_success', applyUser)

socket.on('session:restored', ({ user, room, game }) => {
  applyUser(user)
  setState({ room })
  applyGame(game)
})

socket.on('session:replaced', () => {
  tokenStore.set(null)
  setState({ user: null, room: null, game: null })
  toast('Tu sesión se ha abierto en otra pestaña', 'warn', 6000)
})

socket.on('room:update', (room) => {
  setState((s) => (s.room && s.room.code !== room.code ? {} : { room }))
  if (room.status === 'waiting') setState({ game: null, partnerSignal: null })
})

socket.on('room:left', ({ reason }) => {
  setState({ room: null, game: null, partnerSignal: null })
  if (reason === 'disconnected') toast('Has perdido tu asiento por desconexión', 'warn')
})

socket.on('game:state', applyGame)

socket.on('game:aborted', ({ username, reason }) => {
  setState({ game: null, partnerSignal: null })
  const why = reason === 'disconnected' ? 'se ha desconectado' : 'ha abandonado la mesa'
  toast(`${username ?? 'Un jugador'} ${why}. Partida cancelada.`, 'warn', 6000)
})

socket.on('game:signal', (signal) => setState({ partnerSignal: signal }))

socket.on('app:error', (err) => toast(err.message ?? 'Error', 'error'))

// ───────────────────────────── Acciones ─────────────────────────────

async function run(event, payload, { silent = false } = {}) {
  const res = await request(event, payload)
  if (!res.ok && !silent) toast(res.error?.message ?? 'Algo ha fallado', 'error')
  return res
}

export const actions = {
  async login(username) {
    const res = await run('login_user', { username })
    if (res.ok) {
      applyUser(res.data.user)
      setState({ room: res.data.room })
      applyGame(res.data.game)
    }
    return res
  },

  async logout() {
    await run('logout', undefined, { silent: true })
    tokenStore.set(null)
    setState({ user: null, room: null, game: null, partnerSignal: null })
  },

  async createRoom(isPrivate = true) {
    const res = await run('room:create', { isPrivate })
    if (res.ok) setState({ room: res.data })
    return res
  },

  async joinRoom(code, seat) {
    const res = await run('room:join', seat === undefined ? { code } : { code, seat })
    if (res.ok) {
      setState({ room: res.data.room })
      applyGame(res.data.game)
    }
    return res
  },

  async quickMatch() {
    const res = await run('room:quickMatch')
    if (res.ok) {
      setState({ room: res.data.room })
      applyGame(res.data.game)
    }
    return res
  },

  async practice() {
    const created = await actions.createRoom(true)
    if (!created.ok) return created
    await run('room:ready', { ready: true })
    return run('room:addBots')
  },

  async leaveRoom() {
    const res = await run('room:leave')
    if (res.ok) setState({ room: null, game: null, partnerSignal: null })
    return res
  },

  changeSeat: (seat) => run('room:changeSeat', { seat }),
  setReady: (ready) => run('room:ready', { ready }),
  async addBots() {
    await run('room:ready', { ready: true })
    return run('room:addBots')
  },

  sayMus: (mus) => run('game:mus', { mus }),
  discard: (cardIds) => run('game:discard', { cardIds }),
  sendSignal: (signal) => run('game:signal', { signal }),
  devRedeal: () => run('game:devRedeal'),
}
