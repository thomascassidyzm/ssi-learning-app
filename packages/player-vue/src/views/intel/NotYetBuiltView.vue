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
  <QuestionPage
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
  background: var(--schools-card, #fff);
  border: 1px dashed var(--schools-border-strong, rgba(15, 18, 18, .18));
  border-radius: var(--schools-radius-lg, 12px);
  padding: 22px 20px;
  color: var(--schools-fg-2);
  font-size: 14px;
  max-width: 60ch;
}
</style>
