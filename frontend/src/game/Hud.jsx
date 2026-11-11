import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar, Button } from '../components/ui'
import { cx } from '../lib/cx'
import { LANCE_LABELS, PHRASE_BY_ID, QUICK_PHRASES, SIGNALS, SIGNAL_BY_ID, TEAM_COLORS, actionText, withTotals } from '../lib/mus'
import { isMuted, onMuteChange, setMuted } from '../lib/sound'

const ease = [0.16, 1, 0.3, 1]

// ───────────────────────────── Avatar en mesa ─────────────────────────────

const BETTING = ['GRANDE', 'CHICA', 'PARES', 'JUEGO', 'PUNTO']

/**
 * Lance cuyas jugadas se muestran en los bocadillos: el actual si ya ha
 * hablado alguien; si no, el que acaba de cerrarse (para que se vea la última
 * jugada hasta que alguien hable en el siguiente, y también en el conteo).
 */
function displayLance(game) {
  if (BETTING.includes(game.phase) && game.betting?.history?.length) return game.phase
  if (game.lastAction?.type === 'BET') return game.lastAction.lance
  return BETTING.includes(game.phase) ? game.phase : null
}

/**
 * Bocadillo de un jugador: { text, tone, lance?, fresh? }.
 *  tone: 'bet' (envites, órdago, quiero), 'soft' (paso, no quiero, mus…), 'think' (le toca)
 */
function bubbleFor(game, seat) {
  const a = game.lastAction
  const p = game.players[seat]
  const fresh = a && a.seat === seat ? a.at : null

  const lance = ['MUS', 'DISCARD'].includes(game.phase) ? null : displayLance(game)
  if (lance) {
    const entries = withTotals((game.betLog ?? []).filter((e) => e.lance === lance))
    const last = [...entries].reverse().find((e) => e.seat === seat)
    if (last) {
      const cut = Boolean(a?.cut) && a.seat === seat && entries.filter((e) => e.seat === seat).length === 1 && lance === 'GRANDE'
      const strong = ['envido', 'subir', 'ordago', 'quiero'].includes(last.action)
      return {
        text: actionText(last, { cut }),
        tone: strong ? 'bet' : 'soft',
        lance: lance !== game.phase ? LANCE_LABELS[lance] : null,
        fresh: a?.type === 'BET' && a.seat === seat ? a.at : null,
        ordago: last.action === 'ordago',
      }
    }
  }
  if (a?.type === 'MUS_CUT' && a.seat === seat) return { text: 'Corto', tone: 'bet', fresh }

  if (game.phase === 'DISCARD') return p.hasDiscarded ? { text: 'Listo', tone: 'soft' } : { text: 'Descartando', tone: 'think' }
  if (game.phase === 'MUS') {
    if (p.saidMus) return { text: 'Mus', tone: 'soft', fresh: a?.type === 'MUS' || a?.type === 'MUS_AGREED' ? fresh : null }
    if (a?.type === 'DISCARD_RESOLVED' && game.lastDiscardCounts) {
      const n = game.lastDiscardCounts[seat]
      return { text: `Pide ${n}`, tone: 'soft' }
    }
  }
  if (game.turn === seat) return { text: 'Pensando', tone: 'think' }
  return null
}

