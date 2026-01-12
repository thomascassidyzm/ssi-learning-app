import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Generate build info at build time
const buildTime = new Date().toISOString()
const buildNumber = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
                    process.env.GIT_COMMIT?.slice(0, 7) ||
                    `dev-${Date.now().toString(36)}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
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
