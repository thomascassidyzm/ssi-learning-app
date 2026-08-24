import { defineConfig } from 'vitest/config'

// SEC-AUDIT-2026-08-18 — the security-audit suite.
//
// These specs are DELIBERATELY RED. Each one encodes a security property the
// API surface does not currently have (see docs/security/api-audit-2026-08-18.md),
// so running this suite is how you read the findings and how you check a fix.
//
// They live in their own config, on their own filename suffix
// (`*.security-audit.ts`, not `*.test.ts`), for one reason: `pnpm run test:api`
// is a CI merge gate, and a gate that is permanently red stops being a gate.
// Nothing here is skipped or marked expected-to-fail — the failures are real
// and are meant to be read.
//
//   pnpm run test:security-audit     # all findings
//
// A finding is fixed when its spec goes green. When every spec here is green,
// promote them into api/**/*.test.ts so CI holds the line from then on.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['api/**/*.security-audit.ts'],
  },
})
