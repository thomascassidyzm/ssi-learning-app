<script setup lang="ts">
// ============================================================================
// components/RateCompare.vue — the reusable "entity vs average" RATE widget.
//
// Renders a RateComparisonData (from data/demoRates.ts in demo, or a resolver on
// the real path). RATE IS PRIMARY throughout: the headline is a two-number
// "entity v average" stat — the ENTITY is the hero (a glassy outlined lozenge
// with the blue glow) and the average recedes (smaller, muted), split by a quiet
// "v" (versus). The delta + percentile are kept as small secondary chips.
//
// PRIVACY (non-negotiable): an entity is compared ONLY to an aggregate/average,
// NEVER to another named entity. The centrepiece is an ANONYMISED distribution
// strip — a quartile band over the cohort with just TWO marks: "You" (the
// selected entity) and the chosen average, plus the entity's percentile. No
// other entity's name, label, or identity renders anywhere in this widget.
//
// Frostwell Courtyard chrome: schools-surface tokens, mono labels, Arsenal
// display. NO hardcoded hex — the green/blue scheme comes from the --rc-* role
// tokens. The ECharts trend is delegated to RateTrend.vue (keeps this < ~300 ln).
//
// Never throws: an empty/zero RateComparisonData renders a quiet empty state.
// ============================================================================
import { computed } from 'vue'
import type { RateComparisonData } from '../spec'
import RateTrend from './RateTrend.vue'

// RateCompare's own colours are pure CSS (the --rc-* role tokens cascading from
// the teacher root). The ECharts trend resolves those same tokens off the DOM.
const props = defineProps<{
  data: RateComparisonData
}>()

const isEmpty = computed(() => props.data.distribution.values.length === 0)

const perLabel = computed(() => {
  const { unit, per } = props.data
  return per ? `${unit} / ${per}` : unit
})

// Percent metrics suffix "%" onto each big number; otherwise the numbers are
// bare and the unit lives in the caption beneath.
const isPercent = computed(() => props.data.unit.trim() === '%')
const valueSuffix = computed(() => (isPercent.value ? '%' : ''))

// Caption tail after the entity-blue "YOU": "{average.label} · {unit} / {per}"
// e.g. "YOU / COURSE AVG · LEGOs / WEEK" (uppercased via CSS).
const captionRest = computed(() => `${props.data.average.label} · ${perLabel.value}`)

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

// Percentile chip tone: top third good, mid neutral, bottom third warn.
const pctTone = computed(() => {
  const p = props.data.percentile
  if (p >= 66) return 'good'
  if (p >= 33) return 'neutral'
  return 'warn'
})

// ── Anonymised distribution strip geometry ──────────────────────────────────
// The strip spans [min, max] of the cohort, padded a touch so the entity and
// average markers never clip at the edges. Every position is a % along that
// padded domain. Marks ONLY: the quartile band (Q1..Q3), the median tick, the
// "You" dot, and the average line. The other cohort points are an unlabelled
// shape (light ticks) — no names, ever.
const dist = computed(() => props.data.distribution)

const domain = computed(() => {
  const d = dist.value
  // Include the entity + average so their markers always sit inside the strip.
  const lo = Math.min(d.min, d.entityValue, d.averageValue)
  const hi = Math.max(d.max, d.entityValue, d.averageValue)
  const span = hi - lo
  const pad = span > 0 ? span * 0.06 : Math.abs(hi) * 0.06 || 1
  return { lo: lo - pad, hi: hi + pad }
})

// Map a value to a 0..100 position along the padded domain.
function pos(v: number): number {
  const { lo, hi } = domain.value
  if (hi <= lo) return 50
  return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))
}

// Quartile band geometry (Q1 → Q3) and the median tick within it.
const bandLeft = computed(() => pos(dist.value.q1))
const bandWidth = computed(() => Math.max(0, pos(dist.value.q3) - pos(dist.value.q1)))
const medianPos = computed(() => pos(dist.value.median))
const youPos = computed(() => pos(dist.value.entityValue))
const avgPos = computed(() => pos(dist.value.averageValue))

