<script setup lang="ts">
/**
 * Question 5 — which courses are worth our attention.
 *
 * "Which courses are worth our attention, and which are people actually
 * finishing?" One ranking, replacing the Courses tiles and the Course
 * Scoreboard: reach, stickiness and finishing, real people only. A course
 * row opens question 4 scoped to it, which is the link the design asks for.
 */
import { computed, onMounted } from 'vue'
import QuestionPage from '@/intel/QuestionPage.vue'
import InsightWidget from '@/insight/InsightWidget.vue'
import Chip from '@/intel/Chip.vue'
import { useRoute } from 'vue-router'
import { useIntelApi } from '@/intel/useIntelApi'
import { questionBySlug } from '@/intel/questions'
import { metric } from '@/intel/metrics'
import type { AnyInsightSpec, ResolvedInsight } from '@/insight/spec'

interface Row {
  course: string
  name: string
  community: boolean
  seeds: number | null
  reach: number
  practised30: number
  practised7: number
  finished: number | null
  stickiness: number | null
}
interface CoursesResponse { population: number; rows: Row[] }

const question = questionBySlug('courses')!
const route = useRoute()
const { data, error, fetchedAt, load } = useIntelApi<CoursesResponse>('/api/intel/courses')
onMounted(() => { void load() })

// The lens is a chip and lives in the URL: all courses, or only the ones
// with anybody in them this month.
const lens = computed(() => (route.query.lens === 'quiet' ? 'quiet' : route.query.lens === 'alive' ? 'alive' : 'all'))
const rows = computed(() => {
  const all = data.value?.rows ?? []
  if (lens.value === 'alive') return all.filter((r) => r.practised30 > 0)
  if (lens.value === 'quiet') return all.filter((r) => r.practised30 === 0 && r.reach > 0)
  return all
})

const answer = computed<string | null>(() => {
  if (error.value) return error.value
  const d = data.value
  if (!d) return null
  const alive = d.rows.filter((r) => r.practised30 > 0)
  if (alive.length === 0) return 'No course has had a real person practising in the last thirty days.'
  const top = alive[0]
  const finished = d.rows.reduce((n, r) => n + (r.finished ?? 0), 0)
  return `${alive.length} of ${d.rows.length} courses had real people practising in the last thirty days. ${top.name} had the most, with ${top.practised30}. ${finished} ${finished === 1 ? 'person has' : 'people have'} reached the end of a course.`
})
const headline = computed(() => (data.value ? String(data.value.rows.filter((r) => r.practised30 > 0).length) : null))

const spec = computed<AnyInsightSpec>(() => ({
  widget: 'ranked-bar',
  query: { metric: 'coursePractisedThisMonth', window: '30d' },
  frame: 'content',
  title: metric('coursePractisedThisMonth', question.slug).label,
  tag: 'courses',
}))
const resolved = computed<ResolvedInsight>(() => ({
  isLoading: !data.value && !error.value,
  error: error.value,
  data: {
    kind: 'ranked-bar',
    bars: (data.value?.rows ?? []).filter((r) => r.practised30 > 0).slice(0, 12).map((r) => ({ id: r.course, label: r.name, value: r.practised30 })),
    unit: 'people',
    horizontal: true,
  },
}))

function pct(v: number | null): string {
  return v === null ? '' : `${Math.round(v * 100)}%`
}
</script>

<template>
  <!-- HANDBOOK Which courses are worth attention
       section: seeing-progress
       roles: admin
       place: intel
       keywords: courses, reach, stickiness, finishing, ranking, practised, month
       What it's for. One ranking of every course by real people practising
       it this month, with how many have ever been in it and how many have
       reached its end.
       Where it is. **Courses**, under What's happening.
       How you do it.
       1. Read the sentence for how many courses are alive this month and
          which had the most people.
       2. Read the chart for the courses with anybody in them, most first.
       3. Use the chips to show every course, only the alive ones, or the
          quiet ones somebody once joined. The chip is written into the
          page address.
       4. Open a course row to see which bits of it people stumble on.
       Worth knowing. Reaching the end means getting through nine tenths of
       the course. A course with no recorded length shows a dash there
       rather than a zero. Minutes are not shown: the stored counters are
       not reliable, and a number that might be wrong is left off.
       checked: 92396e9b.f37cf1c8
  -->
  <QuestionPage
    data-intel="question-courses"
    :question="question.question"
    :answer="answer"
    :headline="headline"
    :fetched-at="fetchedAt"
    :people="data?.population ?? null"
  >
    <template #evidence>
      <InsightWidget :spec="spec" :resolved="resolved" />
    </template>

    <template #rows>
      <div class="rows-card">
        <div class="rows-head">
          <p class="rows-title">{{ metric('courseReach', question.slug).label }}</p>
          <span class="chips">
            <Chip :to="{ path: '/intel/courses' }" :on="lens === 'all'">All</Chip>
            <Chip :to="{ path: '/intel/courses', query: { lens: 'alive' } }" :on="lens === 'alive'">Alive this month</Chip>
            <Chip :to="{ path: '/intel/courses', query: { lens: 'quiet' } }" :on="lens === 'quiet'">Gone quiet</Chip>
          </span>
        </div>
        <p v-if="data && rows.length === 0" class="rows-empty">No courses match.</p>
        <router-link
          v-for="r in rows"
          :key="r.course"
          class="row"
          :to="{ path: '/intel/weak-points', query: { course: r.course } }"
        >
          <span class="who">
            <span class="name">{{ r.name }}</span>
            <span class="code">{{ r.course }}<template v-if="r.community"> · community</template></span>
          </span>
          <span class="values">
            <span class="cell"><span class="num">{{ r.practised30 }}</span><span class="lbl">this month</span></span>
            <span class="cell"><span class="num">{{ r.reach }}</span><span class="lbl">ever</span></span>
            <span class="cell"><span class="num">{{ pct(r.stickiness) || '–' }}</span><span class="lbl">stick</span></span>
            <span class="cell" :title="metric('courseFinished', question.slug).label"><span class="num">{{ r.finished ?? '–' }}</span><span class="lbl">finished</span></span>
          </span>
        </router-link>
      </div>
    </template>
  </QuestionPage>
</template>

<style scoped>
.rows-card {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg);
  overflow: hidden;
}
.rows-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-right: 14px; }
.rows-title {
  padding: 14px 18px 10px;
  margin: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red);
}
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
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
.who { display: flex; flex-direction: column; min-width: 0; }
.name { font-size: 14px; }
.code { font-size: 11.5px; color: var(--schools-fg-3); font-family: var(--font-mono, ui-monospace, monospace); }
.values { display: flex; gap: 14px; flex: none; }
.cell { display: flex; flex-direction: column; align-items: flex-end; min-width: 5ch; }
.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 14px; }
.lbl { font-size: 10.5px; color: var(--schools-fg-3); }
@media (max-width: 640px) {
  .row { flex-direction: column; align-items: flex-start; }
  .values { gap: 10px; }
}
</style>
