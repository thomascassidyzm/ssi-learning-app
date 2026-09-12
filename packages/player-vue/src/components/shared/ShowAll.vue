<script setup lang="ts">
// ShowAll — the one control under every collapsed list on the schools
// surfaces: "Show all 14 links", collapsing back to "Show fewer". A plain-text
// button in the card's own grammar, per section, never sticky. The caller
// decides whether it belongs (topThree.ts: more than three rows) and hands in
// the "Show all N …" label already worded for its list.
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

defineProps<{
  /** True while the list is showing everything. */
  expanded: boolean
  /** The collapsed-state label, worded by the caller: "Show all 14 links". */
  label: string
}>()
const emit = defineEmits<{ (e: 'toggle'): void }>()
</script>

<template>
  <button type="button" class="show-all" :data-show-all="expanded ? 'fewer' : 'all'" :aria-expanded="expanded" @click="emit('toggle')">
    <span class="show-all-caret" aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
    {{ expanded ? t('org.ui.showAll.showFewer', 'Show fewer') : label }}
  </button>
</template>

<style scoped>
.show-all {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 4px; margin: 0;
  border: none; background: none; font: inherit;
  font-size: var(--text-sm); font-weight: var(--font-semibold);
  color: var(--schools-red, #DB1E17); cursor: pointer;
  border-radius: var(--radius-sm, 6px);
}
.show-all:hover { text-decoration: underline; }
.show-all-caret { font-size: 11px; }
</style>
