import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '../components/ui'
import { cx } from '../lib/cx'
import { LANCE_LABELS, TEAM_COLORS } from '../lib/mus'

const ease = [0.16, 1, 0.3, 1]

function useNow(active, every = 250) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const id = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(id)
  }, [active, every])
  return now
}

function teamName(team, myTeam) {
  return team === myTeam ? TEAM_COLORS.us.name : TEAM_COLORS.them.name
}

function teamColor(team, myTeam) {
  return team === myTeam ? TEAM_COLORS.us.main : TEAM_COLORS.them.main
}

/** Nota corta de cómo se resolvió el lance. */
function noteFor(item) {
  switch (item.kind) {
    case 'skipped':
      return 'no se juega'
    case 'paso':
      return 'en paso'
    case 'querido':
      return `${item.stake} querido`
    case 'deje':
      return 'no quiero'
    case 'solo':
      return 'sin envite'
    case 'ordago':
      return 'órdago'
    default:
      return ''
  }
}

/** Piedras que ganó cada pareja en un lance (incluido lo cobrado en el acto). */
function pointsOf(item) {
  if (item.team === null || item.team === undefined) return [0, 0]
  const won = (item.counted ? item.stones : 0) + (item.kind === 'deje' ? (item.deje ?? 0) : 0)
  const pts = [0, 0]
  pts[item.team] = won
  return pts
}

/** Escala su contenido para que no supere `maxHeight` (nunca lo agranda). */
export function FitBox({ maxHeight, children }) {
  const ref = useRef(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = height > 0 && maxHeight > 0 ? Math.min(1, maxHeight / height) : 1
  return (
    <div ref={ref} style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
      {children}
    </div>
  )
}

// ───────────────────────────── Conteo de la mano ─────────────────────────────

function PointCell({ value, color, delay, counted }) {
  return (
    <motion.td
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24, delay }}
      className={cx('py-3 text-center font-mono text-[22px] tabular sm:text-[26px]', !counted && 'opacity-40')}
      style={{ color: value > 0 ? color : 'var(--color-mute)' }}
    >
      {value > 0 ? `+${value}` : 0}
    </motion.td>
  )
}

/**
 * Conteo de la mano en tabla (Ronda · Nosotros · Ellos). Si la partida ha
 * terminado, encabeza con Victoria / Derrota y ofrece volver a la mesa.
 */
