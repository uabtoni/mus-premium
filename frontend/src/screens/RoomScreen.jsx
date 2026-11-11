import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { actions, toast, useStore } from '../lib/store'
import { relativeSeat, isMyTeam } from '../lib/mus'
import { cx } from '../lib/cx'
import { Avatar, Button, ConnectionDot, Wordmark } from '../components/ui'
import { FriendsPanel } from '../components/Friends'

const ease = [0.16, 1, 0.3, 1]

// Posición de cada asiento relativo alrededor de la mesa (en % del contenedor).
const SEAT_POS = [
  { left: '50%', top: '100%' },
  { left: '100%', top: '50%' },
  { left: '50%', top: '0%' },
  { left: '0%', top: '50%' },
]

function copy(text, label) {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast(`${label} copiado`, 'success', 2200))
    .catch(() => toast('No se pudo copiar', 'error'))
}

function Seat({ member, seatIndex, rel, mySeat, hostId, onSit }) {
  const team = isMyTeam(seatIndex, mySeat) ? 'us' : 'them'
  const isMe = rel === 0

  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={SEAT_POS[rel]}>
      <AnimatePresence mode="wait">
        {member ? (
          <motion.div
            key={member.playerId}
            initial={{ opacity: 0, scale: 0.85, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.5, ease }}
            className="flex w-[104px] flex-col items-center text-center sm:w-[150px]"
          >
            <Avatar name={member.username} team={team} size={isMe ? 64 : 56} isBot={member.isBot} connected={member.connected} active={member.ready} />
            <div className="mt-3 max-w-full truncate text-[14px] font-medium">
              {member.username}
              {isMe && <span className="text-bone-dim"> · tú</span>}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {member.playerId === hostId && (
                <span className="rounded-full border border-white/10 px-2 py-px font-mono text-[9.5px] uppercase tracking-[0.16em] text-bone-dim">
                  Anfitrión
                </span>
              )}
              <span
                className={cx(
                  'rounded-full px-2 py-px font-mono text-[9.5px] uppercase tracking-[0.16em]',
                  member.ready ? 'bg-acid/15 text-acid' : 'bg-white/[0.04] text-mute',
                )}
              >
                {member.ready ? 'Listo' : 'Esperando'}
              </span>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onSit}
            className="group flex w-[104px] flex-col items-center sm:w-[150px]"
          >
            <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full border border-dashed border-white/15 text-bone-dim transition-all group-hover:border-acid/60 group-hover:text-acid group-hover:shadow-[0_0_30px_-6px_rgba(212,255,79,0.5)]">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="mt-3 text-[13px] text-mute transition-colors group-hover:text-bone">Asiento libre</span>
            <span className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute/70">
              {team === 'us' ? 'Tu pareja' : 'Rival'}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function RoomScreen() {
  const room = useStore((s) => s.room)
  const user = useStore((s) => s.user)
  if (!room || !user) return null
  return <RoomView room={room} user={user} />
}

function RoomView({ room, user }) {
  const [busy, setBusy] = useState(false)

  const mySeat = room.seats.findIndex((s) => s?.playerId === user.playerId)
  const me = room.seats[mySeat]
  const count = room.playerCount
  const allReady = room.seats.every((s) => s?.ready)
  const link = `${window.location.origin}${window.location.pathname}?sala=${room.code}`

  const toggleReady = async () => {
    setBusy(true)
    await actions.setReady(!me?.ready)
    setBusy(false)
  }

  let status = `Faltan ${4 - count} ${4 - count === 1 ? 'jugador' : 'jugadores'}`
  if (room.searching) status = `Buscando rivales… ${status.toLowerCase()}`
  if (count === 4 && !allReady) status = 'Mesa completa · esperando a que todos estén listos'
  if (count === 4 && allReady) status = 'Repartiendo…'

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[1240px] flex-col px-4 pb-10 sm:px-6 lg:px-10">
        <header className="flex items-center justify-between py-4 sm:py-6">
          <Button variant="ghost" size="sm" onClick={actions.leaveRoom}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M12 7H2m0 0 4-4M2 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Salir de la mesa</span>
            <span className="sm:hidden">Salir</span>
          </Button>
          <Wordmark />
          <span className="hidden sm:block">
            <ConnectionDot />
          </span>
        </header>

        <div className="grid flex-1 grid-cols-1 items-start gap-6 py-2 sm:py-6 lg:grid-cols-[380px_1fr] lg:items-center lg:gap-8">
          {/* Panel lateral */}
          <motion.aside
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease }}
            className="flex flex-col gap-4"
          >
            <div className="glass rounded-[28px] p-5 sm:p-7">
              <span className="eyebrow">{room.isPrivate ? 'Mesa privada' : 'Mesa pública'} · código</span>
              <button
                onClick={() => copy(room.code, 'Código')}
                className="mt-4 block font-mono text-[38px] leading-none tracking-[0.22em] text-acid sm:text-[46px] transition-[text-shadow] hover:[text-shadow:0_0_24px_rgba(212,255,79,0.6)]"
                title="Copiar código"
              >
                {room.code}
              </button>
              <div className="mt-6 flex gap-2">
                <Button size="sm" onClick={() => copy(room.code, 'Código')}>
                  Copiar código
                </Button>
                <Button size="sm" variant="ghost" onClick={() => copy(link, 'Enlace')}>
                  Copiar enlace
                </Button>
              </div>
            </div>

            <div className="glass rounded-[28px] p-5 sm:p-7">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Jugadores</span>
                <span className="font-mono text-[13px] tabular text-bone">
                  {count}
                  <span className="text-mute"> / 4</span>
                </span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-1.5">
                {room.seats.map((s, i) => (
                  <motion.div
                    key={i}
                    className={cx('h-1 rounded-full', s ? (s.ready ? 'bg-acid' : 'bg-bone/50') : 'bg-white/[0.08]')}
                    layout
                  />
                ))}
              </div>
              <p className="mt-4 text-[14px] text-bone-dim">{status}</p>

              <Button
                variant={me?.ready ? 'glass' : 'primary'}
                size="lg"
                className="mt-6 w-full"
                onClick={toggleReady}
                disabled={busy}
              >
                {me?.ready ? 'Listo · cancelar' : 'Estoy listo'}
              </Button>

              {count < 4 && (
                <Button
                  variant="glass"
                  className={cx('mt-3 w-full', room.searching && 'border-acid/40 text-acid')}
                  onClick={() => actions.setSearching(!room.searching)}
                  title="Abre la mesa para que entren rivales (o otra pareja) automáticamente"
                >
                  {room.searching && <span className="h-2 w-2 animate-pulse rounded-full bg-acid" />}
                  {room.searching ? 'Buscando rivales · parar' : 'Buscar rivales'}
                </Button>
              )}

              {user.features?.devTools && count < 4 && (
                <button
                  onClick={actions.addBots}
                  className="mt-3 w-full rounded-xl border border-dashed border-white/10 py-2.5 text-[13px] text-bone-dim transition-colors hover:border-white/25 hover:text-bone"
                >
                  Completar con bots <span className="font-mono text-[10.5px] text-mute">· pruebas</span>
                </button>
              )}
            </div>
          </motion.aside>

          {/* Mesa */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease }}
            className="relative mx-auto aspect-[0.9] w-full max-w-[700px] px-[56px] py-[78px] sm:aspect-[1.55] sm:px-[90px] sm:py-[80px]"
          >
            <div className="relative h-full w-full">
              <div className="absolute inset-0 rounded-[50%] border border-acid/25 bg-[radial-gradient(ellipse_at_50%_35%,#191d23,#0c0e11_70%)] shadow-[0_0_90px_-20px_rgba(212,255,79,0.3),inset_0_0_60px_rgba(0,0,0,0.7)]" />
              <div className="absolute inset-[18px] rounded-[50%] border border-white/[0.05]" />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-[64px] italic leading-none text-bone/[0.06]">Mus</span>
                <div className="mt-2 flex items-center gap-4 font-mono text-[10.5px] uppercase tracking-[0.2em]">
                  <span className="text-acid">Nosotros</span>
                  <span className="text-mute">vs</span>
                  <span className="text-ember">Ellos</span>
                </div>
              </div>
              {room.seats.map((member, seatIndex) => (
                <Seat
                  key={seatIndex}
                  member={member}
                  seatIndex={seatIndex}
                  rel={relativeSeat(seatIndex, mySeat)}
                  mySeat={mySeat}
                  hostId={room.hostId}
                  onSit={() => actions.changeSeat(seatIndex)}
                />
              ))}
            </div>
          </motion.div>
          {count < 4 && (
            <div className="lg:col-span-2">
              <FriendsPanel title="Invita a tu compañero" inviteLabel="Invitar a la mesa" />
            </div>
          )}
        </div>

        <p className="text-center text-[12.5px] text-mute">
          Siéntate frente a tu compañero. Los asientos libres se pueden ocupar con un clic.
        </p>
      </div>
    </div>
  )
}
