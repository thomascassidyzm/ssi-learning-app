<script setup lang="ts">
// ============================================================================
// boards/CoverageBoard.vue — Lens (coverage · class-as-learner) · Coverage
//
// The SECOND lane of the teaching-insights product (tutor-insights.md §2–§3):
// "the class is itself a learner." You measure the class the way you measure a
// learner — coverage, pace, dosage, efficiency — and roll it up to leaders.
//
// Three widgets, one data fetch (mirrors ContentFrictionBoard's structure):
//   1. Table       — per-class league (Class · Course · Coverage · Pace · min/wk · Efficiency)
//   2. RankedBar   — classes by PACE (the headline), derived from the table
//   3. NarrativeCard — the fastest / slowest read + graded actions
//
// Mount flow:
//   a. resolveMetric('coverage', { frame:'group', window }) → TableData
//      (DEMO short-circuits to demoCoverage(), no RPC call — fully renderable
//       with ZERO database access)
//   b. Derive the pace ranked-bar + fastest/slowest from the resolved table
//   c. Hand-author InsightSpecs (story + annotate + graded actions)
//   d. Render three <InsightWidget :spec :resolved> panels in a Frostwell grid
//
// No LLM call. The board authors the story from the shape of the data — the
// fastest class (celebrate) and the stalled class (look into).
//
// Coverage is a group-by over class_sessions by the CLEAN class_id, so teacher
// churn never breaks the curve and the lane is independent of the Lane B
// teacher_user_id cleanup (§3).
// ============================================================================
import { ref, computed, onMounted, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { resolveMetric } from '../registry'
import InsightWidget from '../InsightWidget.vue'
import { isInsightDemo, demoCoverage } from '../data/demo'
import type {
  TableData,
  RankedBarData,
  NarrativeCardData,
  InsightSpec,
  ResolvedInsight,
  Annotation,
  Action,
  Tone,
} from '../spec'

// ---- client ----------------------------------------------------------------
const { getClient } = useAdminClient()
const client = getClient()

// ---- window control (30d / 90d) — coverage reads over wall-clock, defaults 90d
const demoMode = isInsightDemo()
const WINDOWS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const
const selectedWindow = ref<'30d' | '90d'>('90d')

// ---- resolved state --------------------------------------------------------
const isLoading = ref(false)
const fetchError = ref<string | null>(null)
const tableData = ref<TableData | null>(null)

const EMPTY_COLUMNS: TableData['columns'] = [
  { key: 'class', label: 'Class', align: 'left' },
  { key: 'course', label: 'Course', align: 'left' },
  { key: 'coverage', label: 'Coverage', align: 'left' },
  { key: 'pace', label: 'Pace (LEGOs/wk)', align: 'right', format: 'number' },
  { key: 'dosage', label: 'Active min/wk', align: 'right', format: 'number' },
  { key: 'efficiency', label: 'Efficiency (LEGOs/min)', align: 'right', format: 'number' },
]

async function fetchCoverage(window: '30d' | '90d') {
  isLoading.value = true
  fetchError.value = null
  tableData.value = null
  // ── DEMO MODE (?demo): synthetic classes, no resolver/RPC call. ──
  if (demoMode) {
    tableData.value = demoCoverage()
    isLoading.value = false
    return
  }
  try {
    const result = await resolveMetric(client, {
      metric: 'coverage',
      frame: 'group',
      window,
    })
    tableData.value = result as TableData
  } catch (e: unknown) {
    fetchError.value = e instanceof Error ? e.message : 'Failed to load coverage'
    console.error('[CoverageBoard]', e)
  } finally {
    isLoading.value = false
  }
}

// ---- derived: fastest / slowest class (table is already pace-sorted desc) ---
const rows = computed<TableData['rows']>(() => tableData.value?.rows ?? [])
const fastest = computed<TableData['rows'][number] | null>(() => rows.value[0] ?? null)
const slowest = computed<TableData['rows'][number] | null>(() =>
  rows.value.length > 0 ? rows.value[rows.value.length - 1] : null,
)
const classCount = computed(() => rows.value.length)

// ---- derived: RankedBarData — classes by PACE (the headline metric) --------
const rankedBarData = computed<RankedBarData>(() => {
  if (rows.value.length === 0) {
    return { kind: 'ranked-bar', bars: [], unit: 'LEGOs / week', horizontal: true }
  }
  const bars = rows.value.map((r) => ({
    id: r.id,
    label: String(r.cells.class),
    value: Number(r.cells.pace) || 0,
    tone: (r.tone ?? 'neutral') as Tone,
  }))
  return { kind: 'ranked-bar', bars, unit: 'LEGOs / week', horizontal: true }
})

// ---- derived: NarrativeCardData -------------------------------------------
const narrativeData = computed<NarrativeCardData>(() => {
  const f = fastest.value
  if (!f) {
    return {
      kind: 'narrative-card',
      moved: 'coverage lane · the class as a learner',
      headline: 'No class coverage yet for this window.',
    }
  }
  return {
    kind: 'narrative-card',
    moved: 'coverage lane · pace over wall-clock = the headline',
    headline: `${f.cells.class} leads at ${f.cells.pace} LEGOs/wk`,
    metricLabel: 'fastest class · pace',
    metricValue: `${f.cells.pace} LEGOs/wk`,
  }
})

// ---- InsightSpecs (hand-authored: story + annotate + graded actions) -------

const tableSpec = computed((): InsightSpec<'table'> => {
  const f = fastest.value
  const s = slowest.value
  const annots: Annotation[] = []
  if (f) {
    annots.push({
      at: 'row',
      rowId: f.id,
      tone: 'good',
      note: `Fastest: ${f.cells.class} — ${f.cells.pace} LEGOs/wk, ${f.cells.efficiency} LEGOs/min. Skipping ahead reads as mastery here, not missing data.`,
    })
  }
  if (s && s.id !== f?.id && s.tone === 'alarm') {
    annots.push({
      at: 'row',
      rowId: s.id,
      tone: 'alarm',
      note: `Stalled: ${s.cells.class} — ${s.cells.pace} LEGOs/wk. Coverage isn't advancing over wall-clock.`,
    })
  }

  const actions: Action[] = []
  if (s && s.tone === 'alarm') {
    actions.push({
      tier: 'investigate',
      text: `Open ${s.cells.class}'s record — coverage isn't moving`,
      owner: 'you',
      drill: { metric: 'coverage', frame: 'group', entityId: s.id, window: selectedWindow.value },
    })
  }
  if (f) {
    actions.push({
      tier: 'together',
      text: `Celebrate ${f.cells.class} — top pace this window`,
      owner: 'you',
    })
  }

  return {
    widget: 'table',
    query: { metric: 'coverage', frame: 'group', window: selectedWindow.value },
    frame: 'group',
    title: 'Each class as a learner — coverage, pace, dosage, efficiency',
    story:
      `The class is a first-class learner-equivalent. Coverage is the furthest LEGO it has reached; ` +
      `pace is that advance over wall-clock (LEGOs/week — the headline); dosage is active minutes/week ` +
      `(flow rate, not a vanity total); efficiency is LEGOs per active-minute. A group-by over ` +
      `class_sessions by the clean class_id, so teacher churn never breaks the curve.`,
    annotate: annots,
    tag: 'table · coverage',
    actions,
  }
})

const rankedBarSpec = computed((): InsightSpec<'ranked-bar'> => {
  const f = fastest.value
  const s = slowest.value
  const annots: Annotation[] = []
  if (f) {
    annots.push({ at: 'datum', key: f.id, tone: 'good', note: `${f.cells.class} sets the pace.` })
  }
  if (s && s.id !== f?.id && s.tone === 'alarm') {
    annots.push({ at: 'datum', key: s.id, tone: 'alarm', note: `${s.cells.class} is stalled.` })
  }

  const actions: Action[] = []
  if (f) {
    actions.push({
      tier: 'together',
      text: `Celebrate the top-pace class (${f.cells.class})`,
      owner: 'you',
    })
  }
  if (s && s.tone === 'alarm') {
    actions.push({
      tier: 'investigate',
      text: `Look into the stalled class (${s.cells.class})`,
      owner: 'you',
      drill: { metric: 'coverage', frame: 'group', entityId: s.id, window: selectedWindow.value },
    })
  }

  return {
    widget: 'ranked-bar',
    query: { metric: 'coverage', frame: 'group', window: selectedWindow.value },
    frame: 'group',
    title: 'Which class is advancing fastest? — pace league',
    story:
      `Pace is coverage over wall-clock (LEGOs/week) — the leadership headline when you're ` +
      `accountable for many classes. A fast, healthy curve is a teacher who keeps the class moving ` +
      `to new items; a flat bar is a class that has stopped advancing.`,
    annotate: annots,
    tag: 'ranked-bar · coverage',
    actions,
  }
})

const narrativeSpec = computed((): InsightSpec<'narrative-card'> => {
  const f = fastest.value
  const s = slowest.value

  const annots: Annotation[] = []
  if (f) {
    annots.push({
      at: 'datum',
      key: 'fastest',
      tone: 'good',
      note: `${f.cells.class} — ${f.cells.pace} LEGOs/wk at ${f.cells.dosage} min/wk.`,
    })
  }
  if (s && s.id !== f?.id) {
    annots.push({
      at: 'datum',
      key: 'slowest',
      tone: s.tone === 'alarm' ? 'alarm' : 'warn',
      note: `${s.cells.class} — ${s.cells.pace} LEGOs/wk. The contrast is the leadership question.`,
    })
  }

  const actions: Action[] = []
  if (f) {
    actions.push({
      tier: 'together',
      text: `Celebrate ${f.cells.class} — top-pace class this window`,
      owner: 'you',
    })
  }
  if (s && s.tone === 'alarm') {
    actions.push({
      tier: 'investigate',
      text: `Open ${s.cells.class}'s record — is it dosage or pacing?`,
      owner: 'you',
      drill: { metric: 'coverage', frame: 'group', entityId: s.id, window: selectedWindow.value },
    })
  }
  actions.push({
    tier: 'try',
    text: 'Roll this up to group / school — same query, higher GROUP BY',
    owner: 'you+claude',
  })

  return {
    widget: 'narrative-card',
    query: { metric: 'coverage', frame: 'group', window: selectedWindow.value },
    frame: 'group',
    title: 'The class-as-learner read',
    story:
      `Two classes at the same coverage but very different minutes tell a leader two different ` +
      `stories — that contrast (efficiency) is the leadership question. The class is durable: it ` +
      `accrues across every session whoever drove it, so this read survives teacher churn.`,
    annotate: annots,
    actions,
    tag: 'narrative · coverage',
  }
})

// ---- ResolvedInsight bundles the wrapper expects ---------------------------
const tableResolved = computed((): ResolvedInsight => ({
  data: tableData.value ?? { kind: 'table', columns: EMPTY_COLUMNS, rows: [] },
  isLoading: isLoading.value,
  error: fetchError.value,
}))

const rankedBarResolved = computed((): ResolvedInsight => ({
  data: rankedBarData.value,
  isLoading: isLoading.value,
  error: fetchError.value,
}))

const narrativeResolved = computed((): ResolvedInsight => ({
  data: narrativeData.value,
  isLoading: isLoading.value,
  error: fetchError.value,
}))

// Board-level empty: not loading/erroring and zero classes (distinct from the
// wrapper's in-figure empty — this explains WHY the real path may be empty).
const isEmpty = computed(() =>
  !isLoading.value && !fetchError.value && rows.value.length === 0,
)

// ---- lifecycle -------------------------------------------------------------
onMounted(() => fetchCoverage(selectedWindow.value))

watch(selectedWindow, (w) => fetchCoverage(w))
</script>

<template>
  <section class="cvb">
    <!-- ---- Board header ------------------------------------------------- -->
    <header class="cvb-head">
      <div class="cvb-title-block">
        <span class="cvb-lens-kicker">Lens · coverage</span>
        <h2 class="cvb-title">Coverage</h2>
        <p class="cvb-sub">
          Each class is a learner — pace, dosage, and efficiency over wall-clock.
          Read by its teacher and the leaders above; skipping ahead reads as mastery, not missing data.
        </p>
      </div>

      <!-- Window control -->
      <div class="cvb-picker">
        <span class="cvb-picker-label">Window</span>
        <div class="cvb-segs" role="group" aria-label="Time window">
          <button
            v-for="w in WINDOWS"
            :key="w.value"
            type="button"
            :class="['cvb-seg', { active: selectedWindow === w.value }]"
            :aria-pressed="selectedWindow === w.value"
            :disabled="isLoading"
            @click="selectedWindow = w.value"
          >{{ w.label }}</button>
        </div>
      </div>
    </header>

    <!-- ---- Summary line (only when we have classes) -------------------- -->
    <p v-if="!isLoading && !fetchError && !isEmpty" class="cvb-summary">
      <strong>{{ classCount }}</strong> classes
      <span class="cvb-sep">·</span>
      sorted by pace
      <template v-if="fastest">
        <span class="cvb-sep">·</span>
        fastest <strong>{{ fastest.cells.class }}</strong>
      </template>
    </p>

    <!-- ---- Widget grid -------------------------------------------------- -->
    <div class="cvb-grid">
      <!-- Widget 1: Table — per-class league (spans full width) -->
      <div class="cvb-cell cvb-span">
        <InsightWidget :spec="tableSpec" :resolved="tableResolved" />
      </div>

      <!-- Widget 2: RankedBar — classes by pace -->
      <div class="cvb-cell">
        <InsightWidget :spec="rankedBarSpec" :resolved="rankedBarResolved" />
      </div>

      <!-- Widget 3: NarrativeCard — fastest / slowest read + actions -->
      <div class="cvb-cell">
        <InsightWidget :spec="narrativeSpec" :resolved="narrativeResolved" />
      </div>
    </div>

    <!-- ---- Board-level empty note -------------------------------------- -->
    <div v-if="isEmpty" class="cvb-empty-note">
      <p class="cvb-empty-lead">
        No class coverage in this window yet.
      </p>
      <p class="cvb-empty-fine">
        The real-data path needs the <code>analytics_class_coverage</code> migration
        applied — a group-by over the existing <code>class_sessions</code> rows (no new
        event instrumentation). Append <code>?demo</code> to preview the board now with
        synthetic classes.
      </p>
    </div>
  </section>
</template>

<style scoped>
/* ---- Board shell --------------------------------------------------------- */
.cvb {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1280px;
  margin: 0 auto;
}

/* ---- Header ------------------------------------------------------------- */
.cvb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.cvb-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cvb-lens-kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
}

