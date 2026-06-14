<script setup lang="ts">
// ============================================================================
// boards/DifficultyTurnsBoard.vue — Lens (attention · per-pupil) · Difficulty turns
//
// The FIRST attention-lane board: "who's struggling, who just turned." One data
// fetch, one widget — a table — composed from the B4 curvature sensor.
//
// Mount flow (mirrors ContentFrictionBoard's structure):
//   a. resolveMetric('difficultyTurns', { frame:'world', window }) → TableData
//      (DEMO short-circuits to demoDifficultyTurns(), no RPC call)
//   b. Derive the loudest turn (top struggling row) for annotation + actions
//   c. Hand-author one InsightSpec<'table'> (story + annotate + graded actions)
//   d. Render one <InsightWidget :spec :resolved> in a Frostwell shell
//
// No LLM call. The board authors the story, the row annotation, and the graded
// actions from the shape of the data — the loudest struggling turn.
//
// ADMIN-ONLY surface: rows name learners (PII). It lives only under the already
// admin-gated /admin/insights route — no new route, no learner-facing path.
// ============================================================================
import { ref, computed, onMounted, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { resolveMetric } from '../registry'
import InsightWidget from '../InsightWidget.vue'
import { isInsightDemo, demoDifficultyTurns } from '../data/demo'
import type {
  TableData,
  InsightSpec,
  ResolvedInsight,
  Annotation,
  Action,
} from '../spec'

// ---- client ----------------------------------------------------------------
const { getClient } = useAdminClient()
const client = getClient()

// ---- window control (30d / 90d) — kept minimal, defaults to 30d -----------
const demoMode = isInsightDemo()
const WINDOWS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const
const selectedWindow = ref<'30d' | '90d'>('30d')

// ---- resolved state --------------------------------------------------------
const isLoading = ref(false)
const fetchError = ref<string | null>(null)
const tableData = ref<TableData | null>(null)

const EMPTY_COLUMNS: TableData['columns'] = [
  { key: 'learner', label: 'Learner', align: 'left' },
  { key: 'unit', label: 'LEGO', align: 'left' },
  { key: 'signal', label: 'Signal', align: 'left' },
  { key: 'z', label: 'vs own noise (σ)', align: 'right', format: 'number' },
]

async function fetchTurns(window: '30d' | '90d') {
  isLoading.value = true
  fetchError.value = null
  tableData.value = null
  // ── DEMO MODE (?demo): synthetic turns, no resolver/RPC call. ──
  if (demoMode) {
    tableData.value = demoDifficultyTurns()
    isLoading.value = false
    return
  }
  try {
    const result = await resolveMetric(client, {
      metric: 'difficultyTurns',
      frame: 'world',
      window,
    })
    tableData.value = result as TableData
  } catch (e: unknown) {
    fetchError.value = e instanceof Error ? e.message : 'Failed to load difficulty turns'
    console.error('[DifficultyTurnsBoard]', e)
  } finally {
    isLoading.value = false
  }
}

// ---- derived: the loudest struggling turn (top of list) --------------------
// The resolver already sorts struggling-first by |σ| desc, so the first
// alarm-toned row IS the loudest turn — the one to act on first.
const loudestRow = computed<TableData['rows'][number] | null>(() => {
  const rows = tableData.value?.rows ?? []
  return rows.find((r) => r.tone === 'alarm') ?? rows[0] ?? null
})

const struggCount = computed(() =>
  (tableData.value?.rows ?? []).filter((r) => r.tone === 'alarm').length,
)
const easeCount = computed(() =>
  (tableData.value?.rows ?? []).filter((r) => r.tone === 'good').length,
)

// ---- InsightSpec (hand-authored: story + annotate + graded actions) --------
const tableSpec = computed((): InsightSpec<'table'> => {
  const top = loudestRow.value
  const annots: Annotation[] = top
    ? [{
        at: 'row',
        rowId: top.id,
        tone: top.tone ?? 'alarm',
        note: `Loudest turn: ${top.cells.learner} on ${top.cells.unit} — ${top.cells.signal} (${top.cells.z}σ vs their own noise).`,
      }]
    : []

  const actions: Action[] = []
  if (top) {
    actions.push({
      tier: 'try',
      text: `Message ${top.cells.learner} — they're at the top of the list`,
      owner: 'you',
    })
    actions.push({
      tier: 'investigate',
      text: `Open ${top.cells.learner}'s per-LEGO trajectory`,
      owner: 'you',
      drill: { metric: 'difficultyTurns', frame: 'group', entityId: String(top.cells.learner), window: selectedWindow.value },
    })
    actions.push({
      tier: 'together',
      text: `Review the sticky LEGO (${top.cells.unit}) with them`,
      owner: 'you+claude',
    })
  }

  return {
    widget: 'table',
    query: { metric: 'difficultyTurns', frame: 'world', window: selectedWindow.value },
    frame: 'world',
    title: "Who's struggling, who just turned",
    story:
      `The B4 curvature sensor reads each learner's persisted per-(learner, LEGO) ` +
      `latency series and flags the turns: "Struggling ↑" is response latency bending ` +
      `upward past that learner's own noise; "Easing ↓" is the latency settling back down. ` +
      `σ is measured against the learner's own baseline, not the cohort — so the signal is ` +
      `personal, not a comparison. Admin-only, because the rows name learners.`,
    annotate: annots,
    tag: 'attention · per-pupil',
    actions,
  }
})

// ---- ResolvedInsight bundle the wrapper expects ----------------------------
const resolved = computed((): ResolvedInsight => ({
  data: tableData.value ?? { kind: 'table', columns: EMPTY_COLUMNS, rows: [] },
  isLoading: isLoading.value,
  error: fetchError.value,
}))

// Empty = no flagged turns AND not loading/erroring (distinct from the wrapper's
// own in-figure empty state — this is the board-level "why might it be empty" note).
const isEmpty = computed(() =>
  !isLoading.value && !fetchError.value && (tableData.value?.rows.length ?? 0) === 0,
)

// ---- lifecycle -------------------------------------------------------------
onMounted(() => fetchTurns(selectedWindow.value))

watch(selectedWindow, (w) => fetchTurns(w))
</script>

<template>
  <section class="dtb">
    <!-- ---- Board header ------------------------------------------------- -->
    <header class="dtb-head">
      <div class="dtb-title-block">
        <span class="dtb-lens-kicker">Attention · per-pupil</span>
        <h2 class="dtb-title">Difficulty turns</h2>
        <p class="dtb-sub">
          Who's struggling, who just turned — the curvature sensor over each
          learner's live latency series.
        </p>
      </div>

      <!-- Window control -->
      <div class="dtb-picker">
        <span class="dtb-picker-label">Window</span>
        <div class="dtb-segs" role="group" aria-label="Time window">
          <button
            v-for="w in WINDOWS"
            :key="w.value"
            type="button"
            :class="['dtb-seg', { active: selectedWindow === w.value }]"
            :aria-pressed="selectedWindow === w.value"
            :disabled="isLoading"
            @click="selectedWindow = w.value"
          >{{ w.label }}</button>
        </div>
      </div>
    </header>

    <!-- ---- Summary line (only when we have flagged turns) --------------- -->
    <p v-if="!isLoading && !fetchError && !isEmpty" class="dtb-summary">
      <strong>{{ struggCount }}</strong> struggling
      <span class="dtb-sep">·</span>
      <strong>{{ easeCount }}</strong> easing
      <span class="dtb-sep">·</span>
      sorted loudest-first
    </p>

    <!-- ---- The table widget -------------------------------------------- -->
    <div class="dtb-cell">
      <InsightWidget :spec="tableSpec" :resolved="resolved" />
    </div>

    <!-- ---- Board-level empty note -------------------------------------- -->
    <!--
      The widget renders its own "No data in this window yet" state; this quiet
      note below explains WHY it might be empty (the curve hasn't bent, or the
      migration/latency series isn't there yet) without shouting an error.
    -->
    <div v-if="isEmpty" class="dtb-empty-note">
      <p class="dtb-empty-lead">
        No difficulty turns in this window — nobody's curve has bent past their own
        noise yet.
      </p>
      <p class="dtb-empty-fine">
        This needs the <code>analytics_difficulty_turns</code> migration applied,
        plus at least one learner with a real (or synthetic) latency series of
        ≥5 samples. Append <code>?demo</code> to preview the board with synthetic
        turns.
      </p>
    </div>
  </section>
</template>

<style scoped>
/* ---- Board shell --------------------------------------------------------- */
.dtb {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1280px;
  margin: 0 auto;
}

/* ---- Header ------------------------------------------------------------- */
.dtb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.dtb-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dtb-lens-kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
}

.dtb-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  margin: 0;
}

