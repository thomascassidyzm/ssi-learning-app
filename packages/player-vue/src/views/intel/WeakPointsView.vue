<script setup lang="ts">
/**
 * Question 4 — the weak points.
 *
 * "Which bits of a course make people stumble, skip or retry?" A learner who
 * skips a LEGO, retries audio or stops inside one is telling us about the
 * content, not about themselves.
 *
 * MOST COURSES WILL SAY "too few learners to say" AND THAT IS THE ANSWER. 87
 * real people have a position in any course at all, spread across 53 courses.
 * The one thing this page must never do is look livelier than the evidence
 * behind it, so the floor is the server's and this page only reports what it
 * decided.
 *
 * Rows are LEGOs, showing both languages. Position is a LEGO, never a seed
 * number.
 */
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import QuestionPage from '@/intel/QuestionPage.vue'
import InsightWidget from '@/insight/InsightWidget.vue'
import { useIntelApi } from '@/intel/useIntelApi'
import { QUESTIONS } from '@/intel/questions'
import type { AnyInsightSpec, ResolvedInsight } from '@/insight/spec'

interface WeakPointRow {
  legoId: string
  knownText: string | null
  targetText: string | null
  plays: number
  skips: number
  retries: number
  failures: number
  learnersReached: number
  stoppedShare: number | null
}
interface WeakPointsResponse {
  course: string
  days: number
  learners: number
  tooFewToSay: boolean
  kFloor: number
  rows: WeakPointRow[]
  truncated: boolean
  countedAt: string
}
interface PulseResponse { population: number; courses: { course: string; thisWeek: number }[] }

const question = QUESTIONS.find((q) => q.slug === 'weak-points')!
const route = useRoute()

// The rail's course list is the same real-population read the pulse does, so
// the courses offered here are courses real people are actually in.
const pulse = useIntelApi<PulseResponse>('/api/intel/pulse')
const weak = useIntelApi<WeakPointsResponse>('/api/intel/weak-points')

const course = computed(() => (route.query.course as string | undefined) || null)

const railCourses = computed(() =>
  (pulse.data.value?.courses ?? []).map((c) => ({ code: c.course, name: c.course })),
)

function reload(): void {
  if (course.value) void weak.load({ course: course.value })
}

onMounted(() => {
  void pulse.load()
  reload()
})
watch(course, reload)

const answer = computed<string | null>(() => {
  if (!course.value) return 'Pick a course on the left to see which of its bits people stumble on.'
  if (weak.error.value) return weak.error.value
  const d = weak.data.value
  if (!d) return null
  if (d.tooFewToSay) {
    return d.learners === 0
      ? 'Nobody has practised this course recently, so there is nothing to say about it.'
      : `Too few learners in this course to say. ${d.learners} real ${d.learners === 1 ? 'person has' : 'people have'} practised it, and we do not report below ${d.kFloor}.`
  }
  const top = d.rows[0]
  if (!top) return `${d.learners} real people practised this course, and none of them stumbled anywhere we can see.`
  return `${d.learners} real people practised this course. The bit that gave them the most trouble was "${top.knownText ?? top.legoId}".`
})

const headline = computed(() => {
  const d = weak.data.value
  if (!course.value || !d || d.tooFewToSay) return null
  return String(d.rows.length)
})

const spec = computed<AnyInsightSpec>(() => ({
  widget: 'ranked-bar',
  query: { metric: 'weakPoints', entity: 'lego', course: course.value ?? undefined },
  frame: 'content',
  title: 'The bits that caused the most trouble',
  tag: 'legos',
}))

const resolved = computed<ResolvedInsight>(() => ({
  isLoading: !!course.value && !weak.data.value && !weak.error.value,
  error: weak.error.value,
  data: {
    kind: 'ranked-bar',
    bars: (weak.data.value?.rows ?? []).slice(0, 10).map((r) => ({
      id: r.legoId,
      label: r.knownText || r.legoId,
      value: Math.round(((r.skips + r.retries + r.failures) / Math.max(1, r.learnersReached)) * 10) / 10,
    })),
    unit: 'per person',
    horizontal: true,
  },
}))

const rows = computed(() => weak.data.value?.rows ?? [])

