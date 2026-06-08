<script setup lang="ts">
// ============================================================================
// boards/HealthStrip.vue — Lens B (ops) health board
//
// Renders three InsightWidget panels from a single analytics_health() call:
//
//   1. STAT    — audio_failed rate headline + cache-hit rate stat (two tiles side-by-side)
//   2. STAT    — build-SHA spread donut ("is my fix live?")
//   3. TIME-SERIES — failure rate trend over the selected window
//
// Board responsibilities (not the wrapper's):
//   · call resolveHealthFull() once on mount with useAdminClient().getClient()
//   · map the HealthPayload into InsightSpec + ResolvedInsight per widget
//   · hand-author story + annotate + actions (NO LLM call)
//   · render with Frostwell grid, loading skeleton, empty state
//
// The four behaviours (annotatable / interrogable / sovereign / action-terminated)
// are entirely owned by <InsightWidget>. This board is presentation-only once
// the data is resolved.
// ============================================================================
import { ref, computed, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { resolveHealthFull } from '../data/health'
import type { HealthPayload } from '../data/health'
import type {
  AnyInsightSpec, ResolvedInsight,
  StatData, TimeSeriesData,
  Tone,
} from '../spec'
import InsightWidget from '../InsightWidget.vue'
import { isInsightDemo, demoHealth } from '../data/demo'

// ---- window selector -------------------------------------------------------
const WINDOWS = ['7d', '14d', '30d'] as const
type W = typeof WINDOWS[number]
const selectedWindow = ref<W>('30d')

// ---- data fetch ------------------------------------------------------------
const isLoading = ref(false)
const fetchError = ref<string | null>(null)
const payload = ref<HealthPayload | null>(null)

const { getClient } = useAdminClient()

async function fetch(win: W = selectedWindow.value) {
  isLoading.value = true
  fetchError.value = null
  // ── DEMO MODE (?demo): synthetic health payload, no Supabase call. ──
  if (isInsightDemo()) {
    const days = parseInt(win, 10) || 30
    payload.value = demoHealth(days)
    isLoading.value = false
    return
  }
  try {
    const client = getClient()
    payload.value = await resolveHealthFull(client, { metric: 'health', window: win })
  } catch (e: unknown) {
    fetchError.value = e instanceof Error ? e.message : 'Failed to load health data.'
    payload.value = null
  } finally {
    isLoading.value = false
  }
}

onMounted(() => fetch())

function onWindowChange(w: W) {
  selectedWindow.value = w
  fetch(w)
}

// ---- derived tones ---------------------------------------------------------
function failTone(pct: number): Tone {
  if (pct >= 5) return 'alarm'
  if (pct >= 2) return 'warn'
  return 'good'
}

function cacheTone(rate: number): Tone {
  // rate is 0-1; <50% is alarming, <80% is warn, else good
  if (rate < 0.5) return 'alarm'
  if (rate < 0.8) return 'warn'
  return 'good'
}

// ============================================================================
// WIDGET 1 — Failure-rate stat tile
// ============================================================================
const failRateSpec = computed<AnyInsightSpec>(() => {
  const p = payload.value
  const failPct = p?.overallFailRatePct ?? 0
  const t = failTone(failPct)
  return {
    widget: 'stat',
    query: { metric: 'health', window: selectedWindow.value },
    frame: 'world',
    tag: 'health · stat',
    title: 'Is audio breaking?',
    story: failPct === 0
      ? 'No failures recorded in this window — system is clean.'
      : failPct < 2
        ? `${failPct}% failure rate — within acceptable threshold. Monitor.`
        : failPct < 5
          ? `${failPct}% failure rate — elevated. Investigate device breakdown.`
          : `${failPct}% failure rate — critical. Ship a hotfix.`,
    annotate: t !== 'good'
      ? [{ at: 'datum' as const, key: 'Audio failure rate', note: t === 'alarm' ? 'Critical: exceeds 5% threshold' : 'Elevated: exceeds 2% warn floor', tone: t }]
      : [],
    actions: [
      {
        tier: 'try' as const,
        text: 'Check device breakdown in the full table below',
        owner: 'you' as const,
      },
      ...(failPct >= 5
        ? [{
            tier: 'investigate' as const,
            text: 'Correlate spike with latest deploy SHA in the donut',
            owner: 'you+claude' as const,
          }]
        : []),
      ...(failPct >= 5
        ? [{
            tier: 'together' as const,
            text: 'Emergency patch: rollback or hotfix the failing audio proxy',
            owner: 'product' as const,
          }]
        : []),
    ],
  }
})

const failRateResolved = computed<ResolvedInsight>(() => {
  if (isLoading.value) return { data: { kind: 'stat', label: 'Audio failure rate', value: 0, unit: '%' }, isLoading: true, error: null }
  if (fetchError.value) return { data: { kind: 'stat', label: 'Audio failure rate', value: 0, unit: '%' }, isLoading: false, error: fetchError.value }
  const p = payload.value
  const d: StatData = p?.stat ?? { kind: 'stat', label: 'Audio failure rate', value: 0, unit: '%' }
  return { data: d, isLoading: false, error: null }
})

// ============================================================================
// WIDGET 2 — Cache-hit rate stat tile
// ============================================================================
const cacheHitSpec = computed<AnyInsightSpec>(() => {
  const p = payload.value
  const rate = p?.cacheHitRate ?? 0
  const pct = Math.round(rate * 1000) / 10
  const t = cacheTone(rate)
  return {
    widget: 'stat',
    query: { metric: 'health', window: selectedWindow.value },
    frame: 'world',
    tag: 'health · cache',
    title: 'Is the audio cache warm?',
    story: pct >= 80
      ? `${pct}% cache hit rate — prefetcher is working. Learners hear audio from local cache, not the network.`
      : pct >= 50
        ? `${pct}% cache hit rate — moderate. Rolling buffer may not be expanding fast enough.`
        : `${pct}% cache hit rate — cold. Every play hits the network. Check the buffer filler.`,
    annotate: t !== 'good'
      ? [{ at: 'datum' as const, key: 'Cache hit rate', note: t === 'alarm' ? 'Cache cold — network load is high' : 'Cache below 80% target', tone: t }]
      : [],
    actions: [
      {
        tier: 'try' as const,
        text: 'Confirm the rolling buffer is expanding past the 3-round bootstrap',
        owner: 'you' as const,
      },
      ...(rate < 0.8
        ? [{
            tier: 'investigate' as const,
            text: 'Check fillBuffer / expandScript wiring (SimplePlayer.prefetchNextCycle + per-cycle resolver)',
            owner: 'you+claude' as const,
          }]
        : []),
    ],
  }
})

const cacheHitResolved = computed<ResolvedInsight>(() => {
  if (isLoading.value) return { data: { kind: 'stat', label: 'Cache hit rate', value: 0, unit: '%' }, isLoading: true, error: null }
  if (fetchError.value) return { data: { kind: 'stat', label: 'Cache hit rate', value: 0, unit: '%' }, isLoading: false, error: fetchError.value }
  const p = payload.value
  const rate = p?.cacheHitRate ?? 0
  const pct = Math.round(rate * 1000) / 10
  const t = cacheTone(rate)
  const d: StatData = {
    kind: 'stat',
    label: 'Cache hit rate',
    value: pct,
    unit: '%',
    delta: undefined,
    deltaTone: t,
  }
  return { data: d, isLoading: false, error: null }
})

// ============================================================================
// WIDGET 3 — Build-SHA spread donut (is my fix live?)
// ============================================================================
const shaDonutSpec = computed<AnyInsightSpec>(() => {
  const p = payload.value
  const spread = p?.buildShaSpread ?? []
  // The leading (highest-learner) SHA is the one we annotate as "current"
  const leadSha = spread[0]?.version?.slice(0, 8) ?? ''
  const leadPct = p?.stat?.donut?.[0]?.value ?? 0
  const leadTone = p?.stat?.donut?.[0]?.tone ?? 'neutral'
  return {
    widget: 'stat',
    query: { metric: 'health', window: selectedWindow.value, dimensions: { view: 'sha-spread' } },
    frame: 'world',
    tag: 'health · build',
    title: 'Is my fix live?',
    story: leadSha
      ? `${leadPct}% of active learners are on build ${leadSha}. Slices with alarm tone are builds with a high failure rate.`
      : 'No build spread data yet — learner events needed.',
    annotate: leadSha && leadTone !== 'good'
      ? [{ at: 'datum' as const, key: leadSha, note: `Leading build has ${leadTone === 'alarm' ? 'critical' : 'elevated'} failure rate`, tone: leadTone }]
      : [],
    actions: [
      {
        tier: 'try' as const,
        text: 'Check that the latest deploy SHA dominates the donut',
        owner: 'you' as const,
      },
      ...(spread.length > 1
        ? [{
            tier: 'investigate' as const,
            text: 'Old SHAs still showing? Force-update the service worker on staging',
            owner: 'you' as const,
          }]
        : []),
    ],
  }
})

const shaDonutResolved = computed<ResolvedInsight>(() => {
  if (isLoading.value) return { data: { kind: 'stat', label: 'Build-SHA spread', value: 0 }, isLoading: true, error: null }
  if (fetchError.value) return { data: { kind: 'stat', label: 'Build-SHA spread', value: 0 }, isLoading: false, error: fetchError.value }
  const p = payload.value
  // Use the donut-enriched stat from the full payload
  const base = p?.stat
  if (!base) return { data: { kind: 'stat', label: 'Build-SHA spread', value: 0 }, isLoading: false, error: null }
  // Build a stat purely about the build spread; headline = leading build share
  const leadSlice = base.donut?.[0]
  const d: StatData = {
    kind: 'stat',
    label: 'Build-SHA spread',
    value: leadSlice?.value ?? 0,
    unit: '%',
    donut: base.donut,
  }
  return { data: d, isLoading: false, error: null }
})

// ============================================================================
// WIDGET 4 — Failure-rate time-series trend
// ============================================================================
const trendSpec = computed<AnyInsightSpec>(() => {
  const p = payload.value
  const trend = p?.failureTrend ?? []
  // Find the day with the highest failure rate to annotate it
  const peakDay = trend.reduce(
    (best, d) => d.failRatePct > (best?.failRatePct ?? -1) ? d : best,
    null as typeof trend[0] | null,
  )
  const overallPct = p?.overallFailRatePct ?? 0
  const t = failTone(overallPct)

  const annotate = peakDay && peakDay.failRatePct > 0
    ? [{
        at: 'point' as const,
        series: 'Failure rate %',
        x: peakDay.day,
        note: `Peak: ${peakDay.failRatePct}% on ${peakDay.day}`,
        tone: failTone(peakDay.failRatePct),
      }]
    : []

  return {
    widget: 'time-series',
    query: { metric: 'health', window: selectedWindow.value },
    frame: 'world',
    tag: 'health · trend',
    title: 'Failure rate over time',
    story: trend.length === 0
      ? 'No trend data yet.'
      : t === 'good'
        ? `Failure rate held below 2% across the ${selectedWindow.value} window — healthy.`
        : t === 'warn'
          ? `Failure rate averaged ${overallPct}% — watch for a trend break.`
          : `Elevated failure rate (${overallPct}%) across the window. Compare peaks to deploy dates.`,
    annotate,
    actions: [
      {
        tier: 'try' as const,
        text: 'Hover the peak point and cross-reference with the deploy log',
        owner: 'you' as const,
      },
      ...(t !== 'good'
        ? [{
            tier: 'investigate' as const,
            text: 'Drill into failure_by_device to isolate iOS vs Android vs desktop',
            owner: 'you+claude' as const,
          }]
        : []),
    ],
  }
})

const trendResolved = computed<ResolvedInsight>(() => {
  if (isLoading.value) {
    return {
      data: { kind: 'time-series', x: [], series: [], yLabel: 'Failure rate %' },
      isLoading: true,
      error: null,
    }
  }
  if (fetchError.value) {
    return {
      data: { kind: 'time-series', x: [], series: [], yLabel: 'Failure rate %' },
      isLoading: false,
      error: fetchError.value,
    }
  }
  const p = payload.value
  const trend = p?.failureTrend ?? []
  const overallPct = p?.overallFailRatePct ?? 0
  const d: TimeSeriesData = {
    kind: 'time-series',
    x: trend.map(r => r.day),
    series: trend.length > 0
      ? [{
          name: 'Failure rate %',
          points: trend.map(r => r.failRatePct),
          tone: failTone(overallPct),
        }]
      : [],
    yLabel: 'Failure rate %',
  }
  return { data: d, isLoading: false, error: null }
})
</script>

<template>
  <div class="health-strip">
    <!-- ── Board header ─────────────────────────────────────────── -->
    <header class="hs-head">
      <div class="hs-title-block">
        <span class="hs-eyebrow">Lens B · Ops</span>
        <h2 class="hs-title">Platform Health</h2>
        <p class="hs-sub">Audio reliability, cache warmth &amp; build rollout</p>
      </div>

      <!-- Window selector -->
      <div class="hs-window-row" role="group" aria-label="Time window">
        <button
          v-for="w in WINDOWS"
          :key="w"
          type="button"
          class="hs-win-btn"
          :class="{ 'is-active': selectedWindow === w }"
          @click="onWindowChange(w)"
        >
          {{ w }}
        </button>
      </div>
    </header>

    <!-- ── Top row: stat tiles (fail rate + cache hit + SHA donut) ── -->
    <div class="hs-stat-row">
      <InsightWidget :spec="failRateSpec" :resolved="failRateResolved" />
      <InsightWidget :spec="cacheHitSpec" :resolved="cacheHitResolved" />
      <InsightWidget :spec="shaDonutSpec" :resolved="shaDonutResolved" />
    </div>

    <!-- ── Trend panel (full-width) ─────────────────────────────── -->
    <div class="hs-trend-row">
      <InsightWidget :spec="trendSpec" :resolved="trendResolved" />
    </div>

    <!-- ── Device breakdown table (supplemental, no InsightWidget chrome) ── -->
    <div v-if="payload && payload.deviceSpread.length" class="hs-device-panel">
      <p class="hs-panel-label">Failure rate by device</p>
      <div class="hs-device-table-wrap">
        <table class="hs-device-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Learners</th>
              <th>Fail %</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in payload.deviceSpread"
              :key="row.device"
              :class="{
                'row-alarm': failTone(row.failRatePct) === 'alarm',
                'row-warn': failTone(row.failRatePct) === 'warn',
              }"
            >
              <td class="col-device">{{ row.device || '—' }}</td>
              <td class="col-num">{{ row.learners }}</td>
              <td class="col-num col-fail">{{ row.failRatePct }}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Empty state (no data at all) ─────────────────────────── -->
    <div
      v-if="!isLoading && !fetchError && payload && payload.totalPlays === 0"
      class="hs-empty"
    >
      <span class="hs-empty-icon">◎</span>
      <span class="hs-empty-text">No audio events in the {{ selectedWindow }} window yet. Play some rounds to see health data.</span>
    </div>
  </div>
