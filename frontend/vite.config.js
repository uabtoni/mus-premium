import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // host: true → accesible desde otros dispositivos de la red local (móviles).
  server: { port: 5173, host: true },
})
