import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import PhaserTable from '../game/PhaserTable'
import { MOBILE, tableLayout } from '../game/tableLayout'
import {
  ActionCallout,
  ActionDock,
  AwayBanner,
  CurrentLance,
  HandLog,
  LanceInline,
  MobileTools,
  MuteButton,
  PhaseBanner,
  PhrasePanel,
  PlayerBadge,
  Scoreboard,
  SignalPanel,
} from '../game/Hud'
import { play } from '../lib/sound'
import { FitBox, OrdagoGlow, ScoringPanel } from '../game/Scoring'
import { actions, toast, useStore } from '../lib/store'
import { isMyTeam, relativeSeat, SIGNALS } from '../lib/mus'
import { Button, Wordmark } from '../components/ui'
import { cx } from '../lib/cx'

const EMPTY = []

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setSize((prev) => (prev.w === window.innerWidth && prev.h === window.innerHeight ? prev : { w: window.innerWidth, h: window.innerHeight })),
      )
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return size
}

/** true cuando han pasado `ms` desde que `key` cambió a un valor no nulo. */
function useDelayed(key, ms) {
  const [ready, setReady] = useState(null)
  useEffect(() => {
    if (!key) return undefined
    const id = setTimeout(() => setReady(key), ms)
    return () => clearTimeout(id)
  }, [key, ms])
  return key !== null && ready === key
}

const BETTING_PHASES = ['GRANDE', 'CHICA', 'PARES', 'JUEGO', 'PUNTO']

/** Nombre del sonido para la última jugada. */
function soundFor(a) {
  if (!a) return null
  switch (a.type) {
    case 'HAND_STARTED':
      return 'deal'
    case 'MUS':
    case 'MUS_AGREED':
      return 'mus'
    case 'MUS_CUT':
      return 'cut'
    case 'DISCARD_SUBMITTED':
      return 'flip'
    case 'DISCARD_RESOLVED':
      return 'discard'
    case 'BET':
      if (a.action === 'ordago' || (a.action === 'quiero' && a.bet?.ordago)) return 'ordago'
      if (a.cut) return 'cut'
      return { paso: 'paso', envido: 'envido', subir: 'subir', quiero: 'quiero', no_quiero: 'noQuiero' }[a.action] ?? null
    default:
      return null
  }
}

/** Sonidos de la partida: cada jugada, tu turno y el final. */
function useGameSounds(game) {
  const sound = soundFor(game.lastAction)
  const at = game.lastAction?.at
  // La jugada que ya estaba al entrar (p. ej. al recargar) no suena.
  const firstAt = useRef(at)
  useEffect(() => {
    if (sound && at && at !== firstAt.current) play(sound)
  }, [sound, at])

  const me = game.you.seat
  const myTurn =
    (game.turn === me && (game.phase === 'MUS' || BETTING_PHASES.includes(game.phase))) ||
    (game.phase === 'DISCARD' && !game.you.pendingDiscard)
  const turnKey = myTurn ? `${game.handNumber}:${game.musRounds}:${game.phase}:${game.turn}` : null
  useEffect(() => {
    if (turnKey) play('turn')
  }, [turnKey])

  const result = game.phase === 'FINISHED' ? (game.winnerTeam === game.you.team ? 'win' : 'lose') : null
  useEffect(() => {
    if (result) play(result)
  }, [result])
}

function LeaveButton({ compact = false }) {
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
      {armed ? (compact ? '¿Salir?' : '¿Abandonar? Se cancela la partida') : compact ? 'Salir' : 'Abandonar'}
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
  return <GameView game={game} room={room} />
}

