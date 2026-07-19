<script setup lang="ts">
// ============================================================================
// components/WindowChips.vue — THE LENS: the time-window selector (This week /
// Last 4 weeks / This term / All time). One chip row, reused by NodeRateEngine
// (the real path) and RatesBoard (the demo path) so the picker reads identical
// wherever it mounts.
//
// Frostwell Courtyard chrome: mono uppercase labels, warm-grey palette — the
// same segmented-pill look as RatesBoard's existing entity-level switch.
// ============================================================================
interface ChipOption { value: string; label: string }

defineProps<{
  options: ChipOption[]
  modelValue: string
  ariaLabel?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="wc" role="group" :aria-label="ariaLabel ?? 'Time window'">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      :class="['wc-chip', { active: o.value === modelValue }]"
      :aria-pressed="o.value === modelValue"
      @click="emit('update:modelValue', o.value)"
    >{{ o.label }}</button>
  </div>
</template>

<style scoped>
.wc {
  display: inline-flex;
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 9px;
  overflow: hidden;
}
.wc-chip {
  appearance: none;
  background: var(--schools-card, #fff);
  border: none;
  padding: 9px 13px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-secondary, #5b534c);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
  white-space: nowrap;
}
.wc-chip + .wc-chip { border-left: 1px solid rgba(44, 38, 34, 0.12); }
.wc-chip:hover:not(.active) { color: var(--ink-primary, #2c2622); }
.wc-chip.active {
  background: rgba(var(--rc-entity, 96 165 250), 0.14);
  color: var(--rc-entity-ink, #2563eb);
}

@media (max-width: 720px) {
  .wc { width: 100%; }
  .wc-chip { flex: 1 1 0; text-align: center; }
}
</style>
