<script setup lang="ts">
// ============================================================================
// boards/ContentFrictionBoard.vue — Lens B (quality) · Content Friction
//
// Three widgets, one data fetch:
//   1. CohortGrid  — seed-band × friction-dimension heatmap (span full width)
//   2. RankedBar   — top seed-bands by composite friction score
//   3. NarrativeCard — editorial read + graded actions to Popty
//
// Mount flow:
//   a. resolveMetric('contentFriction', { course }) → CohortGridData
//   b. Derive RankedBarData + NarrativeCardData from the resolved CohortGridData
//   c. Build three InsightSpecs with hand-authored story + annotate + actions
//   d. Render three <InsightWidget :spec :resolved> panels in a Frostwell grid
//
// No LLM call. The board authors the story, annotation, and actions from the
// shape of the data — that is, from the highest-friction cell/band.
//
// Friction law: unit-concentrated hot cells = a quality problem (not a learner
// problem). The action terminates in Popty: re-split the LEGO or open the cohort.
// ============================================================================
import { ref, computed, watch, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminCourses } from '@/composables/admin/useAdminCourses'
import { resolveMetric } from '../registry'
import InsightWidget from '../InsightWidget.vue'
import { isInsightDemo, demoCourseList, demoFriction } from '../data/demo'
import { courseDisplayName } from '@ssi/core'
import type {
  CohortGridData,
  RankedBarData,
  NarrativeCardData,
  InsightSpec,
  ResolvedInsight,
  Annotation,
  Action,
} from '../spec'

// ---- client ----------------------------------------------------------------
const { getClient } = useAdminClient()
const client = getClient()

// ---- course picker ---------------------------------------------------------
const demoMode = isInsightDemo()
const coursesComposable = useAdminCourses(client)
const selectedCourse = ref<string>('')

const courseOptions = computed(() =>
  demoMode
    ? demoCourseList()
    : coursesComposable.courses.value.map(c => ({
        value: c.course_code,
        label: c.display_name || courseDisplayName(c.course_code),
      }))
)

const selectedCourseLabel = computed(() =>
  courseOptions.value.find(o => o.value === selectedCourse.value)?.label
    || courseDisplayName(selectedCourse.value))

// ---- resolved state --------------------------------------------------------
const isLoading = ref(false)
const fetchError = ref<string | null>(null)
const gridData = ref<CohortGridData | null>(null)

async function fetchFriction(courseCode: string) {
  if (!courseCode) return
  isLoading.value = true
  fetchError.value = null
  gridData.value = null
  // ── DEMO MODE (?demo): synthetic friction grid, no resolver/RPC call. ──
  if (demoMode) {
    gridData.value = demoFriction(courseCode)
    isLoading.value = false
    return
  }
  try {
    const result = await resolveMetric(client, {
      metric: 'contentFriction',
      course: courseCode,
      frame: 'content',
    })
    gridData.value = result as CohortGridData
  } catch (e: unknown) {
    fetchError.value = e instanceof Error ? e.message : 'Failed to load friction data'
    console.error('[ContentFrictionBoard]', e)
  } finally {
    isLoading.value = false
  }
}

// ---- derived: RankedBarData ------------------------------------------------
// Composite friction score per seed-band = sum of normalised scores across all
// friction dimensions for that band. Captures the "multi-dimension pain" that
// a single-dimension rank misses.
const rankedBarData = computed<RankedBarData>(() => {
  const d = gridData.value
  if (!d || d.cells.length === 0) {
    return { kind: 'ranked-bar', bars: [], unit: 'composite friction (0–400)', horizontal: true }
  }

  // Sum across FRICTION_DIMS per seed-band.
  const bandScores: Map<string, number> = new Map()
  for (const cell of d.cells) {
    bandScores.set(cell.x, (bandScores.get(cell.x) ?? 0) + cell.value)
  }

  // Identify max for tone assignment.
  const maxScore = Math.max(...bandScores.values())

  const bars = [...bandScores.entries()]
    .map(([bandLabel, score]) => ({
      id: bandLabel,
      label: bandLabel,
      value: score,
      tone: score === maxScore ? ('alarm' as const) : score > maxScore * 0.7 ? ('warn' as const) : ('neutral' as const),
    }))
    .sort((a, b) => b.value - a.value)

  return {
    kind: 'ranked-bar',
    bars,
    unit: 'composite friction (0–400)',
    horizontal: true,
  }
})

