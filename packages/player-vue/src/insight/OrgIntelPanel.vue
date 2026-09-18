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
import { formatPracticeMinutes } from '@/composables/schools/practiceMinutes'
import InsightWidget from './InsightWidget.vue'
import { ORG_QUESTIONS } from '@/intel/orgQuestions'
import type { AnyInsightSpec, ResolvedInsight } from './spec'
import type { OrgIntelPayload, OrgIntelPosition } from './data/orgIntel'

const props = defineProps<{
  payload: OrgIntelPayload | null
  isLoading: boolean
  error: string | null
  /** Member mount (/org/:id) links a class to its member node home; admin mounts to /admin/classes/:id. */
  member: boolean
  /**
   * The node is an organisation with no class structure anywhere below it
   * (nodeTerminology's neutral preset). Two of the three questions are about
   * classes practising together, which such a node cannot have, so only the
   * people reading is shown and the class words never appear (job #786).
   */
  classless?: boolean
  /**
   * WHICH QUESTIONS THIS MOUNT ASKS (job #32 fix-up, 2026-09-16). The node
   * Insights page shows the JOURNEY alone: the card above it already answers
   * "are they practising" in Monday weeks and the class list already answers
   * "who has gone quiet", both off the card's own rows. Answering them a
   * second time off a different read is how the page came to claim no
   * practice in fourteen days under a card showing recorded minutes. A
   * classless organisation has neither card nor class list, so there the
   * practising question still carries the page (job #786).
   */
  questions?: ('practising' | 'quiet' | 'journey')[]
}>()

const { t } = useI18n()
const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s)
const q = (slug: 'practising' | 'quiet' | 'journey') => ORG_QUESTIONS.find((x) => x.slug === slug)!

const questionText = {
  practising: computed(() => (classless.value
    ? t('org.intel.practising.questionPeople', 'How many of your people practised this week, and is that more or fewer than last week?')
    : t('org.intel.practising.question', q('practising').question))),
  quiet: computed(() => t('org.intel.quiet.question', q('quiet').question)),
  journey: computed(() => t('org.intel.journey.question', q('journey').question)),
}

const classLink = (id: string) => (props.member ? `/org/${id}` : `/admin/classes/${id}`)
const asks = (slug: 'practising' | 'quiet' | 'journey') => !props.questions || props.questions.includes(slug)
const isClassNode = computed(() => props.payload?.node.kind === 'class')
const classless = computed(() => !!props.classless && !isClassNode.value)

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
  if (classless.value) {
    return p.peopleCount === 0
      ? t('org.intel.practising.nobodyYet', 'Nobody below this has practised yet.')
      : fill(t('org.intel.practising.people', '{n} of {total} people practised on their own account, {minutes} minutes between them.'), { n: p.peopleThisWeek, total: p.peopleCount, minutes: p.ownMinutesThisWeek })
  }
  const classes = isClassNode.value
    ? (p.classesThisWeek > 0
      ? fill(t('org.intel.practising.classYesMinutes', 'This class practised together this week, {phrases} phrases practised, {change}, {minutes} in the app.'), { phrases: p.phrasesThisWeek, change: moreOrFewer(p.phrasesThisWeek, p.phrasesLastWeek), minutes: formatPracticeMinutes(p.classMinutesThisWeek) })
      : t('org.intel.practising.classNo', 'This class did not practise together this week.'))
    : fill(t('org.intel.practising.classesMinutes', '{n} of your {total} classes practised together this week, {change}, {phrases} phrases practised, {minutes} in the app.'), { n: p.classesThisWeek, total: p.classCount, change: moreOrFewer(p.classesThisWeek, p.classesLastWeek), phrases: p.phrasesThisWeek, minutes: formatPracticeMinutes(p.classMinutesThisWeek) })
  const people = p.peopleCount === 0 ? '' : ' ' + fill(t('org.intel.practising.people', '{n} of {total} people practised on their own account, {minutes} minutes between them.'), { n: p.peopleThisWeek, total: p.peopleCount, minutes: p.ownMinutesThisWeek })
  return classes + people
})
// The by-day line and the class rows went with the classes (job #32 fix-up):
// the only node that asks this question has no classes to draw them for.

