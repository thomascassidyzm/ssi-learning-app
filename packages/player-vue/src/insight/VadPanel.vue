<script setup lang="ts">
// ============================================================================
// VadPanel — the ONE Voice & pause renderer.
//
// Lifted verbatim out of boards/VadBoard.vue when VAD stopped being admin-only
// (founder ruling 2026-08-20: VAD follows the ordinary visibility hierarchy).
// There are now two data doors — the admin board's whole-forest read and the
// node surfaces' hierarchy-scoped one — and deliberately ONE renderer, because
// two copies of an honesty rule is precisely where the honesty rots.
//
// THE HONESTY REQUIREMENT (the whole point of the panel):
//   Roughly half the learners carry NO row at all in the VAD-fed tables — not
//   zeros, nothing. Not everyone ends up with their own account and a working
//   mic. That is UPTAKE, and uptake is part of the insight, not missing data.
//   So the first thing rendered is the fraction, and every aggregate below
//   states the denominator it was actually taken over. A scope with nobody
//   renders the empty state, never a zeroed board.
//
// It takes a SUMMARY, not a data source: the caller fetches (by whichever door
// its viewer is entitled to) and shapes with summariseVad, so this file has no
// opinion about who is allowed to see what. That opinion lives server-side, in
// api/_utils/vadVisibility.ts, once.
// ============================================================================
import { computed } from 'vue'
import InsightWidget from './InsightWidget.vue'
import { summariseVad, latencyBins, type VadSummary, type MetricRow, type ProsodyAgg } from './data/vadUptake'
import type { InsightSpec, ResolvedInsight, RankedBarData, DistributionData, TableData } from './spec'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

/** A class row for the class-by-class breakdown. Omit to hide that table. */
export interface VadPanelClass {
  classId: string
  className: string
  courseCode: string | null
  learnerIds: string[]
}

const props = withDefaults(defineProps<{
  summary: VadSummary | null
  /** Human label for the scope, used in every "over N learners in X" sentence. */
  scopeLabel: string
  isLoading?: boolean
  error?: string | null
  /** When present, the class-by-class table renders (summarised with the same fn). */
  classes?: VadPanelClass[]
  /** Needed only to summarise the class rows — the same maps the summary came from. */
  names?: Map<string, string>
  metricsByLearner?: Map<string, MetricRow[]>
  prosodyByLearner?: Map<string, ProsodyAgg>
  /** true when the server capped its read — stated, never implied away. */
  truncated?: boolean
}>(), {
  isLoading: false,
  error: null,
  classes: () => [],
  truncated: false,
})

const emit = defineEmits<{ (e: 'open-learner', learnerId: string): void }>()

const hasAnyData = computed(() => (props.summary?.withData ?? 0) > 0)
const uptakePct = computed(() => {
  const u = props.summary?.uptake
  return u === null || u === undefined ? null : Math.round(u * 100)
})

const fmt1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(1))
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)

// ---- widget 1: mastery mix (ranked bar) ------------------------------------
const masterySpec = computed((): InsightSpec<'ranked-bar'> => ({
  widget: 'ranked-bar',
  query: { metric: 'vadMastery', frame: 'world' },
  frame: 'world',
  title: t('insights.vad.masteryTitle', 'Adaptive pause mastery, across the learners who have mic data'),
  story: t(
    'insights.vad.masteryStory',
    "Each bar counts (learner, LEGO) pairs the adaptive pause engine has a state for, over the {withData} learners in {scope} carrying mic-derived data — not all {total} on the roster. A LEGO climbs acquisition → consolidating → confident → mastered as the learner's responses come back smooth and fast enough, run after run.",
  )
    .replace('{withData}', String(props.summary?.withData ?? 0))
    .replace('{scope}', props.scopeLabel)
    .replace('{total}', String(props.summary?.total ?? 0)),
  tag: t('insights.vad.tagAttentionVoice', 'attention · voice'),
  actions: [],
}))
const masteryResolved = computed((): ResolvedInsight => {
  const m = props.summary?.mastery
  const data: RankedBarData = {
    kind: 'ranked-bar',
    unit: 'LEGOs',
    horizontal: true,
    bars: m
      ? [
          { id: 'mastered', label: t('insights.vad.masteryMastered', 'Mastered'), value: m.mastered, tone: 'good' },
          { id: 'confident', label: t('insights.vad.masteryConfident', 'Confident'), value: m.confident, tone: 'good' },
          { id: 'consolidating', label: t('insights.vad.masteryConsolidating', 'Consolidating'), value: m.consolidating, tone: 'neutral' },
          { id: 'acquisition', label: t('insights.vad.masteryAcquisition', 'Acquisition'), value: m.acquisition, tone: 'warn' },
        ]
      : [],
  }
  return { data, isLoading: props.isLoading, error: props.error }
})

