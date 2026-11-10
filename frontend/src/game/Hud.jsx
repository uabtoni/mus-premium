import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar, Button } from '../components/ui'
import { cx } from '../lib/cx'
import { LANCES, SIGNALS, SIGNAL_BY_ID, TEAM_COLORS } from '../lib/mus'

const ease = [0.16, 1, 0.3, 1]

// ───────────────────────────── Avatar en mesa ─────────────────────────────

function statusFor(game, seat) {
  const p = game.players[seat]
  const a = game.lastAction
  if (game.phase === 'DISCARD') return p.hasDiscarded ? { text: 'Listo', tone: 'us' } : { text: 'Descartando', tone: 'idle' }
  if (a?.type === 'MUS_CUT' && a.seat === seat) return { text: 'Corta', tone: 'them' }
  if (game.phase === 'MUS') {
    if (p.saidMus) return { text: 'Mus', tone: 'us' }
    if (a?.type === 'DISCARD_RESOLVED' && game.lastDiscardCounts) {
      return { text: `Pidió ${game.lastDiscardCounts[seat]}`, tone: 'idle' }
    }
    if (game.turn === seat) return { text: 'Hablando', tone: 'live' }
  }
  return null
}

const CHIP_TONES = {
  us: 'bg-acid/15 text-acid border-acid/25',
  them: 'bg-ember/15 text-ember border-ember/30',
  idle: 'bg-white/[0.04] text-bone-dim border-white/10',
  live: 'bg-white/[0.06] text-bone border-white/15',
}

/** Devuelve `value` durante `ttl` ms desde que cambia; después, null. */
function useTimedValue(value, ttl) {
  const [expired, setExpired] = useState(null)
  useEffect(() => {
    if (!value) return undefined
    const id = setTimeout(() => setExpired(value), ttl)
    return () => clearTimeout(id)
  }, [value, ttl])
  return value && expired !== value ? value : null
}

