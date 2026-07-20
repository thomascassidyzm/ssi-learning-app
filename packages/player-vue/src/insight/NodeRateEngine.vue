<script setup lang="ts">
// ============================================================================
// NodeRateEngine — THE LENS: the one Insight Engine scoped to ONE NODE.
//
// The analytics face of node home (docs/THE-VIEW.md): the entity is ALWAYS the
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
import WindowChips from './components/WindowChips.vue'
import FrostSelect from '@/components/FrostSelect.vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import { courseDisplayName } from '@ssi/core'
import type { RateComparisonData } from './spec'

interface CourseOption { code: string; classCount: number }
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
  getToken: () => Promise<string | null>
}>()

const emit = defineEmits<{
  'update:course': [value: string]
  'update:compare': [value: string]
  'update:window': [value: string]
  'update:measure': [value: string]
  state: [value: EngineState]
}>()

const isLoading = ref(true)
const authMissing = ref(false)
const fetchFailed = ref(false)
const insufficientReason = ref<string | null>(null)
const comparison = ref<RateComparisonData | null>(null)
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
    const resp = await fetch(`/api/groups/${props.nodeId}/rate-compare${qs ? `?${qs}` : ''}`, {
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
    if (json.insufficientData) {
      insufficientReason.value = json.reason || 'Not enough data to compare fairly yet.'
    } else {
      comparison.value = json as RateComparisonData
    }
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
const courseSelectOptions = computed(() =>
  (engineState.value?.options.courses ?? []).map((c) => ({ value: c.code, label: courseDisplayName(c.code) })))

function compareWord(o: CompareOption): string {
  if (!props.plainWords) return o.label
  if (o.value === 'global') return 'Everyone on this course'
  if (o.value === 'global_all_courses') return 'All SSi learners · all courses'
  if (o.word === 'school') return 'School average'
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

const showCoursePicker = computed(() => (engineState.value?.options.courses.length ?? 0) > 1)

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
const LEGACY_METRIC_DESC = 'New LEGOs reached per week — the headline rate. Rate of progress '
  + 'matters more than position: a learner three seeds back but climbing fast is '
  + 'healthier than one parked far ahead.'
const metricDesc = computed(() => {
  const selected = measureOptions.value.find((m) => m.value === measureModel.value)
  return selected?.desc || LEGACY_METRIC_DESC
})
</script>

<template>
  <div class="nre">
    <!-- ── Controls ── -->
    <div v-if="engineState" class="nre-controls">
      <div v-if="showWindowChips" class="nre-field">
        <span class="nre-field-label">Window</span>
        <WindowChips v-model="windowModel" :options="windowOptions" aria-label="Time window" />
      </div>

      <label v-if="showCoursePicker" class="nre-field nre-field-wide">
        <span class="nre-field-label">Course</span>
        <FrostSelect v-model="courseModel" :options="courseSelectOptions" aria-label="Course" />
      </label>
      <div v-else-if="engineState.applied.course_code" class="nre-field">
        <span class="nre-field-label">Course</span>
        <p class="nre-fixed">{{ courseDisplayName(engineState.applied.course_code) }}</p>
      </div>

      <label v-if="showMeasurePicker" class="nre-field nre-field-wide">
        <span class="nre-field-label">Measure</span>
        <FrostSelect v-model="measureModel" :options="measureSelectOptions" aria-label="Measure" />
      </label>
      <div v-else class="nre-field">
        <span class="nre-field-label">Measure</span>
        <p class="nre-fixed">Rate of progress (LEGOs / week)</p>
      </div>

      <label class="nre-field nre-field-wide">
        <span class="nre-field-label">Compare to</span>
        <FrostSelect v-model="compareModel" :options="compareSelectOptions" aria-label="Compare to" />
      </label>
    </div>

    <p class="nre-metric-desc">{{ metricDesc }}</p>

    <!-- ── The widget — or an honest state, never a fabricated number ── -->
    <div v-if="comparison" class="nre-widget-card">
      <RateCompare :data="comparison" />
    </div>
    <div v-else-if="isLoading" class="nre-widget-card nre-status"><p>Loading…</p></div>
    <div v-else-if="authMissing" class="nre-widget-card nre-status">
      <p>Your session has expired — sign in again to see these numbers.</p>
    </div>
    <div v-else-if="insufficientReason" class="nre-widget-card nre-status">
      <p>{{ insufficientReason }}</p>
    </div>
    <div v-else-if="fetchFailed" class="nre-widget-card nre-status">
      <p>Couldn't load these numbers just now — try again shortly.</p>
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
