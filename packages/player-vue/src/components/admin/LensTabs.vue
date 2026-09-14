<script setup lang="ts">
// LensTabs — Overview | Insights as two tabs, side by side, at the top of BOTH
// pages of a node, with the open one visibly selected.
//
// Tom's ruling (2026-09-14, reviewing staging as a school leader): the
// Overview page had a "See insights" button and the Insights page a plain
// "Overview" button, which did not read as a pair. The two are now tabs in
// the same segmented family as the WINDOW chips on the graph tool, so the
// eye reads them as one system. Same at every level that has both pages —
// school, group and class — because both pages already share this corner.
//
// Reads only: a tab is a router-link, so a view-as session changes nothing.
import { useI18n } from '@/composables/useI18n'

defineProps<{
  overviewPath: string
  insightsPath: string
  current: 'overview' | 'insights'
}>()

const { t } = useI18n()
</script>

<template>
  <nav class="lens-tabs" role="tablist" :aria-label="t('org.lensTabs.ariaLabel', 'Overview or insights')">
    <router-link
      :to="overviewPath"
      class="lens-tab"
      :class="{ active: current === 'overview' }"
      role="tab"
      :aria-selected="current === 'overview'"
      :aria-current="current === 'overview' ? 'page' : undefined"
      data-lens-tab="overview"
    >{{ t('org.insights.overview', 'Overview') }}</router-link>
    <router-link
      :to="insightsPath"
      class="lens-tab"
      :class="{ active: current === 'insights' }"
      role="tab"
      :aria-selected="current === 'insights'"
      :aria-current="current === 'insights' ? 'page' : undefined"
      data-lens-tab="insights"
    >{{ t('org.lensTabs.insights', 'Insights') }}</router-link>
  </nav>
</template>

<style scoped>
/* Same pill grammar as WindowChips (the WINDOW control on the graph tool). */
.lens-tabs {
  display: inline-flex;
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 9px;
  overflow: hidden;
  background: var(--schools-card, #fff);
}
.lens-tab {
  appearance: none;
  background: var(--schools-card, #fff);
  border: none;
  padding: 9px 14px;
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-secondary, #5b534c);
  text-decoration: none;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
  white-space: nowrap;
}
.lens-tab + .lens-tab { border-left: 1px solid rgba(44, 38, 34, 0.12); }
.lens-tab:hover:not(.active) { color: var(--ink-primary, #2c2622); }
.lens-tab.active {
  background: rgba(var(--rc-entity, 96 165 250), 0.14);
  color: var(--rc-entity-ink, #2563eb);
  cursor: default;
}
@media (max-width: 720px) {
  .lens-tabs { width: 100%; }
  .lens-tab { flex: 1 1 0; text-align: center; }
}
</style>
