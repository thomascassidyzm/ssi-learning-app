<script setup lang="ts">
// ============================================================================
// boards/RatesBoard.vue — "Rate compare": any metric as a rate, entity vs average.
//
// ONE reusable widget (RateCompare.vue) wrapped by three selectors:
//   · Metric   — the 6 HERO_RATES (progressPace leads — the headline rate)
//   · Entity   — a LEVEL switch (learner / class / school / course) + an entity picker
//   · Average  — the entity's ANCESTOR chain (class → its school avg → its course
//                avg), nearest first = default. The cohort is the entity's
//                SIBLINGS in that scope — never its own members (voice ruling).
//
// Design principle: RATE IS PRIMARY. Rate of progress matters more than
// position; position rides along only as the small secondary contextLine.
//
// DEMO-FIRST: with ?demo the board reads data/demoRates.ts (seeded, deterministic,
// NO DB call) — exactly the short-circuit pattern the sibling boards use. The
// real-data path (a getRateComparison RPC) is a TODO; without ?demo the board
// shows a "preview with ?demo" note rather than hitting an unbuilt resolver.
//
// Frostwell Courtyard chrome — matches CoverageBoard's header + segmented
// controls. No hardcoded hex; tokens carry every colour.
// ============================================================================
import { ref, computed, watch } from 'vue'
import RateCompare from '../components/RateCompare.vue'
import WindowChips from '../components/WindowChips.vue'
import FrostSelect from '@/components/FrostSelect.vue'
import {
  HERO_RATES,
  getRateComparison,
  listEntities,
  listAverages,
  listEntityLevels,
  WINDOW_OPTIONS,
  DEFAULT_WINDOW,
  type EntityLevel,
} from '../data/demoRates'
import type { RateComparisonData } from '../spec'

// ── Selection state ─────────────────────────────────────────────────────────
const windowId = ref<string>(DEFAULT_WINDOW)           // This week / 4w / term / all
const metricId = ref<string>('progressPace')          // headline rate by default
const entityLevel = ref<EntityLevel>('class')          // default: a class entity
const entityId = ref<string>('')
const averageId = ref<string>('')                      // snapped to the nearest ancestor below

const metricSelectOptions = computed(() =>
  HERO_RATES.map((m) => ({ value: m.id, label: `${m.label} (${m.unit} / ${m.per})` })))

const ALL_LEVELS: { value: EntityLevel; label: string }[] = [
  { value: 'learner', label: 'Learner' },
  { value: 'class', label: 'Class' },
  { value: 'school', label: 'School' },
  { value: 'course', label: 'Course' },
]

const currentMetric = computed(
  () => HERO_RATES.find((m) => m.id === metricId.value) ?? HERO_RATES[0],
)

// Levels valid for the chosen metric (the level switch only shows these).
const availableLevels = computed(() => {
  const valid = new Set(listEntityLevels(metricId.value))
  return ALL_LEVELS.filter((l) => valid.has(l.value))
})

// Entities for the chosen (metric, level) — the entity picker's options.
const entityOptions = computed(() => listEntities(metricId.value, entityLevel.value))

// Compare-to = the selected entity's ANCESTOR chain (nearest first). The
// options NAME each ancestor ("Gaelcholáiste Luimnigh avg"), so the defaulted
// selection is always explicit — this control never sits empty.
const averageOptions = computed(() =>
  listAverages(metricId.value, entityLevel.value, entityId.value))

// ── Keep the selection coherent as dropdowns change ─────────────────────────
// Metric change: snap the level into the metric's valid set.
watch(metricId, () => {
  const levels = listEntityLevels(metricId.value)
  if (!levels.includes(entityLevel.value)) entityLevel.value = levels[0] ?? 'class'
})

// Metric or level change: re-anchor the entity to the first roster option.
watch([metricId, entityLevel], () => {
  const opts = listEntities(metricId.value, entityLevel.value)
  if (!opts.find((o) => o.value === entityId.value)) {
    entityId.value = opts[0]?.value ?? ''
  }
}, { immediate: true })

// Any selection change: snap compare-to onto the entity's own ancestor chain,
// defaulting to the NEAREST ancestor (options[0]).
watch([metricId, entityLevel, entityId], () => {
  const opts = averageOptions.value
  if (!opts.find((o) => o.value === averageId.value)) {
    averageId.value = opts[0]?.value ?? ''
  }
}, { immediate: true })

// ── The resolved comparison ─────────────────────────────────────────────────
// Seeded synthetic data renders BY DEFAULT — a live preview of what this widget
// surfaces once real learners arrive (no ?demo gate). The real-data resolver
// swaps in here when the analytics path is wired.
const comparison = computed<RateComparisonData>(() =>
  getRateComparison(
    metricId.value,
    entityLevel.value,
    entityId.value,
    averageId.value,
    windowId.value,
  ),
)
</script>