.cvb-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  margin: 0;
}

.cvb-sub {
  font-size: 13.5px;
  color: var(--ink-muted);
  margin: 0;
  max-width: 44rem;
}

/* ---- Window control (segmented) ----------------------------------------- */
.cvb-picker {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.cvb-picker-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
}

.cvb-segs {
  display: inline-flex;
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 10px;
  overflow: hidden;
}

.cvb-seg {
  appearance: none;
  background: var(--card-bg, #fff);
  border: none;
  padding: 8px 14px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.cvb-seg + .cvb-seg {
  border-left: 1px solid rgba(44, 38, 34, 0.12);
}

.cvb-seg:hover:not(.active):not(:disabled) {
  color: var(--ink-primary);
}

.cvb-seg.active {
  background: rgba(var(--tone-red), 0.10);
  color: rgba(var(--tone-red), 1);
}

.cvb-seg:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ---- Summary line ------------------------------------------------------- */
.cvb-summary {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--ink-muted);
  margin: 0;
}

.cvb-summary strong {
  color: var(--ink-primary);
  font-weight: 600;
}

.cvb-sep {
  margin: 0 6px;
  opacity: 0.5;
}

/* ---- Widget grid --------------------------------------------------------- */
.cvb-grid {
  display: grid;
  grid-template-columns: 55fr 45fr;
  gap: 20px;
}

.cvb-cell {
  min-width: 0;
}

/* Full-width row — the table spans both columns */
.cvb-span {
  grid-column: 1 / -1;
}

/* ---- Board-level empty note --------------------------------------------- */
.cvb-empty-note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 22px;
  background: var(--card-bg, #fff);
  border: 1px dashed rgba(44, 38, 34, 0.18);
  border-radius: 14px;
}

.cvb-empty-lead {
  font-size: 14px;
  color: var(--ink-secondary);
  margin: 0;
}

.cvb-empty-fine {
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ink-muted);
  margin: 0;
}

.cvb-empty-fine code {
  font-family: var(--font-mono);
  background: color-mix(in srgb, var(--ink-primary) 6%, transparent);
  padding: 1px 5px;
  border-radius: 5px;
  color: var(--ink-secondary);
}

/* ---- Responsive --------------------------------------------------------- */
@media (max-width: 860px) {
  .cvb-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .cvb-grid {
    grid-template-columns: 1fr;
  }

  .cvb-span {
    grid-column: 1;
  }
}
</style>
