import { CARD_W, CARD_H } from '../lib/cardArt'

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

/**
 * Geometría de la mesa en píxeles CSS. La usan la escena de Phaser (que la
 * multiplica por devicePixelRatio) y el HUD de React, de modo que avatares,
 * botones y cartas quedan siempre alineados.
 *
 * Posiciones relativas: 0 = yo (abajo), 1 = derecha, 2 = compañero (arriba), 3 = izquierda.
 */
export function tableLayout(W, H) {
  if (W < 700 && H > W) return portraitLayout(W, H)

  const compact = W < 900
  const short = H < 560 // móvil en horizontal / ventanas muy bajas
  const myH = short ? clamp(H * 0.3, 92, 150) : clamp(Math.min(H * 0.25, W * 0.2), 128, 214)
  const myW = (myH * CARD_W) / CARD_H
  const backH = myH * 0.56
  const backW = (backH * CARD_W) / CARD_H

  const mySpread = myW * 0.74
  const backSpread = backW * 0.46

  const center = { x: W / 2, y: H * (short ? 0.47 : 0.45) }
  const felt = { x: center.x, y: center.y, rx: Math.min(W * 0.36, H * 0.62), ry: Math.min(H * 0.3, W * 0.24) }

  const sideInset = short ? 36 : compact ? 54 : 96
  const hands = {
    0: { x: W / 2, y: H - myH / 2 - (short ? 12 : 30) },
    1: { x: W - sideInset - backH / 2, y: center.y },
    2: { x: W / 2, y: (short ? 70 : 122) + backH / 2 },
    3: { x: sideInset + backH / 2, y: center.y },
  }

  const myHalf = (mySpread * 3) / 2 + myW / 2
  const backHalfAlong = (backSpread * 3) / 2 + backW / 2

  // Los rivales laterales se sientan en el lado interior de sus cartas, hacia
  // la mesa: así las esquinas superiores quedan libres para el marcador.
  const sideOffset = backH / 2 + (short ? 52 : 70)
  const avatars = {
    0: { x: hands[0].x - myHalf - (short ? 52 : 74), y: hands[0].y + 6 },
    1: { x: hands[1].x - sideOffset, y: hands[1].y },
    2: { x: hands[2].x + backHalfAlong + (short ? 56 : 78), y: hands[2].y },
    3: { x: hands[3].x + sideOffset, y: hands[3].y },
  }

  return {
    W,
    H,
    portrait: false,
    compact: compact || short,
    short,
    avatarSize: short ? 44 : 56,
    myH,
    myW,
    backH,
    backW,
    mySpread,
    backSpread,
    center,
    felt,
    hands,
    avatars,
    dock: { x: hands[0].x + myHalf + (short ? 24 : 40), y: hands[0].y },
    revealScale: 1.25,
  }
}

// Zonas seguras (notch, barra de inicio del iPhone). Se miden con un elemento
// de prueba porque env() solo existe en CSS.
function safeInsets() {
  if (typeof document === 'undefined' || !document.body) return { top: 0, bottom: 0 }
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)'
  document.body.appendChild(el)
  const cs = getComputedStyle(el)
  const top = parseFloat(cs.paddingTop) || 0
  const bottom = parseFloat(cs.paddingBottom) || 0
  el.remove()
  return { top: Math.min(top, 60), bottom: Math.min(bottom, 40) }
}

// Alturas fijas de la versión móvil (px CSS, sin contar zonas seguras).
export const MOBILE = { topBar: 52, actionBar: 122, toolBar: 50 }

/**
 * Móvil en vertical. No es la mesa de escritorio encogida:
 *  - arriba, una barra fina (salir · lance · marcador);
 *  - abajo, una barra fija con la botonera y las herramientas;
 *  - tus cartas, grandes, justo encima de la barra;
 *  - compañero y rivales en miniatura alrededor del tapete.
 */
function portraitLayout(W, H) {
  const safe = safeInsets()
  const topBar = MOBILE.topBar + safe.top
  const bottomBar = MOBILE.actionBar + MOBILE.toolBar + safe.bottom

  const myW = Math.min((W - 20) / 3.3, (H * 0.19 * CARD_W) / CARD_H)
  const myH = (myW * CARD_H) / CARD_W
  const backH = clamp(W * 0.13, 44, 62)
  const backW = (backH * CARD_W) / CARD_H
  const mySpread = myW * 0.76
  const backSpread = backW * 0.46
  const backHalfAlong = (backSpread * 3) / 2 + backW / 2
  const avatarSize = 38

  const myY = H - bottomBar - myH / 2 - 8
  const myTop = myY - myH / 2
  // Zona de juego: entre la barra superior y tu avatar.
  const playTop = topBar
  const playBottom = myTop - 44
  const partnerY = playTop + 14 + backH / 2
  const center = { x: W / 2, y: (partnerY + backH / 2 + 30 + playBottom) / 2 }
  const felt = {
    x: center.x,
    y: center.y,
    rx: W * 0.47,
    ry: Math.max(60, Math.min((playBottom - playTop) / 2 + 6, W * 0.62)),
  }

  const sideY = center.y + 22
  const hands = {
    0: { x: W / 2, y: myY },
    1: { x: W - 10 - backH / 2, y: sideY },
    2: { x: W / 2 + 22, y: partnerY },
    3: { x: 10 + backH / 2, y: sideY },
  }

  const sideAvatarY = sideY - backHalfAlong - 46
  const avatars = {
    0: { x: 12 + avatarSize / 2, y: myTop - 26 },
    1: { x: Math.min(hands[1].x, W - 12 - avatarSize / 2), y: sideAvatarY },
    2: { x: hands[2].x - backHalfAlong - 34, y: partnerY - 8 },
    3: { x: Math.max(hands[3].x, 12 + avatarSize / 2), y: sideAvatarY },
  }

  return {
    W,
    H,
    portrait: true,
    compact: true,
    short: false,
    avatarSize,
    myH,
    myW,
    backH,
    backW,
    mySpread,
    backSpread,
    center,
    felt,
    hands,
    avatars,
    revealScale: 1.4,
    topBar,
    bottomBar,
    safe,
  }
}

/** Posición (x, y, ángulo en grados) de la carta i de n en la posición relativa `rel`. */
export function cardSlot(layout, rel, i, n) {
  const t = i - (n - 1) / 2
  const h = layout.hands[rel]
  switch (rel) {
    case 0:
      return { x: h.x + t * layout.mySpread, y: h.y + t * t * 5, angle: t * 3.2 }
    case 2:
      return { x: h.x - t * layout.backSpread, y: h.y - t * t * 2, angle: 180 + t * 2.5 }
    case 1:
      return { x: h.x + t * t * 2, y: h.y - t * layout.backSpread, angle: -90 + t * 2.5 }
    case 3:
      return { x: h.x - t * t * 2, y: h.y + t * layout.backSpread, angle: 90 + t * 2.5 }
    default:
      return { x: h.x, y: h.y, angle: 0 }
  }
}

/** Mazo: delante del repartidor, a medio camino del centro. */
export function deckPosition(layout, dealerRel) {
  const h = layout.hands[dealerRel]
  const c = layout.center
  return { x: c.x + (h.x - c.x) * 0.42, y: c.y + (h.y - c.y) * 0.42 }
}

export function discardPosition(layout) {
  return { x: layout.center.x, y: layout.center.y }
}
