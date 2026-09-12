<script setup lang="ts">
// OrgIntelPanel — the three org questions (intel/orgQuestions.ts), rendered on
// the node's insights lens from ONE server payload (GET /api/org/intel).
//
// Pure presentation: the host fetches, this shapes words and widgets. Nothing
// here computes a figure of its own, so the Overview's 422 phrases and this
// lens's 422 phrases are the same number from the same read. Each question
// wears the intel grammar — the question said out loud, one answer sentence
// with one number, one Insight Engine widget, then the rows — without the
// /intel-only chrome (that rail is the admin's; this page already has the
// node's own rail).
//
// HONEST UNITS. A class is measured in PHRASES SPOKEN and in IN-APP MINUTES on
// its own class account (api/_utils/inAppTime.ts, founder ruling 2026-09-10),
// the same number its class page shows. People's minutes are their own logins. Position is the LEGO last played, shown as its own
// words in both languages, and a milestone is "sentence N of M" — a seed is
// one sentence — never a seed number on screen.
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { timeAgo } from '@/composables/admin/adminUtils'
import { formatPracticeMinutes } from '@/composables/schools/practiceMinutes'
import InsightWidget from './InsightWidget.vue'
import { ORG_QUESTIONS } from '@/intel/orgQuestions'
import type { AnyInsightSpec, ResolvedInsight } from './spec'
import type { OrgIntelPayload, OrgIntelPosition, OrgIntelClassRow, QuietBucketId } from './data/orgIntel'

const props = defineProps<{
  payload: OrgIntelPayload | null
  isLoading: boolean
  error: string | null
  /** Member mount (/org/:id) links a class to its member node home; admin mounts to /admin/classes/:id. */
  member: boolean
}>()

const { t } = useI18n()
const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s)
const q = (slug: 'practising' | 'quiet' | 'journey') => ORG_QUESTIONS.find((x) => x.slug === slug)!

const questionText = {
  practising: computed(() => t('org.intel.practising.question', q('practising').question)),
  quiet: computed(() => t('org.intel.quiet.question', q('quiet').question)),
  journey: computed(() => t('org.intel.journey.question', q('journey').question)),
}

const classLink = (id: string) => (props.member ? `/org/${id}` : `/admin/classes/${id}`)
const isClassNode = computed(() => props.payload?.node.kind === 'class')

function positionWords(p: OrgIntelPosition | null): string {
  if (!p) return t('org.intel.notStarted', 'not started')
  const text = [p.knownText, p.targetText].filter(Boolean).join(' · ')
  return text || fill(t('org.intel.sentenceN', 'sentence {n}'), { n: p.sentence })
}
const courseLength = computed(() => (props.payload?.journey.courses.length === 1 ? props.payload.journey.courses[0].sentences : null))
function sentenceOf(n: number): string {
  return courseLength.value
    ? fill(t('org.intel.sentenceNofM', 'sentence {n} of {m}'), { n, m: courseLength.value })
    : fill(t('org.intel.sentenceN', 'sentence {n}'), { n })
}
const moreOrFewer = (now: number, before: number) =>
  now === before ? t('org.intel.sameAsLastWeek', 'the same as last week')
    : now > before ? fill(t('org.intel.upFrom', 'up from {n} last week'), { n: before })
      : fill(t('org.intel.downFrom', 'down from {n} last week'), { n: before })

