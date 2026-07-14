<script setup lang="ts">
// ============================================================================
// TeacherInsightsView.vue — the TEACHER/TUTOR view of the Rate-compare widget.
//
// The calm, single-purpose opposite of the /admin/insights cockpit. It contains
// NOTHING but the entity-vs-average Rate-compare widget, framed for a teacher
// looking at THEIR class. No course value, no platform health, no content
// friction, no board tabs, no "Insight Engine" chrome.
//
// HARD SCOPE (non-negotiable):
//   · The entity is always one of THE TEACHER'S OWN classes (a small fixed demo
//     set) — or, by drilling, a learner WITHIN the selected class. Never any
//     class outside the teacher's set, never another school's / teacher's class.
//     The Class picker only ever offers the teacher's own classes; the level
//     switch is class<->learner within the selected class.
//   · An entity is only ever compared to an AGGREGATE/average (course avg /
//     all-classes avg / peer cohort …). The widget itself enforces this — the
//     cohort leaves only as an anonymised distribution marking "You" + the
//     average. No other named entity renders anywhere.
//   · RATE leads; furthest-LEGO position is the small secondary context the
//     widget already carries.
//
// DEMO-FIRST: with ?demo it reads data/demoRates.ts (seeded, deterministic, NO
// DB call) — the same short-circuit the admin boards use (isInsightDemo(), the
// same gate CoverageBoard.vue uses). Without ?demo it fetches the CALLER'S OWN
// real classes (useClassesData — already role-scoped for teacher/school_admin/
// govt_admin) and real rate data from GET /api/school/rate-compare, which
// resolves the caller's visible scope server-side (resolveVisibleScope) and
// computes rate-of-progress from analytics_class_sessions_scoped. Only the
// headline metric (rate of progress) and compare-to (school/group/global) are
// real; the other 5 HERO_RATES and the learner-level drill stay demo-only
// until their own resolvers exist (Principle 5 — earn it, don't fake it).
//
// Frostwell Courtyard idiom, premium + minimal. ONE green/blue colour scheme,
// dressed in Apple-HIG "Liquid Glass": the regular-material glass lives only on
// the CHROME (header + controls + control pills), floating above a soft green/
// blue colour atmosphere it refracts. The CONTENT card stays clean and opaque so
// the data reads crisply. No hardcoded hex for the scheme — the --rc-* role
// tokens carry it. blue = primary/selection, green = success/active, gold = warn.
// ============================================================================
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import RateCompare from './components/RateCompare.vue'
import FrostSelect from '@/components/FrostSelect.vue'
import TopNav from '@/components/schools/shared/TopNav.vue'
import { isInsightDemo } from './data/demo'
import { useClassesData } from '@/composables/schools/useClassesData'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { getSchoolsClient } from '@/composables/schools/client'
import {
  HERO_RATES,
  getRateComparison,
  listEntities,
  listAverages,
  type EntityLevel,
} from './data/demoRates'
import type { RateComparisonData } from './spec'
import '@/styles/schools-tokens.css'

// When `embedded`, this view renders INSIDE the schools shell (SchoolsContainer
// provides the SchoolsTopBar + the page scroll), so it must NOT render its own
// TopNav or impose its own full-viewport scroll. Standalone path is unchanged.
const props = defineProps<{ embedded?: boolean }>()

// isInsightDemo() reads ?demo off the URL — the same gate CoverageBoard.vue
// uses. With it: the seeded demoRates.ts fixture (unchanged, for previewing
// the widget with no login). Without it: real classes + real rate data.
const demoMode = isInsightDemo()

// ── DEMO fixture (unchanged) — a small hardcoded population for the preview ──
interface TeacherClass {
  label: string      // exact CLASS_NAMES entry — `${school} · ${className}`
  school: string
  className: string
  course: string
}
const MY_CLASSES: TeacherClass[] = [
  { label: 'Gaelscoil Cholmcille · Rang a 5 — Sínis', school: 'Gaelscoil Cholmcille', className: 'Rang a 5 — Sínis', course: 'Chinese for Irish speakers' },
  { label: 'Gaelscoil Cholmcille · Rang a 6 — Sínis', school: 'Gaelscoil Cholmcille', className: 'Rang a 6 — Sínis', course: 'Chinese for Irish speakers' },
  { label: 'Coláiste Éinde · 1st Year Gaeilge',       school: 'Coláiste Éinde',       className: '1st Year Gaeilge', course: 'Irish for English speakers' },
]
const selectedDemoClass = computed<TeacherClass>(
  () => MY_CLASSES.find((c) => c.label === selectedClassKey.value) ?? MY_CLASSES[0],
)

