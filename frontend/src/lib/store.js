import { useSyncExternalStore } from 'react'
import { socket, request, tokenStore, api } from './socket'
import { play } from './sound'

/**
 * Store global mínimo (sin dependencias). El servidor es la fuente de verdad:
 * aquí solo se refleja lo que llega por socket.
 */
const initialState = {
  connection: 'connecting', // online | connecting | offline
  restoring: Boolean(tokenStore.get()), // comprobando la sesión guardada
  user: null,
  friends: [], // [{ id, username, elo, relation: friend|incoming|outgoing, presence }]
  invites: [], // invitaciones recibidas pendientes
  emotes: {}, // asiento -> { id, at } última frase rápida de cada jugador
  room: null,
  game: null,
  partnerSignal: null, // { from, signal, at }
  eloDelta: null, // variación de ELO de la última partida terminada
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
  setState({ user })
}

/** Cierra la sesión local (sin avisar al servidor). */
function clearSession() {
  tokenStore.set(null)
  socket.disconnect()
  setState({ user: null, room: null, game: null, partnerSignal: null, friends: [], invites: [], restoring: false })
}

function applyGame(game) {
  if (!game) return setState({ game: null })
  setState((s) => {
    // Descarta estados antiguos que lleguen desordenados (misma partida).
    if (s.game && game.version < s.game.version && game.handNumber <= s.game.handNumber) return {}
    // Momento de recepción: el plazo del turno se calcula con el reloj local.
    return { game: { ...game, receivedAt: Date.now() } }
  })
}

socket.on('connect', () => setState({ connection: 'online' }))
socket.on('disconnect', () => setState({ connection: 'offline' }))
socket.io.on('reconnect_attempt', () => setState({ connection: 'connecting' }))

// El servidor rechaza el handshake si el token ya no vale.
socket.on('connect_error', (err) => {
  if (err?.message === 'UNAUTHORIZED') {
    clearSession()
    toast('Tu sesión ha caducado. Vuelve a entrar.', 'warn', 5000)
  } else {
    setState({ connection: 'offline' })
  }
})

// Al conectar, el servidor envía el perfil, la mesa y la partida en curso.
socket.on('session:ready', ({ user, room, game }) => {
  applyUser(user)
  setState({ room, restoring: false })
  applyGame(game)
  actions.loadFriends()
})

socket.on('session:replaced', () => {
  // La cuenta se ha abierto en otra pestaña: esta deja de jugar (sin borrar el token).
  socket.disconnect()
  setState({ user: null, room: null, game: null, friends: [], invites: [], restoring: false })
  toast('Has abierto la partida en otra pestaña o dispositivo', 'warn', 6000)
})