// Unlabelled cohort points — an anonymous shape only (deduped positions so the
// strip doesn't stack identical ticks). Carry NO label/identity, just a %.
const cohortTicks = computed<number[]>(() => {
  const seen = new Set<number>()
  const out: number[] = []
  for (const v of dist.value.values) {
    const p = Math.round(pos(v) * 2) / 2 // 0.5% buckets
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
})
</script>

<template>
  <section class="rc">
    <!-- Empty state — quiet, never an error -->
    <div v-if="isEmpty" class="rc-empty">
      <span class="rc-empty-label">No rate data for this selection</span>
    </div>

    <template v-else>
      <!-- ── Headline: two-number "entity / average" stat ── -->
      <!-- The two big numbers ARE the comparison (the delta + percentile stay as
           small secondary chips for tone + rank). -->
      <header class="rc-headline">
        <div class="rc-head-main">
          <span class="rc-metric-kicker">{{ data.metricLabel }}</span>
          <div class="rc-stat-row">
            <span class="rc-hero-box">
              <span class="rc-value entity">{{ fmt(data.entity.value) }}{{ valueSuffix }}</span>
            </span>
            <span class="rc-vs" aria-hidden="true">v</span>
            <span class="rc-value average">{{ fmt(data.average.value) }}{{ valueSuffix }}</span>
          </div>
          <span class="rc-stat-caption">
            <span class="rc-cap-you">YOU</span> v {{ captionRest }}
          </span>
        </div>

        <div class="rc-head-delta">
          <span :class="['rc-delta', deltaUp ? 'good' : 'warn']">
            <span class="rc-delta-arrow">{{ deltaUp ? '▲' : '▼' }}</span>
            {{ deltaLabel }}
          </span>
          <span :class="['rc-pct-chip', pctTone]">{{ data.percentile }}th pctl</span>
        </div>
      </header>

      <!-- ── HERO: the rate over time — entity vs average, rolling weekly ── -->
      <!-- A rate is a trajectory, so the LINE is the story: where you're heading
           vs where the cohort is heading. (The two bars that used to sit here
           just restated the headline numbers above — removed.) -->
      <div class="rc-trend-block">
        <div class="rc-trend-head">
          <span class="rc-section-label">{{ data.metricLabel }} over time</span>
          <span class="rc-trend-window">Rolling weekly · last 8 weeks</span>
        </div>
        <RateTrend
          :entity-label="data.entity.label"
          :entity="data.entity.trend"
          :average-label="data.average.label"
          :average="data.average.trend"
          :y-label="perLabel"
        />
      </div>

      <!-- ── Anonymised distribution — the centrepiece (privacy-safe) ── -->
      <!-- The whole cohort as a SHAPE: quartile band + unlabelled points, with
           only "You" and the average marked. No other entity is named. -->
      <div class="rc-dist">
        <div class="rc-dist-head">
          <span class="rc-section-label">
            Where you sit · cohort of {{ data.distribution.values.length }} (anonymised)
          </span>
          <span class="rc-dist-legend">
            <span class="rc-leg-item"><span class="rc-leg-dot you" /> You</span>
            <span class="rc-leg-item"><span class="rc-leg-line avg" /> {{ data.average.label }}</span>
          </span>
        </div>

        <div class="rc-strip">
          <!-- whiskers: min → max baseline -->
          <div class="rc-strip-axis" />
          <!-- quartile band Q1..Q3 -->
          <div class="rc-strip-band" :style="{ left: bandLeft + '%', width: bandWidth + '%' }" />
          <!-- median tick -->
          <div class="rc-strip-median" :style="{ left: medianPos + '%' }" />
          <!-- unlabelled cohort points — an anonymous shape, no identities -->
          <div
            v-for="(p, i) in cohortTicks"
            :key="'tk' + i"
            class="rc-strip-tick"
            :style="{ left: p + '%' }"
            aria-hidden="true"
          />
          <!-- the chosen AVERAGE line -->
          <div class="rc-strip-avg" :style="{ left: avgPos + '%' }">
            <span class="rc-strip-avg-cap">avg</span>
          </div>
          <!-- YOU — the only named entity (the selected one) -->
          <div class="rc-strip-you" :style="{ left: youPos + '%' }">
            <span class="rc-strip-you-dot" />
            <span class="rc-strip-you-cap">You · {{ fmt(data.distribution.entityValue) }}</span>
          </div>
        </div>

        <!-- quartile scale labels (values only — no identities) -->
        <div class="rc-strip-scale">
          <span>min {{ fmt(data.distribution.min) }}</span>
          <span>Q1 {{ fmt(data.distribution.q1) }}</span>
          <span>med {{ fmt(data.distribution.median) }}</span>
          <span>Q3 {{ fmt(data.distribution.q3) }}</span>
          <span>max {{ fmt(data.distribution.max) }}</span>
        </div>

        <p class="rc-dist-foot">
          You're at the <strong>{{ data.percentile }}th percentile</strong> of this cohort.
        </p>
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
  letter-spacing: 0.14em;
  text-transform: uppercase;
  /* deeper blue so the small kicker stays legible on the white card (HIG) */
  color: rgba(var(--rc-entity-ink, var(--rc-entity)), 1);
}
/* Two-number stat row: [HERO entity] v [muted average] — the entity is the hero,
   the average recedes; centred so the smaller average + "v" sit against the box */
