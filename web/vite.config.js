import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// In development, /api calls are forwarded to the local API server.
// The PWA plugin makes the app installable and lets it open with no signal (it caches the app's own files;
// the data lives in IndexedDB, handled by src/offline.js).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // a new version waits for the person to tap "Update", so it never reloads mid-entry
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Station Sales',
        short_name: 'Station Sales',
        description: 'Daily sales, tolerance and profit for your fuel stations.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f2f2f7',
        theme_color: '#f2f2f7',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
