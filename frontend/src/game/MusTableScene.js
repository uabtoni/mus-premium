import Phaser from 'phaser'
import {
  CARD_W,
  CARD_H,
  FX_PAD,
  FONT_STACK,
  drawCardFace,
  drawCardBack,
  drawGlow,
  drawShadow,
  drawLight,
} from '../lib/cardArt'
import { tableLayout, cardSlot, deckPosition, discardPosition } from './tableLayout'
import { relativeSeat, sortHand, isMyTeam } from '../lib/mus'

const SUIT_KEYS = ['oros', 'copas', 'espadas', 'bastos']
const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12]
const LIGHT_SIZE = 512
const COLOR_US = 0xd4ff4f
const COLOR_THEM = 0xff5a36

const faceKey = (id) => `face:${id}`

function canvasTexture(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d'))
  scene.textures.addCanvas(key, canvas)
}

/**
 * Escena de la mesa. No contiene lógica de juego: recibe el estado del
 * servidor a través del registry (`state`, `selection`) y lo anima.
 * Emite `card-toggle` en `game.events` cuando el jugador toca una carta.
 */
export class MusTableScene extends Phaser.Scene {
  constructor() {
    super('MusTable')
  }

  create() {
    this.dpr = this.registry.get('dpr') ?? 1
    this.buildTextures()

    this.cards = [[], [], [], []] // por posición relativa
    this.discardPile = []
    this.state = null
    this.pendingState = null
    this.busy = false
    this.selection = new Set(this.registry.get('selection') ?? [])

    this.tableTexture = this.textures.createCanvas('table', this.scale.width, this.scale.height)
    this.add.image(0, 0, 'table').setOrigin(0, 0).setDepth(0)

    this.light = this.add.image(0, 0, 'light').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(1)
    this.rimPulse = this.add.image(0, 0, 'light').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(1)

    this.deck = this.add.container(0, 0).setDepth(6)
    for (let i = 0; i < 4; i += 1) {
      const back = this.add.image(-i * 1.4 * this.dpr, -i * 1.8 * this.dpr, 'back')
      if (i === 0) this.deck.add(this.add.image(0, 0, 'shadow'))
      this.deck.add(back)
    }

    this.relayout()

    this.registry.events.on('changedata-state', this.onStateData, this)
    this.registry.events.on('changedata-selection', this.onSelectionData, this)
    this.scale.on('resize', this.onResize, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.registry.events.off('changedata-state', this.onStateData, this)
      this.registry.events.off('changedata-selection', this.onSelectionData, this)
      this.scale.off('resize', this.onResize, this)
    })

