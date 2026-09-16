<script setup lang="ts">
// ============================================================================
// components/WeekNumbersCard.vue — THE CLASS CARD. One card, in SCHOOL WEEKS.
//
// Tom's ruling, 2026-09-16: a school works in week-units, and the two things
// it wants are "the total in-app time and a measure of how much progress
// they're making. But easy, and simple to grok." So the card is three numbers
// and nothing else:
//
//   Play-as-class time (X) · Students' own time (Y) · Total = X + Y
//   New phrases this week
//
// with the cohort's SAME three BESIDE them — two columns, class and cohort,
// on every screen width, never two stacked cards (Tom via RBF, 2026-09-16:
// "the class's numbers and the school's are STACKED as two cards instead of
// side by side"). NEVER a ratio, a percent-vs-average or a RANK: no
// percentile, no "1st of 3", no ordinal of any kind — dentist energy. Two
// columns of plain numbers let a head of department see the gap themselves.
//
// Under the numbers, twelve weekly bars: one bar per week for this class in
// the class colour, this week's bar solid, with the cohort's mean laid across
// them as a faint line — "normal for here". Tom's verdict from the display
// lab, 2026-09-16: "Bars with a faint normal line is best." No axes, no
// legend, no rank.
//
// 'All time' is TOTALS ONLY, on its own line beneath, with no comparison
// figure and no cohort column: since the class started, practice time and
// phrases reached.
//
// The 'why?' chip stays: minutes and phrases diverge naturally under Fast vs
// Easy mode, and that is explained on a tap, never annotated on the glance.
//
// No streaks, no targets, no pressure — dog energy, never dentist energy. A
// quiet week reads as a quiet week; nothing here scolds anybody for it.
// ============================================================================
import { computed, ref } from 'vue'
import WeekBars from './WeekBars.vue'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

export interface WeekSide {
  label: string
  classMinutes: number
  pupilMinutes: number
  totalMinutes: number
  newPhrases: number
  hasData?: boolean
  size?: number
  /**
   * "27 classes" — the denominator, counted server-side off the very cohort
   * these numbers were averaged over, with the right noun at every level.
   * Counting it here got "classes" wrong above class level.
   */
  sizeLabel?: string
}

export interface WeekClassRow {
  id: string
  name: string
  started: boolean
  lastPlayedAt: string | null
  classMinutes: number | null
  pupilMinutes: number | null
  totalMinutes: number | null
  newPhrases: number | null
  /** That class's own twelve weeks of minutes; null before it started. */
  bars?: (number | null)[] | null
}

export interface WeekBlock {
  window: string
  label: string
  rangeLabel: string
  timeZone?: string
  entity: WeekSide
  cohort: WeekSide | null
  /**
   * Weekly bars. A number is a real week; NULL is absence — nobody in the
   * cohort had started playing yet, so there is no number to draw and no zero
   * to imply one. The line breaks.
   */
  bars: { weeks: string[]; entity: (number | null)[]; cohort: (number | null)[] }
  /** The faint normal line for the per-class cards: the mean over this node's classes. */
  classesNormal?: (number | null)[] | null
  pupilMinutesCapped?: boolean
  /** The leader's page: one row per class under this node, quietest first. */
  classes?: WeekClassRow[]
}

export interface AllTimeBlock {
  started: boolean
  since?: string
  sinceLabel?: string
  classMinutes?: number
  pupilMinutes?: number
  totalMinutes?: number
  phrasesReached?: number
}

const props = defineProps<{
  data: WeekBlock
  /** Named when there is no comparison to draw — shown as a quiet note. */
  noCohortReason?: string | null
  /** Totals since the class started; class entities only. */
  allTime?: AllTimeBlock | null
}>()

