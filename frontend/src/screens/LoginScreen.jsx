import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { actions } from '../lib/store'
import { Button, CardImage, CardsCredit, Wordmark } from '../components/ui'
import { cx } from '../lib/cx'

const FAN = [
  { card: { suit: 'oros', rank: 12 }, x: -150, y: 26, r: -16, delay: 0.15 },
  { card: { suit: 'copas', rank: 1 }, x: -50, y: -6, r: -5, delay: 0.25 },
  { card: { suit: 'espadas', rank: 11 }, x: 50, y: -6, r: 5, delay: 0.35 },
  { card: null, x: 150, y: 26, r: 16, delay: 0.45 },
]

const ease = [0.16, 1, 0.3, 1]

function Field({ id, label, type = 'text', value, onChange, autoComplete, autoFocus, trailing }) {
  return (
    <label htmlFor={id} className="block">
      <span className="eyebrow mb-2 block">{label}</span>
      <span className="flex items-center rounded-2xl border border-white/[0.08] bg-ink-900/70 backdrop-blur-xl transition-colors focus-within:border-acid/50 focus-within:shadow-[0_0_0_4px_rgba(212,255,79,0.08)]">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          autoCapitalize="none"
          spellCheck={false}
          className="h-13 min-w-0 flex-1 bg-transparent px-4 py-3.5 text-[16px] text-bone outline-none placeholder:text-mute"
        />
        {trailing}
      </span>
    </label>
  )
}

export default function LoginScreen() {
  const [mode, setMode] = useState('login') // login | register
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const register = mode === 'register'
  const canSubmit =
    username.trim().length >= 2 && password.length >= 6 && (!register || confirm.length >= 6) && !busy

  const submit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    if (register && password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    setBusy(true)
    setError(null)
    const res = await actions.authenticate(mode, username.trim(), password)
    if (!res.ok) setError(res.error?.message ?? 'No se pudo entrar')
    setBusy(false)
  }

  const switchMode = (m) => {
    setMode(m)
    setError(null)
    setConfirm('')
  }

  return (
    <div className="relative mx-auto grid h-full max-w-[1320px] grid-cols-1 items-center gap-10 overflow-x-hidden overflow-y-auto px-5 py-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-14">
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
          className="mt-5 max-w-[30ch] font-display text-[clamp(24px,2.6vw,38px)] leading-[1.08] text-bone/90"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.1, ease }}
        >
          Cuatro cartas, dos parejas
          <br />y un <em className="text-ember">órdago</em> que lo cambia todo.
        </motion.p>

        <motion.form
          onSubmit={submit}
          className="glass mt-10 max-w-[440px] rounded-[26px] p-5 sm:p-6"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease }}
        >
          <div className="relative mb-5 grid grid-cols-2 rounded-xl bg-ink-950/60 p-1">
            {[
              ['login', 'Entrar'],
              ['register', 'Crear cuenta'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => switchMode(key)}
                className={cx(
                  'relative h-10 rounded-lg text-[14px] font-medium transition-colors',
                  mode === key ? 'text-ink-950' : 'text-bone-dim hover:text-bone',
                )}
              >
                {mode === key && (
                  <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-lg bg-acid" transition={{ type: 'spring', stiffness: 450, damping: 34 }} />
                )}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <Field id="username" label="Usuario" value={username} onChange={setUsername} autoComplete="username" autoFocus />
            <Field
              id="password"
              label="Contraseña"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={setPassword}
              autoComplete={register ? 'new-password' : 'current-password'}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-bone-dim hover:text-bone"
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              }
            />
            <AnimatePresence initial={false}>
              {register && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Field
                    id="confirm"
                    label="Repite la contraseña"
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={setConfirm}
                    autoComplete="new-password"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 rounded-xl border border-ember/30 bg-ember/10 px-4 py-2.5 text-[13.5px] text-ember"
                role="alert"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} className="mt-5 w-full">
            {busy ? 'Un momento…' : register ? 'Crear cuenta y jugar' : 'Sentarse a la mesa'}
          </Button>
          <p className="mt-4 text-center text-[12.5px] text-mute">
            {register ? 'De 2 a 20 caracteres para el usuario, 6 o más para la contraseña.' : 'Tu ELO, tus amigos y tus partidas, en tu cuenta.'}
          </p>
        </motion.form>
        <CardsCredit className="mt-6 max-w-[440px]" />
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
