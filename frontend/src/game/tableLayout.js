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
  const compact = W < 900
  const myH = clamp(Math.min(H * 0.25, W * 0.2), 128, 214)
  const myW = (myH * CARD_W) / CARD_H
  const backH = myH * 0.56
  const backW = (backH * CARD_W) / CARD_H

  const mySpread = myW * 0.74
  const backSpread = backW * 0.46

  const center = { x: W / 2, y: H * 0.45 }
  const felt = { x: center.x, y: center.y, rx: Math.min(W * 0.36, H * 0.62), ry: Math.min(H * 0.3, W * 0.24) }

  const sideInset = compact ? 54 : 96
  const hands = {
    0: { x: W / 2, y: H - myH / 2 - 30 },
    1: { x: W - sideInset - backH / 2, y: center.y },
    2: { x: W / 2, y: 122 + backH / 2 },
    3: { x: sideInset + backH / 2, y: center.y },
  }

  const myHalf = (mySpread * 3) / 2 + myW / 2
  const backHalfAlong = (backSpread * 3) / 2 + backW / 2

  const avatars = {
    0: { x: hands[0].x - myHalf - 74, y: hands[0].y + 6 },
    1: { x: hands[1].x, y: hands[1].y - backHalfAlong - 62 },
    2: { x: hands[2].x + backHalfAlong + 78, y: hands[2].y },
    3: { x: hands[3].x, y: hands[3].y - backHalfAlong - 62 },
  }

  return {
    W,
    H,
    compact,
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
    dock: { x: hands[0].x + myHalf + 40, y: hands[0].y },
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
