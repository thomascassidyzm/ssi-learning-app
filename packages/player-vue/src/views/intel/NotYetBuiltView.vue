<script setup lang="ts">
/**
 * The honest state of a question whose page has not been built yet.
 *
 * The frame is ten questions from the first day, so all ten are in the top bar
 * and all ten have a route. A question with no page says exactly that, in the
 * same layout as the built ones. It is not a teaser and it is not a stub with
 * a fake number on it — empty with honesty beats seeded.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import QuestionPage from '@/intel/QuestionPage.vue'
import { questionBySlug } from '@/intel/questions'

const route = useRoute()
const question = computed(() => questionBySlug(route.path.split('/').filter(Boolean).pop() ?? ''))
</script>

<template>
  <!-- HANDBOOK A question whose page is not built yet
       section: seeing-progress
       roles: admin
       place: intel
       keywords: not yet, unbuilt, coming, question, frame
       What it's for. Holding the place of a question that is in the frame but
       has no page yet, in the same layout as the built ones, so the bar always
       shows all ten and nothing pretends to measure what it does not.
       Where it is. Any question in the bar shown in the quieter grey.
       How you do it.
       1. Tap the question in the bar.
       2. Read the card saying nothing is measured for it yet.
       Worth knowing. This is never a teaser and never a stub with a fake
       number on it.
       checked: 29fd2d6b.5a8cae4e
  -->
  <QuestionPage
    data-intel="question-not-yet"
    :question="question?.question ?? 'Unknown question'"
    answer="This page has not been built yet."
    :fetched-at="null"
    :people="null"
  >
    <template #evidence>
      <div class="not-yet">
        <p>
          This is one of the ten questions the surface exists to answer, and it is
          here so the frame is complete from the first day. Nothing is being
          measured for it yet.
        </p>
      </div>
    </template>
  </QuestionPage>
</template>

<style scoped>
.not-yet {
  background: var(--schools-card);
  border: 1px dashed var(--schools-border-strong);
  border-radius: var(--schools-radius-lg, 12px);
  padding: 22px 20px;
  color: var(--schools-fg-2);
  font-size: 14px;
  max-width: 60ch;
}
</style>