// ---- derived: hottest cell + hottest band ----------------------------------
// These drive both annotations and the NarrativeCard headline.
const hottestCell = computed<{ x: string; y: string; value: number } | null>(() => {
  const d = gridData.value
  if (!d || d.cells.length === 0) return null
  return d.cells.reduce((best, c) => (c.value > best.value ? c : best), d.cells[0])
})

const hottestBand = computed<string>(() => {
  const bars = rankedBarData.value.bars
  return bars.length > 0 ? bars[0].id : '—'
})

const hottestBandScore = computed<number>(() => {
  const bars = rankedBarData.value.bars
  return bars.length > 0 ? bars[0].value : 0
})

// ---- derived: NarrativeCardData -------------------------------------------
const narrativeData = computed<NarrativeCardData>(() => {
  const hot = hottestCell.value
  const band = hottestBand.value
  if (!hot) {
    return {
      kind: 'narrative-card',
      moved: 'friction law · lens b · content quality',
      headline: 'No friction data yet for this course.',
    }
  }
  return {
    kind: 'narrative-card',
    moved: `friction law · content-concentrated = quality problem`,
    headline: `${hot.y} peaks at ${band} (score ${hot.value})`,
    metricLabel: 'composite friction · hottest band',
    metricValue: String(Math.round(hottestBandScore.value)),
  }
})

// ---- InsightSpecs ----------------------------------------------------------
// Hand-authored: story + annotate + graded actions. No LLM.

const gridSpec = computed((): InsightSpec<'cohort-grid'> => {
  const hot = hottestCell.value
  const annots: Annotation[] = hot
    ? [{ at: 'cell', x: hot.x, y: hot.y, tone: 'alarm', note: `Highest friction: ${hot.y} at ${hot.x} (score ${hot.value} / 100)` }]
    : []

  return {
    widget: 'cohort-grid',
    query: { metric: 'contentFriction', course: selectedCourse.value, frame: 'content' },
    frame: 'content',
    title: 'Where does the curriculum hurt everyone? — friction map',
    story: `Population-wide friction by seed-band × dimension — hot cells are where learners stall regardless of who they are, so they are content problems, not adaptation problems.`,
    annotate: annots,
    tag: 'heatmap · content',
    actions: [
      {
        tier: 'investigate',
        text: 'Open the cohort for this band',
        owner: 'popty',
        drill: { metric: 'contentFriction', course: selectedCourse.value, entityId: hottestBand.value, frame: 'content' },
      },
    ],
  }
})

const rankedBarSpec = computed((): InsightSpec<'ranked-bar'> => {
  const band = hottestBand.value
  const annots: Annotation[] = band !== '—'
    ? [{ at: 'datum', key: band, tone: 'alarm', note: `${band} leads on composite friction — check all four dimensions in the heatmap above.` }]
    : []

  return {
    widget: 'ranked-bar',
    query: { metric: 'contentFriction', course: selectedCourse.value, frame: 'content' },
    frame: 'content',
    title: 'Which seed-band carries the most friction?',
    story: `Composite score = sum of all four normalised friction dimensions (Drop-off + Spike-rate + Skip-back + Audio-failed). A band scoring high on multiple dimensions is the clearest signal for Popty intervention.`,
    annotate: annots,
    tag: 'ranked-bar · content',
    actions: [
      {
        tier: 'try',
        text: `Re-split LEGOs in ${band}`,
        owner: 'popty',
      },
      {
        tier: 'investigate',
        text: 'Open the learner cohort at this band',
        owner: 'popty',
        drill: { metric: 'contentFriction', course: selectedCourse.value, entityId: band, frame: 'content' },
      },
    ],
  }
})

