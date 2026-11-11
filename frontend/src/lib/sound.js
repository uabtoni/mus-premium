/**
 * Sonidos del juego sintetizados con Web Audio (sin archivos que descargar).
 * El navegador solo deja sonar audio tras una interacción: el contexto se
 * crea/reanuda con el primer toque o tecla.
 */

const MUTE_KEY = 'mus.muted'
let ctx = null
let master = null
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
})()
const listeners = new Set()

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.55
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// Desbloqueo con la primera interacción del usuario.
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

export function isMuted() {
  return muted
}

export function setMuted(value) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    /* sin almacenamiento */
  }
  for (const l of listeners) l(muted)
}

export function onMuteChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ───────────────────────────── Primitivas ─────────────────────────────

function tone({ freq, to, type = 'sine', dur = 0.14, gain = 0.25, attack = 0.005, when = 0 }) {
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + when
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(master)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

let noiseBuffer = null
function noise({ dur = 0.06, gain = 0.2, freq = 3000, q = 0.8, type = 'bandpass', sweepTo, when = 0 }) {
  const ac = audio()
  if (!ac) return
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  }
  const t = ac.currentTime + when
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ac.createBiquadFilter()
  filter.type = type
  filter.Q.value = q
  filter.frequency.setValueAtTime(freq, t)
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(g).connect(master)
  src.start(t)
  src.stop(t + dur + 0.02)
}

// ───────────────────────────── Catálogo ─────────────────────────────

const SFX = {
  // Carta deslizándose sobre el tapete.
  card: (when = 0) => noise({ dur: 0.07, gain: 0.18, freq: 2600, q: 0.6, sweepTo: 900, when }),
  flip: (when = 0) => noise({ dur: 0.04, gain: 0.22, freq: 4200, q: 1.2, when }),
  // Reparto: 16 cartas al ritmo de la animación de la mesa.
  deal: () => {
    for (let i = 0; i < 16; i += 1) SFX.card(0.25 + i * 0.062)
    for (let i = 0; i < 4; i += 1) SFX.flip(1.5 + i * 0.12)
  },
  discard: () => {
    noise({ dur: 0.35, gain: 0.16, freq: 1800, q: 0.5, sweepTo: 400 })
    for (let i = 0; i < 6; i += 1) SFX.card(0.55 + i * 0.085)
  },
  mus: () => tone({ freq: 520, to: 620, type: 'triangle', dur: 0.16, gain: 0.16 }),
  cut: () => {
    tone({ freq: 180, to: 90, type: 'sine', dur: 0.22, gain: 0.35 })
    noise({ dur: 0.08, gain: 0.12, freq: 800, when: 0.01 })
  },
  paso: () => tone({ freq: 340, type: 'sine', dur: 0.09, gain: 0.12 }),
  // Fichas que chocan.
  envido: () => {
    tone({ freq: 1250, type: 'triangle', dur: 0.08, gain: 0.18 })
    tone({ freq: 1680, type: 'triangle', dur: 0.1, gain: 0.15, when: 0.06 })
  },
  subir: () => {
    for (let i = 0; i < 3; i += 1) tone({ freq: 1150 + i * 260, type: 'triangle', dur: 0.08, gain: 0.16, when: i * 0.06 })
  },
  quiero: () => {
    tone({ freq: 660, type: 'triangle', dur: 0.3, gain: 0.16 })
    tone({ freq: 880, type: 'triangle', dur: 0.3, gain: 0.12, when: 0.05 })
  },
  noQuiero: () => tone({ freq: 420, to: 230, type: 'sine', dur: 0.28, gain: 0.18 }),
  ordago: () => {
    tone({ freq: 70, to: 45, type: 'sine', dur: 1.1, gain: 0.6, attack: 0.01 })
    noise({ dur: 0.6, gain: 0.25, freq: 300, q: 0.4, type: 'lowpass' })
    tone({ freq: 220, to: 880, type: 'sawtooth', dur: 0.7, gain: 0.06, when: 0.15 })
  },
  turn: () => {
    tone({ freq: 880, type: 'sine', dur: 0.18, gain: 0.14 })
    tone({ freq: 1320, type: 'sine', dur: 0.25, gain: 0.12, when: 0.12 })
  },
  tick: () => tone({ freq: 1500, type: 'square', dur: 0.03, gain: 0.05 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.35, gain: 0.16, when: i * 0.12 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.45, gain: 0.16, when: i * 0.18 })),
  emote: () => tone({ freq: 760, to: 980, type: 'sine', dur: 0.12, gain: 0.12 }),
  score: () => [660, 990].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, gain: 0.1, when: i * 0.09 })),
}

export function play(name) {
  if (muted || !SFX[name]) return
  try {
    SFX[name]()
  } catch {
    /* audio no disponible */
  }
}