// ---- widget 2: latency spread (distribution) -------------------------------
const latencySpec = computed((): InsightSpec<'distribution'> => ({
  widget: 'distribution',
  query: { metric: 'vadLatency', frame: 'world' },
  frame: 'world',
  title: t('insights.vad.latencyTitle', 'How long they take to start speaking'),
  story: t(
    'insights.vad.latencyStory',
    'One point per learner: their mean response latency NORMALISED by phrase length — milliseconds per character of the target, which is how the engine compares a short word against a long sentence. Higher is slower. Over {n} learners with a latency series, not the whole roster.',
  ).replace('{n}', String(props.summary?.learnerLatencies.length ?? 0)),
  tag: t('insights.vad.tagAttentionVoice', 'attention · voice'),
  actions: [],
}))
const latencyResolved = computed((): ResolvedInsight => {
  const values = props.summary?.learnerLatencies ?? []
  const data: DistributionData = {
    kind: 'distribution',
    unit: 'ms/char',
    bins: latencyBins(values).map(b => ({ ...b, tone: 'neutral' as const })),
    mean: props.summary?.medianLatency ?? undefined,
  }
  return { data, isLoading: props.isLoading, error: props.error }
})

// ---- widget 3: uptake by class (table) -------------------------------------
const showClassTable = computed(() => (props.classes?.length ?? 0) > 1 && !!props.metricsByLearner)
const classTableSpec = computed((): InsightSpec<'table'> => ({
  widget: 'table',
  query: { metric: 'vadUptake', frame: 'world' },
  frame: 'world',
  title: t('insights.vad.classTableTitle', 'Uptake, class by class'),
  story: t(
    'insights.vad.classTableStory',
    '"With mic data" is how many learners in the class have ANY row in the VAD-fed tables. The rest have none at all — no account, no mic, or never a voiced cycle — so they are counted here rather than averaged in as zeros anywhere else on this board.',
  ),
  tag: t('insights.vad.tagAttentionVoice', 'attention · voice'),
  actions: [],
}))
// A computed, not a constant: read once at setup these six column headings
// would freeze in English, because the locale chunk is still loading then.
const CLASS_COLUMNS = computed<TableData['columns']>(() => [
  { key: 'cls', label: t('insights.vad.columnClass', 'Class'), align: 'left' },
  { key: 'course', label: t('insights.vad.columnCourse', 'Course'), align: 'left' },
  { key: 'uptake', label: t('insights.vad.columnWithMicData', 'With mic data'), align: 'left' },
  { key: 'share', label: t('insights.vad.columnShare', 'Share'), align: 'right', format: 'percent' },
  { key: 'legos', label: t('insights.vad.columnLegoSeries', 'LEGO series'), align: 'right', format: 'number' },
  { key: 'latency', label: t('insights.vad.columnMedianMsChar', 'Median ms/char'), align: 'right', format: 'number' },
])
const classTableResolved = computed((): ResolvedInsight => {
  const rows: TableData['rows'] = []
  const names = props.names
  const metrics = props.metricsByLearner
  const prosody = props.prosodyByLearner
  if (names && metrics && prosody) {
    for (const cls of props.classes ?? []) {
      const s = summariseVad(cls.learnerIds, names, metrics, prosody)
      rows.push({
        id: cls.classId,
        tone: s.withData === 0 ? 'warn' : 'neutral',
        cells: {
          cls: cls.className,
          course: cls.courseCode ?? '—',
          uptake: t('insights.vad.classTableUptakeCell', '{withData} of {total}').replace('{withData}', String(s.withData)).replace('{total}', String(s.total)),
          share: s.uptake === null ? 0 : Math.round(s.uptake * 100),
          legos: s.legoSeries,
          latency: s.medianLatency === null ? 0 : Number(s.medianLatency.toFixed(1)),
        },
      })
    }
    rows.sort((a, b) => Number(b.cells.share) - Number(a.cells.share))
  }
  return {
    data: { kind: 'table', columns: CLASS_COLUMNS.value, rows } as TableData,
    isLoading: props.isLoading,
    error: props.error,
  }
})
</script>