.rc-stat-row { display: flex; align-items: center; gap: 22px; }
.rc-value {
  font-family: var(--font-display);
  font-size: clamp(38px, 6vw, 56px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
/* The HERO: entity number in a glassy outlined lozenge that floats off the card */
.rc-hero-box {
  display: inline-flex;
  align-items: baseline;
  padding: 2px 18px 6px;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.42)),
    rgba(var(--rc-entity), 0.06);
  border: 1px solid rgba(var(--rc-entity), 0.40);     /* the outline */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),          /* top sheen */
    0 6px 20px rgba(var(--rc-glow), 0.20);            /* soft blue float/glow */
  backdrop-filter: blur(8px) saturate(1.4);
  -webkit-backdrop-filter: blur(8px) saturate(1.4);
}
/* entity = the hero number: full scale, ink + the subtle blue glow */
.rc-value.entity {
  color: var(--ink-primary);
  text-shadow: 0 0 18px rgba(var(--rc-glow), 0.22);
}
/* average = baseline: ~0.62× the entity, muted, no glow, no box */
.rc-value.average {
  font-size: clamp(24px, 3.6vw, 34px);
  color: var(--ink-muted);
  text-shadow: none;
}
/* quiet "v" (versus) separator — clearly a join, not a number */
.rc-vs {
  font-family: var(--font-body);
  font-style: italic;
  font-size: 20px;
  color: var(--ink-faint);
  margin: 0 6px;
  align-self: center;
}
/* mono uppercase caption beneath — "YOU v {avg} · {unit} / {per}" */
.rc-stat-caption {
  font-size: 11.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.rc-cap-you { color: rgba(var(--rc-entity-ink, var(--rc-entity)), 1); }

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
.rc-delta.good { color: rgba(var(--rc-positive), 1); }
.rc-delta.warn { color: rgba(var(--tone-gold), 1); }
.rc-delta-arrow { font-size: 16px; }
.rc-pct-chip {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 999px;
}
/* good chip = green tint + deep-green ink + a hairline green edge (STEP 5) */
.rc-pct-chip.good {
  background: rgba(var(--rc-band), 0.20);
  color: rgba(var(--rc-positive), 1);
  border: 1px solid rgba(var(--rc-positive), 0.30);
}
.rc-pct-chip.neutral { background: rgba(var(--rc-secondary), 0.16); color: rgba(var(--rc-secondary), 1); }
.rc-pct-chip.warn { background: rgba(var(--tone-gold), 0.14); color: rgba(var(--tone-gold), 1); }

/* ── Section labels ── */
.rc-section-label {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

/* ── Trend (the hero graph) ── */
.rc-trend-block { display: flex; flex-direction: column; gap: 10px; }
.rc-trend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.rc-trend-window {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* ── Anonymised distribution centrepiece ── */
.rc-dist {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px 16px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 12px;
}
.rc-dist-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.rc-dist-legend { display: inline-flex; align-items: center; gap: 14px; font-size: 10.5px; color: var(--ink-muted); }
.rc-leg-item { display: inline-flex; align-items: center; gap: 6px; }
.rc-leg-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.rc-leg-dot.you { background: rgba(var(--rc-entity), 0.95); box-shadow: 0 0 0 2px rgba(var(--rc-entity), 0.25), 0 0 8px rgba(var(--rc-glow), 0.45); }
.rc-leg-line { width: 14px; height: 0; border-top: 2px dashed rgba(var(--rc-secondary), 1); display: inline-block; opacity: 0.9; }

/* The strip itself */
.rc-strip {
  position: relative;
  height: 56px;
  margin-top: 18px;     /* headroom for the "You" caption above */
}
.rc-strip-axis {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px solid rgba(44, 38, 34, 0.18);
}
/* quartile band Q1..Q3 — a green tint with a deep-green hairline edge (STEP 5) */
.rc-strip-band {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 22px;
  background: rgba(var(--rc-band), 0.22);
  border: 1px solid rgba(var(--rc-positive), 0.45);
  border-radius: 8px;
}
/* median tick inside the band */
.rc-strip-median {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 22px;
  background: rgba(var(--rc-band), 0.6);
}
/* unlabelled cohort points — anonymous shape only */
.rc-strip-tick {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 9px;
  background: rgba(var(--rc-secondary), 0.55);
  border-radius: 1px;
}
/* the chosen AVERAGE line */
.rc-strip-avg {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 0;
  height: 30px;
  border-left: 2px dashed rgba(var(--rc-secondary), 1);
  opacity: 0.9;
}
.rc-strip-avg-cap {
  position: absolute;
  bottom: -16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
  white-space: nowrap;
}
/* YOU — the only named (selected) entity */
.rc-strip-you {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
}
/* You-dot = blue + light (STEP 5) */
.rc-strip-you-dot {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(var(--rc-entity), 1);
  box-shadow: 0 0 0 3px rgba(var(--rc-glow), 0.20), 0 0 14px rgba(var(--rc-glow), 0.5);
}
.rc-strip-you-cap {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  font-weight: 600;
  /* deeper blue so the "You" caption stays legible on the white card (HIG) */
  color: rgba(var(--rc-entity-ink, var(--rc-entity)), 1);
  white-space: nowrap;
}
/* quartile scale labels */
.rc-strip-scale {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  letter-spacing: 0.03em;
  color: var(--ink-faint);
}
.rc-dist-foot {
  margin: 0;
  font-size: 12px;
  color: var(--ink-secondary);
}
.rc-dist-foot strong { color: var(--ink-primary); }

/* ── Secondary position context (rate stays hero) ── */
.rc-context {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

@media (max-width: 720px) {
  .rc-strip-scale { font-size: 9px; }
}
</style>
