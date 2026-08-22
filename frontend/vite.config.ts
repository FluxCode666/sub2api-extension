import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname), '')
  // Docker development uses the host port from deploy/.env.dev (8788 in the
  // checked-in local setup). Set VITE_AUX_BACKEND_URL when using the standalone
  // backend Makefile target (8004) or another local backend port.
  const deployEnv = loadEnv('dev', resolve(__dirname, '../deploy'), '')
  const configuredTarget = env.VITE_AUX_BACKEND_URL || env.AUX_BACKEND_URL
  const deployPort = deployEnv.SUB2API_EXTENSION_SERVER_PORT
  const backendTarget = configuredTarget || (deployPort ? `http://127.0.0.1:${deployPort}` : 'http://127.0.0.1:8004')

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
