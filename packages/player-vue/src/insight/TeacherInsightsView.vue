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
// DB call) — the same short-circuit the admin boards use. Without ?demo there's
// no teacher RPC yet, so it shows a quiet "preview with ?demo" note rather than
// hitting an unbuilt resolver.
//
// Frostwell Courtyard idiom, warm + minimal. No hardcoded hex — tokens carry it.
// ============================================================================
import { ref, computed, watch } from 'vue'
import RateCompare from './components/RateCompare.vue'
import { isInsightDemo } from './data/demo'
import {
  HERO_RATES,
  getRateComparison,
  listEntities,
  listAverages,
  type EntityLevel,
} from './data/demoRates'
import type { RateComparisonData } from './spec'
import '@/styles/schools-tokens.css'

const demoMode = isInsightDemo()

// ── The teacher's OWN classes ───────────────────────────────────────────────
// A teacher usually teaches more than one class, so they pick among THEIR set —
// never any class outside it. Every label here must exist verbatim in
// CLASS_NAMES (demoRates.ts) so it resolves to a real population. The set spans
// ≥2 courses so switching class also changes the course in the header.
// (In the real path this set comes from the teacher's session, not hardcoded.)
interface TeacherClass {
  label: string      // exact CLASS_NAMES entry — `${school} · ${className}`
  school: string
  className: string
  course: string
}
const MY_CLASSES: TeacherClass[] = [
  { label: 'Ysgol Bryn · Year 7 Spanish', school: 'Ysgol Bryn', className: 'Year 7 Spanish', course: 'Spanish for English speakers' },
  { label: 'Ysgol Bryn · Year 8 Spanish', school: 'Ysgol Bryn', className: 'Year 8 Spanish', course: 'Spanish for English speakers' },
  { label: 'Coleg Tâf · French AS',       school: 'Coleg Tâf',  className: 'French AS',       course: 'French for English speakers' },
]

// The selected class — defaults to the teacher's first class.
const selectedClassLabel = ref<string>(MY_CLASSES[0].label)
const selectedClass = computed<TeacherClass>(
  () => MY_CLASSES.find((c) => c.label === selectedClassLabel.value) ?? MY_CLASSES[0],
)

// Header fields all derive from the SELECTED class, so switching class updates
// the title AND the course label.
const SCHOOL_NAME = computed(() => selectedClass.value.school)
const CLASS_NAME = computed(() => selectedClass.value.className)
const COURSE_LABEL = computed(() => selectedClass.value.course)

// ── Drill scope: the class itself, or a learner within it ───────────────────
type Scope = 'class' | 'learner'
const scope = ref<Scope>('class')
const entityLevel = computed<EntityLevel>(() => (scope.value === 'class' ? 'class' : 'learner'))

// ── Metric + average selection (rate metrics; aggregate cohorts only) ────────
const metricId = ref<string>('progressPace') // headline rate by default
const averageId = ref<string>('course avg')

const currentMetric = computed(
  () => HERO_RATES.find((m) => m.id === metricId.value) ?? HERO_RATES[0],
)

// Averages valid for the chosen metric — every option is an AGGREGATE cohort.
const averageOptions = computed(() => listAverages(metricId.value))

// ── The class entity: the SELECTED one of the teacher's own classes, resolved
// by NAME so it is the SAME class across every measure (listEntities is
// value-sorted, so opts[0] is the top class for the metric, not necessarily
// ours — match on label). The picker only ever offers MY_CLASSES, so we never
// expose any class outside the teacher's set as a selectable entity.
const classEntityId = computed<string>(() => {
  const opts = listEntities(metricId.value, 'class')
  return (opts.find((o) => o.label === selectedClass.value.label) ?? opts[0])?.value ?? ''
})

// ── The learner drill: learners WITHIN the class (the learner-level population).
// This is the only other entity the teacher may select — a pupil they teach.
const learnerOptions = computed(() => listEntities(metricId.value, 'learner'))
const learnerEntityId = ref<string>('')

// The active entity id for the current scope.
const entityId = computed<string>(() =>
  scope.value === 'class' ? classEntityId.value : learnerEntityId.value,
)

// ── Keep the selection coherent as the metric / scope changes ───────────────
// Snap the average into the metric's valid (aggregate) set.
watch(metricId, () => {
  const avgs = listAverages(metricId.value)
  if (!avgs.includes(averageId.value)) averageId.value = avgs[0] ?? 'course avg'
})

// Re-anchor the learner pick to the first learner whenever the metric/scope/
// class makes the current pick invalid (e.g. switching into the learner drill,
// or switching to another of the teacher's classes — the drill is always
// learners WITHIN the selected class).
watch(
  [metricId, scope, selectedClassLabel],
  ([, newScope], [, oldScope]) => {
    if (scope.value !== 'learner') return
    const opts = listEntities(metricId.value, 'learner')
    // On a class change while drilled in, restart from the first learner.
    const classChanged = newScope === oldScope
    if (classChanged || !opts.find((o) => o.value === learnerEntityId.value)) {
      learnerEntityId.value = opts[0]?.value ?? ''
    }
  },
  { immediate: true },
)

// ── The resolved comparison (demo: deterministic; real path: TODO) ──────────
const comparison = computed<RateComparisonData | null>(() => {
  if (!demoMode) return null
  return getRateComparison(
    metricId.value,
    entityLevel.value,
    entityId.value,
    averageId.value,
  )
})