function stopped(r: WeakPointRow): string {
  if (r.stoppedShare === null) return 'too few to say'
  return `${Math.round(r.stoppedShare * 100)}% stopped here`
}
</script>

<template>
  <!-- HANDBOOK Which bits of a course make people stumble
       section: seeing-progress
       roles: admin
       place: intel
       keywords: weak points, stumble, skip, retry, lego, course, too few to say
       What it's for. Seeing, for one course, which pieces of it real learners
       skip, retry, or stop on, ranked by how much trouble each piece caused
       per person who met it.
       Where it is. **Weak points**, under What's happening. Pick a course on
       the left.
       How you do it.
       1. Tap a course under **Courses** in the map on the left.
       2. Read the sentence for the piece that gave people the most trouble.
       3. Read the rows, worst first, showing both languages for each piece.
       4. Open a row to see that piece's phrases.
       Worth knowing. When fewer than five real people have practised a course,
       the page says **too few to say** rather than showing a number. That is
       the truth about the course, not a fault in the page.
       checked: 8378b141.a9071ccb
  -->
  <QuestionPage
    data-intel="question-weak-points"
    :question="question.question"
    :answer="answer"
    :headline="headline"
    :fetched-at="weak.fetchedAt.value"
    :people="pulse.data.value?.population ?? null"
    :courses="railCourses"
    course-scopable
  >
    <!-- Reading content evidence changes nothing on the delivery side, so this
         question carries no verbs. The bar stays, empty. -->
    <template #evidence>
      <div v-if="!course" class="empty-state">
        Pick a course and this fills in.
      </div>
      <div v-else-if="weak.data.value?.tooFewToSay" class="empty-state">
        Not enough people have practised this course to say anything honest about
        which bits of it are hard. This is the truth about the course, not a
        fault in the page.
      </div>
      <InsightWidget v-else :spec="spec" :resolved="resolved" />
    </template>

    <template #rows>
      <div v-if="course && rows.length" class="rows-card">
        <p class="rows-title">The bits, worst first</p>
        <router-link
          v-for="r in rows"
          :key="r.legoId"
          class="row"
          :to="{ path: '/admin/courses', query: { course, lego: r.legoId } }"
        >
          <span class="row-text">
            <span class="known">{{ r.knownText || r.legoId }}</span>
            <span class="target">{{ r.targetText || '' }}</span>
          </span>
          <span class="row-values">
            <span class="num" title="skips">{{ r.skips }}</span>
            <span class="num" title="retries">{{ r.retries }}</span>
            <span class="num" title="failures">{{ r.failures }}</span>
            <span class="stopped">{{ stopped(r) }}</span>
          </span>
        </router-link>
        <p v-if="weak.data.value?.truncated" class="rows-note">
          This course has more events than one read can hold, so these counts are
          a floor rather than a total.
        </p>
      </div>
    </template>
  </QuestionPage>
</template>

<style scoped>
.empty-state {
  background: var(--schools-card, #fff);
  border: 1px dashed var(--schools-border-strong, rgba(15, 18, 18, .18));
  border-radius: var(--schools-radius-lg, 12px);
  padding: 22px 20px;
  color: var(--schools-fg-2);
  font-size: 14px;
  max-width: 60ch;
}

.rows-card {
  background: var(--schools-card, #fff);
  border: 1px solid var(--schools-border, rgba(15, 18, 18, .10));
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
.rows-note { padding: 10px 18px 14px; font-size: 12px; color: var(--schools-fg-3); }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 18px;
  border-top: 1px solid var(--schools-border, rgba(15, 18, 18, .10));
  color: var(--schools-fg);
  text-decoration: none;
}
.row:hover { background: var(--schools-bg, #f6f5f1); }
.row-text { display: flex; flex-direction: column; min-width: 0; }
.known { font-size: 14px; }
.target { font-size: 12.5px; color: var(--schools-fg-3); }
.row-values { display: flex; align-items: baseline; gap: 14px; flex: none; }
.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 14px; min-width: 3ch; text-align: right; }
.stopped { font-size: 12px; color: var(--schools-fg-3); min-width: 14ch; text-align: right; }
</style>
