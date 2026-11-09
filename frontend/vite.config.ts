import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


const base = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base,
  // Shared local environment files remain owned by the repository root.
  envDir: path.resolve(__dirname, '..'),
  // Preserve optional external assets at the existing root public path.
  publicDir: path.resolve(__dirname, '../public'),
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'incoming.jokley.at',
      'code.jokley.at'
    ],
    // Local dev convenience:
    // - Frontend runs on :5173
    // - Backend runs on :5000
    // Proxy base-prefixed API URLs to the backend using its existing /api path.
    proxy: {
      [`${base}api`]: {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Local Flask must use AUTH_DEV_USER, not the outer proxy identity.
            for (const header of [
              'X-Auth-Proxy-Secret',
              'X-Authenticated-User',
              'X-Authenticated-Name',
              'X-Authenticated-Email',
              'X-Authenticated-Groups',
            ]) {
              proxyReq.removeHeader(header)
            }
          })
        },
        // absproxy preserves the base; the backend still expects /api.
        rewrite: (url) => url.slice(base.length - 1),
      },
    },
  }
})