const narrativeSpec = computed((): InsightSpec<'narrative-card'> => {
  const hot = hottestCell.value
  const band = hottestBand.value

  const annots: Annotation[] = []
  if (hot) {
    annots.push({
      at: 'datum',
      key: `${hot.y} · ${hot.x}`,
      tone: 'alarm',
      note: `Score ${hot.value} / 100 — the single loudest signal.`,
    })
    annots.push({
      at: 'band',
      min: 70,
      max: 100,
      axis: 'y',
      tone: 'alarm',
      note: 'Scores above 70 warrant Popty triage',
    })
  }

  const actions: Action[] = [
    {
      tier: 'try',
      text: `Re-split the highest-friction LEGO in ${band}`,
      owner: 'popty',
    },
    {
      tier: 'investigate',
      text: 'Open learner cohort at this band',
      owner: 'popty',
      drill: { metric: 'contentFriction', course: selectedCourse.value, entityId: band, frame: 'content' },
    },
    {
      tier: 'together',
      text: 'Review with content author — is the friction pattern in audio quality or pedagogy?',
      owner: 'you+claude',
    },
  ]

  return {
    widget: 'narrative-card',
    query: { metric: 'contentFriction', course: selectedCourse.value, frame: 'content' },
    frame: 'content',
    title: 'Friction law — what the heatmap is saying',
    story: `Unit-concentrated friction is a quality signal, not a learner signal. When one seed-band lights up across multiple dimensions, the content needs re-splitting in Popty — the curriculum is the bottleneck, not the adaptation.`,
    annotate: annots,
    actions,
    tag: 'narrative · content',
  }
})

// ---- ResolvedInsight bundles the wrapper expects ---------------------------
const gridResolved = computed((): ResolvedInsight => ({
  data: gridData.value ?? {
    kind: 'cohort-grid', xLabels: [], yLabels: [], cells: [], min: 0, max: 0,
  },
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

// ---- lifecycle -------------------------------------------------------------
onMounted(async () => {
  if (demoMode) {
    // No Supabase course fetch — seed straight from the in-memory demo list.
    const opts = demoCourseList()
    if (opts.length > 0 && !selectedCourse.value) {
      selectedCourse.value = opts[0].value
      await fetchFriction(selectedCourse.value)
    }
    return
  }
  await coursesComposable.fetchCourses()
  if (coursesComposable.courses.value.length > 0 && !selectedCourse.value) {
    selectedCourse.value = coursesComposable.courses.value[0].course_code
    await fetchFriction(selectedCourse.value)
  }
})

watch(selectedCourse, async (code) => {
  if (code) await fetchFriction(code)
})

function onCourseChange(e: Event) {
  selectedCourse.value = (e.target as HTMLSelectElement).value
}
</script>

<template>
  <section class="cfb">
    <!-- ---- Board header ------------------------------------------------- -->
    <header class="cfb-head">
      <div class="cfb-title-block">
        <span class="cfb-lens-kicker">Lens B · quality</span>
        <h2 class="cfb-title">Content Friction</h2>
        <p class="cfb-sub">
          Where does the curriculum hurt everyone? Hot cells are content problems, not adaptation problems.
        </p>
      </div>

      <!-- Course picker -->
      <div class="cfb-picker">
        <label class="cfb-picker-label" for="cfb-course-select">Course</label>
        <select
          id="cfb-course-select"
          class="cfb-select"
          :value="selectedCourse"
          :disabled="coursesComposable.isLoading.value || isLoading"
          @change="onCourseChange"
        >
          <option value="" disabled>Select a course…</option>
          <option
            v-for="opt in courseOptions"
            :key="opt.value"
            :value="opt.value"
          >{{ opt.label }}</option>
        </select>
        <span v-if="coursesComposable.isLoading.value" class="cfb-picker-hint">Loading courses…</span>
        <span v-else-if="isLoading" class="cfb-picker-hint">Loading friction…</span>
        <span v-else-if="selectedCourse" class="cfb-picker-hint">{{ selectedCourseLabel }}</span>
      </div>
    </header>

    <!-- ---- Empty / no-course prompt ------------------------------------- -->
    <div v-if="!selectedCourse && !coursesComposable.isLoading.value" class="cfb-empty">
      <span class="cfb-empty-ghost">friction</span>
      <div class="cfb-empty-copy">
        <strong class="cfb-empty-title">Select a course to begin</strong>
        <p class="cfb-empty-body">
          The friction map shows where the curriculum stalls learners population-wide —
          a seed-band × friction-dimension heatmap per course.
        </p>
      </div>
    </div>

    <!-- ---- Widget grid -------------------------------------------------- -->
    <div v-else class="cfb-grid">

      <!-- Widget 1: CohortGrid heatmap — spans full width -->
      <div class="cfb-cell cfb-span">
        <InsightWidget
          :spec="gridSpec"
          :resolved="gridResolved"
        />
      </div>

      <!-- Widget 2: RankedBar — top friction bands -->
      <div class="cfb-cell">
        <InsightWidget
          :spec="rankedBarSpec"
          :resolved="rankedBarResolved"
        />
      </div>

      <!-- Widget 3: NarrativeCard — the editorial read + actions -->
      <div class="cfb-cell">
        <InsightWidget
          :spec="narrativeSpec"
          :resolved="narrativeResolved"
        />
      </div>

    </div>
  </section>
</template>

<style scoped>
/* ---- Board shell --------------------------------------------------------- */
.cfb {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1280px;
  margin: 0 auto;
}

/* ---- Header ------------------------------------------------------------- */
.cfb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.cfb-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cfb-lens-kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
}

.cfb-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  margin: 0;
}

.cfb-sub {
  font-size: 13.5px;
  color: var(--ink-muted);
  margin: 0;
  max-width: 44rem;
}

/* ---- Course picker ------------------------------------------------------- */
.cfb-picker {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.cfb-picker-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
}

.cfb-select {
  appearance: none;
  -webkit-appearance: none;
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 10px;
  padding: 8px 32px 8px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-primary);
  cursor: pointer;
  min-width: 200px;
  /* chevron via inline background */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8078' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}

.cfb-select:hover {
  border-color: rgba(44, 38, 34, 0.28);
}

.cfb-select:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.5);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.08);
}

