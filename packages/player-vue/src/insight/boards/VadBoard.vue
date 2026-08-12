<script setup lang="ts">
// ============================================================================
// boards/VadBoard.vue — Lens (attention · voice) · Voice & pause
//
// The FIRST class/school-level read of the VAD / prosody telemetry. Until this
// board, the only surface showing it was the per-learner admin page ("Adaptive
// pause mastery"), one learner at a time — so there was no way to look at a
// class and ask "is this working, and for how many of them?"
//
// THE HONESTY REQUIREMENT (the whole point of the board):
//   Roughly half the learners carry NO row at all in the VAD-fed tables — not
//   zeros, nothing. Not everyone ends up with their own account and a working
//   mic. That is UPTAKE, and uptake is part of the insight, not missing data.
//   So the first thing on the board is the fraction, and every aggregate below
//   states the denominator it was actually taken over.
//
// DIRECT READ, deliberately: see data/vadUptake.ts — the analytics_* rollups
// exclude demo learners by policy, so an aggregate built on them shows nothing.
// This board reads learner_lego_metrics and player_events directly, the way the
// per-learner admin page does. The exclusion policy is untouched.
//
// PROSODY COMES FROM THE SERVER, everything else from the browser: player_events
// is own-row under RLS for admins too, so a client read of another learner's
// cycle_prosody returns nothing. GET /api/admin/vad-prosody is the
// server-mediated door. If it fails, the panel SAYS it failed.
//
// ADMIN-ONLY surface: the learner table names learners (PII). It lives only
// under the already admin-gated /admin/stats route — no new route, no new gate.
// ============================================================================
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import InsightWidget from '../InsightWidget.vue'
import {
  fetchVadRoster,
  summariseVad,
  latencyBins,
  type SchoolScope,
  type VadRosterPayload,
  type VadSummary,
} from '../data/vadUptake'
import type { InsightSpec, ResolvedInsight, RankedBarData, DistributionData, TableData } from '../spec'

const { getClient, getAuthToken } = useAdminClient()
const router = useRouter()

const isLoading = ref(true)
const fetchError = ref<string | null>(null)
const roster = ref<VadRosterPayload | null>(null)
const selectedSchoolId = ref<string | null>(null)
const selectedClassId = ref<string | null>(null)   // null = whole school

// ---- load ------------------------------------------------------------------
onMounted(async () => {
  try {
    const payload = await fetchVadRoster(getClient(), await getAuthToken())
    roster.value = payload
    // Open on the school with the MOST learners carrying VAD data, so the board
    // lands populated rather than on whichever school sorts first. Flagged as a
    // taste default — the picker moves it in one click.
    let best: SchoolScope | null = null
    let bestCount = -1
    for (const s of payload.scopes) {
      const n = s.learnerIds.filter(id => payload.metricsByLearner.has(id)).length
      if (n > bestCount) { bestCount = n; best = s }
    }
    selectedSchoolId.value = best?.schoolId ?? null
  } catch (e: unknown) {
    fetchError.value = e instanceof Error ? e.message : 'Failed to load VAD telemetry'
    console.error('[VadBoard]', e)
  } finally {
    isLoading.value = false
  }
})

// ---- scope -----------------------------------------------------------------
const schools = computed<SchoolScope[]>(() => roster.value?.scopes ?? [])
const school = computed<SchoolScope | null>(
  () => schools.value.find(s => s.schoolId === selectedSchoolId.value) ?? null,
)
const scopeLearnerIds = computed<string[]>(() => {
  if (!school.value) return []
  if (!selectedClassId.value) return school.value.learnerIds
  return school.value.classes.find(c => c.classId === selectedClassId.value)?.learnerIds ?? []
})
const scopeLabel = computed(() => {
  if (!school.value) return '—'
  if (!selectedClassId.value) return school.value.schoolName
  const cls = school.value.classes.find(c => c.classId === selectedClassId.value)
  return cls ? `${cls.className} · ${school.value.schoolName}` : school.value.schoolName
})

function selectSchool(id: string) {
  selectedSchoolId.value = id
  selectedClassId.value = null
}

// ---- summary ---------------------------------------------------------------
const summary = computed<VadSummary | null>(() => {
  const r = roster.value
  if (!r) return null
  return summariseVad(scopeLearnerIds.value, r.names, r.metricsByLearner, r.prosodyByLearner)
})

const hasAnyData = computed(() => (summary.value?.withData ?? 0) > 0)
const uptakePct = computed(() => {
  const u = summary.value?.uptake
  return u === null || u === undefined ? null : Math.round(u * 100)
})

