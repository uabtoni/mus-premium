import { SUITS, FIGURES } from './mus'

/**
 * Baraja española "Premium" dibujada con Canvas 2D. Única fuente del diseño:
 * la usan tanto Phaser (texturas) como los componentes React (decoración).
 * Todas las medidas están en un lienzo base de 300×450 (proporción 2:3).
 */
export const CARD_W = 300
export const CARD_H = 450
const RADIUS = 26

export const FONT_STACK = {
  display: '"Instrument Serif", Georgia, serif',
  mono: '"Geist Mono", ui-monospace, monospace',
}

let fontsPromise = null
/** Garantiza que las fuentes web están cargadas antes de pintar en canvas. */
export function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      document.fonts.load('italic 80px "Instrument Serif"'),
      document.fonts.load('80px "Instrument Serif"'),
      document.fonts.load('600 40px "Geist Mono"'),
      document.fonts.load('500 20px "Geist Mono"'),
    ])
      .catch(() => {})
      .then(() => undefined)
  }
  return fontsPromise
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ───────────────────────────── Palos (caja 100×100) ─────────────────────────────

const PATHS = {
  copasBowl: new Path2D('M16 18 H84 C84 47 69 62 50 62 C31 62 16 47 16 18 Z'),
  copasStem: new Path2D('M45 61 H55 L56 76 H44 Z'),
  copasBase: new Path2D('M28 88 C28 80 38 76 50 76 C62 76 72 80 72 88 Z'),
  espadaBlade: new Path2D('M50 3 L58.5 15 V64 H41.5 V15 Z'),
  espadaGuard: new Path2D('M24 64 H76 C78 64 79 66 78 68 L76 72 H24 L22 68 C21 66 22 64 24 64 Z'),
  espadaGrip: new Path2D('M45.5 72 H54.5 V88 H45.5 Z'),
  bastoBody: new Path2D('M43 95 L37.5 36 C35 18 44 5 55 6.5 C67 8 68.5 23 62.5 36 L56.5 95 Z'),
}

