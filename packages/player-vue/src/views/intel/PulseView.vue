<script setup lang="ts">
/**
 * Question 1 — the pulse.
 *
 * "How many real people practised this week, and is that more or less than last
 * week?" It is first because every other number is meaningless until the
 * population is right, which is why the chip under the sentence is not
 * decoration: it is the claim the sentence rests on.
 *
 * The rows are courses. The evidence is one ranked bar of where in the world
 * those people are, which is the whole of what we honestly know about where
 * people come from today.
 */
import { computed, onMounted } from 'vue'
import QuestionPage from '@/intel/QuestionPage.vue'
import InsightWidget from '@/insight/InsightWidget.vue'
import { useIntelApi } from '@/intel/useIntelApi'
import { questionBySlug } from '@/intel/questions'
import { metric } from '@/intel/metrics'
import type { AnyInsightSpec, ResolvedInsight } from '@/insight/spec'

interface PulseCourseRow { course: string; thisWeek: number; lastWeek: number }
interface PulseCountryRow { country: string; people: number }
interface StandingCounts { paying: number; gifted: number; free: number }
interface PulseResponse {
  thisWeek: number
  lastWeek: number
  population: number
  standing: StandingCounts
  courses: PulseCourseRow[]
  countries: PulseCountryRow[]
  countedAt: string
}

const question = questionBySlug('pulse')!
const { data, error, fetchedAt, load } = useIntelApi<PulseResponse>('/api/intel/pulse')

onMounted(() => { void load() })

const answer = computed<string | null>(() => {
  if (error.value) return error.value
  const d = data.value
  if (!d) return null
  if (d.thisWeek === 0) return 'Nobody has practised in the last seven days.'
  const diff = d.thisWeek - d.lastWeek
  const people = d.thisWeek === 1 ? 'real person' : 'real people'
  if (diff === 0) return `${d.thisWeek} ${people} practised this week, the same as last week.`
  const word = diff > 0 ? 'more' : 'fewer'
  return `${d.thisWeek} ${people} practised this week, ${Math.abs(diff)} ${word} than last week.`
})

const headline = computed(() => (data.value ? String(data.value.thisWeek) : null))

const spec = computed<AnyInsightSpec>(() => ({
  widget: 'ranked-bar',
  query: { metric: 'pulseByCountry', window: '7d' },
  frame: 'world',
  title: metric('peopleByCountry', question.slug).label,
  tag: 'countries',
}))

const resolved = computed<ResolvedInsight>(() => ({
  isLoading: !data.value && !error.value,
  error: error.value,
  data: {
    kind: 'ranked-bar',
    bars: (data.value?.countries ?? []).slice(0, 12).map((c: PulseCountryRow) => ({
      id: c.country,
      label: c.country,
      value: c.people,
    })),
    unit: 'people',
    horizontal: true,
  },
}))

const courseRows = computed(() => data.value?.courses ?? [])

/**
 * The money-side split of this week's people, in a sentence.
 *
 * Gifted learners — comped teachers, gifted friends, pilot schools — are REAL
 * people and are counted in the number above. This line says how many of them
 * there were, because how comped and pilot learners behave is a question worth
 * asking and it can only be asked of people who are in the data. It splits the
 * headline; it never filters it.
 */
const standingLine = computed<string | null>(() => {
  const s = data.value?.standing
  if (!s) return null
  const total = s.paying + s.gifted + s.free
  if (total === 0) return null
  return `${s.paying} paying, ${s.gifted} gifted, ${s.free} on free access.`
})

function change(row: PulseCourseRow): string {
  const diff = row.thisWeek - row.lastWeek
  if (diff === 0) return 'no change'
  return diff > 0 ? `+${diff}` : String(diff)
}
</script>

<template>
  <!-- HANDBOOK How many real people practised this week
       section: seeing-progress
       roles: admin
       place: intel
       keywords: pulse, practised, this week, last week, real people, courses, countries, paying, gifted
       What it's for. The first question on a Monday: how many real people
       practised in the last seven days, and whether that is more or fewer than
       the seven days before.
       Where it is. **Pulse**, the first question in the bar under What's
       happening.
       How you do it.
       1. Read the number and the sentence for this week against last week.
       2. Read the line beneath the chart for how many of those people are
          paying, gifted or on free access. Gifted people are real people and
          are counted.
       3. Read the chart for where in the world this week's people are.
       4. Open any course row to see which bits of that course give people
          trouble.
       Worth knowing. A person who practised nine times this week counts once.
       checked: 8cf7ecff.7d5c7c03
  -->
  <QuestionPage
    data-intel="question-pulse"
    :question="question.question"
    :answer="answer"
    :headline="headline"
    :fetched-at="fetchedAt"
    :people="data?.population ?? null"
  >
    <!-- No verbs at Everyone scope; the bar renders empty rather than being
         omitted, which is the layout rule. -->
    <template #evidence>
      <p v-if="standingLine" class="standing">{{ standingLine }}</p>
      <InsightWidget :spec="spec" :resolved="resolved" />
    </template>

    <template #rows>
      <div class="rows-card">
        <p class="rows-title">{{ metric('peopleByCourse', question.slug).label }}</p>
        <p v-if="data && courseRows.length === 0" class="rows-empty">
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
  margin: 0 0 14px;
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