</template>

<style scoped>
/* ── Board shell ─────────────────────────────────────────────────────── */
.health-strip {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 4px;
}

/* ── Header ──────────────────────────────────────────────────────────── */
.hs-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.hs-title-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hs-eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
  font-weight: 600;
}

.hs-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  margin: 0;
}

.hs-sub {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-muted);
  margin: 0;
}

/* ── Window picker ───────────────────────────────────────────────────── */
.hs-window-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hs-win-btn {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 5px 13px;
  border-radius: 999px;
  border: 1px solid rgba(44, 38, 34, 0.14);
  background: transparent;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.hs-win-btn:hover {
  background: rgba(44, 38, 34, 0.05);
  color: var(--ink-primary);
}
.hs-win-btn.is-active {
  background: var(--ink-primary);
  color: #fff;
  border-color: var(--ink-primary);
}

/* ── Stat row (3 tiles) ──────────────────────────────────────────────── */
.hs-stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

/* ── Trend row (full-width) ─────────────────────────────────────────── */
.hs-trend-row {
  width: 100%;
}

/* ── Device breakdown panel ─────────────────────────────────────────── */
.hs-device-panel {
  background: var(--glass-bg, rgba(255, 255, 255, 0.62));
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 14px;
  padding: 18px 22px 20px;
  box-shadow: var(--glass-shadow, 0 1px 4px rgba(44, 38, 34, 0.06));
}

.hs-panel-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin: 0 0 12px;
}

.hs-device-table-wrap {
  overflow-x: auto;
}

.hs-device-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-primary);
}
.hs-device-table th {
  text-align: left;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
  padding: 0 12px 8px 0;
  border-bottom: 1px solid rgba(44, 38, 34, 0.10);
  font-weight: 500;
}
.hs-device-table td {
  padding: 9px 12px 9px 0;
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
  vertical-align: middle;
}
.col-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.col-fail {
  font-weight: 600;
}
.row-alarm .col-fail { color: rgba(var(--tone-red), 1); }
.row-warn .col-fail { color: rgba(var(--tone-gold), 1); }

/* ── Empty state ────────────────────────────────────────────────────── */
.hs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 32px;
  border: 1px dashed rgba(44, 38, 34, 0.18);
  border-radius: 14px;
  text-align: center;
}
.hs-empty-icon {
  font-size: 32px;
  color: var(--ink-faint);
  line-height: 1;
}
.hs-empty-text {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-muted);
  max-width: 400px;
  line-height: 1.6;
}

/* ── Responsive: collapse stat row to single column on narrow panes ── */
@media (max-width: 900px) {
  .hs-stat-row {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 600px) {
  .hs-stat-row {
    grid-template-columns: 1fr;
  }
  .hs-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
