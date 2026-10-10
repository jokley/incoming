import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


export default defineConfig({
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
      'incoming.jokley.at'
    ],
    // Local dev convenience:
    // - Frontend runs on :5173
    // - Backend runs on :5000
    // Proxy `/api/*` to the backend so the app can use same-origin `/api` URLs.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  }
})