// ── REAL classes (non-demo): the caller's OWN, already role-scoped by
// useClassesData (teacher -> class_teachers membership; school_admin -> their
// school; govt_admin -> their group subtree) — the exact same fetch
// TeacherDashboard/DashboardView use, so the picker never offers a class
// outside the signed-in caller's scope. ─────────────────────────────────────
const { classes: realClasses, fetchClasses } = useClassesData()
const { currentUser, isGovtAdmin: isGovtAdminRole, isSchoolAdmin: isSchoolAdminRole } = useSchoolContext()
const { schools: govtSchools, fetchSchools } = useSchoolData()
if (!demoMode) fetchClasses()
if (!demoMode && isGovtAdminRole.value) fetchSchools()

interface RealClassOption { id: string; className: string; course: string; schoolId: string }
const realClassOptions = computed<RealClassOption[]>(() =>
  realClasses.value.map((c) => ({ id: c.id, className: c.class_name, course: c.course_code, schoolId: c.school_id })),
)

// ── Course — LEADS the board (owner's ruling, 2026-07-14): the course is
// chosen FIRST and every entity/aggregate below is resolved within it only,
// so a school/group average is never diluted across unrelated courses.
// Only courses with a class in the caller's visible scope are offered.
const realCourseOptions = computed<string[]>(() => [...new Set(realClassOptions.value.map((c) => c.course))].sort())
const selectedCourse = ref<string>('')
watch(realCourseOptions, (opts) => {
  if (!demoMode && !selectedCourse.value && opts.length) selectedCourse.value = opts[0]
}, { immediate: true })
const courseSelectOptions = computed(() => realCourseOptions.value.map((c) => ({ value: c, label: c })))

// ── Entity level — the full ladder (owner's ruling): teacher = class only;
// school_admin = class or their whole school; govt_admin = class, a school
// in their group, or their whole group. Demo path is unaffected (class only,
// its own fixture population) — this ladder is real-data only.
type RealEntityLevel = 'class' | 'school' | 'group'
const availableRealEntityLevels = computed<{ value: RealEntityLevel; label: string }[]>(() => {
  if (isGovtAdminRole.value) return [{ value: 'class', label: 'Class' }, { value: 'school', label: 'School' }, { value: 'group', label: 'Group' }]
  if (isSchoolAdminRole.value) return [{ value: 'class', label: 'Class' }, { value: 'school', label: 'School' }]
  return [{ value: 'class', label: 'Class' }]
})
const realEntityLevel = ref<RealEntityLevel>('class')
watch(availableRealEntityLevels, (opts) => {
  if (!demoMode && !opts.find((o) => o.value === realEntityLevel.value)) realEntityLevel.value = 'class'
}, { immediate: true })

const realClassOptionsForCourse = computed(() => realClassOptions.value.filter((c) => c.course === selectedCourse.value))
const selectedRealClass = computed<RealClassOption | null>(
  () => realClassOptionsForCourse.value.find((c) => c.id === selectedClassKey.value) ?? realClassOptionsForCourse.value[0] ?? null,
)

// One selected-class model spanning both paths (demo picks by fixture label,
// real picks by class id) so the template only ever binds one v-model.
const selectedClassKey = ref<string>(demoMode ? MY_CLASSES[0].label : '')
watch([realClassOptionsForCourse, realEntityLevel], ([opts, level]) => {
  if (demoMode || level !== 'class') return
  if (!opts.find((o) => o.id === selectedClassKey.value)) selectedClassKey.value = opts[0]?.id ?? ''
}, { immediate: true })

const classSelectOptions = computed(() =>
  demoMode
    ? MY_CLASSES.map((c) => ({ value: c.label, label: c.label }))
    : realClassOptionsForCourse.value.map((c) => ({ value: c.id, label: c.className })),
)

