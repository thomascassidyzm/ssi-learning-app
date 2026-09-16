<script setup lang="ts">
// ============================================================================
// components/ClassWeekList.vue — THE LEADER'S PAGE: the same week, once per
// class, quietest first (Tom via RBF, 2026-09-16: the "how long since each
// class practised" section, buried at screen 12, IS the page).
//
// Each card is that class's own three numbers for the week, off the same
// rows and the same Monday-anchored bounds as the card above it, so a
// class's card and the school's card cannot disagree. Quiet is drawn as
// ABSENCE: a class that has not practised shows the gap — "not in the last
// twelve weeks" — not a zero and not a scold. A class that has never started
// has no numbers at all and sits in its own quiet group at the end, because
// it has not "gone quiet"; it has not begun.
//
// Each card carries the same trend rendering as the card above it, compact:
// twelve weekly bars in the class colour with the level's mean as a faint
// line across them (Tom's display-lab verdict, 2026-09-16: "Bars with a faint
// normal line is best").
//
// No rank, no ordinal, no league table. Tap a card for that class's own card
// with its comparison.
// ============================================================================
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import WeekBars from './WeekBars.vue'
import type { WeekClassRow } from './WeekNumbersCard.vue'

const props = defineProps<{
  classes: WeekClassRow[]
  /** Builds the link to one class's own insights. */
  linkFor: (classId: string) => string
  windowLabel?: string
  /**
   * The faint normal line laid across every card's bars: the mean over the
   * classes at this level, week by week. Absent is fine — bars alone then.
   */
  normal?: (number | null)[] | null
}>()
const { t } = useI18n()

