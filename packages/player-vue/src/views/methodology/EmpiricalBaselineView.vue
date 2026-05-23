<script setup lang="ts">
/**
 * EmpiricalBaselineView — first live methodology explainer page.
 *
 * Renders the population's distribution of total practice hours, with the
 * 30-hour ("entry-conversational") and 100-hour ("≈B1-conversational")
 * empirical anchors marked. Reads real anonymised aggregate data via the
 * usePopulationHours composable.
 *
 * Spec reference: docs/methodology/metrics-architecture.md §2 (The empirical
 * baseline) and §10 step 2a (anchoring the scale internally).
 */
import { onMounted, computed } from 'vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import { usePopulationHours, type HourBucket } from '@/composables/methodology/usePopulationHours'

const { isLoading, error, perLearnerHours, buckets, stats, fetch } = usePopulationHours()

onMounted(() => { fetch() })

// SVG layout constants
const SVG_WIDTH = 880
const SVG_HEIGHT = 320
const PAD_LEFT = 48
const PAD_RIGHT = 24
const PAD_TOP = 24
const PAD_BOTTOM = 60

const plotWidth = computed(() => SVG_WIDTH - PAD_LEFT - PAD_RIGHT)
const plotHeight = computed(() => SVG_HEIGHT - PAD_TOP - PAD_BOTTOM)

const maxCount = computed(() => {
  return buckets.value.reduce((m, b) => Math.max(m, b.count), 0)
})

// Logarithmic x-axis — practice hours span 0 → 1000 with most learners
// clustered at the low end. Log scale makes the 30/100h anchors readable.
const X_MIN = 0.5
const X_MAX = 1000

function xFor(hours: number): number {
  const clamped = Math.max(X_MIN, Math.min(X_MAX, hours))
  const t = (Math.log10(clamped) - Math.log10(X_MIN)) / (Math.log10(X_MAX) - Math.log10(X_MIN))
  return PAD_LEFT + t * plotWidth.value
}

function widthFor(b: HourBucket): number {
  const fromHours = Math.max(X_MIN, b.fromHours)
  return Math.max(2, xFor(b.toHours) - xFor(fromHours) - 2)
}

function yFor(count: number): number {
  if (maxCount.value === 0) return SVG_HEIGHT - PAD_BOTTOM
  const t = count / maxCount.value
  return PAD_TOP + (1 - t) * plotHeight.value
}

function heightFor(count: number): number {
  return SVG_HEIGHT - PAD_BOTTOM - yFor(count)
}

const xTicks = [1, 3, 10, 30, 100, 300, 1000]

function pct(n: number): string {
  return `${n.toFixed(1)}%`
}

function num(n: number): string {
  return n.toLocaleString('en-GB')
}

function hoursLabel(h: number): string {
  if (h < 1) return `${(h * 60).toFixed(0)} min`
  if (h < 10) return `${h.toFixed(1)} h`
  return `${Math.round(h)} h`
}
</script>

