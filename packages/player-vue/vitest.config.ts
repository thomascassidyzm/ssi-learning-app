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
  },
})
