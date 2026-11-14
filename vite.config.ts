import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { chunkSizeWarningLimit: 700 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: 'Quadra',
        short_name: 'Quadra',
        description: 'Spese, entrate e budget',
        lang: 'it',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        background_color: '#0F1115',
        theme_color: '#0F1115',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // l'app (codice, font, icone) funziona offline; i dati passano da IndexedDB
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // i font icona in formato svg/ttf/woff sono ripieghi per browser vecchi: non servono offline
        globIgnores: ['**/Phosphor*.svg'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
