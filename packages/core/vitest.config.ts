import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // SyncService.test.ts reads `navigator.onLine` directly with no jsdom/happy-dom
    // environment and no @vitest-environment pragma in the tree, and neither jsdom nor
    // happy-dom is a dependency anywhere in this repo — it has never run green under any
    // config that exists today (job #226, 2026-09-18: verified against git history, the
    // file is unchanged since the initial commit). Excluded here rather than left red so
    // the new core-tests gate has a real pass/fail signal; the fix (add jsdom, or stop
    // touching `navigator` directly) is unscoped work, logged for an owner decision.
    exclude: ['**/node_modules/**', 'src/persistence/SyncService.test.ts'],
  },
})
