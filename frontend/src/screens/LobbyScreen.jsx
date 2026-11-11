import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { actions, useStore } from '../lib/store'
import { SERVER_URL } from '../lib/socket'
import { cx } from '../lib/cx'
import { Avatar, Button, CardImage, CardsCredit, ConnectionDot, Wordmark } from '../components/ui'
import { FriendsPanel } from '../components/Friends'

const ease = [0.16, 1, 0.3, 1]
const rise = (i) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, delay: 0.06 * i, ease },
})

function greeting() {
  const h = new Date().getHours()
  if (h < 6) return 'Buenas noches'
  if (h < 13) return 'Buenos días'
  if (h < 21) return 'Buenas tardes'
  return 'Buenas noches'
}

function usePublicRooms() {
  const [rooms, setRooms] = useState([])
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(`${SERVER_URL}/api/rooms`)
        .then((r) => r.json())
        .then((list) => alive && setRooms(Array.isArray(list) ? list : []))
        .catch(() => {})
    load()
    const id = setInterval(load, 4000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return rooms
}

function CodeInput({ value, onChange, onSubmit }) {
  const ref = useRef(null)
  const chars = value.padEnd(6, ' ').split('')
  return (
    <div className="group relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        maxLength={6}
        inputMode="text"
        autoCapitalize="characters"
        spellCheck={false}
        aria-label="Código de mesa"
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        className="absolute inset-0 z-10 cursor-text opacity-0"
      />
      <div className="flex gap-1.5">
        {chars.map((c, i) => {
          const active = i === Math.min(value.length, 5)
          return (
            <div
              key={i}
              className={cx(
                'flex h-12 w-10 items-center justify-center rounded-lg border bg-ink-900/70 font-mono text-xl text-bone transition-colors',
                active ? 'border-white/10 group-focus-within:border-acid/70' : 'border-white/[0.07]',
                c.trim() && 'border-white/15',
              )}
            >
              {c.trim() || <span className="h-px w-3 bg-mute/60" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className={cx('font-mono text-[28px] tabular leading-none tracking-tight', accent ? 'text-acid' : 'text-bone')}>
        {value}
      </div>
    </div>
  )
}

export default function LobbyScreen() {
  const user = useStore((s) => s.user)
  if (!user) return null
  return <LobbyView user={user} />
}

function LobbyView({ user }) {
  const rooms = usePublicRooms()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(null)

  const run = (key, fn) => async () => {
    if (busy) return
    setBusy(key)
    await fn()
    setBusy(null)
  }

  const join = run('join', () => (code.length === 6 ? actions.joinRoom(code) : Promise.resolve()))
  const winRate = user.gamesPlayed ? Math.round((user.gamesWon / user.gamesPlayed) * 100) : 0
  const firstName = user.username.split(' ')[0]

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-6 pb-16 lg:px-10">
        {/* Cabecera */}
        <header className="flex items-center justify-between py-6">
          <Wordmark />
          <div className="flex items-center gap-5">
            <div className="hidden md:block">
              <ConnectionDot />
            </div>
            <div className="hidden items-center gap-4 rounded-full border border-white/[0.07] bg-ink-900/60 px-4 py-2 font-mono text-[12.5px] tabular sm:flex">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-gold shadow-[0_0_10px_rgba(217,164,65,0.7)]" />
                {user.coins.toLocaleString('es-ES')}
              </span>
              <span className="h-3 w-px bg-white/10" />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rotate-45 bg-acid shadow-[0_0_10px_rgba(212,255,79,0.7)]" />
                {user.gems}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Avatar name={user.username} size={38} />
              <div className="hidden leading-tight sm:block">
                <div className="text-[14px] font-medium">{user.username}</div>
                <div className="font-mono text-[11px] text-bone-dim">ELO {user.elo}</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={actions.logout} aria-label="Cerrar sesión">
              Salir
            </Button>
          </div>
        </header>

        {/* Saludo */}
        <section className="pb-10 pt-8 lg:pt-14">
          <motion.p {...rise(0)} className="eyebrow mb-4 flex items-center gap-3">
            <span className="h-px w-8 bg-acid" /> Sala principal
          </motion.p>
          <motion.h1
            {...rise(1)}
            className="font-display text-[clamp(44px,6.2vw,92px)] leading-[0.95] tracking-[-0.02em]"
          >
            {greeting()}, <em className="text-acid">{firstName}</em>.
          </motion.h1>
          <motion.p {...rise(2)} className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-bone-dim">
            Elige mesa. Partidas a 40 piedras con ocho reyes. La primera pareja que llega, gana.
          </motion.p>
        </section>

        {/* Bento */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <motion.article
            {...rise(3)}
            className="glass group relative overflow-hidden rounded-[28px] p-6 sm:p-8 lg:col-span-7 lg:row-span-2 lg:min-h-[420px]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_85%_60%,rgba(212,255,79,0.12),transparent_60%)]" />
            <div className="pointer-events-none absolute -right-10 bottom-[-78px] hidden h-[340px] w-[440px] md:block" aria-hidden>
              {[
                { card: { suit: 'bastos', rank: 12 }, x: 110, r: -18 },
                { card: { suit: 'oros', rank: 1 }, x: 200, r: -4 },
                { card: { suit: 'espadas', rank: 12 }, x: 290, r: 10 },
              ].map(({ card, x, r }, i) => (
                <motion.div
                  key={i}
                  className="absolute bottom-0"
                  style={{ left: x }}
                  initial={{ rotate: 0, y: 60, opacity: 0 }}
                  animate={{ rotate: r, y: 0, opacity: 1 }}
                  transition={{ duration: 1.1, delay: 0.35 + i * 0.08, ease }}
                >
                  <div className="transition-transform duration-500 ease-out group-hover:-translate-y-3">
                    <CardImage card={card} width={150} />
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="relative flex h-full flex-col">
              <span className="eyebrow text-acid">Matchmaking</span>
              <h2 className="mt-4 font-display text-[44px] leading-none tracking-[-0.02em] sm:text-[56px]">Partida rápida</h2>
              <p className="mt-4 max-w-[30ch] text-[15px] leading-relaxed text-bone-dim">
                Te sentamos en la primera mesa pública con hueco. Si no hay ninguna, abrimos una para ti.
              </p>
              <div className="mt-auto flex items-center gap-5 pt-10">
                <Button variant="primary" size="lg" onClick={run('quick', actions.quickMatch)} disabled={!!busy}>
                  {busy === 'quick' ? 'Buscando…' : 'Buscar mesa'}
                </Button>
                <span className="font-mono text-[12px] text-bone-dim">
                  <span className="text-bone">{rooms.length}</span> {rooms.length === 1 ? 'mesa abierta' : 'mesas abiertas'}
                </span>
              </div>
            </div>
          </motion.article>

          <motion.article {...rise(4)} className="glass relative rounded-[28px] p-5 sm:p-7 lg:col-span-5">
            <span className="eyebrow">Con amigos</span>
            <div className="mt-3 flex items-end justify-between gap-6">
              <div>
                <h3 className="font-display text-[36px] leading-none">Mesa privada</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-bone-dim">
                  Crea una mesa y comparte el código o el enlace.
                </p>
              </div>
              <Button onClick={run('create', () => actions.createRoom(true))} disabled={!!busy}>
                {busy === 'create' ? 'Creando…' : 'Crear'}
              </Button>
            </div>
          </motion.article>

          <motion.article {...rise(5)} className="glass relative rounded-[28px] p-5 sm:p-7 lg:col-span-5">
            <span className="eyebrow">Invitación</span>
            <h3 className="mt-3 font-display text-[36px] leading-none">Unirse con código</h3>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <CodeInput value={code} onChange={setCode} onSubmit={join} />
              <Button variant="primary" onClick={join} disabled={code.length !== 6 || !!busy}>
                Entrar
              </Button>
            </div>
          </motion.article>
        </section>

        {/* Estadísticas, mesas abiertas y entrenamiento */}
        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <motion.div {...rise(6)} className="glass rounded-[28px] p-5 sm:p-7 lg:col-span-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Tu historial</span>
              {user.isGuest && <span className="font-mono text-[10.5px] text-gold">Invitado · sin guardar</span>}
            </div>
            <div className="mt-6 grid grid-cols-4 gap-4">
              <Stat label="ELO" value={user.elo} accent />
              <Stat label="Jugadas" value={user.gamesPlayed} />
              <Stat label="Ganadas" value={user.gamesWon} />
              <Stat label="Ratio" value={`${winRate}%`} />
            </div>
          </motion.div>

          <motion.div {...rise(7)} className="lg:col-span-7 lg:row-span-3">
            <FriendsPanel className="h-full" title="Amigos · invítales de compañero" />
          </motion.div>

          <motion.div {...rise(8)} className="glass rounded-[28px] p-5 sm:p-7 lg:col-span-5">
            <span className="eyebrow">Mesas abiertas</span>
            <ul className="thin-scroll mt-4 max-h-[132px] space-y-1.5 overflow-y-auto pr-1">
              {rooms.length === 0 && (
                <li className="py-3 text-[14px] text-mute">Nadie esperando ahora mismo. Abre tú la primera.</li>
              )}
              {rooms.map((r) => (
                <li key={r.code}>
                  <button
                    onClick={run(r.code, () => actions.joinRoom(r.code))}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="font-mono text-[14px] tracking-[0.18em]">{r.code}</span>
                    <span className="flex items-center gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className={cx('h-1.5 w-4 rounded-full', i < r.playerCount ? 'bg-acid' : 'bg-white/10')} />
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>

          {user.features?.devTools && (
            <motion.div
              {...rise(8)}
              className="relative overflow-hidden rounded-[28px] border border-dashed border-white/10 p-5 sm:p-7 lg:col-span-5"
            >
              <span className="eyebrow">Entrenamiento</span>
              <h3 className="mt-3 font-display text-[30px] leading-none">Contra bots</h3>
              <p className="mt-3 text-[13.5px] leading-relaxed text-bone-dim">Tres bots completan la mesa al instante.</p>
              <Button className="mt-5" size="sm" onClick={run('practice', actions.practice)} disabled={!!busy}>
                {busy === 'practice' ? 'Preparando…' : 'Practicar'}
              </Button>
            </motion.div>
          )}
        </section>
        <CardsCredit className="mt-10 text-center" />
      </div>
    </div>
  )
}