<template>
  <div class="vad-panel-root">
    <!-- ---- Loading / error ----------------------------------------------- -->
    <p v-if="isLoading" class="vad-note">{{ t('insights.vad.readingTables', 'Reading the VAD tables…') }}</p>
    <p v-else-if="error" class="vad-note vad-note-err">{{ error }}</p>

    <template v-else-if="summary">
      <!-- ---- UPTAKE — the honesty tile, first and biggest ---------------- -->
      <div class="vad-uptake">
        <div class="vad-uptake-figure">
          <span class="vad-uptake-num">{{ summary.withData }}</span>
          <span class="vad-uptake-of">{{ t('insights.vad.ofTotal', 'of {total}').replace('{total}', String(summary.total)) }}</span>
          <span class="vad-uptake-pct" v-if="uptakePct !== null">{{ uptakePct }}%</span>
        </div>
        <p class="vad-uptake-read">
          {{ t('insights.vad.uptakeReadIntro', '{withData} of the {total} learners in {scope} have mic-derived data. The other {rest} have no row at all in the VAD-fed tables — not zeros, nothing.')
            .replace('{withData}', String(summary.withData)).replace('{total}', String(summary.total))
            .replace('{scope}', scopeLabel).replace('{rest}', String(summary.total - summary.withData)) }}
          <template v-if="hasAnyData">
            {{ t('insights.vad.uptakeReadHasData', 'They are never averaged into anything below: every figure here is taken over the {withData} who do have data.').replace('{withData}', String(summary.withData)) }}
          </template>
          <template v-else>
            {{ t('insights.vad.uptakeReadNoData', 'So there is nothing to average, and nothing below pretends otherwise.') }}
          </template>
        </p>
        <p class="vad-uptake-fine">
          {{ t('insights.vad.uptakeFine', '{legos} per-LEGO latency series · {events} prosody events from {withProsody} learners')
            .replace('{legos}', String(summary.legoSeries)).replace('{events}', String(summary.prosody.events)).replace('{withProsody}', String(summary.withProsody)) }}
          <template v-if="truncated"> {{ t('insights.vad.uptakeFineCapped', '· capped read, so these are a floor, not a total') }}</template>
        </p>
      </div>

      <!-- ---- Empty scope ------------------------------------------------ -->
      <div v-if="!hasAnyData" class="vad-empty">
        <p class="vad-empty-lead">
          {{ t('insights.vad.emptyLead', 'No learner in {scope} has mic-derived data yet.').replace('{scope}', scopeLabel) }}
        </p>
        <p class="vad-empty-fine">
          {{ t('insights.vad.emptyFine', 'Nothing is broken and nothing is being hidden: no learner here has produced a single voiced cycle the VAD could measure, so there is no distribution to draw.') }}
        </p>
      </div>

      <template v-else>
        <!-- ---- Mastery + latency --------------------------------------- -->
        <div class="vad-grid">
          <div class="vad-cell"><InsightWidget :spec="masterySpec" :resolved="masteryResolved" /></div>
          <div class="vad-cell"><InsightWidget :spec="latencySpec" :resolved="latencyResolved" /></div>
        </div>

        <!-- ---- Prosody ------------------------------------------------- -->
        <section class="vad-panel">
          <header class="vad-panel-head">
            <h3 class="vad-panel-title">{{ t('insights.vad.howTheySound', 'How they sound') }}</h3>
            <p v-if="summary.prosody.available" class="vad-panel-sub">
              {{ t('insights.vad.prosodyAvailablePart1', 'Straight off the {events}').replace('{events}', String(summary.prosody.events)) }}
              <code>cycle_prosody</code>
              {{ t('insights.vad.prosodyAvailablePart2', 'events from {learners} learners. Only what the envelope payload actually carries — nothing inferred.').replace('{learners}', String(summary.prosody.learners)) }}
            </p>
            <p v-else class="vad-panel-sub vad-panel-gap">
              {{ t('insights.vad.prosodyUnavailablePart1', "Prosody is unavailable right now — the server read didn't answer, and") }}
              <code>player_events</code>
              {{ t('insights.vad.prosodyUnavailablePart2', "is own-row under RLS so the browser can't read it directly. This is a stated gap, not a set of zeroes.") }}
            </p>
          </header>
          <dl v-if="summary.prosody.available" class="vad-metrics">
            <div class="vad-metric">
              <dt>{{ t('insights.vad.peakLoudness', 'Peak loudness') }}</dt>
              <dd>{{ fmt1(summary.prosody.meanPeakEnergyDb) }} <span class="u">dB</span></dd>
              <p class="vad-metric-fine">{{ t('insights.vad.peakLoudnessFine', "mean of each cycle's loudest moment") }}</p>
            </div>
            <div class="vad-metric">
              <dt>{{ t('insights.vad.averageLoudness', 'Average loudness') }}</dt>
              <dd>{{ fmt1(summary.prosody.meanAverageEnergyDb) }} <span class="u">dB</span></dd>
              <p class="vad-metric-fine">{{ t('insights.vad.averageLoudnessFine', 'mean across the whole speaking window') }}</p>
            </div>
            <div class="vad-metric">
              <dt>{{ t('insights.vad.burstsPerCycle', 'Bursts per cycle') }}</dt>
              <dd>{{ fmt1(summary.prosody.meanPeakCount) }}</dd>
              <p class="vad-metric-fine">{{ t('insights.vad.burstsPerCycleFine', 'separate peaks in the energy envelope') }}</p>
            </div>
            <div class="vad-metric">
              <dt>{{ t('insights.vad.jumpedInEarly', 'Jumped in early') }}</dt>
              <dd>{{ pct(summary.prosody.startedDuringPromptRate) }}</dd>
              <p class="vad-metric-fine">
                {{ t('insights.vad.jumpedInEarlyFine', 'started speaking before the prompt finished · over {n} events').replace('{n}', String(summary.prosody.startedDuringPromptBase)) }}
              </p>
            </div>
            <div class="vad-metric">
              <dt>{{ t('insights.vad.stillGoingAtVoice1', 'Still going at voice 1') }}</dt>
              <dd>{{ pct(summary.prosody.stillSpeakingRate) }}</dd>
              <p class="vad-metric-fine">
                {{ t('insights.vad.stillGoingAtVoice1Fine', "hadn't finished when the model spoke · over {n} events").replace('{n}', String(summary.prosody.stillSpeakingBase)) }}
              </p>
            </div>
          </dl>
        </section>

        <!-- ---- Class breakdown ----------------------------------------- -->
        <div v-if="showClassTable" class="vad-cell">
          <InsightWidget :spec="classTableSpec" :resolved="classTableResolved" />
        </div>

        <!-- ---- Per-learner rows, click through ------------------------- -->
        <section class="vad-panel">
          <header class="vad-panel-head">
            <h3 class="vad-panel-title">{{ t('insights.vad.learnersWhoHaveData', 'The learners who have data') }}</h3>
            <p class="vad-panel-sub">
              {{ t('insights.vad.learnersWhoHaveDataSub', "{n} of {total} in {scope}. Click a row for that learner's own adaptive-pause read.")
                .replace('{n}', String(summary.learners.length)).replace('{total}', String(summary.total)).replace('{scope}', scopeLabel) }}
            </p>
          </header>
          <table class="vad-table">
            <thead>
              <tr>
                <th>{{ t('insights.vad.colLearner', 'Learner') }}</th>
                <th class="r">{{ t('insights.vad.colLegosTracked', 'LEGOs tracked') }}</th>
                <th class="r">{{ t('insights.vad.colMastered', 'Mastered') }}</th>
                <th class="r">{{ t('insights.vad.colMsChar', 'ms/char') }}</th>
                <th class="r">{{ t('insights.vad.colProsodyEvents', 'Prosody events') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="l in summary.learners"
                :key="l.learnerId"
                class="vad-row"
                tabindex="0"
                @click="emit('open-learner', l.learnerId)"
                @keyup.enter="emit('open-learner', l.learnerId)"
              >
                <td>{{ l.name }}</td>
                <td class="r">{{ l.legos }}</td>
                <td class="r">{{ l.mastered }}</td>
                <td class="r">{{ fmt1(l.meanLatency) }}</td>
                <td class="r">{{ l.prosodyEvents }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.vad-panel-root { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

/* ---- Notes -------------------------------------------------------------- */
.vad-note {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-muted);
  margin: 0;
}
.vad-note-err { color: rgba(var(--tone-red), 1); }

/* ---- Uptake tile -------------------------------------------------------- */
.vad-uptake {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px 24px;
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 16px;
}
.vad-uptake-figure { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.vad-uptake-num {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 46px;
  line-height: 1;
  color: var(--ink-primary);
}
.vad-uptake-of {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--ink-muted);
}
.vad-uptake-pct {
  font-family: var(--font-mono);
  font-size: 15px;
  color: rgba(var(--tone-red), 1);
  margin-left: 4px;
}
.vad-uptake-read {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-secondary);
  margin: 0;
  max-width: 68ch;
}
.vad-uptake-read strong { color: var(--ink-primary); font-weight: 600; }
.vad-uptake-fine {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink-muted);
  margin: 0;
}

/* ---- Empty state -------------------------------------------------------- */
.vad-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 22px;
  background: var(--card-bg, #fff);
  border: 1px dashed rgba(44, 38, 34, 0.18);
  border-radius: 14px;
}
.vad-empty-lead { font-size: 14px; color: var(--ink-secondary); margin: 0; }
.vad-empty-fine {
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ink-muted);
  margin: 0;
  max-width: 70ch;
}

