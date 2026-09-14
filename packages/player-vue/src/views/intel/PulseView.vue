<script setup lang="ts">
/**
 * Question 1 — MINUTES. The Intelligence landing.
 *
 * Tom, 2026-09-13: "why is intelligence still counting by people? the number
 * of people is really irrelevant, it is what is being DONE. how many in-app
 * minutes, per course, per course-person ... using the insights tool we have
 * built for learners? ... this course v average of all courses."
 *
 * So the evidence here IS the insight engine (NodeRateEngine + the RateCompare
 * widget) at Everyone scope: window × course × measure, this course against
 * the average of all courses, with the anonymised distribution strip. The
 * headline measure is in-app minutes per person on the course, main flow and
 * Listening Mode split beneath it; total in-app minutes, new enrolments and
 * people with no activity sit in the same measure picker. The average of all
 * courses INCLUDES the selected course and is learner-weighted for the ratio
 * measures (Tom, 2026-09-14), so it is one number for a window and a measure
 * whichever course is picked. One minute definition serves this page and
 * every school surface (api/_utils/inAppTime.ts).
 *
 * The count of people that used to lead this page is kept BELOW the engine,
 * as the rows — still true, still reachable, no longer the front door.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QuestionPage from '@/intel/QuestionPage.vue'
import NodeRateEngine from '@/insight/NodeRateEngine.vue'
import { useIntelApi } from '@/intel/useIntelApi'
import { useAdminClient } from '@/composables/useAdminClient'
import { questionBySlug } from '@/intel/questions'
import { metric } from '@/intel/metrics'

interface PulseCourseRow { course: string; thisWeek: number; lastWeek: number }
interface StandingCounts { paying: number; gifted: number; free: number }
interface PulseResponse {
  thisWeek: number
  lastWeek: number
  population: number
  standing: StandingCounts
  courses: PulseCourseRow[]
  countedAt: string
}
interface MinutesSplit { minutes: number; mainMinutes: number; listeningMinutes: number; people: number; activePeople: number; newEnrolments: number }
interface MinutesBody {
  insufficientData: boolean
  reason?: string
  windowLabel?: string
  population?: number
  entity?: { label: string; value: number }
  average?: { label: string; value: number }
  applied?: { measure?: string; course_code?: string | null }
  split?: MinutesSplit
  listeningExactFrom?: string
  countedAt?: string
}

const question = questionBySlug('pulse')!
const route = useRoute()
const router = useRouter()
const { getAuthToken } = useAdminClient()

// ?course= / ?window= / ?measure= are the deep link; the engine resolves
// defaults and reflects them back so a copied URL reproduces the view.
const course = ref<string | null>(typeof route.query.course === 'string' ? route.query.course : null)
const window_ = ref<string | null>(typeof route.query.window === 'string' ? route.query.window : null)
const measure = ref<string | null>(typeof route.query.measure === 'string' ? route.query.measure : null)
watch([course, window_, measure], ([c, w, m]) => {
  void router.replace({ query: { ...route.query, course: c || undefined, window: w || undefined, measure: m || undefined } })
})
watch(
  () => [route.query.course, route.query.window, route.query.measure],
  ([qc, qw, qm]) => {
    course.value = typeof qc === 'string' ? qc : null
    window_.value = typeof qw === 'string' ? qw : null
    measure.value = typeof qm === 'string' ? qm : null
  },
)

const body = ref<MinutesBody | null>(null)
const fetchedAt = ref<Date | null>(null)
function onData(json: Record<string, unknown> | null): void {
  body.value = json as unknown as MinutesBody | null
  fetchedAt.value = json ? new Date() : null
}

const minutesPerPersonMetric = metric('minutesPerPerson', question.slug)
const minutesTotalMetric = metric('minutesTotal', question.slug)
const newEnrolmentsMetric = metric('newEnrolments', question.slug)
const noActivityMetric = metric('noActivity', question.slug)
// The kicker names the measure on show, from the registry that owns it.
const minutesMetric = computed(() => {
  switch (body.value?.applied?.measure ?? measure.value) {
    case 'minutes_total': return minutesTotalMetric
    case 'new_enrolments': return newEnrolmentsMetric
    case 'no_activity': return noActivityMetric
    default: return minutesPerPersonMetric
  }
})

// The people rows: the old pulse, kept beneath the engine.
const pulse = useIntelApi<PulseResponse>('/api/intel/pulse')
onMounted(() => { void pulse.load() })

const answer = computed<string | null>(() => {
  const b = body.value
  if (!b) return null
  if (b.insufficientData) return b.reason ?? 'Not enough to compare yet.'
  const s = b.split
  const win = (b.windowLabel ?? 'the period').toLowerCase()
  const name = b.entity?.label ?? 'this course'
  if (b.applied?.measure === 'new_enrolments') {
    return `${b.entity?.value ?? 0} real people joined ${name} ${win === 'today' ? 'today' : `in the ${win}`}, against ${b.average?.value ?? 0} for the average course.`
  }
  if (b.applied?.measure === 'no_activity') {
    return `${b.entity?.value ?? 0}% of the people on ${name} did not press play ${win === 'today' ? 'today' : `in the ${win}`}, against ${b.average?.value ?? 0}% for the average course.`
  }
  if (!s) return null
  const when = win === 'today' ? 'today' : `in the ${win}`
  const modes = `${s.mainMinutes.toLocaleString('en-GB')} of those were in the main flow and ${s.listeningMinutes.toLocaleString('en-GB')} in Listening Mode.`
  if (b.applied?.measure === 'minutes_total') {
    return `${s.minutes.toLocaleString('en-GB')} in-app minutes were done on ${name} ${when}, by ${s.activePeople.toLocaleString('en-GB')} of the ${s.people.toLocaleString('en-GB')} people on it, against ${(b.average?.value ?? 0).toLocaleString('en-GB')} for the average course. ${modes}`
  }
  const per = b.entity?.value ?? 0
  return `${s.minutes.toLocaleString('en-GB')} in-app minutes were done on ${name} ${when}, ${per} per person on the course, against ${b.average?.value ?? 0} per person across all courses. ${modes}`
})

const headline = computed(() => {
  const b = body.value
  if (!b || b.insufficientData || !b.entity) return null
  return b.applied?.measure === 'no_activity' ? `${b.entity.value}%` : String(b.entity.value)
})

const listeningNote = computed(() => {
  const from = body.value?.listeningExactFrom
  if (!from) return null
  const d = new Date(from)
  return `Listening Mode minutes are exact from ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Before that the player sent only a heartbeat every thirty seconds, so earlier listening minutes are bounded by those, never invented.`
})

const standingLine = computed<string | null>(() => {
  const s = pulse.data.value?.standing
  if (!s) return null
  const total = s.paying + s.gifted + s.free
  if (total === 0) return null
  return `${s.paying} paying, ${s.gifted} gifted, ${s.free} on free access.`
})

const courseRows = computed(() => pulse.data.value?.courses ?? [])

function change(row: PulseCourseRow): string {
  const diff = row.thisWeek - row.lastWeek
  if (diff === 0) return 'no change'
  return diff > 0 ? `+${diff}` : String(diff)
}
</script>

<template>
  <!-- HANDBOOK How many in-app minutes are being done
       section: seeing-progress
       roles: admin
       place: intel
       keywords: minutes, in-app, per person, total, course, compare, average, listening mode, main flow, enrolments, no activity
       What it's for. The first question: how many in-app minutes are being done,
       per course, in total and per person on the course, and how each course
       stands against the average of all courses. A minute is everything between
       pressing play and stopping, on every screen, and Listening Mode minutes are
       shown apart from main-flow minutes. The average of all courses is the same
       number whichever course you pick: it counts this course too, and for the
       per-person and no-activity measures it is worked out over every person on
       every course, so a course with two enrolments weighs two people, not a
       whole course.
       Where it is. **Minutes**, the first question in the bar, and where
       Intelligence opens.
       How you do it.
       1. Pick the **window**: today, the last seven days or the last thirty days.
       2. Pick the **course**. It opens on the busiest course in that window.
       3. Pick the **measure**: minutes per person, minutes in total, new
          enrolments, or people with no activity. The line under the pickers says
          what it counts and what the average of all courses is for it.
       4. Read the two numbers: this course against the average of all courses, and
          the strip beneath for where the course sits among the rest.
       5. Read the line under the strip for the split between the main flow and
          Listening Mode, and how many people the minutes are spread over.
       6. The rows further down still count the real people who practised this
          week, by course; open one to see which bits of the course give trouble.
       Worth knowing. Every minute here is the same minute every school page shows,
       and a person on the course who did not press play still counts in the
       denominator.
       checked: 9b54ef0d.0b34bb8a
  -->
  <QuestionPage
    data-intel="question-pulse"
    :question="question.question"
    :answer="answer"
    :headline="headline"
    :fetched-at="fetchedAt"
    :people="body?.population ?? pulse.data.value?.population ?? null"
  >
    <template #evidence>
      <p class="metric-kicker">{{ minutesMetric.label }}</p>
      <NodeRateEngine
        node-id="everyone"
        endpoint="/api/intel/minutes"
        v-model:course="course"
        v-model:window="window_"
        v-model:measure="measure"
        :get-token="getAuthToken"
        @data="onData"
      />
      <p v-if="listeningNote" class="note">{{ listeningNote }}</p>
    </template>

    <template #rows>
      <div class="rows-card">
        <p class="rows-title">{{ metric('peopleByCourse', question.slug).label }}</p>
        <p v-if="standingLine" class="standing">{{ standingLine }}</p>
        <p v-if="pulse.data.value && courseRows.length === 0" class="rows-empty">
          Nobody practised anything in the last fourteen days.
        </p>
        <router-link
          v-for="row in courseRows"
          :key="row.course"
          class="row"
          :to="{ path: '/intel/weak-points', query: { course: row.course } }"
        >
          <span class="row-name">{{ row.course }}</span>
          <span class="row-values">
            <span class="num">{{ row.thisWeek }}</span>
            <span class="delta">{{ change(row) }}</span>
          </span>
        </router-link>
      </div>
    </template>
  </QuestionPage>
</template>

<style scoped>
.metric-kicker {
  margin: 0 0 10px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
}
.note {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--schools-fg-3);
}
.rows-card {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg, 12px);
  overflow: hidden;
}
.rows-title {
  padding: 14px 18px 10px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red);
}
.standing {
  margin: 0;
  padding: 0 18px 12px;
  font-size: 13px;
  color: var(--schools-fg-3);
}
.rows-empty { padding: 0 18px 16px; color: var(--schools-fg-3); font-size: 14px; }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 18px;
  border-top: 1px solid var(--schools-border);
  color: var(--schools-fg);
  text-decoration: none;
}
.row:hover { background: var(--schools-bg); }
.row-name { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.row-values { display: flex; align-items: baseline; gap: 12px; }
.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 15px; }
.delta { font-size: 12px; color: var(--schools-fg-3); min-width: 5ch; text-align: right; }
</style>