const fmt1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(1))
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)

// ---- widget 1: mastery mix (ranked bar) ------------------------------------
const masterySpec = computed((): InsightSpec<'ranked-bar'> => ({
  widget: 'ranked-bar',
  query: { metric: 'vadMastery', frame: 'world' },
  frame: 'world',
  title: 'Adaptive pause mastery, across the learners who have mic data',
  story:
    `Each bar counts (learner, LEGO) pairs the adaptive pause engine has a state for, ` +
    `over the ${summary.value?.withData ?? 0} learner${(summary.value?.withData ?? 0) === 1 ? '' : 's'} ` +
    `in ${scopeLabel.value} carrying mic-derived data — not all ${summary.value?.total ?? 0} on the roster. ` +
    `A LEGO climbs acquisition → consolidating → confident → mastered as the learner's ` +
    `responses come back smooth and fast enough, run after run.`,
  tag: 'attention · voice',
  actions: [],
}))
const masteryResolved = computed((): ResolvedInsight => {
  const m = summary.value?.mastery
  const data: RankedBarData = {
    kind: 'ranked-bar',
    unit: 'LEGOs',
    horizontal: true,
    bars: m
      ? [
          { id: 'mastered', label: 'Mastered', value: m.mastered, tone: 'good' },
          { id: 'confident', label: 'Confident', value: m.confident, tone: 'good' },
          { id: 'consolidating', label: 'Consolidating', value: m.consolidating, tone: 'neutral' },
          { id: 'acquisition', label: 'Acquisition', value: m.acquisition, tone: 'warn' },
        ]
      : [],
  }
  return { data, isLoading: isLoading.value, error: fetchError.value }
})

// ---- widget 2: latency spread (distribution) -------------------------------
const latencySpec = computed((): InsightSpec<'distribution'> => ({
  widget: 'distribution',
  query: { metric: 'vadLatency', frame: 'world' },
  frame: 'world',
  title: 'How long they take to start speaking',
  story:
    `One point per learner: their mean response latency NORMALISED by phrase length — ` +
    `milliseconds per character of the target, which is how the engine compares a short ` +
    `word against a long sentence. Higher is slower. Over ` +
    `${summary.value?.learnerLatencies.length ?? 0} learner${(summary.value?.learnerLatencies.length ?? 0) === 1 ? '' : 's'} ` +
    `with a latency series, not the whole roster.`,
  tag: 'attention · voice',
  actions: [],
}))
const latencyResolved = computed((): ResolvedInsight => {
  const values = summary.value?.learnerLatencies ?? []
  const data: DistributionData = {
    kind: 'distribution',
    unit: 'ms/char',
    bins: latencyBins(values).map(b => ({ ...b, tone: 'neutral' as const })),
    mean: summary.value?.medianLatency ?? undefined,
  }
  return { data, isLoading: isLoading.value, error: fetchError.value }
})

// ---- widget 3: uptake by class (table) -------------------------------------
const classTableSpec = computed((): InsightSpec<'table'> => ({
  widget: 'table',
  query: { metric: 'vadUptake', frame: 'world' },
  frame: 'world',
  title: 'Uptake, class by class',
  story:
    `"With mic data" is how many learners in the class have ANY row in the VAD-fed ` +
    `tables. The rest have none at all — no account, no mic, or never a voiced cycle — ` +
    `so they are counted here rather than averaged in as zeros anywhere else on this board.`,
  tag: 'attention · voice',
  actions: [],
}))
const CLASS_COLUMNS: TableData['columns'] = [
  { key: 'cls', label: 'Class', align: 'left' },
  { key: 'course', label: 'Course', align: 'left' },
  { key: 'uptake', label: 'With mic data', align: 'left' },
  { key: 'share', label: 'Share', align: 'right', format: 'percent' },
  { key: 'legos', label: 'LEGO series', align: 'right', format: 'number' },
  { key: 'latency', label: 'Median ms/char', align: 'right', format: 'number' },
]
const classTableResolved = computed((): ResolvedInsight => {
  const r = roster.value
  const rows: TableData['rows'] = []
  if (r && school.value) {
    for (const cls of school.value.classes) {
      const s = summariseVad(cls.learnerIds, r.names, r.metricsByLearner, r.prosodyByLearner)
      rows.push({
        id: cls.classId,
        tone: s.withData === 0 ? 'warn' : 'neutral',
        cells: {
          cls: cls.className,
          course: cls.courseCode ?? '—',
          uptake: `${s.withData} of ${s.total}`,
          share: s.uptake === null ? 0 : Math.round(s.uptake * 100),
          legos: s.legoSeries,
          latency: s.medianLatency === null ? 0 : Number(s.medianLatency.toFixed(1)),
        },
      })
    }
    rows.sort((a, b) => Number(b.cells.share) - Number(a.cells.share))
  }
  return {
    data: { kind: 'table', columns: CLASS_COLUMNS, rows } as TableData,
    isLoading: isLoading.value,
    error: fetchError.value,
  }
})