/* ---- Widget grid -------------------------------------------------------- */
.vad-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 18px;
}
.vad-cell { min-width: 0; }

/* ---- Panels ------------------------------------------------------------- */
.vad-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 22px;
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 16px;
}
.vad-panel-head { display: flex; flex-direction: column; gap: 4px; }
.vad-panel-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 18px;
  color: var(--ink-primary);
  margin: 0;
}
.vad-panel-sub {
  font-size: 13px;
  color: var(--ink-muted);
  margin: 0;
  max-width: 68ch;
}
.vad-panel-gap { color: rgba(var(--tone-red), 1); }
.vad-panel-sub code {
  font-family: var(--font-mono);
  background: color-mix(in srgb, var(--ink-primary) 6%, transparent);
  padding: 1px 5px;
  border-radius: 5px;
}

/* ---- Prosody metrics ---------------------------------------------------- */
.vad-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin: 0;
}
.vad-metric { display: flex; flex-direction: column; gap: 2px; }
.vad-metric dt {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.vad-metric dd {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 26px;
  line-height: 1.1;
  color: var(--ink-primary);
  margin: 0;
}
.vad-metric dd .u {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 400;
  color: var(--ink-muted);
}
.vad-metric-fine {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--ink-muted);
  margin: 0;
}

/* ---- Learner table ------------------------------------------------------ */
.vad-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.vad-table th {
  text-align: left;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  font-weight: 400;
  padding: 0 10px 8px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.10);
}
.vad-table th.r, .vad-table td.r { text-align: right; }
.vad-table td {
  padding: 9px 10px;
  color: var(--ink-secondary);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}
.vad-row { cursor: pointer; transition: background 120ms ease; }
.vad-row:hover, .vad-row:focus-visible { background: rgba(var(--tone-red), 0.05); }
.vad-row:hover td:first-child { color: var(--ink-primary); }

@media (max-width: 860px) {
  .vad-grid { grid-template-columns: 1fr; }
}
</style>