<template>
  <div class="empirical-baseline">
    <header class="page-head">
      <div class="title-block">
        <span class="kicker">Spec §2 · Empirical baseline</span>
        <h1 class="page-title">17 years, 1,000s of learners — what the data says</h1>
        <p class="page-sub">
          The architecture rests on two empirical observations from SSi's
          long-running learner population: conversational ability emerges
          around <strong>30 hours</strong> of in-app practice, and B1-level
          fluency around <strong>100 hours</strong>. This page shows where
          today's learners actually sit on that scale.
        </p>
      </div>
    </header>

    <!-- Headline stats -->
    <div class="stats-row" v-if="stats">
      <FrostCard variant="stone" class="stat-tile">
        <span class="stat-label">Learners with practice data</span>
        <span class="stat-value">{{ num(stats.learnersWithAnyPractice) }}</span>
        <span class="stat-foot">of {{ num(stats.totalLearners) }} enrolled</span>
      </FrostCard>
      <FrostCard variant="stone" class="stat-tile">
        <span class="stat-label">Median practice</span>
        <span class="stat-value">{{ hoursLabel(stats.medianHours) }}</span>
        <span class="stat-foot">mean {{ hoursLabel(stats.meanHours) }}</span>
      </FrostCard>
      <FrostCard variant="stone" class="stat-tile" tone="gold">
        <span class="stat-label">At or past 30h anchor</span>
        <span class="stat-value">{{ pct(stats.pct30hPlus) }}</span>
        <span class="stat-foot">"entry-conversational"</span>
      </FrostCard>
      <FrostCard variant="stone" class="stat-tile" tone="green">
        <span class="stat-label">At or past 100h anchor</span>
        <span class="stat-value">{{ pct(stats.pct100hPlus) }}</span>
        <span class="stat-foot">"≈ B1-conversational"</span>
      </FrostCard>
    </div>

    <!-- The histogram itself -->
    <FrostCard variant="panel" class="chart-card">
      <header class="chart-head">
        <h2 class="chart-title">Population distribution of total practice hours</h2>
        <p class="chart-sub">
          Each bar shows how many learners have accumulated practice in that
          band. Log scale on the x-axis — the population is heavily concentrated
          at low hours, with a long tail of dedicated learners.
        </p>
      </header>

      <div v-if="isLoading" class="chart-loading">Loading population data…</div>
      <div v-else-if="error" class="chart-error">Could not load data: {{ error }}</div>
      <div v-else-if="perLearnerHours.length === 0" class="chart-empty">No practice data found.</div>

      <svg v-else :viewBox="`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`" class="chart" preserveAspectRatio="xMidYMid meet">
        <!-- Y axis grid -->
        <line
          v-for="tick in [0.25, 0.5, 0.75, 1]"
          :key="`g${tick}`"
          :x1="PAD_LEFT"
          :x2="SVG_WIDTH - PAD_RIGHT"
          :y1="yFor(maxCount * tick)"
          :y2="yFor(maxCount * tick)"
          stroke="rgba(0,0,0,0.06)"
          stroke-dasharray="3 4"
        />

        <!-- Bars -->
        <g v-for="b in buckets" :key="`bar-${b.fromHours}`">
          <rect
            :x="xFor(Math.max(X_MIN, b.fromHours)) + 1"
            :y="yFor(b.count)"
            :width="widthFor(b)"
            :height="heightFor(b.count)"
            fill="#3a3027"
            opacity="0.78"
            rx="2"
          />
          <text
            v-if="b.count > 0"
            :x="xFor(Math.max(X_MIN, b.fromHours)) + widthFor(b) / 2 + 1"
            :y="yFor(b.count) - 6"
            text-anchor="middle"
            font-family="Open Sans, system-ui, sans-serif"
            font-size="11"
            fill="rgba(0,0,0,0.6)"
          >{{ b.count }}</text>
        </g>

        <!-- 30-hour anchor -->
        <g class="anchor anchor-30">
          <line
            :x1="xFor(30)"
            :x2="xFor(30)"
            :y1="PAD_TOP - 6"
            :y2="SVG_HEIGHT - PAD_BOTTOM"
            stroke="#FEC902"
            stroke-width="2"
            stroke-dasharray="4 4"
          />
          <rect
            :x="xFor(30) - 64"
            :y="PAD_TOP - 18"
            width="128"
            height="22"
            rx="11"
            fill="#FEC902"
          />
          <text
            :x="xFor(30)"
            :y="PAD_TOP - 3"
            text-anchor="middle"
            font-family="Open Sans, system-ui, sans-serif"
            font-size="11"
            font-weight="600"
            fill="#3a2c00"
          >30 h · conversational</text>
        </g>

        <!-- 100-hour anchor -->
        <g class="anchor anchor-100">
          <line
            :x1="xFor(100)"
            :x2="xFor(100)"
            :y1="PAD_TOP - 6"
            :y2="SVG_HEIGHT - PAD_BOTTOM"
            stroke="#1d6a2c"
            stroke-width="2"
            stroke-dasharray="4 4"
          />
          <rect
            :x="xFor(100) - 56"
            :y="PAD_TOP - 18"
            width="112"
            height="22"
            rx="11"
            fill="#1d6a2c"
          />
          <text
            :x="xFor(100)"
            :y="PAD_TOP - 3"
            text-anchor="middle"
            font-family="Open Sans, system-ui, sans-serif"
            font-size="11"
            font-weight="600"
            fill="#fff"
          >100 h · ≈ B1</text>
        </g>

        <!-- X axis ticks -->
        <line
          :x1="PAD_LEFT"
          :x2="SVG_WIDTH - PAD_RIGHT"
          :y1="SVG_HEIGHT - PAD_BOTTOM"
          :y2="SVG_HEIGHT - PAD_BOTTOM"
          stroke="rgba(0,0,0,0.4)"
          stroke-width="1"
        />
        <g v-for="t in xTicks" :key="`xt${t}`">
          <line
            :x1="xFor(t)"
            :x2="xFor(t)"
            :y1="SVG_HEIGHT - PAD_BOTTOM"
            :y2="SVG_HEIGHT - PAD_BOTTOM + 5"
            stroke="rgba(0,0,0,0.4)"
          />
          <text
            :x="xFor(t)"
            :y="SVG_HEIGHT - PAD_BOTTOM + 20"
            text-anchor="middle"
            font-family="Open Sans, system-ui, sans-serif"
            font-size="11"
            fill="rgba(0,0,0,0.6)"
          >{{ t }}h</text>
        </g>
        <text
          :x="(SVG_WIDTH + PAD_LEFT - PAD_RIGHT) / 2"
          :y="SVG_HEIGHT - 10"
          text-anchor="middle"
          font-family="Open Sans, system-ui, sans-serif"
          font-size="11.5"
          font-weight="500"
          fill="rgba(0,0,0,0.55)"
        >total in-app practice (hours, log scale)</text>

        <!-- Y axis label -->
        <text
          :x="14"
          :y="(SVG_HEIGHT - PAD_BOTTOM + PAD_TOP) / 2"
          text-anchor="middle"
          font-family="Open Sans, system-ui, sans-serif"
          font-size="11.5"
          font-weight="500"
          fill="rgba(0,0,0,0.55)"
          :transform="`rotate(-90, 14, ${(SVG_HEIGHT - PAD_BOTTOM + PAD_TOP) / 2})`"
        >learner count</text>
      </svg>

      <div v-if="!isLoading && !error" class="legend">
        <span class="legend-item"><span class="legend-dot anchor-30-dot"></span> 30-hour anchor — empirical "entry-conversational" milestone</span>
        <span class="legend-item"><span class="legend-dot anchor-100-dot"></span> 100-hour anchor — empirical "≈ B1-conversational" milestone</span>
      </div>
    </FrostCard>

    <!-- Prose: what this means for the architecture -->
    <FrostCard variant="panel" class="explainer-card">
      <h2 class="explainer-title">Why this is load-bearing</h2>
      <p>
        The 30/100-hour observations are not theoretical — they are population
        averages that SSi has accumulated over nearly two decades. They give
        the metrics architecture an unusually strong starting position:
        a working method exists, and its average dose-response curve is
        already known. The architecture's job is not to discover whether the
        method works (that has been settled by 17 years of learners), but to
        add the resolution to know whether <em>this individual</em> is on
        track and to anchor future external validation against an internal
        empirical baseline.
      </p>
      <p>
        The two coloured anchors on the chart above will become the first
        calibration points for the CEFR-via-calibration layer described in
        spec §10. Once the population spans enough learners past both
        anchors, the (difficulty, execution) trajectories of those learners
        define the "entry-conversational" and "≈ B1" clusters — labels
        derived from SSi's own observations, not imposed from an external
        framework.
      </p>
      <p class="explainer-foot">
        Want to dig in? Read
        <code>docs/methodology/metrics-architecture.md §2</code> and
        <code>§10 step 2a</code>.
      </p>
    </FrostCard>
  </div>
