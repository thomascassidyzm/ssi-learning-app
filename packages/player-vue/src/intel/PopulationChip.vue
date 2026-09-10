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
  <!-- HANDBOOK Who is behind every number
       section: seeing-progress
       roles: admin
       place: intel
       keywords: population, real people, demo, staff, test, excluded, chip
       What it's for. Saying, under every answer, how many real people the
       numbers on that page are counted from and who has been left out. Demo
       accounts, SSi staff, class accounts and machine traffic are never
       counted as people.
       Where it is. The small pill beneath the answer sentence on every
       question page.
       How you do it.
       1. Read the pill under the answer for the number of real people counted.
       2. If a page is deliberately showing demo or staff data, the pill says
          so in red.
       Worth knowing. The count comes from the server, from one shared rule,
       never from the page itself. Two pages cannot disagree about who is real.
       checked: 23b7a8c5.e0a14f75
  -->
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
  border: 1px solid var(--schools-border);
  background: var(--schools-card);
  font-size: 12px;
  color: var(--schools-fg-2);
}
.population-chip.alarm {
  border-color: var(--schools-red);
  color: var(--schools-red);
}
</style>