/** Minutes as a school reads them: "1h 25m" past the hour, plain minutes below. */
function mins(n: number): string {
  const whole = Math.round(n)
  if (whole < 60) return `${whole}m`
  const h = Math.floor(whole / 60)
  const m = whole % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const entity = computed(() => props.data.entity)
const cohort = computed(() => props.data.cohort)

/**
 * "Ysgol Cas-gwent Chepstow School average · 27 classes" — the denominator in
 * four words beside the name it belongs to (Watson, 2026-09-16). It counts
 * classes that have STARTED: a class set up and never played is in no
 * average, so the school reads as busy as it actually is.
 */
const denominatorLine = computed(() => {
  const c = props.data.cohort
  if (!c) return null
  return c.sizeLabel ? `${c.label} · ${c.sizeLabel}` : (c.size ? `${c.label} · ${c.size}` : null)
})

const hasBars = computed(() =>
  props.data.bars.entity.some((v) => typeof v === 'number')
  || props.data.bars.cohort.some((v) => typeof v === 'number'))

const rows = computed(() => [
  { key: 'class', label: t('insights.week.playAsClass', 'Play as class'), big: true, entity: mins(entity.value.classMinutes), cohort: cohort.value ? mins(cohort.value.classMinutes) : null },
  { key: 'pupils', label: t('insights.week.studentsOwn', 'Students on their own'), big: true, entity: mins(entity.value.pupilMinutes), cohort: cohort.value ? mins(cohort.value.pupilMinutes) : null },
  { key: 'total', label: t('insights.week.total', 'Total learning time'), big: false, entity: mins(entity.value.totalMinutes), cohort: cohort.value ? mins(cohort.value.totalMinutes) : null },
  { key: 'phrases', label: t('insights.week.newPhrases', 'New phrases'), big: true, entity: String(Math.round(entity.value.newPhrases)), cohort: cohort.value ? String(Math.round(cohort.value.newPhrases)) : null },
])

const whyOpen = ref(false)

const allTimeLine = computed(() => {
  const a = props.allTime
  if (!a) return null
  if (!a.started) return t('insights.week.allTimeNotStarted', 'This class has not started yet.')
  return t('insights.week.allTimeLine', 'Since {since} · {time} practised · {phrases} phrases reached')
    .replace('{since}', a.sinceLabel ?? '')
    .replace('{time}', mins(a.totalMinutes ?? 0))
    .replace('{phrases}', String(Math.round(a.phrasesReached ?? 0)))
})
</script>

<template>
  <div class="wk">
    <header class="wk-head">
      <p class="wk-window">{{ data.label }}</p>
      <p class="wk-range">{{ data.rangeLabel }}</p>
      <button type="button" class="wk-why" :aria-expanded="whyOpen" @click="whyOpen = !whyOpen">{{ t('insights.widget.whyLink', 'why?') }}</button>
    </header>
    <p v-if="whyOpen" class="wk-why-text">
      {{ t('insights.week.whyText', 'Minutes are time while the play button was playing, on the class account and on students’ own accounts, added together. New phrases are the ones the class reached for the first time that week. The two move apart on purpose: in Fast mode a class covers more new phrases in the same minutes, in Easy mode fewer. Neither is skipping ahead or going back. The average beside you is the mean of every class in that scope that has started this course, this class included, so it reads the same whoever opens it.') }}
    </p>

    <!-- ── The three numbers: label | this class | the cohort, side by side ── -->
    <div class="wk-table" :class="{ 'wk-table-solo': !cohort }" role="table">
      <div class="wk-row wk-row-head" role="row">
        <span class="wk-cell wk-cell-label" role="columnheader"></span>
        <span class="wk-cell wk-col-label wk-col-entity" role="columnheader">{{ entity.label }}</span>
        <span v-if="cohort" class="wk-cell wk-col-label" role="columnheader">{{ cohort.label }}</span>
      </div>
      <template v-for="r in rows" :key="r.key">
        <div class="wk-row" :class="`wk-row-${r.key}`" role="row">
          <span class="wk-cell wk-cell-label" role="rowheader">{{ r.label }}</span>
          <span class="wk-cell wk-num wk-num-entity" :class="r.big ? 'wk-big' : 'wk-small'" role="cell">{{ r.entity }}</span>
          <span v-if="cohort" class="wk-cell wk-num" :class="r.big ? 'wk-big' : 'wk-small'" role="cell">{{ r.cohort }}</span>
        </div>
      </template>
    </div>

    <!-- ── Twelve weeks of it, under the numbers: bars for this class, the
         average as a faint line across them (Tom's lab verdict, 2026-09-16). ── -->
    <div v-if="hasBars" class="wk-trend">
      <p class="wk-trend-label">{{ t('insights.week.lastTwelveWeeks', 'Last 12 weeks') }}</p>
      <WeekBars
        :entity="data.bars.entity"
        :cohort="cohort ? data.bars.cohort : null"
        :label="t('insights.week.lineLabel', 'Total learning time, last twelve weeks, this class over the average')"
      />
    </div>

    <p v-if="denominatorLine" class="wk-denominator">{{ denominatorLine }}</p>
    <p v-if="!cohort && noCohortReason" class="wk-note">{{ noCohortReason }}</p>
    <p v-if="data.pupilMinutesCapped" class="wk-note">
      {{ t('insights.week.pupilsCapped', "Students' own minutes aren't counted at this level — too many classes to read individually. Play-as-class time is complete.") }}
    </p>

    <!-- ── All time: totals only, no comparison, on its own line ── -->
    <!-- HANDBOOK Totals since the class started
         section: seeing-progress
         moment: every-lesson
         roles: teacher, school_admin, leader, admin
         place: node-insights
         keywords: all time, total, since started, phrases reached, practice time
         What it's for. Two totals for one class since the day it first pressed play:
         all its practice time, and how many phrases it has reached. Totals, on their
         own, with nothing to compare them to.
         Where it is. The last line of the class card, under the week.
         How you do it.
         1. Open the class's insights.
         2. Read the line under the week: since when, how long, how far.
         Worth knowing. This is never an average and never a rate. A class that has not
         started yet says so instead of showing zeros.
         checked: 65f3fb1f.1f2f3a30
    -->
    <p v-if="allTimeLine" class="wk-alltime" data-walk="insights-all-time">{{ allTimeLine }}</p>
  </div>
</template>

<style scoped>
.wk { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.wk-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 0; }
.wk-window {
  margin: 0;
  font-family: var(--font-display, inherit);
  font-size: 19px;
  color: var(--ink-primary, #2C2622);
}
.wk-range {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted, #8A8078);
}
.wk-why {
  margin-left: auto;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-muted, #8A8078);
  background: none;
  border: none;
  padding: 0 2px;
  cursor: pointer;
  text-decoration: underline dotted;
}
.wk-why-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-secondary, #5b534c);
  max-width: 60ch;
}

/* Three columns on every width: the label, this class, the cohort. Two
 * numbers beside each other is the point of the card, so the phone keeps the
 * columns and shrinks the type rather than stacking. */
.wk-table { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); column-gap: 10px; }
.wk-table-solo { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); }
.wk-row { display: contents; }
.wk-cell { min-width: 0; padding: 7px 0; border-bottom: 1px solid rgba(44, 38, 34, 0.08); }
.wk-row-head .wk-cell { padding-top: 0; border-bottom: 1px solid rgba(44, 38, 34, 0.14); }
.wk-row-phrases .wk-cell { border-bottom: none; }
.wk-col-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted, #8A8078);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.wk-col-entity { color: rgba(var(--rc-entity-ink, 37, 99, 235), 1); }
.wk-cell-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ink-muted, #8A8078);
  align-self: end;
  overflow-wrap: anywhere;
}
.wk-num { text-align: right; font-variant-numeric: tabular-nums; }
.wk-big {
  font-family: var(--font-display, inherit);
  font-size: 24px;
  line-height: 1.1;
  color: var(--ink-primary, #2C2622);
}
.wk-num-entity.wk-big { color: rgba(var(--rc-entity-ink, 37, 99, 235), 1); }
/* The total is the sum of the two above it, so it whispers rather than shouts. */
.wk-small {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--ink-secondary, #5b534c);
}
.wk-trend { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wk-trend-label {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: var(--ink-muted, #8A8078);
}

.wk-denominator,
.wk-note {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-muted, #8A8078);
}
.wk-alltime {
  margin: 4px 0 0;
  padding-top: 10px;
  border-top: 1px dashed rgba(44, 38, 34, 0.14);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-secondary, #5b534c);
}

@media (max-width: 560px) {
  .wk-big { font-size: 20px; }
  .wk-table { column-gap: 8px; }
}
</style>
