import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import { MusTableScene } from './MusTableScene'
import { loadFonts } from '../lib/cardArt'

/**
 * Monta Phaser dentro de React. El juego se crea una sola vez; el estado y la
 * selección se pasan por el registry (la escena reacciona a 'changedata-*').
 * Se renderiza a resolución nativa (devicePixelRatio) para cartas nítidas.
 */
export default function PhaserTable({ state, selection, onToggleCard }) {
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const latest = useRef({ state, selection, onToggleCard })

  useEffect(() => {
    latest.current = { state, selection, onToggleCard }
  })

  useEffect(() => {
    let cancelled = false
    let game = null
    let observer = null

    loadFonts().then(() => {
      if (cancelled || !hostRef.current) return
      const el = hostRef.current
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, el.clientWidth) * dpr
      const height = Math.max(1, el.clientHeight) * dpr

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: el,
        width,
        height,
        backgroundColor: '#07080a',
        banner: false,
        audio: { noAudio: true },
        render: { antialias: true, powerPreference: 'high-performance' },
        scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
      })
      game.registry.set('dpr', dpr)
      game.registry.set('state', latest.current.state)
      game.registry.set('selection', latest.current.selection)
      game.events.on('card-toggle', (id) => latest.current.onToggleCard?.(id))
      game.scene.add('MusTable', MusTableScene, true)
      gameRef.current = game
      if (import.meta.env.DEV) window.__musGame = game

      observer = new ResizeObserver(() => {
        const w = el.clientWidth
        const h = el.clientHeight
        if (!w || !h || !game.scale) return
        if (game.scale.width === w * dpr && game.scale.height === h * dpr) return
        game.scale.resize(w * dpr, h * dpr)
      })
      observer.observe(el)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
      game?.destroy(true)
      gameRef.current = null
    }
  }, [])

  useEffect(() => {
    gameRef.current?.registry.set('state', state)
  }, [state])

  useEffect(() => {
    gameRef.current?.registry.set('selection', selection)
  }, [selection])

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden [&>canvas]:block" />
}
