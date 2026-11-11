import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { actions, useStore } from '../lib/store'
import { cx } from '../lib/cx'
import { Avatar, Button } from './ui'

const PRESENCE = {
  online: { label: 'En línea', dot: 'bg-acid shadow-[0_0_8px_rgba(212,255,79,0.8)]', canInvite: true },
  room: { label: 'En una mesa', dot: 'bg-gold', canInvite: true },
  playing: { label: 'Jugando', dot: 'bg-ember', canInvite: false },
  offline: { label: 'Desconectado', dot: 'bg-mute/60', canInvite: false },
}

function FriendRow({ friend, children }) {
  const p = PRESENCE[friend.presence] ?? PRESENCE.offline
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.03]">
      <div className="relative">
        <Avatar name={friend.username} size={36} connected={friend.relation !== 'friend' || friend.presence !== 'offline'} />
        {friend.relation === 'friend' && <span className={cx('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink-900', p.dot)} />}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[14px] font-medium text-bone">{friend.username}</div>
        <div className="font-mono text-[11px] text-bone-dim">
          {friend.relation === 'friend' ? p.label : friend.relation === 'incoming' ? 'Quiere ser tu amigo' : 'Solicitud enviada'}
          <span className="text-mute"> · ELO {friend.elo}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </li>
  )
}

/**
 * Panel de amigos: añadir por nombre, aceptar solicitudes, ver quién está
 * conectado e invitarle a tu mesa como compañero.
 */
export function FriendsPanel({ className, title = 'Amigos', inviteLabel = 'Invitar' }) {
  const friends = useStore((s) => s.friends)
  const room = useStore((s) => s.room)
  const user = useStore((s) => s.user)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)

  useEffect(() => {
    actions.loadFriends()
  }, [])

  const incoming = friends.filter((f) => f.relation === 'incoming')
  const outgoing = friends.filter((f) => f.relation === 'outgoing')
  const accepted = friends
    .filter((f) => f.relation === 'friend')
    .sort((a, b) => (a.presence === 'offline') - (b.presence === 'offline') || a.username.localeCompare(b.username))
  const inRoom = new Set(room?.seats.filter(Boolean).map((s) => s.playerId) ?? [])
  const playing = room?.status === 'playing'

  const run = (key, fn) => async () => {
    setBusy(key)
    await fn()
    setBusy(null)
  }

  const add = async (e) => {
    e.preventDefault()
    if (name.trim().length < 2 || busy) return
    setBusy('add')
    const res = await actions.addFriend(name.trim())
    if (res.ok) setName('')
    setBusy(null)
  }

  return (
    <div className={cx('glass flex flex-col rounded-[28px] p-5 sm:p-6', className)}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{title}</span>
        <span className="font-mono text-[11px] text-bone-dim">
          {accepted.filter((f) => f.presence !== 'offline').length} en línea
        </span>
      </div>

      <form onSubmit={add} className="mt-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Añadir por nombre de usuario"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-ink-900/70 px-3.5 text-[14px] text-bone outline-none placeholder:text-mute focus:border-acid/50"
        />
        <Button type="submit" size="sm" className="h-10" disabled={name.trim().length < 2 || busy === 'add'}>
          Añadir
        </Button>
      </form>

      <div className="thin-scroll mt-3 max-h-[300px] flex-1 overflow-y-auto pr-1">
        {incoming.length > 0 && (
          <>
            <div className="eyebrow mb-1 mt-3 text-[9.5px] text-acid">Solicitudes</div>
            <ul>
              {incoming.map((f) => (
                <FriendRow key={f.id} friend={f}>
                  <Button size="sm" variant="primary" onClick={run(`acc${f.id}`, () => actions.respondFriend(f.id, true))} disabled={!!busy}>
                    Aceptar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={run(`dec${f.id}`, () => actions.respondFriend(f.id, false))} disabled={!!busy}>
                    ✕
                  </Button>
                </FriendRow>
              ))}
            </ul>
          </>
        )}

        {accepted.length > 0 && (
          <ul className="mt-2">
            {accepted.map((f) => {
              const p = PRESENCE[f.presence] ?? PRESENCE.offline
              const seated = inRoom.has(`user:${f.id}`)
              return (
                <FriendRow key={f.id} friend={f}>
                  {seated ? (
                    <span className="rounded-full bg-acid/15 px-2.5 py-1 font-mono text-[10.5px] text-acid">En tu mesa</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={p.canInvite ? 'primary' : 'glass'}
                      onClick={run(`inv${f.id}`, () => actions.inviteFriend(f.id, f.username))}
                      disabled={!p.canInvite || playing || !!busy}
                      title={p.canInvite ? 'Le invitas a tu mesa como compañero' : p.label}
                    >
                      {busy === `inv${f.id}` ? '…' : inviteLabel}
                    </Button>
                  )}
                  {confirmRemove === f.id ? (
                    <Button size="sm" variant="ember" onClick={run(`rm${f.id}`, () => actions.removeFriend(f.id))} onBlur={() => setConfirmRemove(null)}>
                      Quitar
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(f.id)} aria-label={`Quitar a ${f.username}`}>
                      ⋯
                    </Button>
                  )}
                </FriendRow>
              )
            })}
          </ul>
        )}

        {outgoing.length > 0 && (
          <>
            <div className="eyebrow mb-1 mt-3 text-[9.5px]">Enviadas</div>
            <ul>
              {outgoing.map((f) => (
                <FriendRow key={f.id} friend={f}>
                  <Button size="sm" variant="ghost" onClick={run(`can${f.id}`, () => actions.removeFriend(f.id))} disabled={!!busy}>
                    Cancelar
                  </Button>
                </FriendRow>
              ))}
            </ul>
          </>
        )}

        {friends.length === 0 && (
          <p className="py-6 text-center text-[13.5px] leading-relaxed text-mute">
            Aún no tienes amigos en Mus Premium.
            <br />
            Añade a tu compañero por su usuario{user ? ` (el tuyo es «${user.username}»)` : ''}.
          </p>
        )}
      </div>
    </div>
  )
}

/** Invitación recibida: aparece encima de todo, en cualquier pantalla. */
export function InviteDialog() {
  const invites = useStore((s) => s.invites)
  const room = useStore((s) => s.room)
  const invite = invites[0]
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!invite) return undefined
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [invite])

  const seconds = invite ? Math.max(0, Math.ceil((invite.expiresAt - now) / 1000)) : 0
  const leavingGame = room?.status === 'playing'

  return (
    <AnimatePresence>
      {invite && (
        <motion.div
          key={invite.id}
          initial={{ opacity: 0, y: -24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="fixed inset-x-3 top-3 z-[60] mx-auto max-w-[420px] sm:top-5"
          role="dialog"
          aria-label="Invitación a una partida"
        >
          <div className="glass flex items-center gap-4 rounded-2xl border-acid/30 p-4 shadow-[0_0_60px_-12px_rgba(212,255,79,0.55)]">
            <Avatar name={invite.from.username} size={46} active />
            <div className="min-w-0 flex-1">
              <div className="eyebrow text-[9.5px] text-acid">Invitación · {seconds}s</div>
              <div className="mt-1 truncate text-[15px] font-medium text-bone">
                {invite.from.username} te invita de compañero
              </div>
              {leavingGame && <div className="text-[12px] text-ember">Termina tu partida antes de unirte</div>}
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button size="sm" variant="primary" onClick={() => actions.respondInvite(invite, true)} disabled={leavingGame}>
                Unirme
              </Button>
              <Button size="sm" variant="ghost" onClick={() => actions.respondInvite(invite, false)}>
                Ahora no
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