function drawSuit(ctx, suit, cx, cy, size) {
  const s = SUITS[suit]
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(size / 100, size / 100)

  const grad = ctx.createLinearGradient(0, 0, 100, 100)
  grad.addColorStop(0, s.light)
  grad.addColorStop(0.45, s.color)
  grad.addColorStop(1, s.deep)

  switch (suit) {
    case 'oros': {
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(50, 50, 42, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = s.deep
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(50, 50, 33, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 0.85
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(50 + Math.cos(a) * 35.5, 50 + Math.sin(a) * 35.5)
        ctx.lineTo(50 + Math.cos(a) * 39.5, 50 + Math.sin(a) * 39.5)
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = s.deep
      ctx.beginPath()
      ctx.moveTo(50, 37)
      ctx.lineTo(63, 50)
      ctx.lineTo(50, 63)
      ctx.lineTo(37, 50)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.beginPath()
      ctx.ellipse(36, 32, 12, 6, -0.7, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'copas': {
      ctx.fillStyle = grad
      ctx.fill(PATHS.copasBowl)
      ctx.fill(PATHS.copasStem)
      ctx.fill(PATHS.copasBase)
      ctx.fillStyle = s.deep
      ctx.fillRect(16, 16, 68, 5)
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      ctx.ellipse(31, 34, 5, 11, 0.25, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'espadas': {
      ctx.fillStyle = grad
      ctx.fill(PATHS.espadaBlade)
      ctx.strokeStyle = s.deep
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(50, 12)
      ctx.lineTo(50, 62)
      ctx.stroke()
      ctx.fillStyle = s.deep
      ctx.fill(PATHS.espadaGuard)
      ctx.fillStyle = grad
      ctx.fill(PATHS.espadaGrip)
      ctx.fillStyle = s.deep
      ctx.beginPath()
      ctx.arc(50, 92.5, 6, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'bastos': {
      ctx.fillStyle = grad
      ctx.fill(PATHS.bastoBody)
      ctx.fillStyle = s.deep
      for (const [x, y, r] of [
        [40, 52, 5],
        [59.5, 44, 5],
        [43, 74, 4],
        [56, 66, 3.5],
      ]) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.28)'
      ctx.beginPath()
      ctx.ellipse(48, 18, 4, 9, -0.4, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    default:
      break
  }
  ctx.restore()
}

// ───────────────────────────── Cara ─────────────────────────────

function drawCorner(ctx, card, s) {
  ctx.fillStyle = s.deep
  ctx.font = `600 46px ${FONT_STACK.mono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(String(card.rank), 44, 74)
  drawSuit(ctx, card.suit, 44, 104, 30)
}

/**
 * Pinta la cara de una carta en (0,0) con tamaño CARD_W×CARD_H.
 * @param {{suit: string, rank: number}} card
 */
export function drawCardFace(ctx, card) {
  const s = SUITS[card.suit]
  const W = CARD_W
  const H = CARD_H

  // Papel marfil con ligera luz superior.
  roundRect(ctx, 0, 0, W, H, RADIUS)
  const paper = ctx.createLinearGradient(0, 0, 0, H)
  paper.addColorStop(0, '#f7f2e7')
  paper.addColorStop(1, '#e6ddca')
  ctx.fillStyle = paper
  ctx.fill()

  ctx.save()
  roundRect(ctx, 0, 0, W, H, RADIUS)
  ctx.clip()

  // Textura de papel sutil.
  ctx.globalAlpha = 0.05
  ctx.fillStyle = s.deep
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 1)
  ctx.globalAlpha = 1

  // Marco interior en el color del palo (las "pausas" de la baraja española).
  ctx.strokeStyle = s.color
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 2
  roundRect(ctx, 14, 14, W - 28, H - 28, 16)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = s.color
  const gap = 34
  ctx.fillRect(W / 2 - gap, 12, gap * 2, 4)
  ctx.fillRect(W / 2 - gap, H - 16, gap * 2, 4)

  // Esquinas
  drawCorner(ctx, card, s)
  ctx.save()
  ctx.translate(W, H)
  ctx.rotate(Math.PI)
  drawCorner(ctx, card, s)
  ctx.restore()

  // Centro
  const figure = FIGURES[card.rank]
  if (figure) {
    drawSuit(ctx, card.suit, W / 2, H / 2 - 58, 92)
    ctx.fillStyle = s.deep
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = `italic ${figure === 'Caballo' ? 54 : 76}px ${FONT_STACK.display}`
    ctx.fillText(figure, W / 2, H / 2 + 62)
    ctx.globalAlpha = 0.5
    ctx.fillRect(W / 2 - 34, H / 2 + 84, 68, 1.5)
    ctx.globalAlpha = 1
  } else if (card.rank === 1) {
    drawSuit(ctx, card.suit, W / 2, H / 2, 172)
  } else {
    drawSuit(ctx, card.suit, W / 2, H / 2 - 14, 128)
    // Pips: tantos puntos como el valor de la carta.
    const n = card.rank
    const spacing = 15
    const startX = W / 2 - ((n - 1) * spacing) / 2
    ctx.fillStyle = s.color
    for (let i = 0; i < n; i += 1) {
      ctx.beginPath()
      ctx.arc(startX + i * spacing, H / 2 + 80, 3.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()

  // Canto
  roundRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, RADIUS)
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

// ───────────────────────────── Dorso ─────────────────────────────

export function drawCardBack(ctx) {
  const W = CARD_W
  const H = CARD_H
  roundRect(ctx, 0, 0, W, H, RADIUS)
  const base = ctx.createLinearGradient(0, 0, W, H)
  base.addColorStop(0, '#1a1e24')
  base.addColorStop(1, '#0b0d10')
  ctx.fillStyle = base
  ctx.fill()

  ctx.save()
  roundRect(ctx, 16, 16, W - 32, H - 32, 14)
  ctx.clip()
  // Retícula diagonal fina.
  ctx.strokeStyle = 'rgba(212,255,79,0.085)'
  ctx.lineWidth = 1.2
  for (let x = -H; x < W + H; x += 14) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + H, H)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x + H, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  // Halo central
  const halo = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 120)
  halo.addColorStop(0, 'rgba(12,14,17,1)')
  halo.addColorStop(0.7, 'rgba(12,14,17,0.9)')
  halo.addColorStop(1, 'rgba(12,14,17,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  ctx.strokeStyle = 'rgba(212,255,79,0.6)'
  ctx.lineWidth = 1.5
  roundRect(ctx, 16, 16, W - 32, H - 32, 14)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(212,255,79,0.5)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, 58, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.25
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, 66, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.fillStyle = '#d4ff4f'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `italic 92px ${FONT_STACK.display}`
  ctx.fillText('M', W / 2, H / 2 + 28)

  ctx.fillStyle = 'rgba(237,230,214,0.45)'
  ctx.font = `500 13px ${FONT_STACK.mono}`
  if ('letterSpacing' in ctx) ctx.letterSpacing = '5px'
  ctx.fillText('MUS · PREMIUM', W / 2 + 2.5, H - 44)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'

  roundRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, RADIUS)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

// ───────────────────────────── Auxiliares para Phaser ─────────────────────────────

export const FX_PAD = 70

/** Halo de selección (más grande que la carta). */
export function drawGlow(ctx, color = '#d4ff4f') {
  const W = CARD_W + FX_PAD * 2
  const H = CARD_H + FX_PAD * 2
  ctx.clearRect(0, 0, W, H)
  ctx.shadowColor = color
  ctx.shadowBlur = 42
  ctx.strokeStyle = color
  ctx.lineWidth = 6
  roundRect(ctx, FX_PAD, FX_PAD, CARD_W, CARD_H, RADIUS)
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.lineWidth = 3
  ctx.stroke()
}

/** Sombra difusa bajo la carta. */
export function drawShadow(ctx) {
  const W = CARD_W + FX_PAD * 2
  const H = CARD_H + FX_PAD * 2
  ctx.clearRect(0, 0, W, H)
  ctx.shadowColor = 'rgba(0,0,0,0.75)'
  ctx.shadowBlur = 36
  ctx.shadowOffsetY = 14
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  roundRect(ctx, FX_PAD + 6, FX_PAD + 10, CARD_W - 12, CARD_H - 12, RADIUS)
  ctx.fill()
}

/** Foco de luz radial (se usa con mezcla aditiva). */
export function drawLight(ctx, size) {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.18)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
}

/** Crea un canvas con la carta (cara o dorso) a una escala dada. */
export function renderCardCanvas(card, scale = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(CARD_W * scale)
  canvas.height = Math.round(CARD_H * scale)
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  if (card) drawCardFace(ctx, card)
  else drawCardBack(ctx)
  return canvas
}