/** Estado secundario bajo el nombre (pares / juego declarados). */
function declarationFor(game, seat) {
  const decl = game.phase === 'PARES' ? game.declarations?.pares : game.phase === 'JUEGO' ? game.declarations?.juego : null
  if (!decl) return null
  if (game.phase === 'PARES') return decl[seat] ? 'Lleva pares' : 'Sin pares'
  return decl[seat] ? 'Lleva juego' : 'Sin juego'
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

// Hacia dónde sale el bocadillo: siempre hacia el centro de la mesa.
const BUBBLE_SIDE = { 0: 'top', 1: 'left', 2: 'bottom', 3: 'right' }
const BUBBLE_POS = {
  top: 'bottom-full left-1/2 mb-3 -translate-x-1/2',
  // Tu avatar en móvil está pegado al borde: el bocadillo crece hacia dentro.
  topStart: 'bottom-full left-[-6px] mb-3',
  bottom: 'top-full left-1/2 mt-3 -translate-x-1/2',
  bottomFar: 'top-full left-1/2 mt-8 -translate-x-1/2',
  left: 'right-full top-1/2 mr-3 -translate-y-1/2',
  right: 'left-full top-1/2 ml-3 -translate-y-1/2',
}
const TAIL_POS = {
  top: 'left-1/2 top-full -mt-[5px] -translate-x-1/2',
  topStart: 'left-[18px] top-full -mt-[5px]',
  bottom: 'bottom-full left-1/2 -mb-[5px] -translate-x-1/2',
  bottomFar: 'bottom-full left-1/2 -mb-[5px] -translate-x-1/2',
  left: 'left-full top-1/2 -ml-[5px] -translate-y-1/2',
  right: 'right-full top-1/2 -mr-[5px] -translate-y-1/2',
}
// El pop crece desde el lado del avatar.
const POP_ORIGIN = { top: '50% 100%', topStart: '12% 100%', bottom: '50% 0%', bottomFar: '50% 0%', left: '100% 50%', right: '0% 50%' }

function ActionBubble({ bubble, team, side, compact }) {
  const color = TEAM_COLORS[team].main
  const strong = bubble.tone === 'bet'
  const think = bubble.tone === 'think'
  let style
  if (bubble.tone === 'emote') {
    // Frase rápida: bocadillo blanco, como un cómic.
    style = { background: '#f5f1e8', color: '#07080a', borderColor: '#f5f1e8', boxShadow: '0 10px 30px -8px rgba(0,0,0,0.6)' }
  } else if (strong) {
    style = { background: color, color: '#07080a', borderColor: color, boxShadow: `0 0 30px -6px ${color}` }
  } else {
    style = { background: 'rgba(17,19,23,0.94)', color: '#ede6d6', borderColor: think ? 'rgba(237,230,214,0.25)' : `${color}88` }
  }

  // Jugada nueva: un "pop" corto (crece un poco y vuelve) y un destello.
  const pop = Boolean(bubble.fresh) && !think
  return (
    <motion.div
      key={`${bubble.text}-${bubble.fresh ?? ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={cx('absolute w-max', pop ? 'z-40' : 'z-10', BUBBLE_POS[side])}
    >
      <motion.div
        initial={{ scale: pop ? 0.7 : 0.94 }}
        animate={{ scale: pop ? [0.7, 1.14, 1] : 1 }}
        transition={pop ? { duration: 0.42, times: [0, 0.55, 1], ease: 'easeOut' } : { duration: 0.15 }}
        style={{ transformOrigin: POP_ORIGIN[side] }}
        className="relative"
      >
        {pop && (
          // Destello que se abre alrededor del bocadillo.
          <motion.span
            className="pointer-events-none absolute inset-0 rounded-2xl border-2"
            style={{ borderColor: style.borderColor }}
            initial={{ opacity: 0.8, scale: 1 }}
            animate={{ opacity: 0, scale: 1.4 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
          />
        )}
      <div
        className={cx(
          'relative rounded-2xl border font-semibold tracking-[-0.01em]',
          compact ? 'px-3 py-1.5 text-[14px]' : 'px-4 py-2 text-[16px]',
          bubble.tone === 'emote' && (compact ? 'max-w-[170px]' : 'max-w-[220px]'),
          bubble.tone === 'emote' && 'whitespace-normal text-center leading-snug',
        )}
        style={style}
      >
        {bubble.lance && (
          <span className={cx('mr-1.5 font-mono uppercase opacity-60', compact ? 'text-[8.5px]' : 'text-[9.5px]')}>{bubble.lance}</span>
        )}
        {think ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1 w-1 rounded-full bg-bone"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
            <span className="font-medium text-bone-dim">{bubble.text}</span>
          </span>
        ) : (
          bubble.text
        )}
        {/* Pico del bocadillo, hacia el avatar */}
        <span className={cx('absolute h-2.5 w-2.5 rotate-45 border', TAIL_POS[side])} style={{ background: style.background, borderColor: style.borderColor, clipPath: tailClip(side) }} />
      </div>
      </motion.div>
    </motion.div>
  )
}

// Solo se dibuja la mitad del cuadrado que sobresale (el pico).
function tailClip(side) {
  switch (side) {
    case 'top':
    case 'topStart':
      return 'polygon(100% 0, 100% 100%, 0 100%)'
    case 'bottom':
    case 'bottomFar':
      return 'polygon(0 0, 100% 0, 0 100%)'
    case 'left':
      return 'polygon(100% 0, 100% 100%, 0 0)'
    default:
      return 'polygon(0 0, 0 100%, 100% 100%)'
  }
}

function useTicker(active, every = 200) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const id = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(id)
  }, [active, every])
  return now
}

/** Milisegundos que le quedan al turno según el último estado recibido. */
function turnLeft(game, now) {
  if (game.turnRemainingMs === null || game.turnRemainingMs === undefined) return null
  return Math.max(0, game.receivedAt + game.turnRemainingMs - now)
}

/** Anillo de cuenta atrás alrededor del avatar (rojo en los últimos 5 s). */
function TurnRing({ game, size }) {
  const now = useTicker(true, 100)
  const left = turnLeft(game, now)
  if (left === null) return null
  const total = game.turnTotalMs || 30000
  const frac = Math.min(1, left / total)
  const r = size / 2 + 7
  const c = 2 * Math.PI * r
  const urgent = left < 5000
  return (
    <svg
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90"
      width={2 * r + 6}
      height={2 * r + 6}
      viewBox={`0 0 ${2 * r + 6} ${2 * r + 6}`}
      aria-hidden
    >
      <circle cx={r + 3} cy={r + 3} r={r} fill="none" stroke="rgba(237,230,214,0.12)" strokeWidth="3" />
      <circle
        cx={r + 3}
        cy={r + 3}
        r={r}
        fill="none"
        stroke={urgent ? '#ff5a36' : '#d4ff4f'}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        style={{ transition: 'stroke-dashoffset 0.1s linear', filter: `drop-shadow(0 0 6px ${urgent ? '#ff5a36' : '#d4ff4f'})` }}
      />
    </svg>
  )
}

export function PlayerBadge({ game, seat, rel, team, position, isBot, connected, partnerSignal, emote, size = 56, compact = false, bubbleSide }) {
  const player = game.players[seat]
  const isMe = rel === 0
  const active = game.turn === seat
  const recentEmote = useTimedValue(emote?.at ?? null, 3500)
  const phrase = recentEmote && emote ? PHRASE_BY_ID[emote.id] : null
  const bubble = phrase ? { text: phrase.text, tone: 'emote', fresh: emote.at } : bubbleFor(game, seat)
  const waiting = !isBot && (active || (game.phase === 'DISCARD' && !player.hasDiscarded))
  const avatarSize = isMe && !compact ? size + 6 : size
  const declaration = declarationFor(game, seat)
  const signal = useTimedValue(rel === 2 ? partnerSignal : null, 4200)
  const meta = signal ? SIGNAL_BY_ID[signal.signal] : null
  const side = bubbleSide ?? (compact && rel === 0 ? 'topStart' : BUBBLE_SIDE[rel])

  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ left: position.x, top: position.y }}
    >
      <div className="relative flex flex-col items-center">
        <div className="relative">
          <Avatar name={player.username} team={team} active={active} size={avatarSize} isBot={isBot} connected={connected} />
          {waiting && game.turnRemainingMs !== null && <TurnRing game={game} size={avatarSize} />}
          {game.mano === seat && (
            <motion.span
              layoutId="mano-badge"
              className={cx(
                'absolute left-1/2 z-10 -translate-x-1/2 rounded-md bg-acid font-mono font-bold uppercase text-ink-950 shadow-[0_0_18px_rgba(212,255,79,0.65)]',
                compact ? '-top-2.5 px-1.5 py-px text-[8.5px] tracking-[0.1em]' : '-top-3 px-2 py-0.5 text-[10.5px] tracking-[0.14em]',
              )}
            >
              Mano
            </motion.span>
          )}
          {/* Bocadillo con la última jugada de este jugador */}
          <AnimatePresence mode="popLayout">
            {bubble && <ActionBubble key={`${bubble.text}-${bubble.fresh ?? ''}`} bubble={bubble} team={team} side={side} compact={compact} />}
          </AnimatePresence>
        </div>
        {!(compact && isMe) && (
          <span
            className={cx(
              'truncate whitespace-nowrap font-medium text-bone',
              compact ? 'mt-1.5 max-w-[88px] text-[12px]' : 'mt-2.5 max-w-[130px] text-[14px]',
            )}
          >
            {isMe ? 'Tú' : player.username}
          </span>
        )}
        {declaration && !(compact && isMe) && (
          <span className={cx('mt-0.5 whitespace-nowrap font-mono uppercase tracking-[0.12em] text-bone-dim', compact ? 'text-[8.5px]' : 'text-[9.5px]')}>
            {declaration}
          </span>
        )}

        {/* Seña recibida: solo existe en el cliente del compañero */}
        <AnimatePresence>
          {meta && (
            <motion.div
              key={signal.at}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute left-1/2 top-full mt-10 w-max -translate-x-1/2"
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
        {gamesToWin > 1 && <div className="ml-2 flex gap-1">
          {Array.from({ length: gamesToWin }, (_, i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full border"
              style={{ borderColor: `${color}88`, background: i < games ? color : 'transparent' }}
            />
          ))}
        </div>}
      </div>
    </div>
  )
}

export function Scoreboard({ score, myTeam, compact = false }) {
  const other = 1 - myTeam
  if (compact) {
    return (
      <div className="glass flex items-center gap-2.5 rounded-xl px-3 py-1.5 font-mono tabular">
        <div className="flex flex-col items-center leading-none">
          <span className="text-[8px] uppercase tracking-[0.14em]" style={{ color: TEAM_COLORS.us.main }}>Nos</span>
          <span className="mt-0.5 text-[18px] text-bone">{score.stones[myTeam]}</span>
        </div>
        <span className="h-6 w-px bg-white/10" />
        <div className="flex flex-col items-center leading-none">
          <span className="text-[8px] uppercase tracking-[0.14em]" style={{ color: TEAM_COLORS.them.main }}>Ellos</span>
          <span className="mt-0.5 text-[18px] text-bone">{score.stones[other]}</span>
        </div>
        <span className="text-[9px] text-mute">/{score.stonesPerGame}</span>
      </div>
    )
  }
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

// ───────────────────────────── Acciones ─────────────────────────────

function Waiting({ children, center = false }) {
  return (
    <div className={cx('flex items-center gap-3 text-[14px] text-bone-dim', center && 'justify-center text-center')}>
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

function Stepper({ value, onChange, min = 2, max = 30 }) {
  const btn =
    'flex h-9 w-8 items-center justify-center text-[16px] text-bone-dim transition-colors hover:text-acid disabled:opacity-30 disabled:hover:text-bone-dim'
  return (
    <div className="flex items-center">
      <button className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Menos">
        −
      </button>
      <span className="w-6 text-center font-mono text-[15px] tabular text-bone">{value}</span>
      <button className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Más">
        +
      </button>
    </div>
  )
}

// En la barra móvil las filas reparten el ancho a partes iguales.
const rowCls = (bar) => (bar ? 'grid w-full grid-flow-col gap-2 [grid-auto-columns:minmax(0,1fr)]' : 'flex gap-2')

function RaiseBox({ amount, setAmount, bar, children }) {
  return (
    <div className={cx('glass flex items-center gap-1 rounded-xl py-1 pr-1', bar && 'min-w-0 flex-1 [&>button:last-child]:flex-1')}>
      <Stepper value={amount} onChange={setAmount} />
      {children}
    </div>
  )
}

function BetDock({ game, busy, onBet, amount, setAmount, compact, timer, bar }) {
  const mid = compact && !bar ? 'sm' : 'md'
  const me = game.you.seat
  const round = game.betting
  const actions = game.you.actions ?? []
  const name = (seat) => (seat === me ? 'Tú' : game.players[seat]?.username)
  const lance = LANCE_LABELS[game.phase]

  if (!round) return <Waiting center={bar}>{lance}</Waiting>
  const bet = round.bet
  let betLine = null
  if (bet?.ordago) betLine = `Órdago de ${name(bet.bettor)}`
  else if (bet) betLine = `${name(bet.bettor)} ${bet.bettor === me ? 'envidas' : 'envida'} ${bet.current}`

  if (actions.length === 0) {
    const speaks = round.eligible.includes(me)
    return (
      <>
        <div className={cx('eyebrow', bar ? 'mb-2 text-center' : 'mb-3', bet?.ordago && 'text-ember')}>
          {lance}
          {betLine && ` · ${betLine}`}
        </div>
        <Waiting center={bar}>{speaks ? `Habla ${name(round.turn)}` : `No hablas en ${lance.toLowerCase()} · habla ${name(round.turn)}`}</Waiting>
      </>
    )
  }

  const responding = round.stage === 'RESPONDING'
  const raise = actions.includes('envido') ? 'envido' : actions.includes('subir') ? 'subir' : null
  return (
    <>
      <div className={cx('eyebrow truncate', bar ? 'mb-2' : 'mb-3', bet?.ordago ? 'text-ember' : 'text-acid')}>
        {lance} · {responding ? betLine : 'te toca hablar'}
        {timer}
      </div>
      <div className={cx('flex flex-col gap-2', bar ? 'items-stretch' : 'items-start')}>
        <div className={rowCls(bar)}>
          {actions.includes('quiero') && (
            <Button variant="primary" kbd="Q" size={mid} onClick={() => onBet('quiero')} disabled={busy}>
              Quiero
            </Button>
          )}
          {actions.includes('no_quiero') && (
            <Button kbd="N" size={mid} onClick={() => onBet('no_quiero')} disabled={busy}>
              No quiero
            </Button>
          )}
          {actions.includes('paso') && (
            <Button kbd="P" size={mid} onClick={() => onBet('paso')} disabled={busy}>
              Paso
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {raise && (
            <RaiseBox amount={amount} setAmount={setAmount} bar={bar}>
              <Button
                variant={raise === 'envido' ? 'primary' : 'glass'}
                size="sm"
                kbd="E"
                onClick={() => onBet(raise, amount)}
                disabled={busy}
              >
                {raise === 'envido' ? `Envido ${amount}` : `Subo ${amount}`}
              </Button>
            </RaiseBox>
          )}
          {actions.includes('ordago') && (
            <Button variant="ember" kbd="O" size={mid} onClick={() => onBet('ordago')} disabled={busy} className={bar && !raise ? 'flex-1' : undefined}>
              Órdago
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * Botonera. `bar`: versión de la barra inferior del móvil (ancho completo,
 * botones de 44 px como mínimo).
 */
export function ActionDock({ game, selection, onMus, onCutBet, onDiscard, onBet, amount, setAmount, busy, compact = false, onTick, bar = false }) {
  const timer = <DockTimer game={game} onTick={onTick} />
  const big = compact && !bar ? 'md' : 'lg'
  const mid = compact && !bar ? 'sm' : 'md'
  const me = game.you.seat
  const turnName = game.turn !== null ? game.players[game.turn]?.username : null
  if (game.phase === 'SCORING' || game.phase === 'FINISHED') {
    return bar ? <Waiting center>{game.phase === 'FINISHED' ? 'Fin de la partida' : 'Conteo de la mano'}</Waiting> : null
  }

  let content
  if (game.phase === 'MUS' && game.turn === me) {
    content = (
      <>
        <div className={cx('eyebrow text-acid', bar ? 'mb-2' : 'mb-2.5')}>Te toca hablar{timer}</div>
        <div className={cx('flex flex-col gap-2', bar ? 'items-stretch' : 'items-start')}>
          <div className={rowCls(bar)}>
            <Button variant="primary" size={mid} kbd="M" onClick={() => onMus(true)} disabled={busy}>
              Mus
            </Button>
            <Button size={mid} kbd="C" onClick={() => onMus(false)} disabled={busy}>
              Cortar
            </Button>
          </div>
          <div className="flex" title="Corta el mus y envida a la Grande">
            <RaiseBox amount={amount} setAmount={setAmount} bar={bar}>
              <Button size="sm" kbd="E" onClick={() => onCutBet(amount)} disabled={busy}>
                Envidar {amount}
              </Button>
            </RaiseBox>
          </div>
        </div>
      </>
    )
  } else if (game.phase === 'MUS') {
    content = <Waiting center={bar}>Habla {turnName}</Waiting>
  } else if (game.phase === 'DISCARD' && !game.you.pendingDiscard) {
    const n = selection.length
    content = (
      <>
        <div className={cx('eyebrow text-acid', bar ? 'mb-2' : 'mb-2.5')}>Descarte · toca de 1 a 4 cartas{timer}</div>
        <Button variant="primary" size={big} kbd="↵" onClick={onDiscard} disabled={n === 0 || busy} className={bar ? 'w-full' : undefined}>
          {n === 0 ? 'Selecciona cartas' : `Descartar ${n} ${n === 1 ? 'carta' : 'cartas'}`}
        </Button>
      </>
    )
  } else if (game.phase === 'DISCARD') {
    const done = game.players.filter((p) => p.hasDiscarded).length
    content = <Waiting center={bar}>Esperando descartes · {done}/4</Waiting>
  } else {
    content = <BetDock game={game} busy={busy} onBet={onBet} amount={amount} setAmount={setAmount} compact={compact} timer={timer} bar={bar} />
  }

  return (
    <motion.div
      key={`${game.phase}-${game.turn === me}-${game.betting?.stage}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className={bar ? 'w-full' : undefined}
    >
      {content}
    </motion.div>
  )
}

// ───────────────────────────── Señas ─────────────────────────────

const signalNote = (partnerName, partnerIsBot) =>
  partnerIsBot ? 'Tu compañero es un bot: no las leerá.' : `Solo las ve ${partnerName}.`

export function SignalOptions({ onSend, lastSent, showKeys = false, large = false }) {
  return (
    <div className={cx('grid grid-cols-2', large ? 'gap-1.5' : 'gap-1')}>
      {SIGNALS.map((s) => (
        <button
          key={s.id}
          onClick={() => onSend(s.id)}
          title={s.gesture}
          className={cx(
            'flex items-center gap-2 rounded-lg text-left transition-colors',
            large ? 'min-h-12 bg-white/[0.03] px-3.5 py-2.5 text-[14.5px]' : 'px-2.5 py-2 text-[12.5px]',
            lastSent === s.id ? 'bg-acid/15 text-acid' : 'text-bone hover:bg-white/[0.05] active:bg-white/[0.08]',
          )}
        >
          {showKeys && <kbd className="rounded border border-white/10 px-1 font-mono text-[10px] text-bone-dim">{s.key}</kbd>}
          <span className="flex flex-col">
            {s.label}
            {large && <span className="text-[11.5px] text-mute">{s.gesture}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

export function SignalPanel({ partnerName, partnerIsBot, onSend, lastSent, compact = false }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cx('glass overflow-hidden rounded-2xl', compact ? (open ? 'w-[min(300px,calc(100vw-24px))]' : 'w-auto') : 'w-[300px]')}>
      <button onClick={() => setOpen((o) => !o)} className={cx('flex w-full items-center justify-between gap-3 text-left', compact ? 'px-3 py-2' : 'px-4 py-3')}>
        <span className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_rgba(212,255,79,0.9)]" />
          <span className="text-[13px] font-medium">Señas</span>
          {!compact && <span className="font-mono text-[10px] text-mute">teclas 1–8</span>}
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
            <div className="px-2 pb-2">
              <SignalOptions onSend={onSend} lastSent={lastSent} showKeys={!compact} />
            </div>
            <p className="border-t border-white/[0.06] px-4 py-2.5 text-[11.5px] text-mute">{signalNote(partnerName, partnerIsBot)}</p>
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
    case 'BET':
      if (a.action !== 'ordago') return null
      return {
        eyebrow: `${name(a.seat)} ${a.seat === game.you.seat ? 'lanzas' : 'lanza'}`,
        title: 'Órdago',
        color: TEAM_COLORS.them.main,
      }
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="eyebrow mb-3 flex items-center gap-3 text-bone">
              <span className="h-px w-10" style={{ background: banner.color }} />
              {banner.eyebrow}
              <span className="h-px w-10" style={{ background: banner.color }} />
            </div>
            <div
              className="font-display text-[clamp(44px,11vw,120px)] italic leading-none tracking-[-0.02em]"
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

// ───────────────────────────── Avisos de acción ─────────────────────────────

/**
 * Resultado de un lance en el centro de la mesa. Quién hace cada jugada ya lo
 * cuentan los bocadillos de cada jugador; aquí solo se resume cómo acaba.
 */
function calloutFor(game) {
  const a = game.lastAction
  if (!a || a.type !== 'BET' || !a.closed) return null
  const eyebrow = LANCE_LABELS[a.lance]
  const teamLabel = (team) => (team === game.you.team ? 'nosotros' : 'ellos')
  const teamColor = (team) => (team === game.you.team ? TEAM_COLORS.us.main : TEAM_COLORS.them.main)

  switch (a.closed) {
    case 'QUERIDO':
      if (a.bet?.ordago) return null // lo cuenta el final de la partida
      return { eyebrow, text: 'Querido', sub: `${a.bet?.current} piedras · se cuentan al final`, color: '#ede6d6' }
    case 'NO_QUERIDO':
      return { eyebrow, text: 'No querido', sub: `+${a.bet?.previous} para ${teamLabel(a.bet?.team)}`, color: teamColor(a.bet?.team) }
    case 'PASO':
      return { eyebrow, text: 'En paso', sub: 'Nadie envida · se cuenta al final', color: '#ede6d6' }
    default:
      return null
  }
}

export function ActionCallout({ game, center }) {
  const callout = calloutFor(game)
  const key = callout ? game.lastAction.at : null
  const visible = useTimedValue(key, 1900)

  return (
    <div
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
      style={{ left: center.x, top: center.y }}
    >
      <AnimatePresence>
        {callout && visible === key && (
          <motion.div
            key={key}
            className="flex flex-col items-center whitespace-nowrap text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="eyebrow mb-2 flex items-center gap-3 text-[11px] text-bone">
              <span className="h-px w-8" style={{ background: callout.color }} />
              {callout.eyebrow}
              <span className="h-px w-8" style={{ background: callout.color }} />
            </div>
            <div
              className="font-display text-[clamp(30px,7.5vw,68px)] italic leading-none tracking-[-0.01em]"
              style={{ color: callout.color, textShadow: `0 0 40px ${callout.color}55` }}
            >
              {callout.text}
            </div>
            {callout.sub && <div className="mt-2 text-[13px] font-medium text-bone/85 sm:mt-3 sm:text-[15px]">{callout.sub}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ───────────────────────────── Ronda actual ─────────────────────────────

const PHASE_TITLES = {
  MUS: 'Mus',
  DISCARD: 'Descarte',
  GRANDE: 'Grande',
  CHICA: 'Chica',
  PARES: 'Pares',
  JUEGO: 'Juego',
  PUNTO: 'Punto',
  SCORING: 'Conteo',
  FINISHED: 'Fin de partida',
}
const BET_STEPS = ['GRANDE', 'CHICA', 'PARES', 'JUEGO']

/** Solo la ronda que se está jugando, en grande. */
export function CurrentLance({ game, compact = false }) {
  const title = PHASE_TITLES[game.phase] ?? game.phase
  const step = BET_STEPS.indexOf(game.phase === 'PUNTO' ? 'JUEGO' : game.phase)
  let sub = `Mano ${game.handNumber}`
  if (game.phase === 'MUS' && game.musRounds > 0) sub += ` · ronda ${game.musRounds + 1}`
  if (step >= 0) sub += compact ? ` · ${step + 1}/4` : ` · lance ${step + 1} de 4`

  return (
    <div className="flex flex-col items-center">
      <div className={cx('eyebrow whitespace-nowrap', compact ? 'text-[8.5px] tracking-[0.14em]' : 'text-[10.5px]')}>{sub}</div>
      <AnimatePresence mode="wait">
        <motion.div
          key={title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={cx(
            'font-display italic leading-none text-bone [text-shadow:0_0_30px_rgba(212,255,79,0.25)]',
            compact ? 'mt-0.5 text-[28px]' : 'mt-1 text-[44px]',
          )}
        >
          {title}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ───────────────────────────── Historial de la mano ─────────────────────────────

const LANCE_ORDER = ['GRANDE', 'CHICA', 'PARES', 'JUEGO', 'PUNTO']

function resultText(rec, myTeam) {
  if (!rec) return null
  const who = (t) => (t === myTeam ? 'nosotros' : 'ellos')
  switch (rec.status) {
    case 'PASO':
      return 'en paso'
    case 'QUERIDO':
      return rec.ordago ? 'órdago querido' : `${rec.stake} querido`
    case 'NO_QUERIDO':
      return `no querido · +${rec.stones} ${who(rec.team)}`
    case 'NO_BET':
      return `sin envite · ${who(rec.team)}`
    case 'SKIPPED':
      return 'no se juega'
    default:
      return null
  }
}

/** Todas las jugadas de la mano, por lances: quién dijo qué, siempre a mano. */
export function HandLog({ game, compact = false }) {
  const [open, setOpen] = useState(false)
  const count = (game.betLog ?? []).length

  return (
    <div className={cx('glass overflow-hidden rounded-2xl', open ? 'w-[min(300px,calc(100vw-24px))]' : 'w-auto')}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cx('flex w-full items-center justify-between gap-3 text-left', compact ? 'px-3 py-2' : 'px-4 py-2.5')}
      >
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-medium">Jugadas</span>
          {count > 0 && <span className="rounded-full bg-white/10 px-1.5 font-mono text-[10px] text-bone-dim">{count}</span>}
        </span>
        <motion.svg animate={{ rotate: open ? 180 : 0 }} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" fill="none" className="text-bone-dim" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="thin-scroll max-h-[46vh] overflow-y-auto px-4 pb-3">
              <HandLogBody game={game} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Jugadas de la mano agrupadas por lance. */
export function HandLogBody({ game, large = false }) {
  const me = game.you.seat
  const log = withTotals(game.betLog ?? [])
  const name = (seat) => (seat === me ? 'Tú' : game.players[seat]?.username)
  const color = (seat) => (seat % 2 === me % 2 ? TEAM_COLORS.us.main : TEAM_COLORS.them.main)
  const lances = LANCE_ORDER.filter((l) => game.lances?.[l] || log.some((e) => e.lance === l) || game.phase === l)
  return (
    <>
              {lances.length === 0 && <p className="py-2 text-[12.5px] text-mute">Aún no se ha apostado en esta mano.</p>}
              {lances.map((l) => {
                const entries = log.filter((e) => e.lance === l)
                const result = resultText(game.lances?.[l], game.you.team)
                return (
                  <div key={l} className="border-t border-white/[0.06] py-2 first:border-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-bone-dim">{LANCE_LABELS[l]}</span>
                      {result && <span className="font-mono text-[10px] text-mute">{result}</span>}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {entries.map((e, i) => (
                        <li key={i} className={cx('flex items-baseline justify-between gap-3', large ? 'py-0.5 text-[15px]' : 'text-[13px]')}>
                          <span className="truncate font-medium" style={{ color: color(e.seat) }}>
                            {name(e.seat)}
                          </span>
                          <span className="shrink-0 text-bone">{actionText(e)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
    </>
  )
}

// ───────────────────────────── Tiempo del turno en la botonera ─────────────────────────────

/** "12 s" junto al título de la botonera; en rojo en los últimos segundos. */
export function DockTimer({ game, onTick }) {
  const now = useTicker(true, 250)
  const left = turnLeft(game, now)
  const secs = left === null ? null : Math.ceil(left / 1000)
  useEffect(() => {
    if (secs !== null && secs > 0 && secs <= 5) onTick?.()
  }, [secs, onTick])
  if (secs === null) return null
  return (
    <span className={cx('ml-2 font-mono tabular', secs <= 5 ? 'text-ember' : 'text-bone-dim')}>{secs} s</span>
  )
}

// ───────────────────────────── Ausente ─────────────────────────────

export function AwayBanner({ onResume }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="glass flex items-center gap-4 rounded-2xl border-gold/40 px-4 py-3"
    >
      <span className="h-2 w-2 rounded-full bg-gold" />
      <span className="text-[14px] text-bone">Un bot está jugando por ti</span>
      <Button size="sm" variant="primary" onClick={onResume}>
        Volver a jugar
      </Button>
    </motion.div>
  )
}

// ───────────────────────────── Sonido ─────────────────────────────

export function MuteButton({ large = false }) {
  const [muted, setLocal] = useState(isMuted())
  useEffect(() => onMuteChange(setLocal), [])
  return (
    <button
      onClick={() => setMuted(!muted)}
      className={cx(
        'pointer-events-auto flex shrink-0 items-center justify-center rounded-lg text-bone-dim transition-colors hover:bg-white/[0.05] hover:text-bone active:bg-white/[0.07]',
        large ? 'h-11 w-11' : 'h-9 w-9',
      )}
      aria-label={muted ? 'Activar sonido' : 'Silenciar'}
      title={muted ? 'Activar sonido' : 'Silenciar'}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        {muted ? <path d="m22 9-6 6m0-6 6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
      </svg>
    </button>
  )
}

// ───────────────────────────── Frases rápidas ─────────────────────────────

export function PhraseOptions({ onSend, large = false }) {
  const [spicy, setSpicy] = useState(false)
  const list = QUICK_PHRASES.filter((p) => Boolean(p.spicy) === spicy)
  return (
    <>
      <div className={cx('mb-2 grid grid-cols-2 rounded-lg bg-ink-950/60 p-0.5', large ? 'text-[14px]' : 'text-[12px]')}>
        {[
          [false, 'Normales'],
          [true, 'Picantes 🌶️'],
        ].map(([value, label]) => (
          <button
            key={label}
            onClick={() => setSpicy(value)}
            className={cx('rounded-md transition-colors', large ? 'py-2.5' : 'py-1.5', spicy === value ? 'bg-white/10 text-bone' : 'text-bone-dim hover:text-bone')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={cx('grid grid-cols-1', large ? 'gap-1' : 'gap-0.5')}>
        {list.map((p) => (
          <button
            key={p.id}
            onClick={() => onSend(p.id)}
            className={cx(
              'rounded-lg text-left text-bone transition-colors hover:bg-white/[0.06] active:bg-white/[0.08]',
              large ? 'min-h-12 bg-white/[0.03] px-4 py-3 text-[15px]' : 'px-3 py-2 text-[13px]',
            )}
          >
            {p.text}
          </button>
        ))}
      </div>
    </>
  )
}

export function PhrasePanel({ onSend, compact = false }) {
  const [open, setOpen] = useState(false)
  const send = (id) => {
    onSend(id)
    setOpen(false)
  }
  return (
    <div className={cx('glass overflow-hidden rounded-2xl', open ? 'w-[min(300px,calc(100vw-24px))]' : 'w-auto')}>
      <button onClick={() => setOpen((o) => !o)} className={cx('flex w-full items-center justify-between gap-3 text-left', compact ? 'px-3 py-2' : 'px-4 py-3')}>
        <span className="flex items-center gap-2">
          <ChatIcon />
          <span className="text-[13px] font-medium">Frases</span>
        </span>
        <motion.svg animate={{ rotate: open ? 180 : 0 }} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 7.5 6 4l3.5 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" className="text-bone-dim" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="thin-scroll max-h-[46vh] overflow-y-auto px-2 pb-2">
              <PhraseOptions onSend={send} />
            </div>
            <p className="border-t border-white/[0.06] px-4 py-2 text-[11px] text-mute">Las ve toda la mesa.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ChatIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-bone-dim" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" strokeLinejoin="round" />
    </svg>
  )
}

// ───────────────────────────── Móvil: hoja inferior ─────────────────────────────

/** Panel que sube desde abajo, con fondo oscuro; se cierra tocando fuera. */
export function BottomSheet({ open, onClose, title, note, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="sheet"
          className="fixed inset-0 z-[70] flex flex-col justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/60" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-label={title}
            initial={{ y: 20 }}
            animate={{ y: 0 }}
            exit={{ y: 20 }}
            transition={{ duration: 0.2, ease }}
            className="relative flex max-h-[78%] flex-col rounded-t-[26px] border border-b-0 border-white/[0.08] bg-ink-900 pb-[max(10px,env(safe-area-inset-bottom))] shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.9)]"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15" />
            <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-3">
              <h3 className="font-display text-[28px] italic leading-none text-bone">{title}</h3>
              <button onClick={onClose} className="-mr-2 h-10 rounded-lg px-3 text-[13px] text-bone-dim active:bg-white/[0.06]">
                Cerrar
              </button>
            </div>
            <div className="thin-scroll min-h-0 touch-pan-y overflow-y-auto overscroll-contain px-3 pb-2">{children}</div>
            {note && <p className="shrink-0 border-t border-white/[0.06] px-5 pt-2.5 text-[12px] text-mute">{note}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Fila de herramientas de la barra inferior: señas, frases, jugadas y sonido. */
export function MobileTools({ game, partnerName, partnerIsBot, onSignal, lastSent, onPhrase }) {
  const [sheet, setSheet] = useState(null)
  const close = useCallback(() => setSheet(null), [])
  const count = (game.betLog ?? []).length
  const item =
    'flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl text-[13px] font-medium text-bone-dim transition-colors active:bg-white/[0.07] active:text-bone'
  return (
    <>
      <div className="flex items-center gap-1">
        <button className={item} onClick={() => setSheet('signals')}>
          <span className="h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_rgba(212,255,79,0.9)]" />
          Señas
        </button>
        <button className={item} onClick={() => setSheet('phrases')}>
          <ChatIcon />
          Frases
        </button>
        <button className={item} onClick={() => setSheet('log')}>
          Jugadas
          {count > 0 && <span className="rounded-full bg-white/10 px-1.5 font-mono text-[10px] text-bone-dim">{count}</span>}
        </button>
        <MuteButton large />
      </div>
      <BottomSheet open={sheet === 'signals'} onClose={close} title="Señas" note={signalNote(partnerName, partnerIsBot)}>
        <SignalOptions
          large
          lastSent={lastSent}
          onSend={(id) => {
            onSignal(id)
            close()
          }}
        />
      </BottomSheet>
      <BottomSheet open={sheet === 'phrases'} onClose={close} title="Frases" note="Las ve toda la mesa.">
        <PhraseOptions
          large
          onSend={(id) => {
            onPhrase(id)
            close()
          }}
        />
      </BottomSheet>
      <BottomSheet open={sheet === 'log'} onClose={close} title="Jugadas" note={`Mano ${game.handNumber}`}>
        <div className="px-2">
          <HandLogBody game={game} large />
        </div>
      </BottomSheet>
    </>
  )
}

/** Lance actual en una sola pieza compacta (barra superior del móvil). */
export function LanceInline({ game }) {
  const title = PHASE_TITLES[game.phase] ?? game.phase
  const step = BET_STEPS.indexOf(game.phase === 'PUNTO' ? 'JUEGO' : game.phase)
  let sub = `Mano ${game.handNumber}`
  if (step >= 0) sub += ` · ${step + 1}/4`
  else if (game.phase === 'MUS' && game.musRounds > 0) sub += ` · ronda ${game.musRounds + 1}`
  return (
    <div className="flex flex-col items-center leading-none">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="whitespace-nowrap font-display text-[25px] italic text-bone"
        >
          {title}
        </motion.span>
      </AnimatePresence>
      <span className="eyebrow mt-1 whitespace-nowrap text-[8.5px] tracking-[0.14em]">{sub}</span>
    </div>
  )
}
