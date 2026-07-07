// Test-only stand-in for the `virtual:pwa-register/vue` module that
// vite-plugin-pwa injects at build/dev time. Vitest has no PWA plugin
// registered, so the bare virtual specifier can't resolve — this file gives
// it somewhere real to resolve to (see vitest.config.ts alias). Individual
// tests use vi.mock('virtual:pwa-register/vue', ...) to control behavior;
// this default export only needs to exist so the .vue SFC transform succeeds
// when a test doesn't mock it.
import { ref } from 'vue'

export function useRegisterSW() {
  return {
    needRefresh: ref(false),
    offlineReady: ref(false),
    updateServiceWorker: async () => {},
  }
}