// A friendly scope label for the header line.
const scopeLabel = computed(() =>
  scope.value === 'class'
    ? `${CLASS_NAME.value} · whole class`
    : `${CLASS_NAME.value} · one learner`,
)
</script>

<template>
  <div class="tiv schools-surface">
    <!-- ── Warm, minimal teacher header (NOT the admin "Insight Engine") ── -->
    <header class="tiv-head">
      <span class="tiv-kicker">Your class</span>
      <h1 class="tiv-title">{{ SCHOOL_NAME }} · {{ scopeLabel }}</h1>
      <p class="tiv-sub">
        How you're doing on <strong>{{ COURSE_LABEL }}</strong> — your class compared
        with the average. Rate leads; position is just context.
      </p>
    </header>

    <!-- ── Controls: your class, drill (class / learner), metric, compare-to ── -->
    <div class="tiv-controls">
      <!-- Your classes — only ever the teacher's OWN set -->
      <label class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Your classes</span>
        <select v-model="selectedClassLabel" class="tiv-select">
          <option v-for="c in MY_CLASSES" :key="c.label" :value="c.label">
            {{ c.label }}
          </option>
        </select>
      </label>

      <!-- Drill: the class, or a learner within it -->
      <div class="tiv-field">
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

      <!-- Learner picker — only when drilled in; learners within THIS class -->
      <label v-if="scope === 'learner'" class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Learner in {{ CLASS_NAME }}</span>
        <select v-model="learnerEntityId" class="tiv-select">
          <option v-for="l in learnerOptions" :key="l.value" :value="l.value">
            {{ l.label }}
          </option>
        </select>
      </label>

      <!-- Metric -->
      <label class="tiv-field tiv-field-wide">
        <span class="tiv-field-label">Measure</span>
        <select v-model="metricId" class="tiv-select">
          <option v-for="m in HERO_RATES" :key="m.id" :value="m.id">
            {{ m.label }} ({{ m.unit }} / {{ m.per }})
          </option>
        </select>
      </label>

      <!-- Average (aggregate cohorts only — never another named entity) -->
      <label class="tiv-field">
        <span class="tiv-field-label">Compare to</span>
        <select v-model="averageId" class="tiv-select">
          <option v-for="a in averageOptions" :key="a" :value="a">{{ a }}</option>
        </select>
      </label>
    </div>

    <!-- ── One-line read of what this measure means ── -->
    <p class="tiv-metric-desc">{{ currentMetric.description }}</p>

    <!-- ── The one widget — nothing else on this page ── -->
    <div class="tiv-widget-card">
      <RateCompare v-if="comparison" :data="comparison" />

      <!-- Real-path note (no ?demo): no DB call, point to the preview. -->
      <div v-else class="tiv-real-note">
        <p class="tiv-real-lead">This view runs in preview today.</p>
        <p class="tiv-real-fine">
          The live teacher data path isn't wired yet. Append <code>?demo</code> to
          the URL to preview your class vs the average now.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tiv {
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 24px 56px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100vh;
  background: var(--schools-bg, #f6f5f1);
}

/* ── Warm teacher header ── */
.tiv-head { display: flex; flex-direction: column; gap: 6px; padding-bottom: 6px; }
/* One subtle brand mark — a short SSi-red rule under the header block. */
.tiv-head::after {
  content: '';
  width: 40px;
  height: 2px;
  margin-top: 4px;
  border-radius: 1px;
  background: rgba(var(--tone-accent), 0.9);
}
.tiv-kicker {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(var(--tone-accent), 1);
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

/* ── Controls ── */
.tiv-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  padding: 16px 18px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 12px;
}
.tiv-field { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
.tiv-field-wide { flex: 1 1 220px; min-width: 220px; }
.tiv-field-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.tiv-select {
  appearance: none;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-primary);
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.18);
  border-radius: 9px;
  padding: 9px 12px;
  cursor: pointer;
  transition: border-color 140ms ease;
}
.tiv-select:hover { border-color: rgba(var(--tone-accent), 0.55); }
.tiv-select:focus {
  outline: none;
  border-color: rgba(var(--tone-accent), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-accent), 0.12);
}

/* ── Segmented drill switch ── */
.tiv-segs { display: inline-flex; border: 1px solid rgba(44, 38, 34, 0.15); border-radius: 9px; overflow: hidden; }
.tiv-seg {
  appearance: none;
  background: var(--schools-card, #fff);
  border: none;
  padding: 9px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.tiv-seg + .tiv-seg { border-left: 1px solid rgba(44, 38, 34, 0.12); }
.tiv-seg:hover:not(.active) { color: var(--ink-primary); }
.tiv-seg.active {
  background: rgba(var(--tone-accent), 0.10);
  color: rgba(var(--tone-accent), 1);
  box-shadow: inset 0 -2px 0 rgba(var(--tone-accent), 0.9);
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

/* ── Widget card ── */
.tiv-widget-card {
  padding: 24px 26px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 16px;
}

/* ── Real-path note ── */
.tiv-real-note { display: flex; flex-direction: column; gap: 6px; }
.tiv-real-lead { font-size: 14px; color: var(--ink-secondary); margin: 0; }
.tiv-real-fine {
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ink-muted);
  margin: 0;
}
.tiv-real-fine code {
  font-family: var(--font-mono);
  background: color-mix(in srgb, var(--ink-primary) 6%, transparent);
  padding: 1px 5px;
  border-radius: 5px;
  color: var(--ink-secondary);
}

/* ── Responsive ── */
@media (max-width: 720px) {
  .tiv-field, .tiv-field-wide { width: 100%; min-width: 0; }
}
</style>
