<script setup lang="ts">
/**
 * Question 2 — who is about to leave.
 *
 * "Who is about to leave, and who has already gone quiet?" People who were
 * regular and have stopped, paying people who are quiet, and people whose
 * access ends soon — the list of who to write to and why. It sends nothing.
 *
 * RANKED BY RECENCY AND REGULARITY, and the page says so: no amount is
 * stored anywhere in this database, so "how much we would lose" cannot be
 * computed and is not pretended.
 *
 * Rows are people, and every row is a link to that person's own question.
 * The verbs the design puts here — give full access, change their trial —
 * act on ONE person, and until a row can be selected in place they live on
 * the person's page, one tap away. The bar renders empty rather than
 * pretending.
 */
import { computed, onMounted } from 'vue'
import QuestionPage from '@/intel/QuestionPage.vue'
import InsightWidget from '@/insight/InsightWidget.vue'
import Pill from '@/intel/Pill.vue'
import { useIntelApi } from '@/intel/useIntelApi'
import { questionBySlug } from '@/intel/questions'
import { metric } from '@/intel/metrics'
import type { AnyInsightSpec, ResolvedInsight } from '@/insight/spec'

type Reason = 'regular-and-stopped' | 'paying-and-quiet' | 'ending-soon'
interface Row {
  learnerId: string
  name: string | null
  email: string | null
  reasons: Reason[]
  daysSincePractice: number | null
  regularDays: number
  course: string | null
  endsAt: string | null
}
interface LeavingResponse {
  population: number
  practisedRecently: number
  rows: Row[]
  counts: Record<Reason, number>
  buckets: { label: string; people: number }[]
}

const question = questionBySlug('leaving')!
const { data, error, fetchedAt, load } = useIntelApi<LeavingResponse>('/api/intel/leaving')
onMounted(() => { void load() })

const REASON_WORDS: Record<Reason, string> = {
  'regular-and-stopped': 'was regular, has stopped',
  'paying-and-quiet': 'paying, gone quiet',
  'ending-soon': 'access ends soon',
}
const REASON_TONE: Record<Reason, 'alarm' | 'watch'> = {
  'regular-and-stopped': 'alarm',
  'paying-and-quiet': 'alarm',
  'ending-soon': 'watch',
}

const answer = computed<string | null>(() => {
  if (error.value) return error.value
  const d = data.value
  if (!d) return null
  const n = d.rows.length
  if (n === 0) return 'Nobody is about to leave that we can see.'
  const c = d.counts
  const parts: string[] = []
  if (c['regular-and-stopped']) parts.push(`${c['regular-and-stopped']} ${c['regular-and-stopped'] === 1 ? 'was' : 'were'} regular and ${c['regular-and-stopped'] === 1 ? 'has' : 'have'} stopped`)
  if (c['paying-and-quiet']) parts.push(`${c['paying-and-quiet']} ${c['paying-and-quiet'] === 1 ? 'is' : 'are'} paying and quiet`)
  if (c['ending-soon']) parts.push(`${c['ending-soon']} ${c['ending-soon'] === 1 ? 'has' : 'have'} access ending soon`)
  return `${n} real ${n === 1 ? 'person is' : 'people are'} about to leave or have gone quiet: ${parts.join(', ')}.`
})
const headline = computed(() => (data.value ? String(data.value.rows.length) : null))

const spec = computed<AnyInsightSpec>(() => ({
  widget: 'ranked-bar',
  query: { metric: 'goneForHowLong', window: '35d' },
  frame: 'world',
  title: metric('goneForHowLong', question.slug).label,
  tag: 'people',
}))
const resolved = computed<ResolvedInsight>(() => ({
  isLoading: !data.value && !error.value,
  error: error.value,
  data: {
    kind: 'ranked-bar',
    bars: (data.value?.buckets ?? []).map((b) => ({ id: b.label, label: b.label, value: b.people })),
    unit: 'people',
    horizontal: true,
  },
}))