export function ScoringPanel({ game, humans, onContinue, busy, eloDelta, onReset, onLeave }) {
  const r = game.handResult
  const now = useNow(Boolean(r && game.nextHandAt))
  if (!r) return null

  const myTeam = game.you.team
  const other = 1 - myTeam
  const totals = [0, 0]
  const rows = r.items.map((item) => {
    const pts = pointsOf(item)
    totals[0] += pts[0]
    totals[1] += pts[1]
    return { item, us: pts[myTeam], them: pts[other] }
  })

  const finished = game.phase === 'FINISHED'
  const won = finished && game.winnerTeam === myTeam
  const resultColor = won ? TEAM_COLORS.us.main : TEAM_COLORS.them.main
  const final = game.score.history?.at(-1)?.stones ?? game.score.stones
  const remaining = game.nextHandAt ? Math.max(0, game.nextHandAt - now) : 0
  const total = 12000
  const voted = game.continueVotes?.includes(game.you.seat)
  const gameWon = r.gameWinner !== null

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.97, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
      transition={{ duration: 0.6, ease }}
      className="glass w-[min(94vw,560px)] overflow-hidden rounded-[28px]"
      style={finished ? { boxShadow: `0 0 0 1px ${resultColor}55, 0 30px 90px -30px ${resultColor}88` } : undefined}
    >
      {finished ? (
        <div className="px-6 pb-4 pt-6 text-center sm:px-8">
          <div className="eyebrow">{r.ordago ? `Órdago a la ${LANCE_LABELS[r.ordago.lance].toLowerCase()}` : 'Partida terminada'}</div>
          <h2
            className="mt-2 font-display text-[64px] italic leading-[0.9] sm:text-[84px]"
            style={{ color: resultColor, textShadow: `0 0 60px ${resultColor}66` }}
          >
            {won ? 'Victoria' : 'Derrota'}
          </h2>
          <div className="mt-3 flex items-center justify-center gap-5 font-mono text-[18px] tabular">
            <span style={{ color: TEAM_COLORS.us.main }}>Nosotros {final[myTeam]}</span>
            <span className="text-mute">—</span>
            <span style={{ color: TEAM_COLORS.them.main }}>{final[other]} Ellos</span>
          </div>
          {eloDelta !== null && eloDelta !== undefined && (
            <div className="mt-2 font-mono text-[13px]" style={{ color: eloDelta >= 0 ? TEAM_COLORS.us.main : TEAM_COLORS.them.main }}>
              ELO {eloDelta >= 0 ? '+' : ''}
              {eloDelta}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-end justify-between gap-4 px-6 pb-4 pt-6 sm:px-8">
          <div>
            <div className="eyebrow">Mano {r.handNumber}</div>
            <h2 className="mt-1 font-display text-[40px] italic leading-none sm:text-[46px]">{r.ordago ? 'Órdago' : 'Conteo'}</h2>
          </div>
          {gameWon && (
            <span className="rounded-full px-3.5 py-1.5 text-[14px] font-semibold text-ink-950" style={{ background: teamColor(r.gameWinner, myTeam) }}>
              Juego para {teamName(r.gameWinner, myTeam).toLowerCase()}
            </span>
          )}
        </div>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-white/[0.07] font-mono text-[11px] uppercase tracking-[0.18em] sm:text-[12px]">
            <th className="py-2.5 pl-5 text-left font-normal text-bone-dim sm:pl-8">Ronda</th>
            <th className="w-[92px] py-2.5 text-center font-normal sm:w-[124px]" style={{ color: TEAM_COLORS.us.main }}>
              Nosotros
            </th>
            <th className="w-[92px] py-2.5 pr-2 text-center font-normal sm:w-[124px] sm:pr-4" style={{ color: TEAM_COLORS.them.main }}>
              Ellos
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, us, them }, i) => (
            <tr key={item.lance} className="border-b border-white/[0.04]" title={item.detail ?? undefined}>
              <td className="py-3 pl-5 sm:pl-8">
                <span className="block text-[17px] font-medium leading-tight text-bone sm:text-[19px]">{LANCE_LABELS[item.lance]}</span>
                <span className="font-mono text-[11px] text-mute">
                  {noteFor(item)}
                  {item.detail && item.kind !== 'skipped' ? ` · ${item.detail}` : ''}
                </span>
              </td>
              <PointCell value={us} color={TEAM_COLORS.us.main} delay={0.2 + i * 0.12} counted={item.counted !== false} />
              <PointCell value={them} color={TEAM_COLORS.them.main} delay={0.26 + i * 0.12} counted={item.counted !== false} />
            </tr>
          ))}
          <tr className="bg-white/[0.03]">
            <td className="py-3.5 pl-5 font-mono text-[12px] uppercase tracking-[0.18em] text-bone sm:pl-8">Total</td>
            <td className="py-3.5 text-center font-mono text-[30px] tabular" style={{ color: TEAM_COLORS.us.main }}>
              {totals[myTeam]}
            </td>
            <td className="py-3.5 pr-2 text-center font-mono text-[30px] tabular sm:pr-4" style={{ color: TEAM_COLORS.them.main }}>
              {totals[other]}
            </td>
          </tr>
        </tbody>
      </table>

      {finished ? (
        <div className="flex flex-wrap items-center justify-center gap-3 px-6 py-5">
          <Button variant="primary" size="lg" onClick={onReset}>
            Volver a la mesa
          </Button>
          <Button size="lg" onClick={onLeave}>
            Salir al lobby
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <span className="font-mono text-[12px] text-mute">Siguiente mano en {Math.ceil(remaining / 1000)} s</span>
          <Button variant={voted ? 'glass' : 'primary'} kbd={voted ? undefined : '↵'} onClick={onContinue} disabled={voted || busy}>
            {voted ? `Esperando · ${game.continueVotes.length}/${humans}` : 'Siguiente mano'}
          </Button>
        </div>
      )}
      {!finished && game.nextHandAt && (
        <div className="h-[3px] bg-white/[0.05]">
          <div className="h-full bg-acid/70 transition-[width] duration-300 ease-linear" style={{ width: `${(remaining / total) * 100}%` }} />
        </div>
      )}
    </motion.div>
  )
}

// ───────────────────────────── Órdago ─────────────────────────────

/** Iluminación de alarma mientras hay un órdago sobre la mesa. */
export function OrdagoGlow({ active }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="ordago"
          className="pointer-events-none fixed inset-0 z-10"
          initial={{ opacity: 0 }}
          // Marco fijo: avisa del órdago sin parpadear.
          animate={{ opacity: 0.9, transition: { duration: 0.4 } }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
          style={{
            background: 'radial-gradient(ellipse 75% 70% at 50% 48%, transparent 45%, rgba(255,90,54,0.22) 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,90,54,0.35), inset 0 0 120px rgba(255,90,54,0.18)',
          }}
        />
      )}
    </AnimatePresence>
  )
}