function mins(n: number): string {
  const whole = Math.round(n)
  if (whole < 60) return `${whole}m`
  const h = Math.floor(whole / 60)
  const m = whole % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "today", "yesterday", "3 days ago", "5 weeks ago" — a school's own words. */
function since(iso: string | null): string {
  if (!iso) return t('insights.classes.notInTwelveWeeks', 'not in the last 12 weeks')
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return t('insights.classes.today', 'today')
  if (days === 1) return t('insights.classes.yesterday', 'yesterday')
  if (days < 14) return t('insights.classes.daysAgo', '{n} days ago').replace('{n}', String(days))
  return t('insights.classes.weeksAgo', '{n} weeks ago').replace('{n}', String(Math.floor(days / 7)))
}

const started = computed(() => props.classes.filter((c) => c.started))
const notStarted = computed(() => props.classes.filter((c) => !c.started))
</script>

<template>
  <!-- HANDBOOK Each class, quietest first
       section: seeing-progress
       moment: every-lesson
       roles: school_admin, leader, admin
       place: node-insights
       keywords: classes, quiet, last practised, not started, week, each class
       walk: reading-insights
       What it's for. Seeing every class under this level at a glance, the one that
       has gone longest without practising first, with its week beside its name.
       Where it is. Under the card on a school's or a group's insights page.
       How you do it.
       1. Read down the list. Each card says when that class last practised, then
          its total time and new phrases for the week, then that class's last twelve
          weeks as small bars with the average here drawn across them as a faint line.
       2. Tap a class to open its own card, with the average beside it.
       3. Classes that have not started yet are counted in one quiet line at the
          end; open it to see their names.
       Worth knowing. This is not a league table. Nothing is ranked by minutes and
       nobody is scored. A class that has not practised shows the gap — "not in the
       last 12 weeks" — rather than a zero.
       checked: 795dafce.1486e16b
  -->
  <section class="cwl" data-walk="insights-classes">
    <header class="cwl-head">
      <h2 class="cwl-title">{{ t('insights.classes.title', 'Each class, quietest first') }}</h2>
      <p class="cwl-sub">{{ t('insights.classes.sub', 'How long since each class last practised, and its week. Tap a class for its own card.') }}</p>
    </header>

    <p v-if="classes.length === 0" class="cwl-empty">{{ t('insights.classes.none', 'No classes on this course here yet.') }}</p>

    <ul v-if="started.length" class="cwl-list">
      <li v-for="c in started" :key="c.id" class="cwl-item">
        <router-link :to="linkFor(c.id)" class="cwl-card">
          <span class="cwl-name">{{ c.name }}</span>
          <span class="cwl-since">{{ t('insights.classes.lastPractised', 'last practised {when}').replace('{when}', since(c.lastPlayedAt)) }}</span>
          <span class="cwl-nums">
            <span class="cwl-num"><span class="cwl-num-v">{{ mins(c.totalMinutes ?? 0) }}</span><span class="cwl-num-l">{{ windowLabel || t('insights.classes.thisWeek', 'this week') }}</span></span>
            <span class="cwl-num"><span class="cwl-num-v">{{ Math.round(c.newPhrases ?? 0) }}</span><span class="cwl-num-l">{{ t('insights.classes.newPhrases', 'new phrases') }}</span></span>
          </span>
          <WeekBars
            v-if="c.bars && c.bars.some((v) => typeof v === 'number')"
            class="cwl-bars"
            size="compact"
            :entity="c.bars"
            :cohort="normal ?? null"
            :label="t('insights.classes.barsLabel', 'Last twelve weeks of learning time for {name}, against the average here').replace('{name}', c.name)"
          />
        </router-link>
      </li>
    </ul>

    <details v-if="notStarted.length" class="cwl-quiet">
      <summary class="cwl-quiet-sum">
        {{ notStarted.length === 1
          ? t('insights.classes.oneNotStarted', '1 class has not started yet')
          : t('insights.classes.nNotStarted', '{n} classes have not started yet').replace('{n}', String(notStarted.length)) }}
      </summary>
      <ul class="cwl-quiet-list">
        <li v-for="c in notStarted" :key="c.id"><router-link :to="linkFor(c.id)" class="cwl-quiet-link">{{ c.name }}</router-link></li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.cwl { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.cwl-head { display: flex; flex-direction: column; gap: 3px; }
.cwl-title {
  font-family: var(--font-display); font-size: clamp(18px, 2vw, 22px); font-weight: 400;
  line-height: 1.15; color: var(--ink-primary, #2C2622); margin: 0;
}
.cwl-sub { font-size: 13.5px; line-height: 1.5; color: var(--ink-secondary, #5b534c); margin: 0; max-width: 60ch; }
.cwl-empty, .cwl-quiet-sum {
  font-family: var(--font-mono); font-size: 12px; color: var(--ink-muted, #8A8078); margin: 0;
}
.cwl-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.cwl-item { min-width: 0; }
.cwl-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: 'name nums' 'since nums' 'bars bars';
  gap: 2px 14px;
  align-items: center;
  padding: 12px 14px;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}
.cwl-card:hover { border-color: rgba(var(--rc-entity, 96, 165, 250), 0.6); }
.cwl-name { grid-area: name; font-family: var(--font-display, inherit); font-size: 16px; color: var(--ink-primary, #2C2622); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cwl-since { grid-area: since; font-family: var(--font-mono); font-size: 11px; color: var(--ink-muted, #8A8078); }
.cwl-nums { grid-area: nums; display: flex; gap: 14px; }
.cwl-num { display: flex; flex-direction: column; align-items: flex-end; }
.cwl-num-v { font-family: var(--font-display, inherit); font-size: 19px; line-height: 1.1; color: var(--ink-primary, #2C2622); font-variant-numeric: tabular-nums; }
.cwl-num-l { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-muted, #8A8078); }
.cwl-bars { grid-area: bars; margin-top: 8px; }
.cwl-quiet { margin: 0; }
.cwl-quiet-sum { cursor: pointer; }
.cwl-quiet-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.cwl-quiet-link { font-family: var(--font-mono); font-size: 12px; color: var(--ink-secondary, #5b534c); }
</style>