function GameView({ game, room }) {
  const partnerSignal = useStore((s) => s.partnerSignal)
  const emotes = useStore((s) => s.emotes)
  const eloDelta = useStore((s) => s.eloDelta)
  const { w, h } = useViewport()
  const layout = useMemo(() => tableLayout(w, h), [w, h])
  useGameSounds(game)

  // Selección ligada a la ronda de descarte actual: al cambiar de ronda se vacía sola.
  const [picked, setPicked] = useState({ round: null, ids: EMPTY })
  const [busy, setBusy] = useState(false)
  const [lastSent, setLastSent] = useState(null)
  const [amount, setAmount] = useState(2)
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
  const onCutBet = useCallback((n) => act(() => actions.cutAndBet(n)), [act])
  const onDiscard = useCallback(() => {
    if (selection.length) act(() => actions.discard(selection))
  }, [act, selection])

  const onBet = useCallback((action, n) => act(() => actions.bet(action, n)), [act])
  const tick = useCallback(() => play('tick'), [])
  const onContinue = useCallback(() => act(() => actions.continueHand()), [act])

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
        if (k === 'e') onCutBet(amount)
      }
      if (k === 'enter' && canDiscard && selection.length && !busy) onDiscard()
      if (k === 'enter' && game.phase === 'SCORING' && !busy && !game.continueVotes?.includes(me)) onContinue()

      const allowed = game.you.actions ?? []
      if (allowed.length && !busy) {
        const map = { p: ['paso'], q: ['quiero'], n: ['no_quiero'], o: ['ordago'], e: ['envido', 'subir'] }
        const action = map[k]?.find((a) => allowed.includes(a))
        if (action) onBet(action, action === 'envido' || action === 'subir' ? amount : undefined)
      }
      const signal = SIGNALS.find((s) => s.key === e.key)
      if (signal) sendSignal(signal.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game, me, busy, canDiscard, selection, amount, onMus, onCutBet, onDiscard, onBet, onContinue, sendSignal])

  const partnerSeat = (me + 2) % 4
  const partner = room.seats[partnerSeat]
  const humans = room.seats.filter((s) => s && !s.isBot).length
  // Hueco libre entre las cartas enseñadas del compañero y las tuyas.
  const scoreGap = {
    top: layout.hands[2].y + (layout.backH * (layout.revealScale ?? 1.25)) / 2 + 14,
    bottom: layout.hands[0].y - layout.myH / 2 - 14,
  }
  const ordagoLive = Boolean(game.betting?.bet?.ordago) || (game.phase === 'SCORING' && Boolean(game.handResult?.ordago))
  // La tabla del conteo espera un poco: así se ve la última jugada (bocadillo y
  // resultado del lance) y se descubren las cartas antes de taparlas.
  const handOver = game.phase === 'SCORING' || game.phase === 'FINISHED'
  const showScore = useDelayed(handOver && game.handResult ? `${game.handNumber}:${game.phase}` : null, 2200)

  const portrait = layout.portrait
  // En el móvil (vertical u horizontal) señas, frases y jugadas van en hojas
  // que suben desde abajo, en vez de paneles flotando sobre la mesa.
  const sheets = portrait || layout.short
  let dockStyle
  if (portrait) dockStyle = null
  else if (layout.compact && !layout.short) {
    dockStyle = { left: layout.W / 2, top: layout.hands[0].y - layout.myH / 2 - 70, transform: 'translate(-50%, -50%)' }
  } else dockStyle = { left: layout.dock.x, top: layout.dock.y, transform: 'translateY(-50%)' }

  return (
    <div className="fixed inset-0 touch-none overflow-hidden overscroll-none bg-ink-950">
      <PhaserTable state={game} selection={selection} onToggleCard={toggleCard} />

      {/* Barra superior */}
      {portrait ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between border-b border-white/[0.05] bg-ink-950/70 px-2 backdrop-blur-md"
          style={{ height: layout.topBar, paddingTop: layout.safe.top }}
        >
          <div className="pointer-events-auto w-[92px]">
            <LeaveButton compact />
          </div>
          <LanceInline game={game} />
          <div className="pointer-events-auto flex w-[92px] justify-end">
            <Scoreboard score={game.score} myTeam={game.you.team} compact />
          </div>
        </div>
      ) : (
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className={cx('pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between', layout.short ? 'p-2.5' : 'p-5')}
      >
        <div className="pointer-events-auto flex items-center gap-4">
          {!layout.compact && (
            <>
              <Wordmark />
              <span className="h-5 w-px bg-white/10" />
            </>
          )}
          <span className="font-mono text-[12px] tracking-[0.2em] text-bone-dim">{room.code}</span>
          <LeaveButton compact={layout.short} />
          {!layout.short && <MuteButton />}
        </div>
        <div className={cx('absolute left-1/2 -translate-x-1/2', layout.short ? 'top-1.5' : 'top-5')}>
          <CurrentLance game={game} compact={layout.short} />
        </div>
        <div className="pointer-events-auto">
          <Scoreboard score={game.score} myTeam={game.you.team} compact={layout.short} />
        </div>
      </motion.div>
      )}

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
            emote={emotes[p.seat]}
            size={layout.avatarSize}
            compact={layout.compact}
            bubbleSide={portrait && rel === 2 ? 'bottomFar' : undefined}
          />
        )
      })}

      <PhaseBanner game={game} center={layout.center} />
      <ActionCallout game={game} center={layout.center} />

      {/* Acciones */}
      {portrait ? (
        // Móvil: barra inferior fija. Arriba la botonera, abajo las herramientas.
        <div
          className="absolute inset-x-0 bottom-0 z-40 flex flex-col border-t border-white/[0.06] bg-ink-950/90 px-3 backdrop-blur-md"
          style={{ height: layout.bottomBar, paddingBottom: layout.safe.bottom }}
        >
          <div className="flex shrink-0 items-center" style={{ height: MOBILE.actionBar }}>
            <ActionDock
              bar
              game={game}
              selection={selection}
              busy={busy}
              onMus={onMus}
              onCutBet={onCutBet}
              onDiscard={onDiscard}
              onBet={onBet}
              amount={amount}
              setAmount={setAmount}
              compact
              onTick={tick}
            />
          </div>
          <div className="shrink-0 border-t border-white/[0.05] pt-[3px]" style={{ height: MOBILE.toolBar }}>
            <MobileTools
              game={game}
              partnerName={partner?.username ?? 'tu compañero'}
              partnerIsBot={partner?.isBot}
              onSignal={sendSignal}
              lastSent={lastSent}
              onPhrase={(id) => actions.emote(id)}
            />
          </div>
        </div>
      ) : (
        <div className="absolute z-30" style={dockStyle}>
          <ActionDock
            game={game}
            selection={selection}
            busy={busy}
            onMus={onMus}
            onCutBet={onCutBet}
            onDiscard={onDiscard}
            onBet={onBet}
            amount={amount}
            setAmount={setAmount}
            compact={layout.compact}
            onTick={tick}
          />
        </div>
      )}

      {/* Si un bot está jugando por ti (ausencia), puedes recuperar el asiento */}
      {room.seats[me]?.substitute && (
        <div className="absolute left-1/2 z-50 w-max max-w-[calc(100vw-20px)] -translate-x-1/2" style={{ top: portrait ? layout.topBar + 10 : 72 }}>
          <AwayBanner onResume={() => actions.resume()} />
        </div>
      )}

      <OrdagoGlow active={ordagoLive} />

      {/* Conteo */}
      <AnimatePresence>
        {showScore && (
          <div
            key={`score-${game.handNumber}`}
            className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
            style={{ left: layout.center.x, top: (scoreGap.top + scoreGap.bottom) / 2 }}
          >
            <FitBox maxHeight={scoreGap.bottom - scoreGap.top}>
              <ScoringPanel
                game={game}
                humans={humans}
                onContinue={onContinue}
                busy={busy}
                eloDelta={eloDelta}
                onReset={actions.resetRoom}
                onLeave={actions.leaveRoom}
              />
            </FitBox>
          </div>
        )}
      </AnimatePresence>

      {sheets ? (
        // Móvil en horizontal: las mismas herramientas, en una pastilla arriba a la izquierda.
        !portrait && (
          <div className="glass absolute left-2.5 top-14 z-40 w-[300px] rounded-2xl px-1">
            <MobileTools
              game={game}
              partnerName={partner?.username ?? 'tu compañero'}
              partnerIsBot={partner?.isBot}
              onSignal={sendSignal}
              lastSent={lastSent}
              onPhrase={(id) => actions.emote(id)}
            />
          </div>
        )
      ) : (
        <>
          {/* Historial de jugadas de la mano */}
          <div className="absolute left-5 top-[84px] z-40">
            <HandLog game={game} compact={layout.compact} />
          </div>

          {/* Señas y frases: abajo a la izquierda */}
          <div className="absolute bottom-5 left-5 z-40">
            <div className="flex items-start gap-2">
              <SignalPanel
                compact={layout.compact}
                partnerName={partner?.username ?? 'tu compañero'}
                partnerIsBot={partner?.isBot}
                onSend={sendSignal}
                lastSent={lastSent}
              />
              <PhrasePanel compact={layout.compact} onSend={(id) => actions.emote(id)} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