// ─── QUIET is not asked here any more (job #32 fix-up, 2026-09-16). The
// leader's page IS the class list, quietest first, off the card's own rows and
// the card's own week; asking the same question again off a four-week diary
// read gave two answers on one screen, and the second one said no practice in
// fourteen days under a card showing recorded minutes. The server still
// computes the quiet buckets for any caller that wants them. ───

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
// NO "CLASSES, FURTHEST FIRST" (job #32 fix-up, 2026-09-16). That table came
// from the pre-rebuild page (2026-09-10) and was never in the rebuild's brief:
// it ordered a school's classes by how far through the course they are, which
// is the league table the rank pills were cut for. The funnel above it answers
// the question — where classes stop — without ranking anybody, and the class
// list on the page itself is ordered quietest first, which is care and not
// competition.
</script>

<template>
  <div class="oip">
    <p v-if="error" class="oip-err">{{ error }}</p>

    <!-- HANDBOOK Which classes practised this week
         section: seeing-progress
         moment: every-lesson
         roles: leader, school_admin
         place: node-insights
         keywords: practised, this week, last week, phrases, classes, people, minutes, adherence
         What it's for. Whether the people under an organisation that runs no
         classes are actually doing it: how many practised on their own account
         in the last seven days against the seven before, and how many minutes
         between them — a count, never a name.
         Where it is. Under **More about this level** on the insights page of an
         organisation with no classes anywhere below it. A school or a group
         with classes does not see this question: the card at the top of its
         page answers it, in school weeks, and the class list under the card
         says which classes those minutes came from.
         How you do it.
         1. Read the sentence for this week against last week.
         Worth knowing. People's own-account minutes are counted in the sentence
         and never listed by name.
         checked: 41fec0fe.5558a068
    -->
    <section v-if="asks('practising')" class="oq" data-walk="insights-org-practising">
      <p class="oq-question">{{ questionText.practising.value }}</p>
      <div class="oq-answer">
        <span v-if="payload" class="oq-num">{{ classless ? payload.practising.peopleThisWeek : isClassNode ? payload.practising.phrasesThisWeek : payload.practising.classesThisWeek }}</span>
        <p class="oq-sentence">{{ practisingAnswer ?? (isLoading ? t('org.intel.counting', 'Counting…') : '') }}</p>
      </div>
    </section>

    <!-- HANDBOOK Where classes are in the course and where they stop
         section: seeing-progress
         moment: every-lesson
         roles: leader, school_admin
         place: node-insights
         keywords: journey, how far, drop off, stop, sentence, position, funnel, course
         What it's for. Where in the course your classes have got to, shown as
         the last phrase each class played, and the point most of them stop
         before. An organisation with no classes does not see this question.
         Where it is. The **Journey** question under **More about this level** on
         any level's insights page. It is the only question there, because the
         card and the class list above it answer the other two.
         How you do it.
         1. Read the sentence for how many classes have started, how far the
            furthest have got and where most stop.
         2. Read the funnel: each step is a sentence of the course, and the
            bar is how many classes have reached it.
         Worth knowing. A position is the phrase the class last played, in
         both languages. A sentence is one of the course's own sentences; the
         count out of the total says how far along that is. No class is named
         or ranked here: there is no order of merit to read off it, and the
         list on the page above is ordered by who has been quiet longest. It
         reads the same course the card above it reads.
         checked: 55588148.2f3982df
    -->
    <section v-if="!classless && asks('journey')" class="oq" data-walk="insights-org-journey">
      <p class="oq-question">{{ questionText.journey.value }}</p>
      <div class="oq-answer">
        <span v-if="payload && !isClassNode" class="oq-num">{{ payload.journey.stages[0]?.classes ?? 0 }}</span>
        <p class="oq-sentence">{{ journeyAnswer ?? (isLoading ? t('org.intel.counting', 'Counting…') : '') }}</p>
      </div>
      <InsightWidget v-if="!isClassNode" :spec="journeySpec" :resolved="journeyResolved" />
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
