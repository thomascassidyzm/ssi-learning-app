import { defineConfig } from 'vitest/config'
// The LIVE probes' own config — never merged into vitest.api.config.ts, so
// nothing here runs by accident. Point at one file explicitly.
export default defineConfig({
  test: { environment: 'node', globals: true, include: ['tools/security/*-probe.ts'], testTimeout: 90000 },
})
