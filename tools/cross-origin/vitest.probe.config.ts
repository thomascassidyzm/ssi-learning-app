import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', globals: true, include: ['tools/cross-origin/live-probe.ts'], testTimeout: 60000 },
})
