<script setup lang="ts">
// SchoolsErrorBoundary — last line of defense around the /schools routed
// content. A render/setup/lifecycle error anywhere below this used to
// unmount silently, leaving the schools shell (top bar) up with a blank
// page below it until a hard reload — see the white-page-of-death bug
// (2026-07-16). This never replaces fixing the actual root cause; it just
// means the NEXT one shows a recoverable card instead of a blank screen.
import { ref, watch, onErrorCaptured } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const caughtError = ref<Error | null>(null)

// Reset on route change so navigating away from the broken page (e.g. via
// the top bar, which keeps rendering) clears the card rather than sticking.
watch(() => route.fullPath, () => { caughtError.value = null })

onErrorCaptured((err, _instance, info) => {
  console.error('[SchoolsErrorBoundary] caught render error:', err, { info })
  caughtError.value = err instanceof Error ? err : new Error(String(err))
  // Stop propagation — without this Vue rethrows up to the app root, which
  // has no handler and would blank the ENTIRE app, not just this surface.
  return false
})

function reload() {
  window.location.reload()
}
</script>

<template>
  <div v-if="caughtError" class="schools-error-card" role="alert">
    <h2 class="arsenal">Something went wrong</h2>
    <p>This page hit an error and couldn't finish loading. Your data is safe.</p>
    <button type="button" class="btn-play" @click="reload">Reload</button>
  </div>
  <slot v-else />
</template>

<style scoped>
.schools-error-card {
  max-width: 480px;
  margin: 64px auto;
  padding: 32px;
  text-align: center;
  background: #fff;
  border: 1px solid var(--schools-border);
  border-radius: 12px;
}
.schools-error-card h2 {
  font-size: 20px;
  margin: 0 0 8px;
}
.schools-error-card p {
  font-size: 14px;
  color: var(--schools-fg-2);
  margin: 0 0 20px;
}
</style>
