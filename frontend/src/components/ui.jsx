import { forwardRef, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { initials, TEAM_COLORS } from '../lib/mus'
import { renderCardCanvas, loadFonts, CARD_W, CARD_H } from '../lib/cardArt'
import { dismissToast, useStore } from '../lib/store'
import { cx } from '../lib/cx'


// ───────────────────────────── Botón ─────────────────────────────

const VARIANTS = {
  primary:
    'bg-acid text-ink-950 shadow-[0_0_0_1px_rgba(212,255,79,0.4),0_10px_40px_-10px_rgba(212,255,79,0.55)] hover:shadow-[0_0_0_1px_rgba(212,255,79,0.7),0_14px_50px_-8px_rgba(212,255,79,0.75)] disabled:bg-ink-700 disabled:text-mute disabled:shadow-none',
  glass: 'glass text-bone hover:bg-white/[0.06] hover:border-white/15 disabled:text-mute disabled:hover:bg-transparent',
  ember:
    'bg-ember text-ink-950 shadow-[0_10px_40px_-10px_rgba(255,90,54,0.6)] hover:shadow-[0_14px_50px_-8px_rgba(255,90,54,0.8)] disabled:bg-ink-700 disabled:text-mute disabled:shadow-none',
  ghost: 'text-bone-dim hover:text-bone hover:bg-white/[0.04]',
}

const SIZES = {
  sm: 'h-9 px-3.5 text-[13px] rounded-lg gap-2',
  md: 'h-11 px-5 text-sm rounded-xl gap-2.5',
  lg: 'h-14 px-7 text-[15px] rounded-2xl gap-3',
}

export const Button = forwardRef(function Button(
  { variant = 'glass', size = 'md', kbd, className, children, disabled, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      disabled={disabled}
      className={cx(
        'relative inline-flex select-none items-center justify-center font-medium tracking-[-0.01em] transition-[background,box-shadow,color,border-color] duration-200',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
      {kbd && (
        <kbd
          className={cx(
            'ml-1 rounded-[5px] border px-1.5 py-px font-mono text-[10px] leading-4',
            variant === 'primary' || variant === 'ember'
              ? 'border-ink-950/25 text-ink-950/60'
              : 'border-white/10 text-bone-dim',
          )}
        >
          {kbd}
        </kbd>
      )}
    </motion.button>
  )
})

// ───────────────────────────── Marca ─────────────────────────────

export function Wordmark({ size = 'md', className }) {
  const big = size === 'xl'
  return (
    <div className={cx('flex items-baseline gap-2.5 leading-none', className)}>
      <span
        className={cx(
          'font-display italic text-bone',
          big ? 'text-[clamp(96px,15vw,220px)] tracking-[-0.04em]' : 'text-[30px] tracking-[-0.02em]',
        )}
      >
        Mus
      </span>
      <span
        className={cx(
          'font-mono uppercase text-acid',
          big ? 'text-[13px] tracking-[0.42em]' : 'text-[9.5px] tracking-[0.36em]',
        )}
      >
        Premium
      </span>
    </div>
  )
}

// ───────────────────────────── Avatar ─────────────────────────────

/**
 * Avatar de jugador con anillo de equipo. `active` muestra el indicador de turno
 * (anillo giratorio + halo). `team`: 'us' | 'them'.
 */
export function Avatar({ name, team = 'us', active = false, size = 56, isBot = false, connected = true, className }) {
  const color = TEAM_COLORS[team].main
  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      {active && (
        <>
          <motion.div
            className="absolute -inset-3 rounded-full"
            style={{ background: `radial-gradient(circle, ${TEAM_COLORS[team].glow} 0%, transparent 68%)` }}
            animate={{ opacity: [0.5, 1, 0.5], scale: [0.96, 1.06, 0.96] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="turn-ring absolute -inset-[5px] animate-spin-slow rounded-full" style={{ color }} />
        </>
      )}
      <div
        className={cx(
          'relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-ink-800 transition-opacity',
          !connected && 'opacity-40 grayscale',
        )}
        style={{ boxShadow: `inset 0 0 0 1px ${color}${active ? 'cc' : '55'}, inset 0 1px 0 rgba(255,255,255,0.06)` }}
      >
        <div
          className="absolute inset-0 opacity-60"
          style={{ background: `radial-gradient(120% 90% at 30% 15%, ${color}22, transparent 60%)` }}
        />
        <span className="relative font-display italic text-bone" style={{ fontSize: size * 0.42, lineHeight: 1 }}>
          {initials(name)}
        </span>
      </div>
      {isBot && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-ink-900 px-1.5 font-mono text-[8.5px] uppercase leading-[14px] tracking-[0.18em] text-bone-dim">
          bot
        </span>
      )}
      {!connected && (
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-ink-950 bg-ember" />
      )}
    </div>
  )
}

// ───────────────────────────── Carta DOM ─────────────────────────────

/** Carta renderizada con el mismo arte que Phaser (decoración de pantallas). */
export function CardImage({ card, width = 120, className, style }) {
  const ref = useRef(null)
  useEffect(() => {
    let alive = true
    loadFonts().then(() => {
      if (!alive || !ref.current) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const src = renderCardCanvas(card, (width * dpr) / CARD_W)
      const el = ref.current
      el.width = src.width
      el.height = src.height
      el.getContext('2d').drawImage(src, 0, 0)
    })
    return () => {
      alive = false
    }
  }, [card, width])
  return (
    <canvas
      ref={ref}
      className={cx('drop-shadow-[0_18px_30px_rgba(0,0,0,0.65)]', className)}
      style={{ width, height: (width * CARD_H) / CARD_W, ...style }}
    />
  )
}

// ───────────────────────────── Fondo ambiental ─────────────────────────────

export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <div className="absolute left-1/2 top-[-30%] h-[90vh] w-[120vw] -translate-x-1/2 animate-drift rounded-[50%] bg-[radial-gradient(closest-side,rgba(212,255,79,0.075),transparent)]" />
      <div className="absolute bottom-[-35%] right-[-15%] h-[80vh] w-[70vw] animate-drift rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,90,54,0.06),transparent)] [animation-delay:-8s]" />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(237,230,214,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(237,230,214,0.035) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, #000 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, #000 20%, transparent 75%)',
        }}
      />
    </div>
  )
}

// ───────────────────────────── Estado de conexión ─────────────────────────────

export function ConnectionDot() {
  const connection = useStore((s) => s.connection)
  const map = {
    online: ['bg-acid', 'En línea'],
    connecting: ['bg-gold animate-pulse', 'Conectando'],
    offline: ['bg-ember animate-pulse', 'Sin conexión'],
  }
  const [dot, label] = map[connection]
  return (
    <span className="eyebrow inline-flex items-center gap-2">
      <span className={cx('h-1.5 w-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

export function OfflineBanner() {
  const connection = useStore((s) => s.connection)
  return (
    <AnimatePresence>
      {connection !== 'online' && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2"
        >
          <div className="glass flex items-center gap-3 rounded-full px-4 py-2 text-[13px]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
            Reconectando con la mesa…
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ───────────────────────────── Toasts ─────────────────────────────

const TONES = {
  neutral: 'bg-bone-dim',
  success: 'bg-acid',
  warn: 'bg-gold',
  error: 'bg-ember',
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={() => dismissToast(t.id)}
            className="glass pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-left text-[13px] text-bone"
          >
            <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', TONES[t.tone])} />
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}