function since(r: Row): string {
  if (r.daysSincePractice === null) return 'never practised'
  if (r.daysSincePractice === 0) return 'today'
  return `${r.daysSincePractice} ${r.daysSincePractice === 1 ? 'day' : 'days'} ago`
}
function ends(r: Row): string {
  if (!r.endsAt) return ''
  return new Date(r.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
</script>

<template>
  <!-- HANDBOOK Who is about to leave
       section: seeing-progress
       roles: admin
       place: intel
       keywords: leaving, quiet, stopped, churn, paying, trial, ending, write to
       What it's for. The list of who to write to and why: real people who
       were practising regularly and have stopped, paying people who have
       gone quiet, and people whose access runs out within a fortnight.
       Where it is. **Leaving**, under What's happening.
       How you do it.
       1. Read the sentence for how many, and why.
       2. Read the chart for how long they have been gone.
       3. Read the rows, most recently seen first, then the most regular
          first. Each carries every reason that applies.
       4. Open a row to see that person and act on them.
       Worth knowing. Nobody is ranked by money. No amount is stored anywhere
       in this database, so the order is who was seen most recently and who
       was most regular before they stopped. This page sends nothing.
       checked: 42697cc3.7a82c02e
  -->
  <QuestionPage
    data-intel="question-leaving"
    :question="question.question"
    :answer="answer"
    :headline="headline"
    :fetched-at="fetchedAt"
    :people="data?.population ?? null"
  >
    <template #evidence>
      <p class="note">
        Ranked by who was seen most recently, then by who was most regular
        before they stopped. No amount is stored for anyone, so nobody is
        ranked by money.
      </p>
      <InsightWidget :spec="spec" :resolved="resolved" />
    </template>

    <template #rows>
      <div class="rows-card">
        <p class="rows-title">{{ metric('aboutToLeave', question.slug).label }}</p>
        <p v-if="data && data.rows.length === 0" class="rows-empty">Nobody, right now.</p>
        <router-link
          v-for="r in data?.rows ?? []"
          :key="r.learnerId"
          class="row"
          :to="{ path: '/intel/person', query: { person: r.learnerId } }"
        >
          <span class="who">
            <span class="name">{{ r.name || r.email || 'Somebody with no name yet' }}</span>
            <span v-if="r.name && r.email" class="email">{{ r.email }}</span>
          </span>
          <span class="reasons">
            <Pill v-for="reason in r.reasons" :key="reason" :tone="REASON_TONE[reason]">{{ REASON_WORDS[reason] }}</Pill>
          </span>
          <span class="values">
            <span class="num">{{ since(r) }}</span>
            <span class="regular">{{ r.regularDays }} {{ r.regularDays === 1 ? 'day' : 'days' }} before</span>
            <span v-if="r.endsAt" class="ends">ends {{ ends(r) }}</span>
          </span>
        </router-link>
      </div>
    </template>
  </QuestionPage>
</template>

<style scoped>
.note { margin: 0 0 14px; font-size: 13px; color: var(--schools-fg-3); max-width: 60ch; }
.rows-card {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg);
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
.rows-empty { padding: 0 18px 16px; color: var(--schools-fg-3); font-size: 14px; }
.row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.4fr) auto;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  border-top: 1px solid var(--schools-border);
  color: var(--schools-fg);
  text-decoration: none;
}
.row:hover { background: var(--schools-bg); }
.who { display: flex; flex-direction: column; min-width: 0; }
.name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.email { font-size: 12px; color: var(--schools-fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reasons { display: flex; flex-wrap: wrap; gap: 6px; }
.values { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }
.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 13px; }
.regular, .ends { font-size: 11.5px; color: var(--schools-fg-3); }
@media (max-width: 640px) {
  .row { grid-template-columns: minmax(0, 1fr); }
  .values { align-items: flex-start; text-align: left; }
}
</style>
