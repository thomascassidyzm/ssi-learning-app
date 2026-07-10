import { defineConfig } from 'vitest/config'

// Scoped config for api/**/*.test.ts (serverless functions in `api/` are not
// a pnpm workspace package, so they don't ride player-vue's vitest config).
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['api/**/*.test.ts'],
  },
})