export function PlayerBadge({ game, seat, rel, team, position, isBot, connected, partnerSignal }) {
  const player = game.players[seat]
  const isMe = rel === 0
  const active = game.turn === seat
  const status = statusFor(game, seat)
  const signal = useTimedValue(rel === 2 ? partnerSignal : null, 4200)
  const meta = signal ? SIGNAL_BY_ID[signal.signal] : null

  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ left: position.x, top: position.y }}
    >
      <div className="relative flex flex-col items-center">
        <Avatar name={player.username} team={team} active={active} size={isMe ? 60 : 52} isBot={isBot} connected={connected} />
        <div className="mt-2.5 flex items-center gap-1.5 whitespace-nowrap">
          <span className="max-w-[120px] truncate text-[13px] font-medium text-bone">{isMe ? 'Tú' : player.username}</span>
          {game.mano === seat && (
            <span className="rounded-[4px] border border-acid/40 px-1 font-mono text-[8.5px] uppercase leading-[14px] tracking-[0.16em] text-acid">
              Mano
            </span>
          )}
        </div>
        <div className="mt-1.5 h-[20px]">
          <AnimatePresence mode="wait">
            {status && (
              <motion.span
                key={status.text}
                initial={{ opacity: 0, y: 4, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.9 }}
                transition={{ duration: 0.25 }}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-px font-mono text-[9.5px] uppercase leading-4 tracking-[0.16em]',
                  CHIP_TONES[status.tone],
                )}
              >
                {status.tone === 'live' && <span className="h-1 w-1 animate-pulse rounded-full bg-bone" />}
                {status.text}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Seña recibida: solo existe en el cliente del compañero */}
        <AnimatePresence>
          {meta && (
            <motion.div
              key={signal.at}
              initial={{ opacity: 0, y: 10, scale: 0.9, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(6px)' }}
              transition={{ duration: 0.4, ease }}
              className="absolute left-1/2 top-full mt-2 w-max -translate-x-1/2"
            >
              <div className="glass rounded-2xl border-acid/30 px-4 py-2.5 text-center shadow-[0_0_40px_-10px_rgba(212,255,79,0.6)]">
                <div className="eyebrow text-[9px] text-acid">Seña de tu compañero</div>
                <div className="mt-1 font-display text-[24px] italic leading-none text-bone">{meta.label}</div>
                <div className="mt-1 text-[11.5px] text-bone-dim">{meta.gesture}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ───────────────────────────── Marcador ─────────────────────────────

function ScoreRow({ label, stones, games, perGame, gamesToWin, color }) {
  const segments = perGame / 5 // amarracos de 5 piedras
  const filled = stones / 5
  return (
    <div>
      <div className="flex items-baseline justify-between gap-6">
        <span className="eyebrow" style={{ color }}>
          {label}
        </span>
        <span className="font-mono text-[22px] tabular leading-none text-bone">
          {String(stones).padStart(2, '0')}
          <span className="text-[12px] text-mute">/{perGame}</span>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-[3px]">
        {Array.from({ length: segments }, (_, i) => (
          <div key={i} className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full"
              style={{ background: color, boxShadow: `0 0 10px ${color}` }}
              initial={false}
              animate={{ width: `${Math.max(0, Math.min(1, filled - i)) * 100}%` }}
              transition={{ duration: 0.6, ease }}
            />
          </div>
        ))}
        <div className="ml-2 flex gap-1">
          {Array.from({ length: gamesToWin }, (_, i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full border"
              style={{ borderColor: `${color}88`, background: i < games ? color : 'transparent' }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function Scoreboard({ score, myTeam }) {
  const other = 1 - myTeam
  return (
    <div className="glass w-[264px] space-y-3.5 rounded-2xl px-5 py-4">
      <ScoreRow
        label="Nosotros"
        stones={score.stones[myTeam]}
        games={score.games[myTeam]}
        perGame={score.stonesPerGame}
        gamesToWin={score.gamesToWin}
        color={TEAM_COLORS.us.main}
      />
      <ScoreRow
        label="Ellos"
        stones={score.stones[other]}
        games={score.games[other]}
        perGame={score.stonesPerGame}
        gamesToWin={score.gamesToWin}
        color={TEAM_COLORS.them.main}
      />
    </div>
  )
}

// ───────────────────────────── Lances ─────────────────────────────

export function LanceTrack({ game }) {
  const activeIndex = LANCES.findIndex((l) => l.phases.includes(game.phase))
  const sub =
    game.phase === 'DISCARD' ? 'Descarte' : game.musRounds > 0 && game.phase === 'MUS' ? `Ronda ${game.musRounds + 1}` : null
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="glass flex items-center gap-1 rounded-full p-1">
        {LANCES.map((l, i) => {
          const active = i === activeIndex
          const done = activeIndex > i
          return (
            <div key={l.key} className="relative px-3.5 py-1.5">
              {active && (
                <motion.div
                  layoutId="lance-active"
                  className="absolute inset-0 rounded-full bg-acid/[0.12] shadow-[inset_0_0_0_1px_rgba(212,255,79,0.35)]"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span
                className={cx(
                  'relative font-mono text-[10.5px] uppercase tracking-[0.18em] transition-colors',
                  active ? 'text-acid' : done ? 'text-bone-dim' : 'text-mute',
                )}
              >
                {l.label}
              </span>
            </div>
          )
        })}
      </div>
      <div className="eyebrow h-3 text-[9.5px]">
        Mano {game.handNumber}
        {sub && <span className="text-bone"> · {sub}</span>}
      </div>
    </div>
  )
}

// ───────────────────────────── Acciones ─────────────────────────────

function Waiting({ children }) {
  return (
    <div className="flex items-center gap-3 text-[14px] text-bone-dim">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1 w-1 rounded-full bg-bone-dim"
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18 }}
          />
        ))}
      </span>
      {children}
    </div>
  )
}

export function ActionDock({ game, selection, onMus, onDiscard, onRedeal, devTools, busy }) {
  const me = game.you.seat
  const turnName = game.turn !== null ? game.players[game.turn]?.username : null
  let content

  if (game.phase === 'MUS' && game.turn === me) {
    content = (
      <>
        <div className="eyebrow mb-3 text-acid">Te toca hablar</div>
        <div className="flex gap-2">
          <Button variant="primary" size="lg" kbd="M" onClick={() => onMus(true)} disabled={busy}>
            Mus
          </Button>
          <Button size="lg" kbd="C" onClick={() => onMus(false)} disabled={busy}>
            Corto
          </Button>
        </div>
      </>
    )
  } else if (game.phase === 'MUS') {
    content = <Waiting>Habla {turnName}</Waiting>
  } else if (game.phase === 'DISCARD' && !game.you.pendingDiscard) {
    const n = selection.length
    content = (
      <>
        <div className="eyebrow mb-3 text-acid">Descarte · elige de 1 a 4</div>
        <Button variant="primary" size="lg" kbd="↵" onClick={onDiscard} disabled={n === 0 || busy}>
          {n === 0 ? 'Selecciona cartas' : `Descartar ${n} ${n === 1 ? 'carta' : 'cartas'}`}
        </Button>
      </>
    )
  } else if (game.phase === 'DISCARD') {
    const done = game.players.filter((p) => p.hasDiscarded).length
    content = <Waiting>Esperando descartes · {done}/4</Waiting>
  } else {
    content = (
      <>
        <div className="eyebrow mb-3">Apuestas · {LANCES.find((l) => l.phases.includes(game.phase))?.label ?? game.phase}</div>
        <div className="flex gap-2 opacity-60">
          <Button size="md" disabled>
            Paso
          </Button>
          <Button size="md" disabled>
            Envido
          </Button>
          <Button size="md" variant="ember" disabled>
            Órdago
          </Button>
        </div>
        <p className="mt-3 max-w-[260px] text-[12px] leading-relaxed text-mute">
          Las apuestas llegan en la próxima fase del desarrollo.
        </p>
        {devTools && (
          <button onClick={onRedeal} className="mt-2 font-mono text-[11px] text-bone-dim underline-offset-4 hover:text-acid hover:underline">
            Repartir otra mano →
          </button>
        )}
      </>
    )
  }

  return (
    <motion.div
      key={`${game.phase}-${game.turn === me}`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease }}
    >
      {content}
    </motion.div>
  )
}

// ───────────────────────────── Señas ─────────────────────────────

export function SignalPanel({ partnerName, partnerIsBot, onSend, lastSent }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="glass w-[300px] overflow-hidden rounded-2xl">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_rgba(212,255,79,0.9)]" />
          <span className="text-[13px] font-medium">Señas</span>
          <span className="font-mono text-[10px] text-mute">teclas 1–8</span>
        </span>
        <motion.svg animate={{ rotate: open ? 180 : 0 }} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 7.5 6 4l3.5 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" className="text-bone-dim" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
          >
            <div className="grid grid-cols-2 gap-1 px-2 pb-2">
              {SIGNALS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSend(s.id)}
                  title={s.gesture}
                  className={cx(
                    'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors',
                    lastSent === s.id ? 'bg-acid/15 text-acid' : 'text-bone hover:bg-white/[0.05]',
                  )}
                >
                  <kbd className="rounded border border-white/10 px-1 font-mono text-[10px] text-bone-dim">{s.key}</kbd>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="border-t border-white/[0.06] px-4 py-2.5 text-[11.5px] text-mute">
              {partnerIsBot ? 'Tu compañero es un bot: no las leerá.' : `Solo las ve ${partnerName}.`}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ───────────────────────────── Banner de fase ─────────────────────────────

function bannerFor(game) {
  const a = game.lastAction
  if (!a) return null
  const name = (seat) => (seat === game.you.seat ? 'Tú' : game.players[seat]?.username)
  switch (a.type) {
    case 'HAND_STARTED':
      return { eyebrow: `Mano ${game.handNumber} · reparte ${name(a.dealer)}`, title: 'Reparto', color: TEAM_COLORS.us.main }
    case 'MUS_AGREED':
      return { eyebrow: 'Todos piden', title: 'Mus', color: TEAM_COLORS.us.main }
    case 'MUS_CUT':
      return {
        eyebrow: `${name(a.seat)} ${a.seat === game.you.seat ? 'cortas' : 'corta'}`,
        title: 'No hay mus',
        color: TEAM_COLORS.them.main,
      }
    default:
      return null
  }
}

export function PhaseBanner({ game, center }) {
  const banner = bannerFor(game)
  const key = game.lastAction?.at
  const visible = useTimedValue(banner ? key : null, 1700)
  const show = banner && visible === key

  return (
    <div
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
      style={{ left: center.x, top: center.y }}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            key={key}
            className="flex flex-col items-center text-center"
            initial={{ opacity: 0, scale: 0.94, filter: 'blur(14px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.04, filter: 'blur(10px)' }}
            transition={{ duration: 0.55, ease }}
          >
            <div className="eyebrow mb-3 flex items-center gap-3 text-bone">
              <span className="h-px w-10" style={{ background: banner.color }} />
              {banner.eyebrow}
              <span className="h-px w-10" style={{ background: banner.color }} />
            </div>
            <div
              className="font-display text-[clamp(64px,8vw,120px)] italic leading-none tracking-[-0.02em]"
              style={{ color: banner.color, textShadow: `0 0 60px ${banner.color}66` }}
            >
              {banner.title}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
