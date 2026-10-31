import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The FastAPI backend the dev server proxies to (default :8000; set VITE_PROXY_TARGET to test a second instance).
const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Playwright writes locked .crdownload files into e2e-results/ — watching them crashes Vite on Windows
    watch: { ignored: ['**/e2e-results/**', '**/test-results/**'] },
    proxy: {
      // dev: frontend on :5173 talks to FastAPI on :8000 without CORS/config
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: { port: 4173, host: true },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) return 'three'
          if (id.includes('node_modules/leaflet') || id.includes('react-leaflet')) return 'leaflet'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
} as any)