</template>

<style scoped>
.empirical-baseline {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ---------------- Page header ---------------- */
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.title-block { display: flex; flex-direction: column; gap: 4px; max-width: 820px; }

.kicker {
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-fg-2, #5a615f);
}

.page-title {
  font-family: 'Arsenal', serif;
  font-size: 32px;
  line-height: 1.08;
  letter-spacing: -0.01em;
  margin: 4px 0 6px;
}

.page-sub {
  margin: 0;
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--schools-fg-2, #5a615f);
}

.page-sub strong { color: var(--schools-fg, #0F1212); font-weight: 600; }

/* ---------------- Stats row ---------------- */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.stat-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px 14px;
}

.stat-label {
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--schools-fg-2, #5a615f);
}

.stat-value {
  font-family: 'Arsenal', serif;
  font-size: 28px;
  line-height: 1.1;
  color: var(--schools-fg, #0F1212);
}

.stat-foot {
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 12px;
  color: var(--schools-fg-2, #5a615f);
}

/* ---------------- Chart card ---------------- */
.chart-card {
  padding: 22px 26px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chart-head { display: flex; flex-direction: column; gap: 4px; }
.chart-title { font-family: 'Arsenal', serif; font-size: 20px; margin: 0; }
.chart-sub { margin: 0; font-family: 'Open Sans', system-ui, sans-serif; font-size: 13px; color: var(--schools-fg-2, #5a615f); }

.chart { width: 100%; height: auto; display: block; }

.chart-loading, .chart-error, .chart-empty {
  padding: 40px 0;
  text-align: center;
  font-family: 'Open Sans', system-ui, sans-serif;
  color: var(--schools-fg-2, #5a615f);
  font-size: 13.5px;
}

.chart-error { color: #b21f2d; }

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding-top: 6px;
  border-top: 1px solid var(--schools-border, #e4e2dc);
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 12.5px;
  color: var(--schools-fg-2, #5a615f);
}

.legend-item { display: inline-flex; align-items: center; gap: 8px; }
.legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.anchor-30-dot { background: #FEC902; }
.anchor-100-dot { background: #1d6a2c; }

/* ---------------- Explainer card ---------------- */
.explainer-card { padding: 22px 26px; display: flex; flex-direction: column; gap: 12px; }
.explainer-title { font-family: 'Arsenal', serif; font-size: 20px; margin: 0 0 4px; }
.explainer-card p { margin: 0; font-family: 'Open Sans', system-ui, sans-serif; font-size: 14px; line-height: 1.6; color: var(--schools-fg, #0F1212); }
.explainer-card em { font-style: italic; }
.explainer-foot { color: var(--schools-fg-2, #5a615f); font-size: 13px !important; }
.explainer-foot code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
}
</style>
