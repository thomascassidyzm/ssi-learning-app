<script setup lang="ts">
// ============================================================================
// NodeRateEngine — THE LENS: the one Insight Engine scoped to ONE NODE.
//
// The analytics face of node home (archive/docs-retired-2026-08-24/THE-VIEW.md): the entity is ALWAYS the
// node it was opened from (a class, a school, a group at any depth) and the
// compare-to chain IS the map rail's ancestor path — parent's average by
// default, then up the tree to the global cohorts. One component serves every
// surface: the admin node pages mount it under their chrome, the teacher view
// mounts it with `plainWords` (design law §1.12 — "your class", "school
// average"; never engine vocabulary).
//
// Data: GET /api/groups/:nodeId/rate-compare — one round trip returns the
// picker options (courses below the node, the ancestor chain) AND the resolved
// comparison, k-floored server-side. Cohorts arrive as aggregates + an
// anonymised distribution only; this component never sees a peer's name.
//
// Deep links: `course`/`compare` are v-model'd so the wrapper can mirror them
// into the URL query. The server resolves defaults; we emit the applied values
// back up only when they differ from what was asked.
//
// Refresh protocol: registers its loader with useDashboardRefresh — data loads
// on navigation and holds still; the universal affordance re-fetches. No polling.
// ============================================================================
import { ref, computed, watch } from 'vue'
import RateCompare from './components/RateCompare.vue'
import WeekNumbersCard, { type WeekBlock } from './components/WeekNumbersCard.vue'
import WindowChips from './components/WindowChips.vue'
import FrostSelect from '@/components/FrostSelect.vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import { courseDisplayName, courseShortName } from '@ssi/core'
import { useI18n } from '@/composables/useI18n'
import type { RateComparisonData } from './spec'

const { t } = useI18n()

interface CourseOption { code: string; classCount: number; hasData?: boolean }
interface CompareOption { value: string; label: string; word: string }
interface WindowOption { value: string; label: string }
interface MeasureOption { value: string; label: string; desc: string }
export interface EngineState {
  node: { id: string; name: string; label: string; kind: 'node' | 'class' }
  options: { courses: CourseOption[]; compares: CompareOption[]; windows?: WindowOption[]; measures?: MeasureOption[] }
  applied: { course_code: string | null; compare_to: string; days: number; window?: string; measure?: string }
}

const props = defineProps<{
  nodeId: string
  course?: string | null
  compare?: string | null
  window?: string | null
  measure?: string | null
  plainWords?: boolean
  /**
   * Where the rate-compare contract is served from. Default: the node route.
   * Intelligence at Everyone scope passes `/api/intel/minutes` (job #609) —
   * the same response shape, so this component needs no second adapter.
   */
  endpoint?: string | null
  getToken: () => Promise<string | null>
}>()

const emit = defineEmits<{
  'update:course': [value: string]
  'update:compare': [value: string]
  'update:window': [value: string]
  'update:measure': [value: string]
  state: [value: EngineState]
  /** The full resolved body, for a wrapper that says the answer in a sentence. */
  data: [value: Record<string, unknown> | null]
}>()

const isLoading = ref(true)
const authMissing = ref(false)
const fetchFailed = ref(false)
const insufficientReason = ref<string | null>(null)
const comparison = ref<RateComparisonData | null>(null)
// The week card (job #989) rides alongside the comparison: it is computed from
// the entity's own play, so it renders even when there is no comparable cohort
// — a class with no peers still gets its own week, and only the comparison is
// missing.
const weekBlock = ref<WeekBlock | null>(null)
const weekPercentile = ref<number | null>(null)
const weekCohortUnit = ref<string | null>(null)
const engineState = ref<EngineState | null>(null)

// Direct calls can overlap (rapid prop changes) — latest request wins, a
// stale response never overwrites a newer one.
let fetchSeq = 0

