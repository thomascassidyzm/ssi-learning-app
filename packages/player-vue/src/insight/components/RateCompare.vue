<script setup lang="ts">
// ============================================================================
// components/RateCompare.vue — the reusable "entity vs average" RATE widget.
//
// Renders a RateComparisonData (from data/demoRates.ts in demo, or a resolver on
// the real path). RATE IS PRIMARY throughout: the big entity rate leads, the
// delta-vs-average sits beside it, and the cohort league is the visual
// centrepiece. Position (furthest LEGO) rides along as a small secondary line.
//
// Frostwell Courtyard chrome: schools-surface tokens, mono labels, Arsenal
// display. NO hardcoded hex — tone/percentile colours come from CSS tokens.
// The ECharts trend is delegated to RateTrend.vue (keeps this file < ~300 lines).
//
// Never throws: an empty/zero RateComparisonData renders a quiet empty state.
// ============================================================================
import { computed } from 'vue'
import type { RateComparisonData } from '../spec'
import RateTrend from './RateTrend.vue'

const props = defineProps<{ data: RateComparisonData }>()

const isEmpty = computed(() => props.data.cohort.length === 0)

const perLabel = computed(() => {
  const { unit, per } = props.data
  return per ? `${unit} / ${per}` : unit
})

// Format a rate value: integers plain, otherwise pick precision from magnitude
// (sub-10 → 2dp for ratio-style metrics, else 1dp).
function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return Math.abs(v) < 10 ? v.toFixed(v < 5 ? 2 : 1) : v.toFixed(1)
}

const deltaUp = computed(() => props.data.deltaPct >= 0)
const deltaLabel = computed(() => {
  const d = props.data.deltaPct
  const sign = d > 0 ? '+' : d < 0 ? '−' : '' // proper minus sign
  return `${sign}${Math.abs(d)}%`
})

// Cohort bar geometry: scale every bar against the max so the league reads clearly.
const cohortMax = computed(() =>
  props.data.cohort.reduce((m, c) => Math.max(m, c.value), 0) || 1,
)
function barPct(v: number): number {
  return Math.max(2, Math.round((v / cohortMax.value) * 100))
}
// Where the average marker line sits (as a % of the same scale).
const avgLinePct = computed(() =>
  Math.min(100, Math.round((props.data.average.value / cohortMax.value) * 100)),
)

// Percentile chip tone: top third good, mid neutral, bottom third warn.
const pctTone = computed(() => {
  const p = props.data.percentile
  if (p >= 66) return 'good'
  if (p >= 33) return 'neutral'
  return 'warn'
})
</script>

<template>
  <section class="rc">
    <!-- Empty state — quiet, never an error -->
    <div v-if="isEmpty" class="rc-empty">
      <span class="rc-empty-label">No rate data for this selection</span>
    </div>

    <template v-else>
      <!-- ── Headline: the entity RATE leads ── -->
      <header class="rc-headline">
        <div class="rc-head-main">
          <span class="rc-metric-kicker">{{ data.metricLabel }}</span>
          <div class="rc-value-row">
            <span class="rc-value">{{ fmt(data.entity.value) }}</span>
            <span class="rc-unit">{{ perLabel }}</span>
          </div>
          <span class="rc-entity-label">{{ data.entity.label }}</span>
        </div>

        <div class="rc-head-delta">
          <span :class="['rc-delta', deltaUp ? 'good' : 'warn']">
            <span class="rc-delta-arrow">{{ deltaUp ? '▲' : '▼' }}</span>
            {{ deltaLabel }}
          </span>
          <span class="rc-delta-vs">vs {{ data.average.label }} ({{ fmt(data.average.value) }})</span>
          <span :class="['rc-pct-chip', pctTone]">{{ data.percentile }}th pctl</span>
        </div>
      </header>

      <!-- ── Comparison: entity bar vs average marker ── -->
      <div class="rc-compare">
        <div class="rc-compare-row">
          <span class="rc-compare-name">{{ data.entity.label }}</span>
          <div class="rc-track">
            <div class="rc-bar entity" :style="{ width: barPct(data.entity.value) + '%' }" />
            <div class="rc-avg-line" :style="{ left: avgLinePct + '%' }" />
          </div>
          <span class="rc-compare-val">{{ fmt(data.entity.value) }}</span>
        </div>
        <div class="rc-compare-row">
          <span class="rc-compare-name muted">{{ data.average.label }}</span>
          <div class="rc-track">
            <div class="rc-bar average" :style="{ width: barPct(data.average.value) + '%' }" />
          </div>
          <span class="rc-compare-val muted">{{ fmt(data.average.value) }}</span>
        </div>
      </div>

      <!-- ── Trend: entity vs average across 8 periods ── -->
      <div class="rc-trend-block">
        <span class="rc-section-label">Trend · last 8 {{ data.per }}s</span>
        <RateTrend
          :entity-label="data.entity.label"
          :entity="data.entity.trend"
          :average-label="data.average.label"
          :average="data.average.trend"
        />
      </div>

      <!-- ── Cohort league — the centrepiece ── -->
      <div class="rc-cohort">
        <div class="rc-cohort-head">
          <span class="rc-section-label">Cohort · all {{ data.cohort.length }}, ranked by rate</span>
          <span class="rc-cohort-legend">
            <span class="rc-legend-dot avg" /> {{ data.average.label }} ({{ fmt(data.average.value) }})
          </span>
        </div>
        <ul class="rc-cohort-list">
          <li
            v-for="(c, i) in data.cohort"
            :key="c.label + i"
            :class="['rc-cohort-item', { selected: c.isEntity }]"
          >
            <span class="rc-cohort-rank">{{ i + 1 }}</span>
            <span class="rc-cohort-name">{{ c.label }}</span>
            <div class="rc-cohort-track">
              <div
                :class="['rc-cohort-bar', c.belowAvg ? 'below' : 'above', { selected: c.isEntity }]"
                :style="{ width: barPct(c.value) + '%' }"
              />
              <div class="rc-cohort-avg" :style="{ left: avgLinePct + '%' }" />
            </div>
            <span class="rc-cohort-val">{{ fmt(c.value) }}</span>
          </li>
        </ul>
      </div>

      <!-- ── Secondary position context (rate stays the hero) ── -->
      <p v-if="data.contextLine" class="rc-context">{{ data.contextLine }}</p>
    </template>
  </section>
