import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname), '')
  // The standalone `cd backend && make dev` target listens on 8004. Docker
  // development uses 8788, so set VITE_AUX_BACKEND_URL explicitly when the
  // backend is running via `make dev-up` (or on another local port).
  const configuredTarget = env.VITE_AUX_BACKEND_URL || env.AUX_BACKEND_URL
  const backendTarget = configuredTarget || 'http://127.0.0.1:8004'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test-setup.ts',
    },
    server: {
      host: '0.0.0.0',
      port: 3100,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