// ─── PRACTISING ─────────────────────────────────────────────────────────────
const practisingAnswer = computed<string | null>(() => {
  const p = props.payload?.practising
  if (!p) return null
  const classes = isClassNode.value
    ? (p.classesThisWeek > 0
      ? fill(t('org.intel.practising.classYesMinutes', 'This class practised together this week, {phrases} phrases practised, {change}, {minutes} in the app.'), { phrases: p.phrasesThisWeek, change: moreOrFewer(p.phrasesThisWeek, p.phrasesLastWeek), minutes: formatPracticeMinutes(p.classMinutesThisWeek) })
      : t('org.intel.practising.classNo', 'This class did not practise together this week.'))
    : fill(t('org.intel.practising.classesMinutes', '{n} of your {total} classes practised together this week, {change}, {phrases} phrases practised, {minutes} in the app.'), { n: p.classesThisWeek, total: p.classCount, change: moreOrFewer(p.classesThisWeek, p.classesLastWeek), phrases: p.phrasesThisWeek, minutes: formatPracticeMinutes(p.classMinutesThisWeek) })
  const people = p.peopleCount === 0 ? '' : ' ' + fill(t('org.intel.practising.people', '{n} of {total} people practised on their own account, {minutes} minutes between them.'), { n: p.peopleThisWeek, total: p.peopleCount, minutes: p.ownMinutesThisWeek })
  return classes + people
})
const practisingSpec = computed<AnyInsightSpec>(() => ({
  widget: 'time-series',
  query: { metric: 'orgPhrasesByDay', window: '28d' },
  frame: 'world',
  title: t('org.intel.practising.widgetTitle', 'Phrases practised together, by day'),
  tag: t('org.intel.byDay', 'by day'),
}))
const practisingResolved = computed<ResolvedInsight>(() => ({
  isLoading: props.isLoading,
  error: props.error,
  data: {
    kind: 'time-series',
    x: (props.payload?.byDay ?? []).map((d) => d.day.slice(5)),
    series: [{ name: t('org.intel.practising.series', 'phrases practised'), points: (props.payload?.byDay ?? []).map((d) => d.phrases), tone: 'good' }],
    yLabel: t('org.intel.practising.series', 'phrases practised'),
  },
}))
const practisingRows = computed(() => (props.payload?.classes ?? []).filter((c) => c.phrasesThisWeek > 0 || c.phrasesLastWeek > 0))
const peopleRows = computed(() => (props.payload?.people ?? []).filter((p) => p.minutesThisWeek > 0 || p.minutesLastWeek > 0))

// ─── QUIET ──────────────────────────────────────────────────────────────────
const bucketLabel: Record<QuietBucketId, () => string> = {
  'this-week': () => t('org.intel.quiet.bucketThisWeek', 'practised this week'),
  'gone-a-week': () => t('org.intel.quiet.bucketWeek', 'gone a week'),
  'gone-two-weeks': () => t('org.intel.quiet.bucketTwoWeeks', 'gone two weeks'),
  'gone-three-weeks': () => t('org.intel.quiet.bucketThreeWeeks', 'gone three weeks'),
  'gone-a-month': () => t('org.intel.quiet.bucketMonth', 'gone a month or more'),
  never: () => t('org.intel.quiet.bucketNever', 'never started'),
}
const quietAnswer = computed<string | null>(() => {
  const p = props.payload
  if (!p) return null
  if (isClassNode.value) {
    const c = p.classes[0]
    if (!c) return null
    if (!c.lastPractisedAt) return t('org.intel.quiet.classNever', 'This class has never practised together.')
    return c.daysSincePractice !== null && c.daysSincePractice >= 7
      ? fill(t('org.intel.quiet.classQuiet', 'This class has gone quiet: last practised together {when}.'), { when: timeAgo(c.lastPractisedAt) })
      : fill(t('org.intel.quiet.classFine', 'This class last practised together {when}.'), { when: timeAgo(c.lastPractisedAt) })
  }
  const { quietCount, neverCount } = p.quiet
  if (quietCount === 0 && neverCount === 0) return t('org.intel.quiet.none', 'Every class has practised in the last seven days.')
  const quiet = quietCount === 1 ? t('org.intel.quiet.oneQuiet', '1 class has gone quiet') : fill(t('org.intel.quiet.nQuiet', '{n} classes have gone quiet'), { n: quietCount })
  const never = neverCount === 1 ? t('org.intel.quiet.oneNever', '1 has never started') : fill(t('org.intel.quiet.nNever', '{n} have never started'), { n: neverCount })
  return fill(t('org.intel.quiet.answer', '{quiet}, and {never}.'), { quiet, never })
})
const quietSpec = computed<AnyInsightSpec>(() => ({
  widget: 'ranked-bar',
  query: { metric: 'orgQuietBuckets', window: '28d' },
  frame: 'world',
  title: t('org.intel.quiet.widgetTitle', 'How long since each class practised'),
  tag: t('org.intel.classesWord', 'classes'),
}))
const quietResolved = computed<ResolvedInsight>(() => ({
  isLoading: props.isLoading,
  error: props.error,
  data: {
    kind: 'ranked-bar',
    bars: (props.payload?.quiet.buckets ?? []).map((b) => ({
      id: b.id, label: bucketLabel[b.id](), value: b.classes,
      tone: b.id === 'this-week' ? 'good' : b.id === 'never' ? 'neutral' : b.id === 'gone-a-week' ? 'warn' : 'alarm',
    })),
    unit: t('org.intel.classesWord', 'classes'),
    horizontal: true,
  },
}))
const quietRows = computed(() => (props.payload?.classes ?? []).filter((c) => !c.lastPractisedAt || (c.daysSincePractice ?? 0) >= 7)
  .sort((a, b) => (b.daysSincePractice ?? Number.POSITIVE_INFINITY) - (a.daysSincePractice ?? Number.POSITIVE_INFINITY)))
