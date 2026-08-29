import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // vite-plugin-pwa's virtual module isn't registered under Vitest —
      // point it at a stub so PwaUpdatePrompt.vue can resolve/transform;
      // tests override behavior via vi.mock('virtual:pwa-register/vue', ...).
      'virtual:pwa-register/vue': fileURLToPath(new URL('./src/test/virtualPwaRegisterVueStub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts'],
    // Vitest's 5s/10s defaults are wall-clock, and several of these tests do
    // real work inside the clock: a `router.push('/schools')` in a beforeEach
    // resolves a LAZY route, so the hook pays for transforming
    // SchoolsContainer.vue and its whole import graph. On an idle box that's
    // ~1-4s; on watson-1 running the 251-file suite fully parallel alongside
    // other jobs it blew past 10s and turned the 2026-08-29 nightly red with
    // "Hook timed out in 10000ms" — a false red, not a regression.
    // These ceilings exist to catch a HUNG test, not to police a slow one, so
    // they're set where a genuine hang is still caught quickly and machine
    // load can't manufacture a failure. Costs nothing when tests pass.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
