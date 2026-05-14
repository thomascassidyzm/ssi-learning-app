<script setup lang="ts">
/**
 * BrainInventory — vertical-passage browser.
 *
 * Belt-grouped sections, one LEGO per line in introduction order. Reads
 * like a script or song lyrics — clean column, scannable, rhythmic. Tap
 * any line to open the tombola for that LEGO.
 *
 * NEVER expose "lego/seed/round" to the user. Each line shows:
 *   - ordinal index (#1, #47, #205) — introduction order
 *   - target text — large
 *   - known text — dim subline
 *   - belt-coloured pip
 *   - opacity ramps with practice frequency (fireCount)
 */
import { computed } from 'vue'
import type { InventoryLego, BrainInventoryData } from '../composables/useBrainInventory'

const props = defineProps<{
  data: BrainInventoryData
  /** Currently focused LEGO (highlighted line). */
  focusedLegoId?: string | null
}>()

const emit = defineEmits<{
  select: [lego: InventoryLego]
}>()

// Opacity ramp from fireCount. Floor at 0.55 (never invisible — every
// introduced LEGO is visible) up to 1.0 at the course's current max fire.
// Log scale so the first few practices move the needle noticeably and
// later practices keep brightening gradually without saturating early.
const brightnessFor = (lego: InventoryLego) => {
  const max = props.data.maxFireCount
  if (max <= 0) return 0.7 // uniform until any practice data exists
  const t = Math.log(lego.fireCount + 1) / Math.log(max + 1)
  return 0.55 + 0.45 * t
}
</script>

<template>
  <div class="brain-inventory">
    <div
      v-for="section in data.sections"
      :key="section.beltIndex"
      class="belt-section"
    >
      <header class="belt-header">
        <span class="belt-pip" :style="{ background: section.beltColor }" />
        <h3 class="belt-name">{{ section.beltName }}</h3>
        <span class="belt-count">{{ section.legos.length }}</span>
      </header>

      <button
        v-for="lego in section.legos"
        :key="lego.legoId"
        type="button"
        class="inventory-line"
        :class="{ 'is-focused': lego.legoId === focusedLegoId }"
        :style="{ '--line-opacity': brightnessFor(lego) }"
        @click="emit('select', lego)"
      >
        <span class="line-ordinal">{{ lego.ordinal }}</span>
        <span class="line-target">{{ lego.targetText }}</span>
        <span v-if="lego.knownText" class="line-known">{{ lego.knownText }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.brain-inventory {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  padding: 0 1rem;
  font-family: var(--font-body, system-ui);
  -webkit-font-smoothing: antialiased;
}

.belt-section {
  padding-top: 1.25rem;
}

.belt-section:first-child {
  padding-top: 0.25rem;
}

.belt-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0 0.75rem;
  position: sticky;
  top: 0;
  z-index: 5;
  background: linear-gradient(to bottom,
    rgba(240, 236, 231, 1) 0%,
    rgba(240, 236, 231, 1) 70%,
    rgba(240, 236, 231, 0) 100%
  );
}

.belt-pip {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

.belt-name {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(44, 38, 34, 0.7);
}

.belt-count {
  margin-left: auto;
  font-size: 0.75rem;
  color: rgba(44, 38, 34, 0.45);
  font-variant-numeric: tabular-nums;
}

.inventory-line {
  display: grid;
  grid-template-columns: 2.5rem 1fr auto;
  align-items: baseline;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.12s ease, opacity 0.2s ease;
  opacity: var(--line-opacity, 0.7);
  -webkit-tap-highlight-color: transparent;
}

.inventory-line:hover {
  background: rgba(0, 0, 0, 0.04);
}

.inventory-line:active {
  background: rgba(0, 0, 0, 0.08);
}

.inventory-line.is-focused {
  background: rgba(0, 0, 0, 0.06);
  opacity: 1;
}

.line-ordinal {
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(44, 38, 34, 0.4);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.line-target {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 1.05rem;
  font-weight: 500;
  color: rgba(44, 38, 34, 0.95);
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
}

.line-known {
  font-size: 0.85rem;
  font-weight: 400;
  color: rgba(44, 38, 34, 0.55);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 50%;
}

@media (max-width: 480px) {
  .brain-inventory {
    padding: 0 0.75rem;
  }
  .inventory-line {
    grid-template-columns: 2rem 1fr;
    grid-template-rows: auto auto;
    row-gap: 0.15rem;
    padding: 0.55rem 0.5rem;
  }
  .line-known {
    grid-column: 2 / -1;
    text-align: left;
    max-width: 100%;
  }
  .line-target {
    font-size: 1rem;
  }
}
</style>