function quietWhen(c: OrgIntelClassRow): string {
  return c.lastPractisedAt ? timeAgo(c.lastPractisedAt) : t('org.intel.never', 'never')
}

// ─── JOURNEY ────────────────────────────────────────────────────────────────
const journeyAnswer = computed<string | null>(() => {
  const p = props.payload
  if (!p) return null
  const stages = p.journey.stages
  const started = stages[0]?.classes ?? 0
  if (started === 0) return t('org.intel.journey.nobody', 'No class has started the course yet.')
  const reached = stages.filter((s) => s.sentence !== null && s.classes > 0)
  const furthest = reached[reached.length - 1]
  const startedWords = isClassNode.value
    ? fill(t('org.intel.journey.classAt', 'This class has reached {where}, {sentence}.'), { where: positionWords(p.classes[0]?.position ?? null), sentence: p.classes[0]?.position ? sentenceOf(p.classes[0].position.sentence) : '' })
    : fill(t('org.intel.journey.started', '{n} of {total} classes have started.'), { n: started, total: p.practising.classCount })
  if (isClassNode.value || !furthest) return startedWords
  const furthestWords = fill(t('org.intel.journey.furthest', 'The furthest {n} have reached {where}, {sentence}.'), { n: furthest.classes, where: positionWords(furthest.label), sentence: sentenceOf(furthest.sentence!) })
  // The drop-off place: the biggest fall between two consecutive stages.
  let drop: { from: typeof stages[number]; to: typeof stages[number]; lost: number } | null = null
  for (let i = 1; i < stages.length; i++) {
    const lost = stages[i - 1].classes - stages[i].classes
    if (lost > 0 && (!drop || lost > drop.lost)) drop = { from: stages[i - 1], to: stages[i], lost }
  }
  const dropWords = drop && drop.to.sentence
    ? ' ' + fill(t('org.intel.journey.drop', 'Most stop before {where}, {sentence}: {lost} classes got to the step before it and no further.'), { where: positionWords(drop.to.label), sentence: sentenceOf(drop.to.sentence), lost: drop.lost })
    : ''
  return `${startedWords} ${furthestWords}${dropWords}`
})
const journeySpec = computed<AnyInsightSpec>(() => ({
  widget: 'funnel',
  query: { metric: 'orgJourney', window: 'all' },
  frame: 'world',
  title: t('org.intel.journey.widgetTitle', 'Classes reaching each point in the course'),
  tag: t('org.intel.classesWord', 'classes'),
}))
const journeyResolved = computed<ResolvedInsight>(() => ({
  isLoading: props.isLoading,
  error: props.error,
  data: {
    kind: 'funnel',
    stages: (props.payload?.journey.stages ?? []).map((s) => ({
      id: s.id,
      label: s.sentence === null ? t('org.intel.journey.stageStarted', 'started') : `${positionWords(s.label)} · ${sentenceOf(s.sentence)}`,
      value: s.classes,
    })),
  },
}))
const journeyRows = computed(() => [...(props.payload?.classes ?? [])]
  .filter((c) => c.position)
  .sort((a, b) => (b.position!.sentence - a.position!.sentence) || a.name.localeCompare(b.name)))
</script>