.cfb-select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cfb-picker-hint {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-muted);
  letter-spacing: 0.04em;
}

/* ---- Empty state --------------------------------------------------------- */
.cfb-empty {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 28px;
  align-items: center;
  padding: 40px 36px;
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 18px;
  min-height: 200px;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.05);
}

.cfb-empty-ghost {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 88px;
  letter-spacing: -0.03em;
  color: var(--ink-faint);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.cfb-empty-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cfb-empty-title {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 20px;
  color: var(--ink-primary);
}

.cfb-empty-body {
  font-size: 14px;
  color: var(--ink-muted);
  line-height: 1.55;
  margin: 0;
  max-width: 38rem;
}

/* ---- Widget grid --------------------------------------------------------- */
/*
 * Desktop-first. The heatmap spans full width (.cfb-span); the ranked-bar and
 * narrative card sit side-by-side on a 55/45 split underneath it.
 * On narrow viewports they stack.
 */
.cfb-grid {
  display: grid;
  grid-template-columns: 55fr 45fr;
  gap: 20px;
}

.cfb-cell {
  /* Each cell is a grid item. The wrapper .fig handles its own chrome. */
  min-width: 0;   /* prevents grid blowout when the chart canvas is wide */
}

/* Full-width row — the heatmap spans both columns */
.cfb-span {
  grid-column: 1 / -1;
}

/* ---- Responsive ---------------------------------------------------------- */
@media (max-width: 860px) {
  .cfb-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .cfb-grid {
    grid-template-columns: 1fr;
  }

  .cfb-span {
    grid-column: 1;
  }

  .cfb-empty {
    grid-template-columns: 1fr;
  }

  .cfb-empty-ghost {
    display: none;
  }
}
</style>
