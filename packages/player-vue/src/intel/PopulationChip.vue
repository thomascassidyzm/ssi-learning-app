<script setup lang="ts">
/**
 * PopulationChip — who is behind every number on this page.
 *
 * Design §3.5: the two errors that have already burned analysis in this repo
 * are counting machines and counting demo rows, so the population is part of
 * the grammar rather than a footnote. Every page shows this chip, in the same
 * slot, reading the count the server itself resolved — never a count the page
 * worked out on its own.
 *
 * If a page is deliberately looking at demo or staff data the chip says so in
 * the alarm tone, so "these are not real people" can never be silent.
 */
withDefaults(defineProps<{
  /** Real people behind this page's numbers, as counted by the server. */
  people: number | null
  /** True when the page is deliberately showing demo or staff data. */
  showingTestData?: boolean
}>(), { showingTestData: false })
</script>

<template>
  <span class="population-chip" :class="{ alarm: showingTestData }" data-intel="population-chip">
    <template v-if="showingTestData">
      Demo and staff data. These are not real people.
    </template>
    <template v-else-if="people === null">
      Counting real people…
    </template>
    <template v-else>
      {{ people.toLocaleString('en-GB') }} real people. Demo, staff and test traffic excluded.
    </template>
  </span>
</template>

<style scoped>
.population-chip {
  display: inline-block;
  padding: 3px 10px 4px;
  border-radius: var(--schools-radius-pill, 999px);
  border: 1px solid var(--schools-border, rgba(15, 18, 18, .10));
  background: var(--schools-card, #fff);
  font-size: 12px;
  color: var(--schools-fg-2);
}
.population-chip.alarm {
  border-color: var(--schools-red);
  color: var(--schools-red);
}
</style>
