// Metadatos de presentación del juego (nombres, colores, señas, asientos).

export const SUITS = {
  oros: { label: 'Oros', color: '#c08a1e', deep: '#6f4c0c', light: '#f0c55a' },
  copas: { label: 'Copas', color: '#c2362b', deep: '#761911', light: '#ef6f5f' },
  espadas: { label: 'Espadas', color: '#2e5e8c', deep: '#173452', light: '#6fa3d6' },
  bastos: { label: 'Bastos', color: '#3e7b4b', deep: '#1f4428', light: '#7dbd8a' },
}

export const FIGURES = { 10: 'Sota', 11: 'Caballo', 12: 'Rey' }

export const TEAM_COLORS = {
  us: { main: '#d4ff4f', glow: 'rgba(212,255,79,0.45)', name: 'Nosotros' },
  them: { main: '#ff5a36', glow: 'rgba(255,90,54,0.45)', name: 'Ellos' },
}

/** Posición en pantalla de un asiento respecto al jugador local. */
export const relativeSeat = (seat, mySeat) => (seat - mySeat + 4) % 4
export const POSITIONS = ['bottom', 'right', 'top', 'left']
export const isMyTeam = (seat, mySeat) => seat % 2 === mySeat % 2

export const LANCES = [
  { key: 'MUS', label: 'Mus', phases: ['MUS', 'DISCARD'] },
  { key: 'GRANDE', label: 'Grande', phases: ['GRANDE'] },
  { key: 'CHICA', label: 'Chica', phases: ['CHICA'] },
  { key: 'PARES', label: 'Pares', phases: ['PARES'] },
  { key: 'JUEGO', label: 'Juego', phases: ['JUEGO', 'PUNTO'] },
]

// Señas tradicionales. La tecla es el atajo de teclado.
export const SIGNALS = [
  { id: 'dos-reyes', key: '1', label: 'Dos reyes', gesture: 'Morder el labio inferior' },
  { id: 'tres-reyes', key: '2', label: 'Tres reyes', gesture: 'Morder el labio de lado' },
  { id: 'duples', key: '3', label: 'Duples', gesture: 'Morder ambos labios' },
  { id: 'dos-ases', key: '4', label: 'Dos ases', gesture: 'Asomar la punta de la lengua' },
  { id: 'tres-ases', key: '5', label: 'Tres ases', gesture: 'Lengua hacia un lado' },
  { id: 'treinta-y-una', key: '6', label: 'La 31', gesture: 'Guiñar un ojo' },
  { id: 'juego', key: '7', label: 'Juego', gesture: 'Ladear la cabeza' },
  { id: 'ciego', key: '8', label: 'Ciego', gesture: 'Encoger los hombros' },
]
export const SIGNAL_BY_ID = Object.fromEntries(SIGNALS.map((s) => [s.id, s]))

/** Orden de exhibición de la mano: de mayor a menor valor. */
const SUIT_ORDER = ['oros', 'copas', 'espadas', 'bastos']
export function sortHand(hand) {
  return [...hand].sort(
    (a, b) => b.strength - a.strength || b.rank - a.rank || SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit),
  )
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase()
}