// ── School picker — govt_admin only (school_admin has exactly one school,
// shown as fixed text instead). Only schools that have a class on the
// selected course, derived client-side from the classes already fetched. ──
interface SchoolOption { id: string; school_name: string }
const schoolOptionsForCourse = computed<SchoolOption[]>(() => {
  if (!isGovtAdminRole.value) return []
  const idsWithCourse = new Set(realClassOptionsForCourse.value.map((c) => c.schoolId))
  return govtSchools.value.filter((s) => idsWithCourse.has(s.id)).map((s) => ({ id: s.id, school_name: s.school_name }))
})
const schoolSelectOptions = computed(() => schoolOptionsForCourse.value.map((s) => ({ value: s.id, label: s.school_name })))
const selectedGovtSchoolId = ref<string>('')
watch([schoolOptionsForCourse, realEntityLevel], ([opts, level]) => {
  if (demoMode || level !== 'school' || !isGovtAdminRole.value) return
  if (!opts.find((o) => o.id === selectedGovtSchoolId.value)) selectedGovtSchoolId.value = opts[0]?.id ?? ''
}, { immediate: true })

// ── The resolved real entity id + human label, one per level. ──
const realEntityId = computed<string | null>(() => {
  if (demoMode) return null
  if (realEntityLevel.value === 'class') return selectedRealClass.value?.id ?? null
  if (realEntityLevel.value === 'school') {
    return isGovtAdminRole.value ? (selectedGovtSchoolId.value || null) : (currentUser.value?.school_id ?? null)
  }
  return currentUser.value?.group_id ?? null
})
const realEntityLabel = computed<string>(() => {
  if (realEntityLevel.value === 'class') return selectedRealClass.value?.className || '—'
  if (realEntityLevel.value === 'school') {
    if (isGovtAdminRole.value) return schoolOptionsForCourse.value.find((s) => s.id === selectedGovtSchoolId.value)?.school_name || '—'
    return currentUser.value?.school_name || 'Your school'
  }
  return currentUser.value?.organization_name || 'Your group'
})
const entityNoun = computed(() => (demoMode ? 'class' : realEntityLevel.value))

// Header fields all derive from the SELECTED class/entity, so switching
// updates the title AND the course label. Real path: COURSE_LABEL follows
// the course-first picker directly (course leads; it no longer rides on
// whichever class happens to be selected).
const SCHOOL_NAME = computed(() => (demoMode ? selectedDemoClass.value.school : (currentUser.value?.school_name || 'Your school')))
const CLASS_NAME = computed(() => (demoMode ? selectedDemoClass.value.className : (selectedRealClass.value?.className || '—')))
const COURSE_LABEL = computed(() => (demoMode ? selectedDemoClass.value.course : (selectedCourse.value || '—')))

// One header title spanning every level: demo (class/learner drill),
// real class (school context + class), real school (whole school), real
// group (whole group).
const headerTitle = computed(() => {
  if (demoMode) return `${SCHOOL_NAME.value} · ${scopeLabel.value}`
  if (realEntityLevel.value === 'class') return `${SCHOOL_NAME.value} · ${CLASS_NAME.value} · whole class`
  if (realEntityLevel.value === 'school') return `${realEntityLabel.value} · whole school`
  return `${realEntityLabel.value} · whole group`
})

// ── Drill scope: the class itself, or a learner within it. Real per-learner
// rate data doesn't exist yet (homework-sourced attention lane, tutor-
// insights.md §4 — a separate build), so the learner drill stays demo-only.
type Scope = 'class' | 'learner'
const scope = ref<Scope>('class')

// Deep-link from the schools Students table: a "View →" on a student opens this
// view pre-scoped to that learner (route query: scope=learner, learner=<id>,
// name=<display name>). We open in learner view and surface WHICH learner was
// requested. NOTE: the per-learner RATE data is still the deferred wiring — the
// widget below renders a seeded preview until the live resolver lands, so we say
// so plainly rather than implying these are this student's real figures.
const route = useRoute()
const requestedLearnerName = computed(() => {
  const n = route.query.name
  return (Array.isArray(n) ? n[0] : n) || ''
})
if (demoMode && route.query.scope === 'learner') scope.value = 'learner'
const entityLevel = computed<EntityLevel>(() => (scope.value === 'class' ? 'class' : 'learner'))