.dtb-sub {
  font-size: 13.5px;
  color: var(--ink-muted);
  margin: 0;
  max-width: 44rem;
}

/* ---- Window control (segmented) ----------------------------------------- */
.dtb-picker {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.dtb-picker-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
}

.dtb-segs {
  display: inline-flex;
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 10px;
  overflow: hidden;
}

.dtb-seg {
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

.dtb-seg + .dtb-seg {
  border-left: 1px solid rgba(44, 38, 34, 0.12);
}

.dtb-seg:hover:not(.active):not(:disabled) {
  color: var(--ink-primary);
}

.dtb-seg.active {
  background: rgba(var(--tone-red), 0.10);
  color: rgba(var(--tone-red), 1);
}

.dtb-seg:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ---- Summary line ------------------------------------------------------- */
.dtb-summary {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--ink-muted);
  margin: 0;
}

.dtb-summary strong {
  color: var(--ink-primary);
  font-weight: 600;
}

.dtb-sep {
  margin: 0 6px;
  opacity: 0.5;
}

/* ---- Widget cell -------------------------------------------------------- */
.dtb-cell {
  min-width: 0;
}

/* ---- Board-level empty note --------------------------------------------- */
.dtb-empty-note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 22px;
  background: var(--card-bg, #fff);
  border: 1px dashed rgba(44, 38, 34, 0.18);
  border-radius: 14px;
}

.dtb-empty-lead {
  font-size: 14px;
  color: var(--ink-secondary);
  margin: 0;
}

.dtb-empty-fine {
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ink-muted);
  margin: 0;
}

.dtb-empty-fine code {
  font-family: var(--font-mono);
  background: color-mix(in srgb, var(--ink-primary) 6%, transparent);
  padding: 1px 5px;
  border-radius: 5px;
  color: var(--ink-secondary);
}

/* ---- Responsive --------------------------------------------------------- */
@media (max-width: 860px) {
  .dtb-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
