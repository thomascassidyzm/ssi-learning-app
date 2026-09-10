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
import PopulationChip from './PopulationChip.vue'
import UpdatedStamp from './UpdatedStamp.vue'
import ScopeRail from './ScopeRail.vue'

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
  courses?: { code: string; name: string }[]
  courseScopable?: boolean
}>(), {
  headline: null,
  showingTestData: false,
  courseScopable: false,
})
</script>

<template>
  <div class="question-page" data-intel="question-page">
    <!-- 1. WHERE YOU ARE -->
    <aside class="where">
      <ScopeRail :courses="courses" :course-scopable="courseScopable" />
    </aside>

    <div class="main">
      <!-- 5. THE VERBS — first in the source because it sits across the top of
           the main column; empty is a rendered state, not a missing one. -->
      <div class="verbs" data-intel="verb-bar">
        <slot name="verbs" />
      </div>

      <!-- 2. THE ANSWER -->
      <section class="answer" data-intel="answer">
        <p class="kicker">{{ question }}</p>
        <p v-if="headline" class="headline">{{ headline }}</p>
        <p class="sentence arsenal">{{ answer ?? 'Working it out…' }}</p>
        <div class="meta">
          <UpdatedStamp :fetched-at="fetchedAt" />
          <PopulationChip :people="people" :showing-test-data="showingTestData" />
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
  padding: 20px max(20px, env(safe-area-inset-right, 0px)) calc(28px + env(safe-area-inset-bottom, 0px)) max(20px, env(safe-area-inset-left, 0px));
  max-width: 1180px;
  margin: 0 auto;
}

@media (max-width: 900px) {
  .question-page { grid-template-columns: minmax(0, 1fr); }
}

.main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.verbs { display: flex; flex-wrap: wrap; gap: 8px; min-height: 4px; }

.answer {
  background: var(--schools-card, #fff);
  border: 1px solid var(--schools-border, rgba(15, 18, 18, .10));
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
