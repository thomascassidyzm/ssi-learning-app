import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['diag/**/*.diag.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
})