// ---- per-learner rows (native table — the widget Table emits nothing, and
// these rows must click through to the per-learner page that already renders) --
function openLearner(learnerId: string) {
  router.push(`/admin/users/${learnerId}`)
}
</script>

<template>
  <section class="vad">
    <!-- ---- Board header ------------------------------------------------- -->
    <header class="vad-head">
      <div class="vad-title-block">
        <span class="vad-lens-kicker">Attention · voice</span>
        <h2 class="vad-title">Voice &amp; pause</h2>
        <p class="vad-sub">
          What the microphone is actually giving us — how many learners have
          mic-derived data at all, and for those who do, how the adaptive pause
          is settling and how they sound.
        </p>
      </div>

      <div v-if="schools.length" class="vad-picker">
        <label class="vad-picker-label" for="vad-school">School</label>
        <select
          id="vad-school"
          class="vad-select"
          :value="selectedSchoolId ?? ''"
          @change="selectSchool(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in schools" :key="s.schoolId" :value="s.schoolId">{{ s.schoolName }}</option>
        </select>
      </div>
    </header>

    <!-- ---- Scope: whole school or one class ---------------------------- -->
    <nav v-if="school" class="vad-scopes" aria-label="Scope">
      <button
        type="button"
        :class="['vad-chip', { active: selectedClassId === null }]"
        @click="selectedClassId = null"
      >Whole school</button>
      <button
        v-for="c in school.classes"
        :key="c.classId"
        type="button"
        :class="['vad-chip', { active: selectedClassId === c.classId }]"
        @click="selectedClassId = c.classId"
      >{{ c.className }}</button>
    </nav>

    <!-- ---- Loading / error --------------------------------------------- -->
    <p v-if="isLoading" class="vad-note">Reading the VAD tables…</p>
    <p v-else-if="fetchError" class="vad-note vad-note-err">{{ fetchError }}</p>

    <template v-else-if="summary">
      <!-- ---- UPTAKE — the honesty tile, first and biggest -------------- -->
      <div class="vad-uptake">
        <div class="vad-uptake-figure">
          <span class="vad-uptake-num">{{ summary.withData }}</span>
          <span class="vad-uptake-of">of {{ summary.total }}</span>
          <span class="vad-uptake-pct" v-if="uptakePct !== null">{{ uptakePct }}%</span>
        </div>
        <p class="vad-uptake-read">
          <strong>{{ summary.withData }} of the {{ summary.total }} learners</strong> in
          {{ scopeLabel }} have mic-derived data. The other
          {{ summary.total - summary.withData }} have no row at all in the VAD-fed
          tables — not zeros, nothing.
          <template v-if="hasAnyData">
            They are never averaged into anything below: every figure on this board is
            taken over the {{ summary.withData }} who do have data.
          </template>
          <template v-else>
            So there is nothing to average, and nothing below pretends otherwise.
          </template>
        </p>
        <p class="vad-uptake-fine">
          {{ summary.legoSeries }} per-LEGO latency series ·
          {{ summary.prosody.events }} prosody events from
          {{ summary.withProsody }} learner{{ summary.withProsody === 1 ? '' : 's' }}
        </p>
      </div>

      <!-- ---- Empty scope --------------------------------------------- -->
      <div v-if="!hasAnyData" class="vad-empty">
        <p class="vad-empty-lead">
          No learner in {{ scopeLabel }} has mic-derived data yet.
        </p>
        <p class="vad-empty-fine">
          Nothing is broken and nothing is being hidden: no learner here has produced a
          single voiced cycle the VAD could measure, so there is no distribution to draw.
          Pick another class or school above.
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
            <h3 class="vad-panel-title">How they sound</h3>
            <p v-if="summary.prosody.available" class="vad-panel-sub">
              Straight off the {{ summary.prosody.events }} <code>cycle_prosody</code>
              events from {{ summary.prosody.learners }} learner{{ summary.prosody.learners === 1 ? '' : 's' }}.
              Only what the envelope payload actually carries — nothing inferred.
            </p>
            <p v-else class="vad-panel-sub vad-panel-gap">
              Prosody is unavailable right now — <code>/api/admin/vad-prosody</code> didn't
              answer, and <code>player_events</code> is own-row under RLS so the browser
              can't read it directly. This is a stated gap, not a set of zeroes.
            </p>
          </header>
          <dl v-if="summary.prosody.available" class="vad-metrics">
            <div class="vad-metric">
              <dt>Peak loudness</dt>
              <dd>{{ fmt1(summary.prosody.meanPeakEnergyDb) }} <span class="u">dB</span></dd>
              <p class="vad-metric-fine">mean of each cycle's loudest moment</p>
            </div>
            <div class="vad-metric">
              <dt>Average loudness</dt>
              <dd>{{ fmt1(summary.prosody.meanAverageEnergyDb) }} <span class="u">dB</span></dd>
              <p class="vad-metric-fine">mean across the whole speaking window</p>
            </div>
            <div class="vad-metric">
              <dt>Bursts per cycle</dt>
              <dd>{{ fmt1(summary.prosody.meanPeakCount) }}</dd>
              <p class="vad-metric-fine">separate peaks in the energy envelope</p>
            </div>
            <div class="vad-metric">
              <dt>Jumped in early</dt>
              <dd>{{ pct(summary.prosody.startedDuringPromptRate) }}</dd>
              <p class="vad-metric-fine">
                started speaking before the prompt finished · over
                {{ summary.prosody.startedDuringPromptBase }} events
              </p>
            </div>
            <div class="vad-metric">
              <dt>Still going at voice 1</dt>
              <dd>{{ pct(summary.prosody.stillSpeakingRate) }}</dd>
              <p class="vad-metric-fine">
                hadn't finished when the model spoke · over
                {{ summary.prosody.stillSpeakingBase }} events
              </p>
            </div>
          </dl>
        </section>

        <!-- ---- Class breakdown ----------------------------------------- -->
        <div v-if="!selectedClassId" class="vad-cell">
          <InsightWidget :spec="classTableSpec" :resolved="classTableResolved" />
        </div>

        <!-- ---- Per-learner rows, click through ------------------------- -->
        <section class="vad-panel">
          <header class="vad-panel-head">
            <h3 class="vad-panel-title">The learners who have data</h3>
            <p class="vad-panel-sub">
              {{ summary.learners.length }} of {{ summary.total }} in {{ scopeLabel }}.
              Click a row for that learner's own adaptive-pause read.
            </p>
          </header>
          <table class="vad-table">
            <thead>
              <tr>
                <th>Learner</th>
                <th class="r">LEGOs tracked</th>
                <th class="r">Mastered</th>
                <th class="r">ms/char</th>
                <th class="r">Prosody events</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="l in summary.learners"
                :key="l.learnerId"
                class="vad-row"
                tabindex="0"
                @click="openLearner(l.learnerId)"
                @keyup.enter="openLearner(l.learnerId)"
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
  </section>