<template>
  <section class="rtb">
    <!-- ── Board header ── -->
    <header class="rtb-head">
      <div class="rtb-title-block">
        <span class="rtb-lens-kicker">Lens · rates</span>
        <h2 class="rtb-title">Rate compare</h2>
        <p class="rtb-sub">
          Any metric as a rate — entity vs average. Pick the metric, the entity (at any
          level), and the cohort to compare against. Rate of progress matters more than
          position: lead with the rate, treat the furthest LEGO as context.
        </p>
      </div>
    </header>

    <!-- ── Selectors ── -->
    <div class="rtb-controls">
      <!-- Time window -->
      <div class="rtb-field">
        <span class="rtb-field-label">Window</span>
        <WindowChips v-model="windowId" :options="WINDOW_OPTIONS" aria-label="Time window" />
      </div>

      <!-- Measure -->
      <label class="rtb-field rtb-field-wide">
        <span class="rtb-field-label">Measure</span>
        <FrostSelect v-model="metricId" :options="metricSelectOptions" aria-label="Measure" />
      </label>

      <!-- Entity level switch -->
      <div class="rtb-field">
        <span class="rtb-field-label">Entity level</span>
        <div class="rtb-segs" role="group" aria-label="Entity level">
          <button
            v-for="l in availableLevels"
            :key="l.value"
            type="button"
            :class="['rtb-seg', { active: entityLevel === l.value }]"
            :aria-pressed="entityLevel === l.value"
            @click="entityLevel = l.value"
          >{{ l.label }}</button>
        </div>
      </div>

      <!-- Entity picker -->
      <label class="rtb-field rtb-field-wide">
        <span class="rtb-field-label">Entity</span>
        <select v-model="entityId" class="rtb-select">
          <option v-for="e in entityOptions" :key="e.value" :value="e.value">
            {{ e.label }}
          </option>
        </select>
      </label>

      <!-- Average picker — the entity's ancestor chain, nearest first -->
      <label class="rtb-field">
        <span class="rtb-field-label">Compare to</span>
        <select v-model="averageId" class="rtb-select">
          <option v-for="a in averageOptions" :key="a.value" :value="a.value">{{ a.label }}</option>
        </select>
      </label>
    </div>

    <!-- ── Metric description (the read this rate carries) ── -->
    <p class="rtb-metric-desc">{{ currentMetric.description }}</p>

    <!-- ── The widget ── -->
    <div class="rtb-widget-card">
      <RateCompare :data="comparison" />
    </div>
    <p class="rtb-preview-note">
      Seeded synthetic cohort — a live preview of what this surfaces once learners arrive.
    </p>
  </section>
</template>

<style scoped>
.rtb {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1280px;
  margin: 0 auto;
}

/* ── Header ── */
.rtb-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.rtb-title-block { display: flex; flex-direction: column; gap: 4px; }
.rtb-lens-kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
}
.rtb-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  margin: 0;
}
.rtb-sub {
  font-size: 13.5px;
  color: var(--ink-muted);
  margin: 0;
  max-width: 52rem;
}

/* ── Controls ── */
.rtb-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  padding: 16px 18px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 12px;
}
.rtb-field { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
.rtb-field-wide { flex: 1 1 220px; min-width: 220px; }
.rtb-field-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.rtb-select {
  appearance: none;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-primary);
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.18);
  border-radius: 9px;
  padding: 9px 12px;
  cursor: pointer;
  transition: border-color 140ms ease;
}
.rtb-select:hover { border-color: rgba(var(--tone-red), 0.35); }
.rtb-select:focus { outline: none; border-color: rgba(var(--tone-red), 0.55); box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.08); }

/* ── Segmented level switch ── */
.rtb-segs { display: inline-flex; border: 1px solid rgba(44, 38, 34, 0.15); border-radius: 9px; overflow: hidden; }
.rtb-seg {
  appearance: none;
  background: var(--schools-card, #fff);
  border: none;
  padding: 9px 13px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.rtb-seg + .rtb-seg { border-left: 1px solid rgba(44, 38, 34, 0.12); }
.rtb-seg:hover:not(.active) { color: var(--ink-primary); }
.rtb-seg.active { background: rgba(var(--tone-red), 0.10); color: rgba(var(--tone-red), 1); }

/* ── Metric description ── */
.rtb-metric-desc {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-secondary);
  margin: 0;
  max-width: 64rem;
}

/* ── Widget card ── */
.rtb-widget-card {
  padding: 24px 26px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 16px;
}

/* ── Preview note ── */
.rtb-preview-note {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
  margin: 0;
  text-align: center;
}

/* ── Responsive ── */
@media (max-width: 860px) {
  .rtb-head { flex-direction: column; align-items: flex-start; }
  .rtb-field, .rtb-field-wide { width: 100%; min-width: 0; }
}
</style>
