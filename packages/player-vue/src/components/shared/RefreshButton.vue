<script setup lang="ts">
/**
 * RefreshButton — the ONE universal refresh affordance.
 *
 * A standard circular-arrow icon that triggers the shared dashboard refresh.
 * Same button, same spot, same behaviour on every dashboard surface
 * (consistency law §1.12). It renders only on surfaces that have registered a
 * refresh handler, spins while a refresh is in flight, and is disabled during.
 *
 * Drop it into any navbar `.right`/actions cluster — it carries its own state
 * from useDashboardRefresh, so no props are needed.
 */
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'

const { isRefreshing, hasHandler, refresh } = useDashboardRefresh()
</script>

<template>
  <button
    v-if="hasHandler"
    type="button"
    class="refresh-button"
    :class="{ 'is-spinning': isRefreshing }"
    :disabled="isRefreshing"
    title="Refresh data"
    aria-label="Refresh data"
    @click="refresh"
  >
    <!-- Standard two-arrow circular refresh glyph -->
    <svg
      class="refresh-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  </button>
</template>

<style scoped>
.refresh-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.refresh-button:hover {
  opacity: 1;
  background: rgba(127, 127, 127, 0.14);
}

.refresh-button:disabled {
  cursor: default;
  opacity: 0.5;
}

.refresh-icon {
  display: block;
}

.refresh-button.is-spinning .refresh-icon {
  animation: refresh-spin 0.7s linear infinite;
}

@keyframes refresh-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .refresh-button.is-spinning .refresh-icon {
    animation-duration: 1.4s;
  }
}
</style>
