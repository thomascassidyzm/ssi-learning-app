<script setup lang="ts">
// YearGroupTiles — the row of small tiles under the headline numbers, one per
// year group (Option A, job #306). Shared by the leader home and the classes
// page so the two pages say the same thing the same way. The rule that makes
// the tiles is views/schools/yearGroup.ts; this only draws them. Each tile:
// phrases practised this week, the year group, and classes practising out of
// classes in the group. When fewer than half the names parse the row falls
// back to per-class tiles, busiest first, three then Show all.
import { computed, ref } from 'vue'
import { useI18n } from '@/composables/useI18n'
import ShowAll from '@/components/shared/ShowAll.vue'
import { topThree } from '@/components/shared/topThree'
import type { YearGroupBreakdown, YearGroupTile } from '@/views/schools/yearGroup'

const { t } = useI18n()
const props = defineProps<{ breakdown: YearGroupBreakdown }>()

const showAllClasses = ref(false)
const shown = computed(() => (props.breakdown.mode === 'class' ? topThree(props.breakdown.tiles, showAllClasses.value) : { shown: props.breakdown.tiles, hidden: 0, collapsible: false }))

function title(tile: YearGroupTile): string {
  if (tile.name) return tile.name
  if (tile.year === null) return t('schools.yearGroupTiles.other', 'Other')
  return t('schools.yearGroupTiles.year', 'Year {n}').replace('{n}', String(tile.year))
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
      <div v-for="tile in shown.shown" :key="tile.key" class="year-tile" :class="{ 'is-quiet': tile.phrases7d === 0 }">
        <span class="year-tile-value frost-mono-nums">{{ tile.phrases7d > 0 ? tile.phrases7d : '—' }}</span>
        <span class="year-tile-word">{{ title(tile) }}</span>
        <span class="year-tile-sub">{{ classesLine(tile) }}</span>
      </div>
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
  display: flex; flex-direction: column; gap: 1px; padding: 10px 12px 12px;
  border-radius: var(--radius-md, 10px); background: var(--bg-primary, #e8e3dd);
  border-top: 3px solid var(--belt-yellow, #F2C94C); min-width: 0;
}
.year-tile.is-quiet { border-top-color: rgba(44, 38, 34, 0.14); }
.year-tile-value { font-size: 22px; font-weight: var(--font-semibold); color: var(--ink-primary, #2C2622); line-height: 1.15; }
.year-tile-word { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3, #8A8078); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.year-tile-sub { font-size: var(--text-xs); color: var(--schools-fg-2, #555); margin-top: 3px; }
</style>
