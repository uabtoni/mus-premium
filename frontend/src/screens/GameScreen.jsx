import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import PhaserTable from '../game/PhaserTable'
import { tableLayout } from '../game/tableLayout'
import { ActionDock, LanceTrack, PhaseBanner, PlayerBadge, Scoreboard, SignalPanel } from '../game/Hud'
import { actions, toast, useStore } from '../lib/store'
import { isMyTeam, relativeSeat, SIGNALS } from '../lib/mus'
import { Button, Wordmark } from '../components/ui'

const EMPTY = []

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

function LeaveButton() {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const id = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(id)
  }, [armed])
  return (
    <Button
      variant={armed ? 'ember' : 'ghost'}
      size="sm"
      onClick={() => (armed ? actions.leaveRoom() : setArmed(true))}
    >
      {armed ? '¿Abandonar? Se cancela la partida' : 'Abandonar'}
    </Button>
  )
}

// Durante la animación de salida la pantalla sigue montada aunque la partida
// ya no exista: en ese caso no se pinta nada.
export default function GameScreen() {
  const game = useStore((s) => s.game)
  const room = useStore((s) => s.room)
  const user = useStore((s) => s.user)
  if (!game?.you || !room || !user) return null
  return <GameView game={game} room={room} user={user} />
}

function GameView({ game, room, user }) {
  const partnerSignal = useStore((s) => s.partnerSignal)
  const { w, h } = useViewport()
  const layout = useMemo(() => tableLayout(w, h), [w, h])

  // Selección ligada a la ronda de descarte actual: al cambiar de ronda se vacía sola.
  const [picked, setPicked] = useState({ round: null, ids: EMPTY })
  const [busy, setBusy] = useState(false)
  const [lastSent, setLastSent] = useState(null)
  const sentTimer = useRef(null)

  const me = game.you.seat
  const canDiscard = game.phase === 'DISCARD' && !game.you.pendingDiscard

  const round = `${game.handNumber}:${game.musRounds}`
  const selection = canDiscard && picked.round === round ? picked.ids : EMPTY

  const toggleCard = useCallback(
    (id) => {
      setPicked((prev) => {
        const sel = prev.round === round ? prev.ids : EMPTY
        if (sel.includes(id)) return { round, ids: sel.filter((x) => x !== id) }
        if (sel.length >= 4) return prev
        return { round, ids: [...sel, id] }
      })
    },
    [round],
  )

  const act = useCallback(async (fn) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }, [])

  const onMus = useCallback((mus) => act(() => actions.sayMus(mus)), [act])
  const onDiscard = useCallback(() => {
    if (selection.length) act(() => actions.discard(selection))
  }, [act, selection])

  const sendSignal = useCallback(async (id) => {
    const res = await actions.sendSignal(id)
    if (res.ok) {
      setLastSent(id)
      clearTimeout(sentTimer.current)
      sentTimer.current = setTimeout(() => setLastSent(null), 1200)
      toast(`Seña enviada: ${SIGNALS.find((s) => s.id === id)?.label}`, 'success', 1600)
    }
  }, [])

  // Atajos de teclado
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (game.phase === 'MUS' && game.turn === me && !busy) {
        if (k === 'm') onMus(true)
        if (k === 'c') onMus(false)
      }
      if (k === 'enter' && canDiscard && selection.length && !busy) onDiscard()
      const signal = SIGNALS.find((s) => s.key === e.key)
      if (signal) sendSignal(signal.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game.phase, game.turn, me, busy, canDiscard, selection, onMus, onDiscard, sendSignal])

  const partnerSeat = (me + 2) % 4
  const partner = room.seats[partnerSeat]

  const dockStyle = layout.compact
    ? { left: layout.W / 2, top: layout.hands[0].y - layout.myH / 2 - 70, transform: 'translate(-50%, -50%)' }
    : { left: layout.dock.x, top: layout.dock.y, transform: 'translateY(-50%)' }

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink-950">
      <PhaserTable state={game} selection={selection} onToggleCard={toggleCard} />

      {/* Barra superior */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-5"
      >
        <div className="pointer-events-auto flex items-center gap-4">
          {!layout.compact && (
            <>
              <Wordmark />
              <span className="h-5 w-px bg-white/10" />
            </>
          )}
          <span className="font-mono text-[12px] tracking-[0.2em] text-bone-dim">{room.code}</span>
          <LeaveButton />
        </div>
        <div className="absolute left-1/2 top-5 -translate-x-1/2">
          <LanceTrack game={game} />
        </div>
        <div className="pointer-events-auto">
          <Scoreboard score={game.score} myTeam={game.you.team} />
        </div>
      </motion.div>

      {/* Jugadores */}
      {game.players.map((p) => {
        const rel = relativeSeat(p.seat, me)
        const member = room.seats[p.seat]
        return (
          <PlayerBadge
            key={p.seat}
            game={game}
            seat={p.seat}
            rel={rel}
            team={isMyTeam(p.seat, me) ? 'us' : 'them'}
            position={layout.avatars[rel]}
            isBot={member?.isBot}
            connected={member?.connected ?? true}
            partnerSignal={partnerSignal}
          />
        )
      })}

      <PhaseBanner game={game} center={layout.center} />

      {/* Acciones */}
      <div className="absolute z-30" style={dockStyle}>
        <ActionDock
          game={game}
          selection={selection}
          busy={busy}
          onMus={onMus}
          onDiscard={onDiscard}
          onRedeal={() => actions.devRedeal()}
          devTools={user.features?.devTools}
        />
      </div>

      {/* Señas */}
      <div className="absolute bottom-5 left-5 z-30">
        <SignalPanel
          partnerName={partner?.username ?? 'tu compañero'}
          partnerIsBot={partner?.isBot}
          onSend={sendSignal}
          lastSent={lastSent}
        />
      </div>
    </div>
  )
}