// ── Metric selection — real path is fixed to the one real metric (rate of
// progress); the other 5 HERO_RATES stay demo-only until their own resolvers
// exist (Principle 5, metrics-architecture.md — earn the signal, don't fake it).
const metricId = ref<string>('progressPace') // headline rate; the only real one
const currentMetric = computed(
  () => HERO_RATES.find((m) => m.id === metricId.value) ?? HERO_RATES[0],
)
const metricSelectOptions = computed(() => HERO_RATES.map((m) => ({ value: m.id, label: `${m.label} (${m.unit} / ${m.per})` })))

// ── Compare-to — demo keeps the full escalation ladder (class/year/school/…);
// real is the entity ladder the endpoint can actually compute, gated by
// LEVEL (owner's ruling): class -> school/group/global; school -> group/
// global; group -> region/global. Every option is an aggregate-only average
// (k-floor 5, held server-side at EVERY level, not just class).
//
// Every level ALSO offers a course-agnostic "all courses" global average
// alongside its same-course options (owner's follow-up ruling, 2026-07-14):
// relatedness is the STRENGTH of a comparison, not its permission — labelled
// explicitly ("this course" vs "all courses") so the weaker basis is always
// visible. It's listed LAST in each level (the most-related, same-course
// cohort stays the default/preferred pick — averageId defaults to it below).
const REAL_COMPARE_OPTIONS_BY_LEVEL: Record<RealEntityLevel, { value: string; label: string }[]> = {
  class: [
    { value: 'school', label: 'School average' },
    { value: 'group', label: 'Group average' },
    { value: 'global', label: 'Global average · this course' },
    { value: 'global_all_courses', label: 'Global average · all courses' },
  ],
  school: [
    { value: 'group', label: 'Group average' },
    { value: 'global', label: 'Global average · this course' },
    { value: 'global_all_courses', label: 'Global average · all courses' },
  ],
  group: [
    { value: 'region', label: 'Regional average' },
    { value: 'global', label: 'Global average · this course' },
    { value: 'global_all_courses', label: 'Global average · all courses' },
  ],
}
const averageId = ref<string>(demoMode ? 'class avg' : 'school')
const averageOptions = computed(() => listAverages(metricId.value)) // demo only
const averageSelectOptions = computed(() =>
  demoMode ? averageOptions.value.map((a) => ({ value: a, label: a })) : REAL_COMPARE_OPTIONS_BY_LEVEL[realEntityLevel.value],
)
watch(realEntityLevel, (level) => {
  if (demoMode) return
  const opts = REAL_COMPARE_OPTIONS_BY_LEVEL[level]
  if (!opts.find((o) => o.value === averageId.value)) averageId.value = opts[0].value
})

// ── The class entity (demo path only — matched by label into the demo
// population; the real path uses selectedRealClass.id directly). ───────────
const classEntityId = computed<string>(() => {
  const opts = listEntities(metricId.value, 'class')
  return (opts.find((o) => o.label === selectedDemoClass.value.label) ?? opts[0])?.value ?? ''
})

// ── The learner drill (demo path only). ─────────────────────────────────────
const learnerOptions = computed(() => listEntities(metricId.value, 'learner'))
const learnerEntityId = ref<string>('')
const entityId = computed<string>(() => (scope.value === 'class' ? classEntityId.value : learnerEntityId.value))

// ── Keep the demo selection coherent as the metric / scope changes ─────────
watch(metricId, () => {
  if (!demoMode) return
  const avgs = listAverages(metricId.value)
  if (!avgs.includes(averageId.value)) averageId.value = avgs[0] ?? 'class avg'
})
watch(
  [metricId, scope, selectedClassKey],
  ([, newScope], [, oldScope]) => {
    if (!demoMode || scope.value !== 'learner') return
    const opts = listEntities(metricId.value, 'learner')
    const classChanged = newScope === oldScope
    if (classChanged || !opts.find((o) => o.value === learnerEntityId.value)) {
      learnerEntityId.value = opts[0]?.value ?? ''
    }
  },
  { immediate: true },
)

// ── REAL fetch: GET /api/school/rate-compare, server-mediated (auth ->
// resolveVisibleScope -> analytics_class_sessions_scoped). Never throws to
// the template — insufficientData / network failure both degrade to an
// honest empty state, never a fabricated number. Two separate result refs
// (rather than one polymorphic union) so the template never has to narrow. ─
const realData = ref<RateComparisonData | null>(null)
const realInsufficientReason = ref<string | null>(null)
const isLoadingReal = ref(false)
const realFetchFailed = ref(false)