socket.on('room:update', (room) => {
  setState((s) => {
    // Se acepta si es mi mesa, o si me han sentado en otra (p. ej. al emparejar parejas).
    const mine = room.seats.some((seat) => seat?.playerId === s.user?.playerId)
    if (s.room && s.room.code !== room.code && !mine) return {}
    return { room }
  })
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

socket.on('profile:update', ({ user, eloDelta }) => {
  applyUser(user)
  setState({ eloDelta })
})

socket.on('app:error', (err) => toast(err.message ?? 'Error', 'error'))

// ───────────────────────────── Amigos ─────────────────────────────

socket.on('friends:changed', ({ reason, username } = {}) => {
  actions.loadFriends()
  if (reason === 'request') toast(`${username} quiere ser tu amigo`, 'neutral', 5000)
  if (reason === 'accepted') toast(`${username} y tú ya sois amigos`, 'success', 4000)
})

socket.on('friends:presence', ({ userId, presence }) => {
  setState((s) => ({ friends: s.friends.map((f) => (f.id === userId ? { ...f, presence } : f)) }))
})

socket.on('invite:received', (invite) => {
  setState((s) => ({ invites: [...s.invites.filter((i) => i.from.id !== invite.from.id), invite] }))
  const ttl = Math.max(0, invite.expiresAt - Date.now())
  setTimeout(() => setState((s) => ({ invites: s.invites.filter((i) => i.id !== invite.id) })), ttl)
})

socket.on('invite:declined', ({ username }) => toast(`${username} no puede jugar ahora`, 'warn'))

// ───────────────────────────── Mesa: frases, avisos y tiempo ─────────────────────────────

socket.on('game:emote', ({ seat, id, at }) => {
  setState((s) => ({ emotes: { ...s.emotes, [seat]: { id, at: Date.now(), serverAt: at } } }))
  play('emote')
})

socket.on('room:notice', ({ kind, reason, username }) => {
  if (kind === 'returned') return toast(`${username} ha vuelto a la mesa`, 'success')
  const why = { left: 'ha abandonado', disconnected: 'se ha desconectado', afk: 'no responde' }[reason] ?? 'se ha ido'
  toast(`${username} ${why}: un bot juega por él`, 'warn', 5000)
})

socket.on('game:timeout', () => toast('Se te acabó el tiempo: hemos jugado por ti', 'warn', 3500))

// ───────────────────────────── Acciones ─────────────────────────────

async function run(event, payload, { silent = false } = {}) {
  const res = await request(event, payload)
  if (!res.ok && !silent) toast(res.error?.message ?? 'Algo ha fallado', 'error')
  return res
}

export const actions = {
  /** Inicia sesión o crea la cuenta. Devuelve { ok, error } para mostrarlo en el formulario. */
  async authenticate(mode, username, password) {
    const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
    const res = await api('POST', path, { username, password })
    if (!res.ok) return res
    tokenStore.set(res.data.token)
    setState({ restoring: true })
    socket.connect()
    if (res.data.claimed) toast('Tu cuenta antigua ya tiene contraseña', 'success', 5000)
    return res
  },

  async logout() {
    if (socket.connected) await run('logout', undefined, { silent: true })
    await api('POST', '/api/auth/logout')
    clearSession()
  },

  async loadFriends() {
    const res = await request('friends:list')
    if (res.ok) setState({ friends: res.data })
  },
  async addFriend(username) {
    const res = await run('friends:request', { username })
    if (res.ok) {
      setState({ friends: res.data.friends })
      const msg = res.data.relation === 'friend' ? `${res.data.username} y tú ya sois amigos` : `Solicitud enviada a ${res.data.username}`
      toast(msg, 'success')
    }
    return res
  },
  async respondFriend(userId, accept) {
    const res = await run('friends:respond', { userId, accept })
    if (res.ok) setState({ friends: res.data })
    return res
  },
  async removeFriend(userId) {
    const res = await run('friends:remove', { userId })
    if (res.ok) setState({ friends: res.data })
    return res
  },
  async inviteFriend(userId, username) {
    const res = await run('friends:invite', { userId })
    if (res.ok) {
      setState({ room: res.data.room })
      toast(`Invitación enviada a ${username}`, 'success')
    }
    return res
  },
  async respondInvite(invite, accept) {
    setState((s) => ({ invites: s.invites.filter((i) => i.id !== invite.id) }))
    const res = await run('invite:respond', { id: invite.id, accept })
    if (res.ok && accept) {
      setState({ room: res.data.room })
      applyGame(res.data.game)
    }
    return res
  },
  setSearching: (on) => run('room:search', { on }),
  emote: (id) => run('game:emote', { id }),
  resume: () => run('game:resume'),

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
  cutAndBet: (amount) => run('game:cutAndBet', { amount }),
  discard: (cardIds) => run('game:discard', { cardIds }),
  sendSignal: (signal) => run('game:signal', { signal }),
  devRedeal: () => run('game:devRedeal'),
  bet: (action, amount) => run('game:bet', amount === undefined ? { action } : { action, amount }),
  continueHand: () => run('game:continue'),
  async resetRoom() {
    const res = await run('room:reset')
    if (res.ok) setState({ room: res.data, game: null, eloDelta: null })
    return res
  },
}

// ───────────────────────────── Arranque ─────────────────────────────

// Si hay un token guardado, se valida y se conecta sin pasar por el login.
if (tokenStore.get()) {
  api('GET', '/api/auth/me').then((res) => {
    if (res.ok) {
      setState({ user: { ...res.data.user, features: res.data.features } })
      socket.connect()
    } else if (res.status === 401) {
      clearSession()
    } else {
      // Servidor caído: se reintenta al conectar el socket.
      setState({ connection: 'offline' })
      socket.connect()
    }
  })
}
