<script setup lang="ts">
/**
 * UpdatedStamp — when this number was fetched.
 *
 * Design §3.5: the stamp reads from the moment the fetch COMPLETED, never from
 * render time. A page that stamps itself on render tells you when you looked,
 * which is the one thing you already know. `fetchedAt` is therefore set by
 * whoever awaited the request, and a null value reads as still loading rather
 * than as fresh.
 */
import { computed } from 'vue'

const props = defineProps<{ fetchedAt: Date | null }>()

const text = computed(() => {
  if (!props.fetchedAt) return 'Updating…'
  const time = props.fetchedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `Updated ${time}`
})
</script>

<template>
  <span class="updated-stamp" data-intel="updated-stamp">{{ text }}</span>
</template>

<style scoped>
.updated-stamp {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--schools-fg-3);
}
</style>
