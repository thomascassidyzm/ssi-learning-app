<script setup lang="ts">
/**
 * QuestionPage — the five-part layout every one of the ten questions wears.
 *
 * Design §3.1, and the rule that makes it worth having: no page may add to or
 * reorder these five. Top to bottom they are
 *
 *   1. Where you are   — the rail, left at desktop width, first at phone width
 *   2. The answer      — one sentence, one number, the stamp and the chip
 *   3. The evidence    — exactly ONE widget from the Insight Engine library
 *   4. The rows        — the things behind the number, every row a link
 *   5. The verbs       — actions the answer implies, across the top of the
 *                        main column, most common first
 *
 * The verb bar renders EMPTY rather than being omitted when a page has no
 * verbs, so the slot is always in the same place and a reader never has to
 * work out whether a page simply forgot it. docs/intelligence-surface-verbs.md
 * says which verbs belong on which question.
 *
 * The chip and the stamp are this component's own, not each page's, which is
 * what makes "every page shows them, in the same slot" true by construction
 * instead of true by everybody remembering.
 */
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import PopulationChip from './PopulationChip.vue'
import UpdatedStamp from './UpdatedStamp.vue'
import ScopeRail from './ScopeRail.vue'
import QuestionFindings from './QuestionFindings.vue'
import { useIntelUsage } from './useIntelUsage'

withDefaults(defineProps<{
  /** The question, said out loud, as the kicker. */
  question: string
  /** Slot 2: the answer in one plain sentence. Null while it loads. */
  answer: string | null
  /** Slot 2: the one number beside the sentence, when there is one. */
  headline?: string | null
  fetchedAt: Date | null
  people: number | null
  showingTestData?: boolean
  /** For a page about one person: their standing in the numbers, in words. */
  populationNote?: string | null
  courses?: { code: string; name: string }[]
  courseScopable?: boolean
  /** For a page about one person: who, so the rail can say where you are. */
  person?: { id: string; name: string } | null
}>(), {
  headline: null,
  showingTestData: false,
  populationNote: null,
  courseScopable: false,
  person: null,
})

// THE SURFACE RECORDS ITS OWN USE. Every question opened, about whom, so in
// a month the ten-question premise is measured rather than assumed — see
// useIntelUsage.ts. Recorded here, in the layout, so no page can forget.
const route = useRoute()
const { recordOpened } = useIntelUsage()
const slug = () => route.path.split('/').filter(Boolean).pop() ?? ''
function record(): void {
  const slug_ = slug()
  const course = typeof route.query.course === 'string' ? route.query.course : null
  void recordOpened({ question: slug_, course })
}
onMounted(record)
watch(() => [route.path, route.query.course], record)
</script>

<template>
  <!-- HANDBOOK How every question page is laid out
       section: seeing-progress
       roles: admin
       place: intel
       parts: verb-bar, answer, evidence, rows
       keywords: question, page, layout, answer, evidence, rows, verbs, five parts
       What it's for. Every one of the ten questions is answered on a page with
       the same five parts in the same order, so once you can read one you can
       read them all: where you are, the answer, the evidence, the rows, and the
       verbs.
       Where it is. Any page under What's happening.
       How you do it.
       1. Read the map on the left to see who the question is being asked about.
       2. Read the answer: one plain sentence and one number, with when it was
          fetched and who is counted directly beneath.
       3. Read the evidence: one chart, never two side by side.
       4. Open any row beneath it. Every row is a link to the thing it names.
       5. The buttons across the top of the main column are the things you can
          do about the answer. When there is nothing to do, the strip is empty
          rather than missing.
       Worth knowing. No page may add a part or move one. A page that tried to
       would fail the build.
       checked: f511f1fc.9db64e3c
  -->
  <div class="question-page" data-intel="question-page">
    <!-- 1. WHERE YOU ARE -->
    <aside class="where">
      <ScopeRail :courses="courses" :course-scopable="courseScopable" :person="person" />
    </aside>

    <div class="main">
      <!-- 5. THE VERBS — first in the source because it sits across the top of
           the main column; empty is a rendered state, not a missing one. -->
      <div class="verbs" data-intel="verb-bar">
        <slot name="verbs" />
      </div>

      <!-- The nightly findings about THIS question, above the answer — the
           Discovery feed's new shape. Layout-owned, so no page can forget. -->
      <QuestionFindings :question="slug()" />

      <!-- 2. THE ANSWER -->
      <section class="answer" data-intel="answer">
        <p class="kicker">{{ question }}</p>
        <p v-if="headline" class="headline">{{ headline }}</p>
        <p class="sentence arsenal">{{ answer ?? 'Working it out…' }}</p>
        <div class="meta">
          <UpdatedStamp :fetched-at="fetchedAt" />
          <PopulationChip :people="people" :showing-test-data="showingTestData" :note="populationNote" />
        </div>
      </section>

      <!-- 3. THE EVIDENCE — exactly one widget, never two side by side. -->
      <section class="evidence" data-intel="evidence">
        <slot name="evidence" />
      </section>

      <!-- 4. THE ROWS -->
      <section class="rows" data-intel="rows">
        <slot name="rows" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.question-page {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 20px;
  /* The shell pads and centres; the page only lays out. */
  max-width: 1180px;
  margin: 0 auto;
}

@media (max-width: 900px) {
  .question-page { grid-template-columns: minmax(0, 1fr); }
}

.main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.verbs { display: flex; flex-wrap: wrap; gap: 8px; min-height: 4px; }

.answer {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg, 12px);
  padding: 18px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kicker {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red);
}

.headline {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 34px;
  line-height: 1.1;
  color: var(--schools-fg);
}

.sentence { font-size: 20px; line-height: 1.3; color: var(--schools-fg); }

.meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
</style>