<template>
  <div class="oip">
    <p v-if="error" class="oip-err">{{ error }}</p>

    <!-- HANDBOOK Which classes practised this week
         section: seeing-progress
         roles: leader, school_admin
         place: node-insights
         keywords: practised, this week, last week, phrases, classes, people, minutes, adherence
         What it's for. Whether your classes are actually doing it: how many
         practised together in the last seven days against the seven before,
         how many phrases they practised, and which people practised on their own
         account and for how long.
         Where it is. The **Practising** question at the top of any level's
         insights page.
         How you do it.
         1. Read the sentence for this week against last week.
         2. Read the line for how many phrases were practised each day over the
            last four weeks.
         3. Read the class rows for who practised, when they last practised
            together and where in the course they are.
         4. Read the people rows for own-account minutes.
         Worth knowing. A class's minutes are time in the app on its own class
         account, the gaps between phrases included, the same number its class
         page shows. People's minutes are their own logins.
         checked: d824eaac.c640230d
    -->
    <section class="oq" data-walk="insights-org-practising">
      <p class="oq-question">{{ questionText.practising.value }}</p>
      <div class="oq-answer">
        <span v-if="payload" class="oq-num">{{ isClassNode ? payload.practising.phrasesThisWeek : payload.practising.classesThisWeek }}</span>
        <p class="oq-sentence">{{ practisingAnswer ?? (isLoading ? t('org.intel.counting', 'Counting…') : '') }}</p>
      </div>
      <InsightWidget :spec="practisingSpec" :resolved="practisingResolved" />
      <p class="oq-note">{{ t('org.intel.practising.classTime', 'A class\'s minutes are time in the app on its own class account, the gaps between phrases included. People\'s minutes are their own logins.') }}</p>
      <div v-if="payload && !isClassNode" class="oq-rows">
        <p class="oq-rows-title">{{ t('org.intel.practising.rowsClassesMinutes', 'Classes, by phrases practised this week, with minutes in the app') }}</p>
        <p v-if="practisingRows.length === 0" class="oq-empty">{{ t('org.intel.practising.rowsEmpty', 'No class has practised together in the last fourteen days.') }}</p>
        <router-link v-for="c in practisingRows" :key="c.id" class="oq-row" :to="classLink(c.id)">
          <span class="oq-row-name">{{ c.name }}</span>
          <span class="oq-row-where">{{ positionWords(c.position) }}</span>
          <span class="oq-row-when">{{ c.lastPractisedAt ? timeAgo(c.lastPractisedAt) : '' }}</span>
          <span class="oq-row-min">{{ formatPracticeMinutes(c.minutesThisWeek) }}</span>
          <span class="oq-row-num">{{ c.phrasesThisWeek }}<span class="oq-row-delta">{{ c.phrasesLastWeek }}</span></span>
        </router-link>
      </div>
      <div v-if="payload && peopleRows.length" class="oq-rows">
        <p class="oq-rows-title">{{ t('org.intel.practising.rowsPeople', 'People on their own account, minutes this week') }}</p>
        <div v-for="p in peopleRows" :key="p.learnerId" class="oq-row oq-row-static">
          <span class="oq-row-name">{{ p.name }}</span>
          <span class="oq-row-when">{{ p.lastPractisedDay ?? '' }}</span>
          <span class="oq-row-num">{{ p.minutesThisWeek }}<span class="oq-row-delta">{{ p.minutesLastWeek }}</span></span>
        </div>
      </div>
    </section>

    <!-- HANDBOOK Which classes have gone quiet
         section: seeing-progress
         roles: leader, school_admin
         place: node-insights
         keywords: quiet, gone quiet, never started, stopped, not practising, drop off
         What it's for. The half you act on: which classes practised before and
         have stopped, how long ago, and which have never started at all.
         Where it is. The **Quiet** question on any level's insights page,
         under Practising.
         How you do it.
         1. Read the sentence for how many classes have gone quiet and how
            many have never started.
         2. Read the bars for how long since each class last practised.
         3. Open a class row to see where it stopped.
         Worth knowing. Practised this week counts any sign of practice, a
         phrase reached in a lesson or the course opened and progress saved. The
         Practising figure above counts phrases practised only, so it can be lower.
         checked: cb9d6d4f.7087bea9
    -->
    <section class="oq" data-walk="insights-org-quiet">
      <p class="oq-question">{{ questionText.quiet.value }}</p>
      <div class="oq-answer">
        <span v-if="payload && !isClassNode" class="oq-num">{{ payload.quiet.quietCount + payload.quiet.neverCount }}</span>
        <p class="oq-sentence">{{ quietAnswer ?? (isLoading ? t('org.intel.counting', 'Counting…') : '') }}</p>
      </div>
      <InsightWidget v-if="!isClassNode" :spec="quietSpec" :resolved="quietResolved" />
      <div v-if="payload && !isClassNode" class="oq-rows">
        <p class="oq-rows-title">{{ t('org.intel.quiet.rowsTitle', 'Classes with nothing this week, longest gone first') }}</p>
        <p v-if="quietRows.length === 0" class="oq-empty">{{ t('org.intel.quiet.rowsEmpty', 'Every class has practised this week.') }}</p>
        <router-link v-for="c in quietRows" :key="c.id" class="oq-row" :to="classLink(c.id)">
          <span class="oq-row-name">{{ c.name }}</span>
          <span class="oq-row-where">{{ positionWords(c.position) }}</span>
          <span class="oq-row-when">{{ quietWhen(c) }}</span>
        </router-link>
      </div>
    </section>

    <!-- HANDBOOK Where classes are in the course and where they stop
         section: seeing-progress
         roles: leader, school_admin
         place: node-insights
         keywords: journey, how far, drop off, stop, sentence, position, funnel, course
         What it's for. Where in the course your classes have got to, shown as
         the last phrase each class played, and the point most of them stop
         before.
         Where it is. The **Journey** question on any level's insights page,
         under Quiet.
         How you do it.
         1. Read the sentence for how many classes have started, how far the
            furthest have got and where most stop.
         2. Read the funnel: each step is a sentence of the course, and the
            bar is how many classes have reached it.
         3. Read the class rows, furthest first, for each class's own position.
         Worth knowing. A position is the phrase the class last played, in
         both languages. A sentence is one of the course's own sentences; the
         count out of the total says how far along that is.
         checked: 13dc14db.406c304f
    -->
    <section class="oq" data-walk="insights-org-journey">
      <p class="oq-question">{{ questionText.journey.value }}</p>
      <div class="oq-answer">
        <span v-if="payload && !isClassNode" class="oq-num">{{ payload.journey.stages[0]?.classes ?? 0 }}</span>
        <p class="oq-sentence">{{ journeyAnswer ?? (isLoading ? t('org.intel.counting', 'Counting…') : '') }}</p>
      </div>
      <InsightWidget v-if="!isClassNode" :spec="journeySpec" :resolved="journeyResolved" />
      <div v-if="payload && !isClassNode" class="oq-rows">
        <p class="oq-rows-title">{{ t('org.intel.journey.rowsTitle', 'Classes, furthest first') }}</p>
        <p v-if="journeyRows.length === 0" class="oq-empty">{{ t('org.intel.journey.rowsEmpty', 'No class has a position yet.') }}</p>
        <router-link v-for="c in journeyRows" :key="c.id" class="oq-row" :to="classLink(c.id)">
          <span class="oq-row-name">{{ c.name }}</span>
          <span class="oq-row-where">{{ positionWords(c.position) }}</span>
          <span class="oq-row-when">{{ sentenceOf(c.position!.sentence) }}</span>
        </router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