async function fetchRealComparison(): Promise<void> {
  if (demoMode) return
  const course = selectedCourse.value
  const entityId = realEntityId.value
  realData.value = null
  realInsufficientReason.value = null
  if (!course || !entityId) return
  isLoadingReal.value = true
  realFetchFailed.value = false
  try {
    const client = getSchoolsClient()
    const { data: { session } } = await client.auth.getSession()
    const token = session?.access_token
    if (!token) return
    const params = new URLSearchParams({
      course_code: course,
      entity_level: realEntityLevel.value,
      entity_id: entityId,
      compare_to: averageId.value,
    })
    const res = await fetch(`/api/school/rate-compare?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`rate-compare ${res.status}`)
    const json = await res.json() as { insufficientData: boolean; reason?: string } & Partial<RateComparisonData>
    if (json.insufficientData) {
      realInsufficientReason.value = json.reason || 'Not enough data to compare fairly yet.'
    } else {
      realData.value = json as RateComparisonData
    }
  } catch (e) {
    console.error('[TeacherInsightsView] rate-compare fetch failed:', e)
    realFetchFailed.value = true
  } finally {
    isLoadingReal.value = false
  }
}
watch([selectedCourse, realEntityLevel, realEntityId, averageId], () => { if (!demoMode) fetchRealComparison() }, { immediate: true })

// ── The resolved comparison ─────────────────────────────────────────────────
// Demo: seeded synthetic data, unchanged. Real: the server response, only when
// it cleared the k-floor — otherwise null, and the template shows the honest
// insufficient-data / loading / error state instead of a widget.
const comparison = computed<RateComparisonData | null>(() =>
  demoMode
    ? getRateComparison(metricId.value, entityLevel.value, entityId.value, averageId.value)
    : realData.value,
)

const insufficientReason = computed<string | null>(() => (demoMode ? null : realInsufficientReason.value))

// A friendly scope label for the header line.
const scopeLabel = computed(() =>
  scope.value === 'class'
    ? `${CLASS_NAME.value} · whole class`
    : `${CLASS_NAME.value} · one learner`,
)
</script>

<template>
  <!-- The teacher's dashboard nav is present in the standalone page; when
       embedded the schools shell (SchoolsTopBar) provides it instead. -->
  <TopNav v-if="!props.embedded" :force-tabs="true" />

  <div :class="['tiv-scroll', { 'tiv-scroll--embedded': props.embedded }]">
  <div class="tiv schools-surface">
    <!-- ── Calm, minimal teacher header (NOT the admin "Insight Engine") ── -->
    <header class="tiv-head">
      <div class="tiv-head-top">
        <span class="tiv-kicker">Your {{ entityNoun }}</span>
      </div>
      <h1 class="tiv-title">{{ headerTitle }}</h1>
      <p class="tiv-sub">
        How you're doing on <strong>{{ COURSE_LABEL }}</strong> — your {{ entityNoun }} compared
        with the average. Rate leads; position is just context.
      </p>
      <p v-if="requestedLearnerName" class="tiv-preview-note">
        Opened in learner view for <strong>{{ requestedLearnerName }}</strong>. The figures
        below are a seeded preview — live per-learner rates arrive once your school's
        telemetry is wired.
      </p>
    </header>

    <!-- ── Controls: course, entity level, your class/school/group, drill,
         metric, compare-to ── -->
    <div class="tiv-controls">
      <!-- Course — LEADS the board (course-first, owner's ruling 2026-07-14):
           every entity/aggregate below is resolved within this course only.
           Real path only — demo keeps its own fixed fixture population. -->
      <label v-if="!demoMode" class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Course</span>
        <FrostSelect v-model="selectedCourse" :options="courseSelectOptions" aria-label="Course" />
      </label>

      <!-- Entity level — only shown when the caller's role has more than one
           to choose from (school_admin: class/school; govt_admin: class/
           school/group). A teacher only ever sees their own classes. -->
      <div v-if="!demoMode && availableRealEntityLevels.length > 1" class="tiv-field">
        <span class="tiv-field-label">Level</span>
        <div class="tiv-segs" role="group" aria-label="Level">
          <button
            v-for="opt in availableRealEntityLevels"
            :key="opt.value"
            type="button"
            :class="['tiv-seg', { active: realEntityLevel === opt.value }]"
            :aria-pressed="realEntityLevel === opt.value"
            @click="realEntityLevel = opt.value"
          >{{ opt.label }}</button>
        </div>
      </div>

      <!-- Your classes — only ever the caller's OWN set (demo fixture, or the
           real role-scoped classes: teacher's own / school's / group's) -->
      <label v-if="demoMode || realEntityLevel === 'class'" class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Your classes</span>
        <FrostSelect v-model="selectedClassKey" :options="classSelectOptions" aria-label="Your classes" />
      </label>

      <!-- Your school — govt_admin picks WHICH school in their scope;
           school_admin has exactly one, shown as fixed text. -->
      <label v-if="!demoMode && realEntityLevel === 'school' && isGovtAdminRole" class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Your schools</span>
        <FrostSelect v-model="selectedGovtSchoolId" :options="schoolSelectOptions" aria-label="Your schools" />
      </label>
      <div v-else-if="!demoMode && realEntityLevel === 'school'" class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Your school</span>
        <p class="tiv-fixed-measure">{{ realEntityLabel }}</p>
      </div>

      <!-- Your group — govt_admin's own group, always fixed (they have one). -->
      <div v-if="!demoMode && realEntityLevel === 'group'" class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Your group</span>
        <p class="tiv-fixed-measure">{{ realEntityLabel }}</p>
      </div>

      <!-- Drill: the class, or a learner within it — demo-only (no real
           per-learner rate data yet; see tutor-insights.md §4). -->
      <div v-if="demoMode" class="tiv-field">
        <span class="tiv-field-label">View</span>
        <div class="tiv-segs" role="group" aria-label="View">
          <button
            type="button"
            :class="['tiv-seg', { active: scope === 'class' }]"
            :aria-pressed="scope === 'class'"
            @click="scope = 'class'"
          >Whole class</button>
          <button
            type="button"
            :class="['tiv-seg', { active: scope === 'learner' }]"
            :aria-pressed="scope === 'learner'"
            @click="scope = 'learner'"
          >A learner</button>
        </div>
      </div>

      <!-- Learner picker — demo-only, only when drilled in -->
      <label v-if="demoMode && scope === 'learner'" class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Learner in {{ CLASS_NAME }}</span>
        <FrostSelect v-model="learnerEntityId" :options="learnerOptions" :aria-label="`Learner in ${CLASS_NAME}`" />
      </label>

      <!-- Metric — demo can browse all 6 HERO_RATES; real is fixed to the one
           real metric (rate of progress), shown as plain text instead. -->
      <label v-if="demoMode" class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Measure</span>
        <FrostSelect v-model="metricId" :options="metricSelectOptions" aria-label="Measure" />
      </label>
      <div v-else class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Measure</span>
        <p class="tiv-fixed-measure">{{ currentMetric.label }} ({{ currentMetric.unit }} / {{ currentMetric.per }})</p>
      </div>

      <!-- Average (aggregate cohorts only — never another named entity) -->
      <label class="tiv-field">
        <span class="tiv-field-label">Compare to</span>
        <FrostSelect v-model="averageId" :options="averageSelectOptions" aria-label="Compare to" />
      </label>
    </div>

    <!-- ── One-line read of what this measure means ── -->
    <p class="tiv-metric-desc">{{ currentMetric.description }}</p>

    <!-- ── The one widget — nothing else on this page. Real path: an honest
         loading / insufficient-data state stands in for a widget rather than
         ever rendering a fabricated number. ── -->
    <div v-if="comparison" class="tiv-widget-card">
      <RateCompare :data="comparison" />
    </div>
    <div v-else-if="isLoadingReal" class="tiv-widget-card tiv-widget-status">
      <p>Loading your {{ entityNoun }}'s rate…</p>
    </div>
    <div v-else-if="insufficientReason" class="tiv-widget-card tiv-widget-status">
      <p>{{ insufficientReason }}</p>
    </div>
    <div v-else-if="realFetchFailed" class="tiv-widget-card tiv-widget-status">
      <p>Couldn't load your {{ entityNoun }}'s rate just now — try again shortly.</p>
    </div>
    <div v-else class="tiv-widget-card tiv-widget-status">
      <p>No classes yet — once you have a class with sessions, its rate compares here.</p>
    </div>
  </div>
  </div>
</template>

<style scoped>
/* ============================================================================
 * ROLE TOKENS — the small palette every coloured element references. ONE green/
 * blue scheme (no look switcher): each token is an "r, g, b" triplet consumed as
 * rgba(var(--rc-…), α). Semantics: blue = primary/selection, green = success/
 * active, gold = warning (--tone-gold, unchanged).
 *   --rc-entity    identity / "You" / active states / eyebrows   → BLUE
 *   --rc-positive  the genuinely-good delta + chip                → DEEP GREEN
 *   --rc-secondary average / cohort secondary ink                 → NEUTRAL GREY
 *   --rc-band      distribution band tint base (low alpha)        → GREEN
 *   --rc-glow      glow colour (hero number, You-dot, trend line) → BLUE
 *   --rc-entity-ink  a DEEPER blue for blue TEXT on white/glass, so small
 *                    labels stay legible (HIG contrast) while fills/strokes/
 *                    glows keep the lighter --rc-entity. Used only as a colour.
 * ============================================================================ */

/* Full-width scroll container. The app shell pins body { overflow: hidden } so
 * the player can't scroll-bounce — which means any long content page must own
 * its OWN scroll. The grey canvas shows at the sides; the .tiv column keeps the
 * green/blue atmosphere. */
.tiv-scroll {
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--bg-primary, #e8e3dd);
  /* Clear the fixed TopNav so content starts below it. */
  padding-top: calc(var(--nav-height, 80px) + env(safe-area-inset-top, 0px));
}

/* Embedded inside SchoolsContainer: the shell owns the top bar AND the page
 * scroll, so drop the full-viewport height, the own overflow, and the
 * nav-clearing padding. The content just flows in the shell's content area. */
.tiv-scroll--embedded {
  height: auto;
  min-height: 0;
  overflow-y: visible;
  padding-top: 0;
  background: transparent;
}
.tiv-scroll--embedded .tiv {
  min-height: 0;
}

.tiv {
  --rc-entity:     96, 165, 250;
  --rc-entity-ink: 37, 99, 235;
  --rc-positive:   21, 128, 61;
  --rc-secondary:  138, 128, 120;
  --rc-band:       74, 222, 128;
  --rc-glow:       96, 165, 250;

  max-width: 980px;
  margin: 0 auto;
  padding: 32px 24px 56px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: calc(100dvh - var(--nav-height, 80px));
  position: relative;
  isolation: isolate;
  /* STEP 4 — the soft green/blue colour atmosphere UNDER the content, so the
   * glass chrome floating above it has real colour to refract (that's the pop).
   * Light, not heavy: ~12-20% tints fading to transparent. */
  background:
    radial-gradient(760px 400px at 16% -8%, rgba(74, 222, 128, 0.20), transparent 60%),
    radial-gradient(720px 380px at 92% 2%, rgba(96, 165, 250, 0.20), transparent 58%),
    radial-gradient(900px 520px at 55% 112%, rgba(96, 165, 250, 0.12), transparent 60%),
    var(--schools-bg, #f6f5f1);
}

/* ── Header (glass chrome — STEP 2) ── */
.tiv-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 22px 16px;
  /* regular-material glass: light, lit by edges + sheen, not heavy opacity */
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    0 1px 2px rgba(44, 38, 34, 0.05),
    0 10px 28px rgba(44, 38, 34, 0.10);
}
/* One subtle brand mark — a short blue rule under the header block. */
.tiv-head::after {
  content: '';
  width: 40px;
  height: 2px;
  margin-top: 4px;
  border-radius: 1px;
  background: rgba(var(--rc-entity), 0.9);
  box-shadow: 0 0 10px rgba(var(--rc-glow), 0.35);
}
/* header top row: kicker */
.tiv-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.tiv-kicker {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(var(--rc-entity-ink), 1);
}

.tiv-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(26px, 4vw, 38px);
  line-height: 1.06;
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 4px 0 2px;
}
.tiv-sub {
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink-secondary);
  max-width: 56ch;
  margin: 0;
}
.tiv-sub strong { color: var(--ink-primary); }

/* Deep-link preview note — a quiet honest line when arriving from a student's
 * "View →" before live per-learner data is wired. */
.tiv-preview-note {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-secondary);
  background: rgba(var(--rc-entity), 0.08);
  border: 1px solid rgba(var(--rc-entity), 0.2);
  border-radius: 10px;
  padding: 9px 12px;
  margin: 2px 0 0;
  max-width: 56ch;
}
.tiv-preview-note strong { color: rgba(var(--rc-entity-ink), 1); }

/* ── Controls bar (glass chrome — STEP 2) ── */
.tiv-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  padding: 16px 18px;
  /* regular-material glass — the controls bar floats above the atmosphere */
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    0 1px 2px rgba(44, 38, 34, 0.05),
    0 10px 28px rgba(44, 38, 34, 0.10);
}
.tiv-field { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
.tiv-field-wide { flex: 1 1 220px; min-width: 220px; }
.tiv-field-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}
/* Selects = a LIGHTER glass material (control pills floating on the bar). */
.tiv-select {
  appearance: none;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(12px) saturate(1.6);
  -webkit-backdrop-filter: blur(12px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  padding: 9px 12px;
  cursor: pointer;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.tiv-select:hover { border-color: rgba(var(--rc-entity), 0.55); }
.tiv-select:focus {
  outline: none;
  border-color: rgba(var(--rc-entity), 0.7);
  box-shadow: 0 0 0 3px rgba(var(--rc-entity), 0.18);
}

/* ── Segmented drill switch (lighter glass — STEP 2) ── */
.tiv-segs {
  display: inline-flex;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(12px) saturate(1.6);
  -webkit-backdrop-filter: blur(12px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  overflow: hidden;
}
.tiv-seg {
  appearance: none;
  background: transparent;
  border: none;
  padding: 9px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.tiv-seg + .tiv-seg { border-left: 1px solid rgba(255, 255, 255, 0.55); }
.tiv-seg:hover:not(.active) { color: var(--ink-primary); }
/* Active segment = blue tint + (legible) blue text + inset blue underline. */
.tiv-seg.active {
  background: rgba(var(--rc-entity), 0.14);
  color: rgba(var(--rc-entity-ink), 1);
  box-shadow: inset 0 -2px 0 rgba(var(--rc-entity), 0.9);
}

/* ── Measure description ── */
.tiv-metric-desc {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-secondary);
  margin: 0;
  max-width: 64rem;
}

/* ── Widget card (CONTENT — STEP 3: clean, near-solid, NO glass) ── */
/* The data must read crisply, so the content card is opaque: no backdrop-filter,
 * a hairline ink border, and a soft drop shadow lifting it off the atmosphere. */
.tiv-widget-card {
  padding: 24px 26px;
  background: #ffffff;
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: 18px;
  box-shadow:
    0 1px 2px rgba(44, 38, 34, 0.05),
    0 14px 34px rgba(44, 38, 34, 0.08);
}
/* Honest empty/loading states standing in for the widget on the real path —
 * never a fabricated number. */
.tiv-widget-status {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  text-align: center;
}
.tiv-widget-status p {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink-secondary);
  max-width: 42ch;
  margin: 0;
}
/* Real-path fixed "Measure" readout — visually matches a FrostSelect pill
 * without being one (there's nothing to choose yet). */
.tiv-fixed-measure {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  padding: 9px 12px;
  margin: 0;
}

/* ── Responsive ── */
@media (max-width: 720px) {
  .tiv-field, .tiv-field-wide { width: 100%; min-width: 0; }
}

/* ── Accessibility (HIG built-in — STEP 6) ── */
/* Reduced transparency: the glass chrome becomes opaque (no blur), so the design
 * still reads for anyone who's turned transparency down. Content was already
 * opaque, so nothing there changes. */
@media (prefers-reduced-transparency: reduce) {
  .tiv-head,
  .tiv-controls,
  .tiv-select,
  .tiv-segs {
    background: rgba(255, 255, 255, 0.94) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}
/* Reduced motion: drop the hover/focus transitions on this view. */
@media (prefers-reduced-motion: reduce) {
  .tiv *,
  .tiv *::before,
  .tiv *::after {
    transition: none !important;
    animation: none !important;
  }
}
</style>