</template>

<style scoped>
.rc {
  display: flex;
  flex-direction: column;
  gap: 20px;
  font-family: var(--font-mono);
}

/* ── Empty ── */
.rc-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  border: 1px dashed var(--ink-faint);
  border-radius: 12px;
}
.rc-empty-label {
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* ── Headline ── */
.rc-headline {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.10);
}
.rc-head-main { display: flex; flex-direction: column; gap: 4px; }
.rc-metric-kicker {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
}
.rc-value-row { display: flex; align-items: baseline; gap: 8px; }
.rc-value {
  font-family: var(--font-display);
  font-size: clamp(38px, 6vw, 56px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--ink-primary);
}
.rc-unit { font-size: 15px; color: var(--ink-secondary); }
.rc-entity-label { font-size: 13px; color: var(--ink-muted); }

.rc-head-delta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.rc-delta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
}
.rc-delta.good { color: rgba(var(--tone-green), 1); }
.rc-delta.warn { color: rgba(var(--tone-gold), 1); }
.rc-delta-arrow { font-size: 16px; }
.rc-delta-vs { font-size: 11.5px; color: var(--ink-muted); }
.rc-pct-chip {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 999px;
}
.rc-pct-chip.good { background: rgba(var(--tone-green), 0.12); color: rgba(var(--tone-green), 1); }
.rc-pct-chip.neutral { background: rgba(var(--tone-blue), 0.12); color: rgba(var(--tone-blue), 1); }
.rc-pct-chip.warn { background: rgba(var(--tone-gold), 0.14); color: rgba(var(--tone-gold), 1); }

/* ── Section labels ── */
.rc-section-label {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

/* ── Comparison bars ── */
.rc-compare { display: flex; flex-direction: column; gap: 10px; }
.rc-compare-row {
  display: grid;
  grid-template-columns: 150px 1fr 56px;
  align-items: center;
  gap: 12px;
}
.rc-compare-name { font-size: 12.5px; color: var(--ink-primary); }
.rc-compare-name.muted, .rc-compare-val.muted { color: var(--ink-muted); }
.rc-compare-val { font-size: 12.5px; text-align: right; color: var(--ink-secondary); }
.rc-track {
  position: relative;
  height: 18px;
  background: rgba(44, 38, 34, 0.05);
  border-radius: 5px;
  overflow: visible;
}
.rc-bar { height: 100%; border-radius: 5px; }
.rc-bar.entity { background: rgba(var(--tone-blue), 0.85); }
.rc-bar.average { background: rgba(44, 38, 34, 0.28); }
.rc-avg-line {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: var(--ink-secondary);
  opacity: 0.6;
}

/* ── Trend ── */
.rc-trend-block { display: flex; flex-direction: column; gap: 8px; }

/* ── Cohort centrepiece ── */
.rc-cohort {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 12px;
}
.rc-cohort-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.rc-cohort-legend { font-size: 10.5px; color: var(--ink-muted); display: inline-flex; align-items: center; gap: 6px; }
.rc-legend-dot { display: inline-block; width: 14px; height: 0; border-top: 2px solid var(--ink-secondary); opacity: 0.7; }
.rc-cohort-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.rc-cohort-item {
  display: grid;
  grid-template-columns: 22px 150px 1fr 52px;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  border-radius: 7px;
  transition: background 140ms ease;
}
.rc-cohort-item.selected {
  background: rgba(var(--tone-blue), 0.08);
  box-shadow: inset 0 0 0 1px rgba(var(--tone-blue), 0.30);
}
.rc-cohort-rank { font-size: 10.5px; color: var(--ink-faint); text-align: right; }
.rc-cohort-name {
  font-size: 12px;
  color: var(--ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rc-cohort-item.selected .rc-cohort-name { color: var(--ink-primary); font-weight: 600; }
.rc-cohort-track {
  position: relative;
  height: 14px;
  background: rgba(44, 38, 34, 0.04);
  border-radius: 4px;
}
.rc-cohort-bar { height: 100%; border-radius: 4px; opacity: 0.55; }
.rc-cohort-bar.above { background: rgba(var(--tone-green), 0.75); }
.rc-cohort-bar.below { background: rgba(var(--tone-gold), 0.65); }
.rc-cohort-bar.selected { opacity: 1; background: rgba(var(--tone-blue), 0.9); }
.rc-cohort-avg {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--ink-secondary);
  opacity: 0.55;
}
.rc-cohort-val { font-size: 12px; text-align: right; color: var(--ink-secondary); }
.rc-cohort-item.selected .rc-cohort-val { color: var(--ink-primary); font-weight: 600; }

/* ── Secondary position context (rate stays hero) ── */
.rc-context {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

@media (max-width: 720px) {
  .rc-compare-row { grid-template-columns: 100px 1fr 46px; }
  .rc-cohort-item { grid-template-columns: 18px 96px 1fr 44px; }
}
</style>