.oip { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.oip-err { margin: 0; font-size: 14px; color: var(--schools-red, #DB1E17); }
.oq { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.oq-question {
  margin: 0; font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.oq-answer { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.oq-num {
  font-family: var(--font-display); font-size: clamp(30px, 4vw, 44px); font-weight: 400; line-height: 1;
  color: var(--ink-primary, #2C2622); font-variant-numeric: tabular-nums;
}
.oq-sentence { margin: 0; font-size: 15px; line-height: 1.5; color: var(--ink-primary, #2C2622); max-width: 64ch; }
.oq-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink-secondary, #5b534c); max-width: 64ch; }
.oq-rows { background: var(--schools-card, #fff); border: 1px solid var(--schools-border, rgba(44, 38, 34, 0.1)); border-radius: var(--schools-radius-lg, 12px); overflow: hidden; }
.oq-rows-title {
  margin: 0; padding: 12px 16px 8px; font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.oq-empty { margin: 0; padding: 0 16px 14px; font-size: 14px; color: var(--ink-secondary, #5b534c); }
.oq-row {
  display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr) minmax(0, 1fr) auto auto; gap: 12px; align-items: baseline;
  padding: 10px 16px; border-top: 1px solid var(--schools-border, rgba(44, 38, 34, 0.1)); color: var(--ink-primary, #2C2622); text-decoration: none;
}
a.oq-row:hover { background: rgba(44, 38, 34, 0.04); }
.oq-row-name { font-size: 14px; font-weight: var(--font-semibold, 600); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oq-row-where { font-size: 13px; color: var(--ink-secondary, #5b534c); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oq-row-when { font-size: 12px; color: var(--ink-secondary, #5b534c); text-align: right; white-space: nowrap; }
.oq-row-min { font-family: var(--font-mono, 'Spline Sans Mono', monospace); font-variant-numeric: tabular-nums; font-size: 13px; color: var(--ink-secondary, #5b534c); text-align: right; white-space: nowrap; }
.oq-row-num { font-family: var(--font-mono, 'Spline Sans Mono', monospace); font-variant-numeric: tabular-nums; font-size: 15px; text-align: right; }
.oq-row-delta { font-size: 11px; color: var(--ink-secondary, #5b534c); margin-left: 8px; }
.oq-row-delta::before { content: '← '; }
@media (max-width: 720px) {
  .oq-row { grid-template-columns: minmax(0, 1fr) auto; }
  .oq-row-where { grid-column: 1 / -1; }
}
</style>
