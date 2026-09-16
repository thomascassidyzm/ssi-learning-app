<script setup lang="ts">
// ============================================================================
// components/WeekNumbersCard.vue — Class Insights in SCHOOL WEEKS.
//
// Tom's ruling, 2026-09-16: a school works in week-units, and the two things
// it wants are "the total in-app time and a measure of how much progress
// they're making. But easy, and simple to grok." So the card is three numbers
// and nothing else:
//
//   Play-as-class time (X) · Individual students' time (Y) · Total = X + Y
//   New phrases this week
//
// beside the SAME three for the school. NEVER a ratio and never a
// percent-vs-average headline: a computed ratio does the reader's comparing
// for them, and does it wrongly whenever the denominator is small. Two columns
// of plain numbers let a head of department see the gap themselves.
//
// No streaks, no targets, no pressure — dog energy, never dentist energy. A
// quiet week reads as a quiet week; nothing here scolds anybody for it.
// ============================================================================
import { computed } from 'vue'
import RateTrend from './RateTrend.vue'

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
   * to imply one. The chart leaves a gap.
   */
  bars: { weeks: string[]; entity: (number | null)[]; cohort: (number | null)[] }
  pupilMinutesCapped?: boolean
}

const props = defineProps<{
  data: WeekBlock
  /** Named when there is no comparison to draw — shown as a quiet note. */
  noCohortReason?: string | null
  /** The entity's standing in its cohort, if the server still computes one. */
  percentile?: number | null
  cohortUnit?: string | null
}>()

/** 1st, 2nd, 3rd, 4th — "91th percentile" is nobody's English. */
function ordinal(n: number): string {
  const v = Math.round(n)
  const tens = v % 100
  if (tens >= 11 && tens <= 13) return `${v}th`
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`
}

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

const barsSpan = computed(() => {
  const w = props.data.bars.weeks
  if (w.length === 0) return ''
  return `${w[0]} → ${w[w.length - 1]}`
})
const hasBars = computed(() =>
  props.data.bars.entity.some((v) => typeof v === 'number' && v > 0)
  || props.data.bars.cohort.some((v) => typeof v === 'number' && v > 0))
</script>

<template>
  <div class="wk">
    <header class="wk-head">
      <p class="wk-window">{{ data.label }}</p>
      <p class="wk-range">{{ data.rangeLabel }}</p>
    </header>

    <!-- ── The three numbers, this entity then the cohort's same three ── -->
    <div class="wk-grid" :class="{ 'wk-grid-solo': !cohort }">
      <div class="wk-col wk-col-entity">
        <p class="wk-col-label">{{ entity.label }}</p>
        <dl class="wk-nums">
          <div class="wk-num">
            <dt>Play as class</dt>
            <dd class="wk-big">{{ mins(entity.classMinutes) }}</dd>
          </div>
          <div class="wk-num">
            <dt>Students on their own</dt>
            <dd class="wk-big">{{ mins(entity.pupilMinutes) }}</dd>
          </div>
          <div class="wk-num wk-num-total">
            <dt>Total learning time</dt>
            <dd class="wk-small">{{ mins(entity.totalMinutes) }}</dd>
          </div>
          <div class="wk-num wk-num-phrases">
            <dt>New phrases</dt>
            <dd class="wk-big">{{ Math.round(entity.newPhrases) }}</dd>
          </div>
        </dl>
      </div>

      <div v-if="cohort" class="wk-col wk-col-cohort">
        <p class="wk-col-label">{{ cohort.label }}</p>
        <dl class="wk-nums">
          <div class="wk-num">
            <dt>Play as class</dt>
            <dd class="wk-big">{{ mins(cohort.classMinutes) }}</dd>
          </div>
          <div class="wk-num">
            <dt>Students on their own</dt>
            <dd class="wk-big">{{ mins(cohort.pupilMinutes) }}</dd>
          </div>
          <div class="wk-num wk-num-total">
            <dt>Total learning time</dt>
            <dd class="wk-small">{{ mins(cohort.totalMinutes) }}</dd>
          </div>
          <div class="wk-num wk-num-phrases">
            <dt>New phrases</dt>
            <dd class="wk-big">{{ Math.round(cohort.newPhrases) }}</dd>
          </div>
        </dl>
        <p v-if="denominatorLine" class="wk-denominator">{{ denominatorLine }}</p>
      </div>
    </div>

    <p v-if="!cohort && noCohortReason" class="wk-note">{{ noCohortReason }}</p>
    <p v-if="data.pupilMinutesCapped" class="wk-note">
      Students' own minutes aren't counted at this level — too many classes to read individually.
      Play-as-class time is complete.
    </p>
    <p v-else-if="percentile != null && cohortUnit" class="wk-tag">
      {{ ordinal(percentile) }} percentile of {{ cohortUnit }}
    </p>

    <!-- ── 12 Monday-anchored weeks. An empty week is an empty week. ── -->
    <section v-if="hasBars" class="wk-trend">
      <p class="wk-trend-label">Total learning time · last 12 weeks · {{ barsSpan }}</p>
      <RateTrend
        :entity-label="entity.label"
        :entity="data.bars.entity"
        :average-label="cohort?.label || 'Average'"
        :average="data.bars.cohort"
        y-label="minutes / week"
        :period-days="7"
      />
    </section>
  </div>
</template>

<style scoped>
.wk { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

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

.wk-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
.wk-grid-solo { grid-template-columns: minmax(0, 1fr); }

.wk-col {
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 12px;
  padding: 14px 15px;
  /* A grid item's min-width is auto, so the longest word inside sets the
   * column's floor — "Ysgol Cas-gwent Chepstow School average" pushed the
   * whole card wider than a phone and clipped its own caption. */
  min-width: 0;
}
.wk-col-entity { background: rgba(var(--rc-entity, 96, 165, 250), 0.07); }
.wk-col-label {
  margin: 0 0 12px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted, #8A8078);
  /* A long class name must not push the two columns out of alignment. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wk-nums { margin: 0; display: flex; flex-direction: column; gap: 11px; }
.wk-num { margin: 0; }
.wk-num dt {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ink-muted, #8A8078);
}
.wk-num dd { margin: 2px 0 0; }
.wk-big {
  font-family: var(--font-display, inherit);
  font-size: 26px;
  line-height: 1.1;
  color: var(--ink-primary, #2C2622);
}
/* The total is the sum of the two above it, so it whispers rather than shouts. */
.wk-small {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--ink-secondary, #5b534c);
}
.wk-num-total { padding-top: 9px; border-top: 1px solid rgba(44, 38, 34, 0.09); }
.wk-num-phrases { padding-top: 9px; border-top: 1px solid rgba(44, 38, 34, 0.09); }

.wk-denominator,
.wk-note {
  margin: 10px 0 0;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-muted, #8A8078);
}
.wk-tag {
  margin: 0;
  align-self: flex-start;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--ink-muted, #8A8078);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: 999px;
  padding: 4px 10px;
}

.wk-trend { display: flex; flex-direction: column; gap: 8px; }
.wk-trend-label {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted, #8A8078);
}

/* Phone: the two columns stack rather than shrinking the numbers to nothing. */
@media (max-width: 560px) {
  .wk-grid { grid-template-columns: 1fr; }
  .wk-big { font-size: 23px; }
}
</style>
