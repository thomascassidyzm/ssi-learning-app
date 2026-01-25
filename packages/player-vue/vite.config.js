import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// Generate build info at build time
const buildTime = new Date().toISOString()
const buildNumber = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
                    process.env.GIT_COMMIT?.slice(0, 7) ||
                    `dev-${Date.now().toString(36)}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',  // User approves updates

      workbox: {
        // Precache app shell
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],

        // DON'T cache audio via workbox - we use IndexedDB
        globIgnores: ['**/*.{mp3,wav,ogg,m4a}'],

        // NOTE: Do NOT set skipWaiting/clientsClaim here!
        // With registerType: 'prompt', vite-plugin-pwa handles skipWaiting
        // based on user approval via updateServiceWorker(true)

        // Runtime caching for fonts/CDN/audio
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // Audio proxy - primary path for audio delivery
          // Benefits: analytics, entitlements, CORS, future CDN flexibility
          {
            urlPattern: /\/api\/audio\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ssi-audio-cache',
              expiration: {
                maxEntries: 1000,  // ~1000 audio files = ~25MB
                maxAgeSeconds: 60 * 60 * 24 * 30,  // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // S3 audio direct - fallback for offline scenarios
          // When proxy is unreachable, SW can still serve cached S3 audio
          {
            urlPattern: /^https:\/\/ssi-audio.*\.s3\..*\.amazonaws\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ssi-audio-cache',  // Same cache as proxy
              expiration: {
                maxEntries: 1000,  // ~1000 audio files = ~25MB
                maxAgeSeconds: 60 * 60 * 24 * 30,  // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],  // Cache opaque responses too
              },
            },
          },
        ],
      },

      manifest: {
        name: 'SaySomethingin',
        short_name: 'SSi',
        description: 'Learn languages naturally with immersive audio-based learning',
        theme_color: '#050508',
        background_color: '#050508',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
  },
})
