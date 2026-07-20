<script setup lang="ts">
/**
 * UpdatedStamp — the quiet "Updated 14:32" honesty marker.
 *
 * Sits near a surface's stats. Reads the shared refresh timestamp, so it stays
 * in lockstep with the RefreshButton and pull-to-refresh (all three are the one
 * protocol). Shows nothing until the first successful load — an empty stamp is
 * better than a false "Updated —".
 */
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'

const { updatedLabel } = useDashboardRefresh()
</script>

<template>
  <span v-if="updatedLabel" class="updated-stamp" aria-live="polite">
    Updated {{ updatedLabel }}
  </span>
</template>

<style scoped>
.updated-stamp {
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  opacity: 0.55;
  white-space: nowrap;
}
</style>
