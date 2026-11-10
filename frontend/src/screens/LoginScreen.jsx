import { useState } from 'react'
import { motion } from 'framer-motion'
import { actions } from '../lib/store'
import { Button, CardImage, ConnectionDot, Wordmark } from '../components/ui'

const FAN = [
  { card: { suit: 'oros', rank: 12 }, x: -150, y: 26, r: -16, delay: 0.15 },
  { card: { suit: 'copas', rank: 1 }, x: -50, y: -6, r: -5, delay: 0.25 },
  { card: { suit: 'espadas', rank: 11 }, x: 50, y: -6, r: 5, delay: 0.35 },
  { card: null, x: 150, y: 26, r: 16, delay: 0.45 },
]

const ease = [0.16, 1, 0.3, 1]

export default function LoginScreen() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy || name.trim().length < 2) return
    setBusy(true)
    await actions.login(name.trim())
    setBusy(false)
  }

  return (
    <div className="relative mx-auto grid h-full max-w-[1320px] grid-cols-1 items-center gap-10 overflow-x-hidden overflow-y-auto px-6 py-10 lg:grid-cols-[1.05fr_1fr] lg:px-14">
      <div className="relative z-10">
        <motion.p
          className="eyebrow mb-6 flex items-center gap-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease }}
        >
          <span className="h-px w-8 bg-acid" /> Club de cartas · Online
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease }}>
          <Wordmark size="xl" />
        </motion.div>

        <motion.p
          className="mt-6 max-w-[30ch] font-display text-[clamp(26px,2.6vw,38px)] leading-[1.08] text-bone/90"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.1, ease }}
        >
          Cuatro cartas, dos parejas
          <br />y un <em className="text-ember">órdago</em> que lo cambia todo.
        </motion.p>

        <motion.form
          onSubmit={submit}
          className="mt-12 max-w-[440px]"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease }}
        >
          <label htmlFor="name" className="eyebrow mb-3 block">
            Tu nombre en la mesa
          </label>
          <div className="group flex gap-2 rounded-2xl border border-white/[0.08] bg-ink-900/70 p-1.5 backdrop-blur-xl transition-colors focus-within:border-acid/50 focus-within:shadow-[0_0_0_4px_rgba(212,255,79,0.08)]">
            <input
              id="name"
              autoFocus
              autoComplete="nickname"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="p. ej. Tekko"
              className="h-12 min-w-0 flex-1 bg-transparent px-4 text-[17px] text-bone outline-none placeholder:text-mute"
            />
            <Button type="submit" variant="primary" disabled={busy || name.trim().length < 2} className="h-12 px-6">
              {busy ? 'Entrando…' : 'Sentarse'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 8h10m0 0L9 4m4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </Button>
          </div>
          <div className="mt-4 flex items-center justify-between text-[13px] text-mute">
            <span>Sin contraseña. Tu ELO se guarda con tu nombre.</span>
            <ConnectionDot />
          </div>
        </motion.form>
      </div>

      <div className="pointer-events-none relative hidden h-[560px] lg:block" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-acid/20 shadow-[0_0_80px_-10px_rgba(212,255,79,0.25),inset_0_0_80px_rgba(0,0,0,0.6)]" />
        <div className="absolute left-1/2 top-1/2 h-[372px] w-[572px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/[0.04]" />
        {FAN.map(({ card, x, y, r, delay }, i) => (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2"
            initial={{ opacity: 0, x: -70, y: 120, rotate: 0, scale: 0.8 }}
            animate={{ opacity: 1, x: x - 70, y: y - 105, rotate: r, scale: 1 }}
            transition={{ duration: 1.1, delay, ease }}
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 5 + i * 0.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
            >
              <CardImage card={card} width={140} />
            </motion.div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
