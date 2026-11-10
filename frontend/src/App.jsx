import { lazy, Suspense, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { actions, useStore } from './lib/store'
import { Backdrop, OfflineBanner, Toasts, Wordmark } from './components/ui'
import LoginScreen from './screens/LoginScreen'
import LobbyScreen from './screens/LobbyScreen'
import RoomScreen from './screens/RoomScreen'

// Phaser solo se descarga al entrar en una partida.
const GameScreen = lazy(() => import('./screens/GameScreen'))

const SCREENS = { login: LoginScreen, lobby: LobbyScreen, room: RoomScreen, game: GameScreen }

function useInviteLink(user, room) {
  useEffect(() => {
    if (!user || room) return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('sala')
    if (!code) return
    params.delete('sala')
    const qs = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    actions.joinRoom(code.toUpperCase())
  }, [user, room])
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center">
      <motion.div animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 1.8, repeat: Infinity }}>
        <Wordmark />
      </motion.div>
    </div>
  )
}

export default function App() {
  const { user, room, game, restoring } = useStore()
  useInviteLink(user, room)

  let screen = 'login'
  if (restoring) screen = 'splash'
  else if (user && !room) screen = 'lobby'
  else if (user && room) screen = room.status === 'playing' && game ? 'game' : 'room'

  const Screen = SCREENS[screen] ?? Splash

  return (
    <div className="grain relative h-full">
      {screen !== 'game' && <Backdrop />}
      <AnimatePresence mode="wait">
        <motion.main
          key={screen}
          className="h-full"
          initial={{ opacity: 0, filter: 'blur(8px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(8px)' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <Suspense fallback={<Splash />}>
            <Screen />
          </Suspense>
        </motion.main>
      </AnimatePresence>
      <OfflineBanner />
      <Toasts />
    </div>
  )
}