</template>

<style scoped>
.vad {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1280px;
  margin: 0 auto;
}

/* ---- Header ------------------------------------------------------------- */
.vad-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}
.vad-title-block { display: flex; flex-direction: column; gap: 4px; }
.vad-lens-kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
}
.vad-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  margin: 0;
}
.vad-sub {
  font-size: 13.5px;
  color: var(--ink-muted);
  margin: 0;
  max-width: 44rem;
}

/* ---- School picker ------------------------------------------------------ */
.vad-picker { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.vad-picker-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.vad-select {
  appearance: none;
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 10px;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-primary);
  cursor: pointer;
}

/* ---- Scope chips -------------------------------------------------------- */
.vad-scopes { display: flex; flex-wrap: wrap; gap: 8px; }
.vad-chip {
  appearance: none;
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 999px;
  padding: 6px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.vad-chip:hover:not(.active) { color: var(--ink-primary); }
.vad-chip.active {
  background: rgba(var(--tone-red), 0.10);
  color: rgba(var(--tone-red), 1);
  border-color: rgba(var(--tone-red), 0.3);
}

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

/* ---- Responsive --------------------------------------------------------- */
@media (max-width: 860px) {
  .vad-head { flex-direction: column; align-items: flex-start; }
  .vad-grid { grid-template-columns: 1fr; }
}
</style>
