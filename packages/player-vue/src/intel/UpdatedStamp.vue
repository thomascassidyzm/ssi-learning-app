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
  <!-- HANDBOOK When an answer was fetched
       section: seeing-progress
       roles: admin
       place: intel
       keywords: updated, fetched, fresh, stale, time, stamp
       What it's for. Saying when the numbers on a question page were actually
       read from the database, so you know whether you are looking at this
       minute or this morning.
       Where it is. Beneath the answer sentence on every question page,
       reading **Updated** and a time.
       How you do it.
       1. Read the time beneath the answer.
       2. While it reads **Updating**, the page is still fetching and no number
          on it is final.
       Worth knowing. The time is taken when the fetch completed, never when
       the page drew itself.
       checked: 9632e806.e7e6b15a
  -->
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