// What the server last resolved. When the wrapper mirrors the applied
// defaults back into the v-models, the watch fires again with values we
// already hold — refetching then is a pure echo (one wasted round trip and
// a "Loading…" flash over an already-rendered comparison).
let lastApplied: { nodeId: string; course: string | null; compare: string | null; window: string | null; measure: string | null } | null = null

async function fetchComparison(): Promise<void> {
  if (!props.nodeId) return
  const seq = ++fetchSeq
  isLoading.value = true
  authMissing.value = false
  fetchFailed.value = false
  insufficientReason.value = null
  comparison.value = null
  try {
    const token = await props.getToken()
    if (!token) { authMissing.value = true; return }
    const params = new URLSearchParams()
    if (props.course) params.set('course_code', props.course)
    if (props.compare) params.set('compare_to', props.compare)
    if (props.window) params.set('window', props.window)
    if (props.measure) params.set('measure', props.measure)
    const qs = params.toString()
    const base = props.endpoint || `/api/groups/${props.nodeId}/rate-compare`
    const resp = await fetch(`${base}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (seq !== fetchSeq) return
    if (!resp.ok) throw new Error(`rate-compare ${resp.status}`)
    const json = await resp.json()
    if (seq !== fetchSeq) return
    engineState.value = { node: json.node, options: json.options, applied: json.applied }
    lastApplied = {
      nodeId: props.nodeId,
      course: json.applied.course_code ?? null,
      compare: json.applied.compare_to ?? null,
      window: json.applied.window ?? null,
      measure: json.applied.measure ?? null,
    }
    emit('state', engineState.value)
    // Reflect server-resolved defaults back into the v-models (deep links stay
    // honest); identical values emit nothing, so no fetch loop.
    if (json.applied.course_code && json.applied.course_code !== props.course) emit('update:course', json.applied.course_code)
    if (json.applied.compare_to && json.applied.compare_to !== props.compare) emit('update:compare', json.applied.compare_to)
    if (json.applied.window && json.applied.window !== props.window) emit('update:window', json.applied.window)
    if (json.applied.measure && json.applied.measure !== props.measure) emit('update:measure', json.applied.measure)
    weekBlock.value = (json.week as WeekBlock | null) ?? null
    weekPercentile.value = typeof json.percentile === 'number' ? json.percentile : null
    weekCohortUnit.value = typeof json.cohortUnit === 'string' ? json.cohortUnit : null
    if (json.insufficientData) {
      insufficientReason.value = json.reason || t('insights.rateEngine.notEnoughData', 'Not enough data to compare fairly yet.')
    } else {
      comparison.value = json as RateComparisonData
    }
    emit('data', json as Record<string, unknown>)
  } catch (err) {
    if (seq !== fetchSeq) return
    console.error('[NodeRateEngine] fetch failed:', err)
    fetchFailed.value = true
  } finally {
    if (seq === fetchSeq) isLoading.value = false
  }
}

// The ONE refresh protocol: register the loader so the navbar button and
// pull-to-refresh re-fetch (no polling; the page holds still until asked).
// Input changes (node / course / compare) call the loader DIRECTLY, not via
// refresh(): the singleton's in-flight guard is for the button, and routing
// initial loads through it let another surface's still-running refresh
// swallow this instance's only load (seen live when the admin containers
// re-gate and remount the page as auth resolves — the ghost instance's
// refresh() left the fresh one stuck on "Loading…" forever).
const { registerRefresh } = useDashboardRefresh()
registerRefresh(fetchComparison, { immediate: false })
watch(
  [() => props.nodeId, () => props.course, () => props.compare, () => props.window, () => props.measure],
  ([nid, course, compare, win, measure]) => {
    // Echo guard: a null prop means "server default", which is what we hold.
    if (lastApplied && nid === lastApplied.nodeId
      && (!course || course === lastApplied.course)
      && (!compare || compare === lastApplied.compare)
      && (!win || win === lastApplied.window)
      && (!measure || measure === lastApplied.measure)) return
    void fetchComparison()
  },
  { immediate: true },
)

// ─── Pickers ───
// Server sends courses sorted active-first (busiest by recent practice);
// a course with no practice at THIS node is named as such so a human picking
// manually can't land on an empty screen unwarned. hasData undefined (older
// server) reads as "has data" — no annotation, exactly today's rendering.
const courseSelectOptions = computed(() =>
  (engineState.value?.options.courses ?? []).map((c) => ({
    value: c.code,
    label: c.hasData === false
      ? t('insights.rateEngine.courseNoPracticeHere', '{course} — no practice here').replace('{course}', courseDisplayName(c.code))
      : courseDisplayName(c.code),
  })))

function compareWord(o: CompareOption): string {
  if (!props.plainWords) return o.label
  if (o.value === 'global') return t('insights.rateEngine.compareEveryoneOnCourse', 'Everyone on this course')
  if (o.value === 'global_all_courses') return t('insights.rateEngine.compareAllLearnersAllCourses', 'All SSi learners · all courses')
  if (o.word === 'school') return t('insights.rateEngine.compareSchoolAverage', 'School average')
  return o.label // "<Name> average" — already plain language
}
const compareSelectOptions = computed(() =>
  (engineState.value?.options.compares ?? []).map((o) => ({ value: o.value, label: compareWord(o) })))

const courseModel = computed({
  get: () => props.course || engineState.value?.applied.course_code || '',
  set: (v: string) => emit('update:course', v),
})
const compareModel = computed({
  get: () => props.compare || engineState.value?.applied.compare_to || '',
  set: (v: string) => emit('update:compare', v),
})

// Even one course is a dropdown — the same control everywhere, never a
// static box beside real dropdowns (Tom, 2026-09-14).
const showCoursePicker = computed(() => (engineState.value?.options.courses.length ?? 0) >= 1)

// ── Window chips: server-sent options; absent → no chip row at all (defensive
// — renders exactly as today until the server ships options.windows). ──
const windowOptions = computed(() => engineState.value?.options.windows ?? [])
const showWindowChips = computed(() => windowOptions.value.length > 0)
const windowModel = computed({
  get: () => props.window || engineState.value?.applied.window || '',
  set: (v: string) => emit('update:window', v),
})

// ── Measure picker: server-sent options; absent → the fixed legacy text. ──
const measureOptions = computed(() => engineState.value?.options.measures ?? [])
const showMeasurePicker = computed(() => measureOptions.value.length > 0)
const measureSelectOptions = computed(() =>
  measureOptions.value.map((m) => ({ value: m.value, label: m.label })))
const measureModel = computed({
  get: () => props.measure || engineState.value?.applied.measure || '',
  set: (v: string) => emit('update:measure', v),
})

// The legacy fixed metric — kept as the fallback when the server hasn't (yet)
// sent options.measures (the admin Stats boards carry the browsable metric
// set; this page is the scoped door, not a fork).
const LEGACY_METRIC_DESC = t(
  'insights.rateEngine.legacyMetricDesc',
  'New phrases reached per week — the headline rate. Rate of progress matters more than position: a learner three seeds back but climbing fast is healthier than one parked far ahead.',
)
const metricDesc = computed(() => {
  if (weekBlock.value) {
    return t(
      'insights.rateEngine.weekDesc',
      'A school week, Monday to Sunday. Time is in-app time from pressing play to stopping; play-as-class and students on their own accounts are counted separately and then added. New phrases are the ones the class reached for the first time in the week.',
    )
  }
  const selected = measureOptions.value.find((m) => m.value === measureModel.value)
  return selected?.desc || LEGACY_METRIC_DESC
})
</script>

<template>
  <div class="nre">
    <!-- ── Controls ── -->
    <div v-if="engineState" class="nre-controls">
      <div v-if="showWindowChips" class="nre-field" data-walk="insights-window">
        <span class="nre-field-label">{{ t('insights.rateEngine.windowLabel', 'Window') }}</span>
        <WindowChips v-model="windowModel" :options="windowOptions" :aria-label="t('insights.rateEngine.timeWindowAriaLabel', 'Time window')" />
      </div>

      <label v-if="showCoursePicker" class="nre-field nre-field-wide">
        <span class="nre-field-label">{{ t('insights.rateEngine.courseLabel', 'Course') }}</span>
        <FrostSelect v-model="courseModel" :options="courseSelectOptions" :aria-label="t('insights.rateEngine.courseLabel', 'Course')" />
      </label>
      <div v-else-if="engineState.applied.course_code" class="nre-field">
        <span class="nre-field-label">{{ t('insights.rateEngine.courseLabel', 'Course') }}</span>
        <p class="nre-fixed">{{ courseShortName(engineState.applied.course_code) }}</p>
      </div>

      <!-- HANDBOOK Reading your insights
           section: seeing-progress
           moment: every-lesson
           roles: admin, leader, school_admin
           place: node-insights
           keywords: insights, numbers, week, compare, minutes, phrases, window
           walk: reading-insights
           What it's for. Reading a week of learning at this level — how much time was
           spent, how much new ground was covered, and how that sits beside the school.
           Where it is. The node's home page, **See insights**.
           How you do it.
           1. Open the node's home page and tap **See insights**.
           2. Pick the **window**. **This week** runs from Monday morning to right now;
              **Last week** is the Monday to Sunday just gone. Those are the only two,
              because a school works in weeks.
           3. Read the three numbers. **Play as class** is time on the class's own
              account, the lesson from the front. **Students on their own** is time on
              their own accounts. **Total learning time** is those two added together.
           4. **New phrases** is how much new ground was reached for the first time
              that week. A week spent going back over old ground reads zero there and a
              healthy pile of minutes, which is exactly what that week was.
           5. Use **Compare to** to choose whose average sits in the second column. It
              is the mean of every class in that scope that has STARTED on this course,
              counted whether or not it practised this week, and the class you are
              looking at is one of them — so it reads the same number whichever class
              you open it from. The line under it says how many.
           6. **Overview** takes you back to the same place's home page.
           Worth knowing. A class that was set up and has never played is in no average
           anywhere — counting it would read your school as less busy than it is. A
           class joins the average in the week it first plays and never leaves, so a new
           class starting does not change last month's figures. The two columns are
           plain numbers side by side: no score, no percentage, you do the comparing
           yourself. The chart is one bar per week for the last twelve weeks,
           Monday-anchored on your own clock. A week with no play is a bar of zero; a
           week before anyone had started is a gap, because there was nothing there to
           measure. A class that practises from the front is counted through its own
           class account, so whole-class lessons show here the same as any other
           practice.
           checked: d02609b0.1e86d15d
      -->
      <label v-if="showMeasurePicker" class="nre-field nre-field-wide" data-walk="insights-measure">
        <span class="nre-field-label">{{ t('insights.rateEngine.measureLabel', 'Measure') }}</span>
        <FrostSelect v-model="measureModel" :options="measureSelectOptions" :aria-label="t('insights.rateEngine.measureLabel', 'Measure')" />
      </label>
      <!-- Under the week primitive there is nothing to pick: the card IS the
           three numbers, so the field names them instead of offering the same
           figure three ways. The anchor stays — the walk still points here. -->
      <div v-else class="nre-field" data-walk="insights-measure">
        <span class="nre-field-label">{{ t('insights.rateEngine.measureLabel', 'Measure') }}</span>
        <p class="nre-fixed">{{ weekBlock
          ? t('insights.rateEngine.weekMeasureFixed', 'Time and new phrases, by week')
          : t('insights.rateEngine.rateOfProgressFixed', 'Rate of progress (new phrases / week)') }}</p>
      </div>

      <label class="nre-field nre-field-wide" data-walk="insights-compare">
        <span class="nre-field-label">{{ t('insights.rateEngine.compareToLabel', 'Compare to') }}</span>
        <FrostSelect v-model="compareModel" :options="compareSelectOptions" :aria-label="t('insights.rateEngine.compareToLabel', 'Compare to')" />
      </label>
    </div>

    <p class="nre-metric-desc">{{ metricDesc }}</p>

    <!-- ── The widget — or an honest state, never a fabricated number ── -->
    <!-- HANDBOOK Why the insights are told in weeks
         section: seeing-progress
         moment: setting-up
         roles: admin, leader, school_admin
         place: node-insights
         keywords: week, monday, total, compare, average, denominator, this week, last week
         What it's for. A school plans and reviews in weeks, so the insights page counts in
         weeks too — Monday morning to Sunday night, on your own clock. A rolling "last
         seven days" straddles two different weeks of teaching and cannot be talked about
         in a staff meeting.
         Where it is. The block under the pickers on any level's insights page.
         How you do it.
         1. Open a level and tap **See insights**.
         2. Read the line under the pickers — it says in words what the numbers count.
         3. The block below puts this level's week beside the average's same week, as two
            columns of plain numbers.
         4. Switch between **This week** and **Last week**. On a Monday or a Tuesday the
            page opens on last week, because the week in progress is barely a lesson old.
         Worth knowing. The week runs Monday 00:00 to Sunday night on UK time, so a
         Monday-morning lesson belongs to the week it was taught in. Nothing here is a
         score, a target or a streak. A quiet week is allowed to read as a quiet week.
         checked: ac359fff.a9a3817c
    -->
    <div v-if="weekBlock" class="nre-widget-card" data-walk="insights-rate-widget">
      <WeekNumbersCard
        :data="weekBlock"
        :no-cohort-reason="insufficientReason"
        :percentile="weekPercentile"
        :cohort-unit="weekCohortUnit"
      />
    </div>
    <div v-else-if="comparison" class="nre-widget-card" data-walk="insights-rate-widget">
      <RateCompare :data="comparison" />
    </div>
    <div v-else-if="isLoading" class="nre-widget-card nre-status"><p>{{ t('insights.rateEngine.loading', 'Loading…') }}</p></div>
    <div v-else-if="authMissing" class="nre-widget-card nre-status">
      <p>{{ t('insights.rateEngine.sessionExpired', 'Your session has expired — sign in again to see these numbers.') }}</p>
    </div>
    <div v-else-if="insufficientReason" class="nre-widget-card nre-status">
      <p>{{ insufficientReason }}</p>
    </div>
    <div v-else-if="fetchFailed" class="nre-widget-card nre-status">
      <p>{{ t('insights.rateEngine.fetchFailed', "Couldn't load these numbers just now — try again shortly.") }}</p>
    </div>
  </div>
</template>

<style scoped>
.nre {
  /* RateCompare's --rc-* role tokens (one green/blue scheme — the same values
   * the teacher surface carries), so the widget reads identically wherever
   * this engine mounts. blue = entity/selection, green = positive/band. */
  --rc-entity:     96, 165, 250;
  --rc-entity-ink: 37, 99, 235;
  --rc-positive:   21, 128, 61;
  --rc-secondary:  138, 128, 120;
  --rc-band:       74, 222, 128;
  --rc-glow:       96, 165, 250;

  display: flex;
  flex-direction: column;
  gap: 16px;
}

.nre-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  padding: 16px 18px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 12px;
}
.nre-field { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
.nre-field-wide { flex: 1 1 220px; min-width: 220px; }
.nre-field-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted, #8A8078);
}
.nre-fixed {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-primary, #2C2622);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: 9px;
  padding: 9px 12px;
  margin: 0;
}
.nre-metric-desc {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  margin: 0;
  max-width: 64rem;
}
.nre-widget-card {
  padding: 24px 26px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 16px;
}
.nre-status {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  text-align: center;
}
.nre-status p {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  max-width: 42ch;
  margin: 0;
}
@media (max-width: 720px) {
  .nre-field, .nre-field-wide { width: 100%; min-width: 0; }
}
</style>