    const initial = this.registry.get('state')
    if (initial) this.receive(initial)
  }

  // ───────────────────────────── Texturas ─────────────────────────────

  buildTextures() {
    for (const suit of SUIT_KEYS) {
      for (const rank of RANKS) {
        canvasTexture(this, faceKey(`${suit}-${rank}`), CARD_W, CARD_H, (ctx) => drawCardFace(ctx, { suit, rank }))
      }
    }
    canvasTexture(this, 'back', CARD_W, CARD_H, drawCardBack)
    canvasTexture(this, 'glow', CARD_W + FX_PAD * 2, CARD_H + FX_PAD * 2, (ctx) => drawGlow(ctx))
    canvasTexture(this, 'shadow', CARD_W + FX_PAD * 2, CARD_H + FX_PAD * 2, drawShadow)
    canvasTexture(this, 'light', LIGHT_SIZE, LIGHT_SIZE, (ctx) => drawLight(ctx, LIGHT_SIZE))

    this.noise = document.createElement('canvas')
    this.noise.width = 160
    this.noise.height = 160
    const n = this.noise.getContext('2d')
    const img = n.createImageData(160, 160)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 14
    }
    n.putImageData(img, 0, 0)
  }

  /** Tapete: grafito profundo, bisel de reloj y filo de neón. */
  drawTable() {
    const W = this.scale.width
    const H = this.scale.height
    const d = this.dpr
    const L = this.L
    const tex = this.tableTexture
    tex.setSize(W, H)
    const ctx = tex.getContext()
    ctx.clearRect(0, 0, W, H)

    const cx = L.felt.x * d
    const cy = L.felt.y * d
    const rx = L.felt.rx * d
    const ry = L.felt.ry * d

    const bg = ctx.createRadialGradient(cx, cy * 0.8, 0, cx, cy, Math.max(W, H) * 0.8)
    bg.addColorStop(0, '#161a1f')
    bg.addColorStop(0.55, '#0b0d10')
    bg.addColorStop(1, '#050607')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Halo exterior del tapete
    ctx.save()
    ctx.shadowColor = 'rgba(212,255,79,0.16)'
    ctx.shadowBlur = 60 * d
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    const felt = ctx.createRadialGradient(cx, cy - ry * 0.4, ry * 0.1, cx, cy, rx)
    felt.addColorStop(0, '#191d23')
    felt.addColorStop(0.7, '#111418')
    felt.addColorStop(1, '#0c0e11')
    ctx.fillStyle = felt
    ctx.fill()
    ctx.restore()

    // Filo de neón
    ctx.save()
    ctx.shadowColor = 'rgba(212,255,79,0.55)'
    ctx.shadowBlur = 16 * d
    ctx.strokeStyle = 'rgba(212,255,79,0.38)'
    ctx.lineWidth = 1.3 * d
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    // Anillo interior y bisel graduado
    ctx.strokeStyle = 'rgba(237,230,214,0.06)'
    ctx.lineWidth = 1 * d
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx - 22 * d, ry - 22 * d, 0, 0, Math.PI * 2)
    ctx.stroke()

    const ticks = 96
    for (let i = 0; i < ticks; i += 1) {
      const a = (i / ticks) * Math.PI * 2
      const major = i % 8 === 0
      const r1 = 1 - (major ? 16 : 9) / Math.min(L.felt.rx, L.felt.ry)
      const x0 = cx + Math.cos(a) * (rx - 4 * d)
      const y0 = cy + Math.sin(a) * (ry - 4 * d)
      const x1 = cx + Math.cos(a) * (rx - 4 * d) * r1
      const y1 = cy + Math.sin(a) * (ry - 4 * d) * r1
      ctx.strokeStyle = major ? 'rgba(212,255,79,0.32)' : 'rgba(237,230,214,0.08)'
      ctx.lineWidth = (major ? 1.4 : 1) * d
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }

    // Monograma
    ctx.fillStyle = 'rgba(237,230,214,0.035)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `italic ${Math.round(ry * 0.95)}px ${FONT_STACK.display}`
    ctx.fillText('Mus', cx, cy + ry * 0.04)

    // Grano y viñeta
    ctx.fillStyle = ctx.createPattern(this.noise, 'repeat')
    ctx.fillRect(0, 0, W, H)
    const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0,0,0,0.65)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, W, H)

    tex.refresh()
  }

  // ───────────────────────────── Layout ─────────────────────────────

  relayout() {
    this.L = tableLayout(this.scale.width / this.dpr, this.scale.height / this.dpr)
    this.myScale = (this.L.myH * this.dpr) / CARD_H
    this.backScale = (this.L.backH * this.dpr) / CARD_H
    this.drawTable()
    this.placeDeck(this.dealerRel ?? 3, false)

    const c = discardPosition(this.L)
    this.discardPos = { x: c.x * this.dpr, y: c.y * this.dpr }
    for (const s of this.discardPile) s.setScale(this.backScale * 0.82)

    const lightScale = (this.L.felt.rx * 1.25 * this.dpr) / LIGHT_SIZE
    this.light.setScale(lightScale)
    this.rimPulse.setScale(lightScale * 1.8).setPosition(this.L.center.x * this.dpr, this.L.center.y * this.dpr)
  }

  placeDeck(dealerRel, animate = true) {
    this.dealerRel = dealerRel
    const p = deckPosition(this.L, dealerRel)
    const target = { x: p.x * this.dpr, y: p.y * this.dpr, scale: this.backScale * 0.9, angle: [0, -90, 180, 90][dealerRel] + 8 }
    this.deckPos = { x: target.x, y: target.y }
    if (animate) this.tweens.add({ targets: this.deck, ...target, duration: 500, ease: 'Cubic.easeInOut' })
    else this.deck.setPosition(target.x, target.y).setScale(target.scale).setAngle(target.angle)
  }

  onResize() {
    this.relayout()
    this.layoutAll(0)
    this.updateLight(this.state, true)
  }

  /** Destino de cada carta de una posición. */
  targetFor(rel, i, n, card) {
    const s = cardSlot(this.L, rel, i, n)
    const t = { x: s.x * this.dpr, y: s.y * this.dpr, angle: s.angle, scale: rel === 0 ? this.myScale : this.backScale, glow: 0 }
    if (rel === 0 && card) {
      const lift = this.L.myH * this.dpr
      const marked = this.state?.you?.pendingDiscard?.includes(card.cardId)
      if (this.selection.has(card.cardId) || marked) {
        t.y -= lift * 0.2
        t.glow = marked ? 0.45 : 1
      } else if (card.hovered && this.canSelect()) {
        t.y -= lift * 0.07
      }
    }
    return t
  }

  layoutSeat(rel, duration = 260) {
    const list = this.cards[rel]
    list.forEach((card, i) => {
      const t = this.targetFor(rel, i, list.length, card)
      card.setDepth(rel === 0 ? 30 + i : 10 + i)
      if (duration === 0) {
        this.tweens.killTweensOf(card)
        card.setPosition(t.x, t.y).setAngle(t.angle).setScale(t.scale).setAlpha(1)
        card.glow.setAlpha(t.glow)
        if (card.faceKeyTarget) card.face.setTexture(card.faceKeyTarget).setScale(1, 1)
        return
      }
      this.tweens.add({ targets: card, x: t.x, y: t.y, angle: t.angle, scale: t.scale, duration, ease: 'Cubic.easeOut' })
      this.tweens.add({ targets: card.glow, alpha: t.glow, duration: 180 })
    })
  }

  layoutAll(duration = 260) {
    for (let rel = 0; rel < 4; rel += 1) this.layoutSeat(rel, duration)
  }

  canSelect() {
    const s = this.state
    return Boolean(s && !this.busy && s.phase === 'DISCARD' && !s.you?.pendingDiscard)
  }

  // ───────────────────────────── Cartas ─────────────────────────────

  makeCard(x, y, cardId = null) {
    const shadow = this.add.image(0, 0, 'shadow')
    const glow = this.add.image(0, 0, 'glow').setAlpha(0)
    const face = this.add.image(0, 0, 'back')
    const card = this.add.container(x, y, [shadow, glow, face])
    card.face = face
    card.glow = glow
    card.cardId = cardId
    card.hovered = false
    card.faceKeyTarget = null
    card.setScale(this.backScale * 0.9).setAngle(this.deck.angle).setDepth(50)

    if (cardId) {
      card.faceKeyTarget = faceKey(cardId)
      face.setInteractive({ useHandCursor: true, pixelPerfect: false })
      face.on('pointerover', () => {
        card.hovered = true
        if (this.canSelect()) this.layoutSeat(0, 160)
      })
      face.on('pointerout', () => {
        card.hovered = false
        if (this.canSelect()) this.layoutSeat(0, 160)
      })
      face.on('pointerdown', () => {
        if (this.canSelect()) this.game.events.emit('card-toggle', cardId)
      })
    }
    return card
  }

  flip(card, key, delay = 0) {
    this.tweens.add({
      targets: card.face,
      scaleX: 0,
      duration: 120,
      delay,
      ease: 'Quad.easeIn',
      onComplete: () => {
        card.face.setTexture(key)
        this.tweens.add({ targets: card.face, scaleX: 1, duration: 150, ease: 'Back.easeOut' })
      },
    })
  }

  clearTable() {
    for (const list of this.cards) for (const c of list) c.destroy()
    this.cards = [[], [], [], []]
    for (const s of this.discardPile) s.destroy()
    this.discardPile = []
  }

  playOrder(state) {
    return [0, 1, 2, 3].map((i) => (state.mano + i) % 4)
  }

  // ───────────────────────────── Estado ─────────────────────────────

  onStateData(_parent, value) {
    this.receive(value)
  }

  onSelectionData(_parent, value) {
    this.selection = new Set(value ?? [])
    this.layoutSeat(0, 180)
  }

  receive(state) {
    if (!state?.you) return
    if (this.busy) {
      this.pendingState = state
      return
    }
    const prev = this.state
    this.state = state
    this.mySeat = state.you.seat

    const mine = this.cards[0].length
    if (!prev || prev.handNumber !== state.handNumber || mine === 0) {
      this.dealHand(state)
    } else if (
      state.lastAction?.type === 'DISCARD_RESOLVED' &&
      prev.lastAction?.at !== state.lastAction.at &&
      state.version > prev.version
    ) {
      this.animateDiscard(state)
    } else {
      this.layoutAll()
    }
    this.updateLight(state)
  }

  finishAnimation() {
    this.busy = false
    this.layoutAll(200)
    if (this.pendingState) {
      const next = this.pendingState
      this.pendingState = null
      this.receive(next)
    }
  }

  /** Reparto de una mano nueva: de una en una, empezando por la mano. */
  dealHand(state) {
    this.busy = true
    this.clearTable()
    const dealerRel = relativeSeat(state.dealer, state.you.seat)
    this.placeDeck(dealerRel, false)
    this.deck.setAlpha(0)
    this.tweens.add({ targets: this.deck, alpha: 1, duration: 250 })

    const hand = sortHand(state.you.hand)
    const order = this.playOrder(state)
    const step = 62
    let k = 0
    let lastEnd = 0

    for (let round = 0; round < 4; round += 1) {
      for (const seat of order) {
        const rel = relativeSeat(seat, state.you.seat)
        const count = state.players[seat].cardCount
        if (round >= count) continue
        const card = this.makeCard(this.deckPos.x, this.deckPos.y, rel === 0 ? hand[round].id : null)
        card.setAlpha(0)
        this.cards[rel].push(card)
        const t = this.targetFor(rel, round, count, null)
        const delay = 250 + k * step
        this.tweens.add({
          targets: card,
          x: t.x,
          y: t.y,
          angle: t.angle,
          scale: t.scale,
          alpha: 1,
          duration: 430,
          delay,
          ease: 'Cubic.easeOut',
        })
        if (rel === 0) this.flip(card, faceKey(card.cardId), delay + 330)
        lastEnd = delay + 430 + (rel === 0 ? 300 : 0)
        k += 1
      }
    }
    this.time.delayedCall(lastEnd + 40, () => this.finishAnimation())
  }

  /** Descartes al centro (boca abajo) y reposición desde el mazo. */
  animateDiscard(state) {
    this.busy = true
    const counts = state.lastDiscardCounts
    const mySeat = state.you.seat
    const newHand = sortHand(state.you.hand)
    const newIds = new Set(newHand.map((c) => c.id))
    let k = 0

    // 1) Salida de descartes
    for (let seat = 0; seat < 4; seat += 1) {
      const rel = relativeSeat(seat, mySeat)
      const list = this.cards[rel]
      let outgoing
      if (rel === 0) outgoing = list.filter((c) => !newIds.has(c.cardId))
      else outgoing = list.slice(list.length - counts[seat])
      this.cards[rel] = list.filter((c) => !outgoing.includes(c))

      for (const card of outgoing) {
        card.face.disableInteractive()
        card.glow.setAlpha(0)
        if (rel === 0) this.flip(card, 'back', k * 30)
        const jitter = () => (Math.random() - 0.5) * 26 * this.dpr
        this.tweens.add({
          targets: card,
          x: this.discardPos.x + jitter(),
          y: this.discardPos.y + jitter(),
          angle: Math.random() * 360,
          scale: this.backScale * 0.82,
          duration: 420,
          delay: k * 30,
          ease: 'Cubic.easeInOut',
          onComplete: () => this.addToDiscardPile(card),
        })
        k += 1
      }
    }

    // 2) Reposición en orden de juego
    const dealStart = 520
    const step = 85
    let j = 0
    let lastEnd = dealStart
    const keptIds = new Set(this.cards[0].map((c) => c.cardId))
    const fresh = newHand.filter((c) => !keptIds.has(c.id))

    for (const seat of this.playOrder(state)) {
      const rel = relativeSeat(seat, mySeat)
      for (let n = 0; n < counts[seat]; n += 1) {
        const cardId = rel === 0 ? fresh[n].id : null
        const card = this.makeCard(this.deckPos.x, this.deckPos.y, cardId)
        card.setAlpha(0)
        card.dealDelay = dealStart + j * step
        this.cards[rel].push(card)
        j += 1
      }
    }
    // Orden final de mi mano
    const byId = new Map(this.cards[0].map((c) => [c.cardId, c]))
    this.cards[0] = newHand.map((c) => byId.get(c.id))

    for (let rel = 0; rel < 4; rel += 1) {
      const list = this.cards[rel]
      list.forEach((card, i) => {
        const t = this.targetFor(rel, i, list.length, card)
        if (card.dealDelay === undefined) {
          // Las cartas que se quedan se reacomodan para dejar hueco a las nuevas.
          this.tweens.add({ targets: card, x: t.x, y: t.y, angle: t.angle, scale: t.scale, duration: 360, delay: 260, ease: 'Cubic.easeInOut' })
          return
        }
        this.tweens.add({
          targets: card,
          x: t.x,
          y: t.y,
          angle: t.angle,
          scale: t.scale,
          alpha: 1,
          duration: 430,
          delay: card.dealDelay,
          ease: 'Cubic.easeOut',
        })
        if (rel === 0) this.flip(card, faceKey(card.cardId), card.dealDelay + 320)
        lastEnd = Math.max(lastEnd, card.dealDelay + 430 + (rel === 0 ? 300 : 0))
        delete card.dealDelay
      })
    }
    this.time.delayedCall(lastEnd + 40, () => this.finishAnimation())
  }

  addToDiscardPile(card) {
    card.setDepth(4)
    card.cardId = null
    card.faceKeyTarget = null
    this.discardPile.push(card)
    while (this.discardPile.length > 10) this.discardPile.shift().destroy()
  }

  // ───────────────────────────── Luz dinámica ─────────────────────────────

  /** El foco sigue al jugador en turno: verde si es de tu pareja, coral si es rival. */
  updateLight(state, instant = false) {
    if (!state?.you) return
    const d = this.dpr
    let x = this.L.center.x * d
    let y = this.L.center.y * d
    let alpha = 0.16
    let color = COLOR_US

    if (state.turn !== null && state.turn !== undefined) {
      const rel = relativeSeat(state.turn, state.you.seat)
      const h = this.L.hands[rel]
      x = (this.L.center.x + (h.x - this.L.center.x) * 0.62) * d
      y = (this.L.center.y + (h.y - this.L.center.y) * 0.62) * d
      alpha = rel === 0 ? 0.42 : 0.3
      color = isMyTeam(state.turn, state.you.seat) ? COLOR_US : COLOR_THEM
    }

    this.light.setTint(color)
    if (instant) {
      this.light.setPosition(x, y).setAlpha(alpha)
    } else {
      this.tweens.add({ targets: this.light, x, y, alpha, duration: 650, ease: 'Sine.easeInOut' })
    }

    // Pulso ambiental cuando es tu turno.
    this.tweens.killTweensOf(this.rimPulse)
    if (state.turn === state.you.seat || this.canSelect()) {
      this.rimPulse.setTint(COLOR_US).setAlpha(0.02)
      this.tweens.add({ targets: this.rimPulse, alpha: 0.09, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    } else {
      this.tweens.add({ targets: this.rimPulse, alpha: 0, duration: 400 })
    }
  }
}
