<script setup lang="ts">
// YearGroupTiles — the row of small tiles under the headline numbers, one per
// year group (Option A, job #306). Shared by the leader home and the classes
// page so the two pages say the same thing the same way. The rule that makes
// the tiles is views/schools/yearGroup.ts; this only draws them. Each tile:
// the year group, big — "Y7", "Y8", "Other" — in-app minutes this week
// beneath it, and classes practising out of classes in the group. The
// minutes are the SAME figure as the headline and the class rows, one
// definition (job #673), and they replaced a phrases count Tom read as
// minutes under a headline in minutes (job #766, 2026-09-15). When fewer than
// half the names parse the row falls back to per-class tiles, busiest first,
// three then Show all.
import { computed, ref } from 'vue'
import { useI18n } from '@/composables/useI18n'
import ShowAll from '@/components/shared/ShowAll.vue'
import { topThree } from '@/components/shared/topThree'
import { formatPracticeMinutes } from '@/composables/schools/practiceMinutes'
import type { YearGroupBreakdown, YearGroupTile } from '@/views/schools/yearGroup'

const { t } = useI18n()
// EVERYTHING IS TAPPABLE (Tom, 2026-09-14, job #624): a tile is a link to the
// breakdown behind it when the page gives one — the classes list filtered to
// that year, or the class itself for a per-class tile. No builder, no link.
const props = defineProps<{ breakdown: YearGroupBreakdown; tileLink?: (tile: YearGroupTile) => string | null }>()
function linkFor(tile: YearGroupTile): string | null {
  return props.tileLink ? props.tileLink(tile) : null
}

const showAllClasses = ref(false)
const shown = computed(() => (props.breakdown.mode === 'class' ? topThree(props.breakdown.tiles, showAllClasses.value) : { shown: props.breakdown.tiles, hidden: 0, collapsible: false }))

// The dominant element: "Y7" for a year group, "Other" for the names that
// did not parse, the class's own name on a per-class tile.
function title(tile: YearGroupTile): string {
  if (tile.name) return tile.name
  if (tile.year === null) return t('schools.yearGroupTiles.other', 'Other')
  return t('schools.yearGroupTiles.yearShort', 'Y{n}').replace('{n}', String(tile.year))
}
// The long form, for the screen reader and the hover: "Year 7".
function longTitle(tile: YearGroupTile): string {
  if (tile.name) return tile.name
  if (tile.year === null) return t('schools.yearGroupTiles.other', 'Other')
  return t('schools.yearGroupTiles.year', 'Year {n}').replace('{n}', String(tile.year))
}
function minutesLine(tile: YearGroupTile): string {
  return tile.minutes7d > 0 ? formatPracticeMinutes(tile.minutes7d) : '—'
}
function classesLine(tile: YearGroupTile): string {
  if (tile.name) return tile.practising ? t('schools.yearGroupTiles.classPractised', 'practised this week') : t('schools.yearGroupTiles.classNotThisWeek', 'not this week')
  if (tile.practising === 0) return t('schools.yearGroupTiles.noneOfYet', 'none of {total} yet').replace('{total}', String(tile.classCount))
  return (tile.classCount === 1
    ? t('schools.yearGroupTiles.ofClassesOne', '{n} of {total} class')
    : t('schools.yearGroupTiles.ofClassesMany', '{n} of {total} classes')
  ).replace('{n}', String(tile.practising)).replace('{total}', String(tile.classCount))
}
</script>

<template>
  <div v-if="breakdown.tiles.length" class="year-tiles schools-card" :data-mode="breakdown.mode">
    <span class="schools-kicker">{{ breakdown.mode === 'class' ? t('schools.yearGroupTiles.byClass', 'By class') : t('schools.yearGroupTiles.byYearGroup', 'By year group') }}</span>
    <div class="year-tiles-row">
      <component
        :is="linkFor(tile) ? 'router-link' : 'div'"
        v-for="tile in shown.shown"
        :key="tile.key"
        :to="linkFor(tile) || undefined"
        class="year-tile"
        :class="{ 'is-quiet': tile.minutes7d === 0, 'is-link': !!linkFor(tile), 'is-class': !!tile.name }"
        :data-year-tile="tile.key"
        :title="longTitle(tile)"
      >
        <span class="year-tile-word arsenal" :aria-label="longTitle(tile)">{{ title(tile) }}</span>
        <span class="year-tile-value frost-mono-nums" data-year-tile-minutes>{{ minutesLine(tile) }}</span>
        <span class="year-tile-sub">{{ classesLine(tile) }}</span>
      </component>
    </div>
    <ShowAll v-if="shown.collapsible" :expanded="showAllClasses" :label="t('schools.yearGroupTiles.showAllClasses', 'Show all {n} classes').replace('{n}', String(breakdown.tiles.length))" @toggle="showAllClasses = !showAllClasses" />
  </div>
</template>

<style scoped>
.year-tiles { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--space-4) var(--space-4); }
.year-tiles .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-fg-3, #8A8078);
}
/* Phone first: three across at 390px, the same stat-card grammar one size down,
   the belt-yellow rule the only colour. */
.year-tiles-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: var(--space-2); }
.year-tile {
  display: flex; flex-direction: column; gap: 2px; padding: 10px 12px 12px;
  border-radius: var(--radius-md, 10px); background: var(--bg-primary, #e8e3dd);
  border-top: 3px solid var(--belt-yellow, #F2C94C); min-width: 0;
}
.year-tile.is-quiet { border-top-color: rgba(44, 38, 34, 0.14); }
.year-tile.is-link { color: inherit; text-decoration: none; cursor: pointer; }
.year-tile.is-link:hover { background: #fff; }
.year-tile.is-link:focus-visible { outline: 2px solid var(--schools-red, #DB1E17); outline-offset: 2px; }
/* The year key is the thing the eye parses first — big, bold, one glance. */
.year-tile-word { font-size: 26px; font-weight: 700; line-height: 1.1; color: var(--ink-primary, #2C2622); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* A per-class tile carries a name, not a key: one size down so it fits. */
.year-tile.is-class .year-tile-word { font-size: 15px; }
.year-tile-value { font-size: 15px; font-weight: var(--font-semibold); color: var(--ink-primary, #2C2622); line-height: 1.2; }
.year-tile.is-quiet .year-tile-value { color: var(--schools-fg-3, #8A8078); }
.year-tile-sub { font-size: var(--text-xs); color: var(--schools-fg-2, #555); margin-top: 2px; }
</style>
