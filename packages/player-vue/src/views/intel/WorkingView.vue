<script setup lang="ts">
/**
 * Question 7 — is the app working right now.
 *
 * "Is the app working right now, and did my last fix land?" The audio
 * failure rate over real people's plays, by day, by build and by device,
 * with the build most people are on named. Rows are builds; a build row
 * is a chip on this page, since a build is a lens over the same numbers,
 * never a page of its own.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import QuestionPage from '@/intel/QuestionPage.vue'
import InsightWidget from '@/insight/InsightWidget.vue'
import Pill from '@/intel/Pill.vue'
import Chip from '@/intel/Chip.vue'
import { useIntelApi } from '@/intel/useIntelApi'
import { questionBySlug } from '@/intel/questions'
import { metric } from '@/intel/metrics'
import type { AnyInsightSpec, ResolvedInsight } from '@/insight/spec'

interface Tally { plays: number; failures: number; people: number; rate: number | null }
interface WorkingResponse {
  days: number
  population: number
  people: number
  overall: Tally
  byDay: ({ day: string } & Tally)[]
  byBuild: ({ build: string } & Tally)[]
  byDevice: ({ device: string } & Tally)[]
  currentBuild: string | null
  truncated: boolean
}

const question = questionBySlug('working')!
const route = useRoute()
const { data, error, fetchedAt, load } = useIntelApi<WorkingResponse>('/api/intel/working')
onMounted(() => { void load({ days: '7' }) })

/** A build named in the URL narrows the rows to it; the chart stays whole. */
const build = computed(() => (typeof route.query.build === 'string' ? route.query.build : null))

function pct(rate: number | null): string {
  return rate === null ? 'no plays' : `${Math.round(rate * 1000) / 10}%`
}
function tone(rate: number | null): 'good' | 'watch' | 'alarm' | 'quiet' {
  if (rate === null) return 'quiet'
  if (rate >= 0.05) return 'alarm'
  if (rate >= 0.01) return 'watch'
  return 'good'
}

const answer = computed<string | null>(() => {
  if (error.value) return error.value
  const d = data.value
  if (!d) return null
  if (d.people === 0) return 'No real person has played audio in the last seven days, so there is nothing to judge the app by.'
  const rate = d.overall.rate ?? 0
  const verdict = rate >= 0.05 ? 'Audio is failing too often.' : rate >= 0.01 ? 'Audio is mostly working.' : 'Audio is working.'
  const buildLine = d.currentBuild ? ` Most people today are on build ${d.currentBuild.slice(0, 8)}.` : ''
  return `${verdict} ${pct(d.overall.rate)} of ${d.overall.plays + d.overall.failures} plays by ${d.people} real people failed in the last seven days.${buildLine}`
})
const headline = computed(() => (data.value && data.value.people > 0 ? pct(data.value.overall.rate) : null))

const spec = computed<AnyInsightSpec>(() => ({
  widget: 'time-series',
  query: { metric: 'audioFailureRate', window: '7d' },
  frame: 'world',
  title: metric('audioFailureRate', question.slug).label,
  tag: 'by day',
}))
const resolved = computed<ResolvedInsight>(() => ({
  isLoading: !data.value && !error.value,
  error: error.value,
  data: {
    kind: 'time-series',
    x: (data.value?.byDay ?? []).map((d) => d.day.slice(5)),
    series: [{ name: 'failed plays, per hundred', points: (data.value?.byDay ?? []).map((d) => Math.round((d.rate ?? 0) * 1000) / 10), tone: 'alarm' }],
    yLabel: 'per hundred plays',
  },
}))

const rows = computed(() => {
  const all = data.value?.byBuild ?? []
  return build.value ? all.filter((b) => b.build === build.value) : all
})
</script>

<template>
  <!-- HANDBOOK Whether the app is working right now
       section: seeing-progress
       roles: admin
       place: intel
       keywords: working, health, audio, failed, build, device, fix landed
       What it's for. Whether audio is failing for real people, and on which
       build and which kind of device, so you can tell if the last fix
       reached them.
       Where it is. **Working now**, under What's happening.
       How you do it.
       1. Read the sentence for the failure rate over the last seven days and
          the build most people are on today.
       2. Read the chart for the rate by day.
       3. Read the rows, one per build, most people first. Tap a build to
          narrow the rows to it; the choice is written into the page address.
       4. Read the device line under the rows for phones against desktops.
       Worth knowing. Only real people's plays are counted, so your own
       session on staging is not here. Machine traffic is left out by rule.
       checked: b183fcdc.aa1f0b63
  -->
  <QuestionPage
    data-intel="question-working"
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
          <p class="rows-title">{{ metric('failureRateByBuild', question.slug).label }}</p>
          <Chip v-if="build" :to="{ path: '/intel/working' }" :on="true">build {{ build.slice(0, 8) }} · show all</Chip>
        </div>
        <p v-if="data && rows.length === 0" class="rows-empty">No plays on any build this week.</p>
        <router-link
          v-for="b in rows"
          :key="b.build"
          class="row"
          :to="{ path: '/intel/working', query: { build: b.build } }"
        >
          <span class="who">
            <span class="name">{{ b.build === 'unknown' ? 'build not stamped' : b.build.slice(0, 12) }}</span>
            <Pill v-if="b.build === data?.currentBuild" tone="good">most people today</Pill>
          </span>
          <span class="values">
            <span class="cell"><span class="num">{{ b.people }}</span><span class="lbl">people</span></span>
            <span class="cell"><span class="num">{{ b.plays }}</span><span class="lbl">plays</span></span>
            <span class="cell"><span class="num">{{ b.failures }}</span><span class="lbl">failed</span></span>
            <span class="cell"><Pill :tone="tone(b.rate)">{{ pct(b.rate) }}</Pill></span>
          </span>
        </router-link>
        <p v-if="data?.byDevice.length" class="devices">
          <span v-for="d in data.byDevice" :key="d.device" class="device">
            {{ d.device }} {{ pct(d.rate) }} of {{ d.plays + d.failures }}
          </span>
        </p>
        <p v-if="data?.truncated" class="rows-note">
          More events this week than one read can hold, so these counts are a floor rather than a total.
        </p>
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
.rows-empty { padding: 0 18px 16px; color: var(--schools-fg-3); font-size: 14px; }
.rows-note { padding: 10px 18px 14px; margin: 0; font-size: 12px; color: var(--schools-fg-3); }
.devices { display: flex; gap: 16px; flex-wrap: wrap; padding: 12px 18px 14px; margin: 0; border-top: 1px solid var(--schools-border); font-size: 12.5px; color: var(--schools-fg-2); }
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
.who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.name { font-family: var(--font-mono, ui-monospace, monospace); font-size: 13.5px; }
.values { display: flex; gap: 14px; flex: none; align-items: center; }
.cell { display: flex; flex-direction: column; align-items: flex-end; min-width: 5ch; }
.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 14px; }
.lbl { font-size: 10.5px; color: var(--schools-fg-3); }
</style>
