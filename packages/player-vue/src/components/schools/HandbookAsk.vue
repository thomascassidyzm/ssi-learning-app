<script setup lang="ts">
/**
 * HandbookAsk — "Not in here?" (job #386): the Handbook's ask box and the
 * reader's own questions, with their answers rendered back on the page.
 *
 * Deflect for free before writing anything: a lenient local match over the
 * question's content words runs as the reader types, and a strong match is offered
 * as "This might be it" with Ask anyway beside it. No network, no model.
 *
 * Honesty about the tiers a question can be in: an answer that exists only
 * in the database is outside the compile gate that guards every entry on
 * this page, so it is rendered as "Answered on 8 September, not yet checked
 * into the handbook" — never posing as page content. A question the
 * handbook already answers, or that became an entry, links to that entry.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { suggestHandbook, type HandbookEntry } from '@/walkthrough/handbook'
import {
  askHandbookQuestion, fetchMyHandbookQuestions, questionDay, answeringEntryId,
  type HandbookQuestion,
} from '@/walkthrough/handbookQuestions'

const props = defineProps<{
  entries: HandbookEntry[]
  persona: string
  nodeId: string
  route: string
  /** Text pushed in from a search that found nothing. */
  seed?: string
}>()
const emit = defineEmits<{ (e: 'open-entry', id: string): void }>()

const { t, locale } = useI18n()
const text = ref('')
const box = ref<HTMLTextAreaElement | null>(null)
const sending = ref(false)
const sentMessage = ref('')
const failMessage = ref('')
const askAnyway = ref(false)
const mine = ref<HandbookQuestion[]>([])

watch(() => props.seed, (s) => {
  if (!s) return
  text.value = s
  askAnyway.value = false
  requestAnimationFrame(() => box.value?.focus())
})

// The free deflection: the best local match, once there is enough to match on.
const deflection = computed<HandbookEntry | null>(() => {
  const q = text.value.trim()
  if (askAnyway.value || q.length < 8) return null
  return suggestHandbook(q, props.entries)
})

const canAsk = computed(() => text.value.trim().length >= 3 && !sending.value)

async function ask(): Promise<void> {
  if (!canAsk.value) return
  sending.value = true
  failMessage.value = ''
  const result = await askHandbookQuestion({
    question: text.value.trim(),
    route: props.route,
    persona: props.persona,
    node_id: props.nodeId || null,
    deflected_entry_id: deflection.value?.id ?? null,
  })
  sending.value = false
  if (result.ok === false) {
    const refused: { status: number; error: string } = result
    failMessage.value = refused.status === 429
      ? refused.error
      : t('schools.handbookPage.askFailed', 'That did not send. Try again in a moment.')
    return
  }
  mine.value = [result.question, ...mine.value]
  text.value = ''
  askAnyway.value = false
  sentMessage.value = t('schools.handbookPage.asked', 'Asked. The answer gets written into this page, so it will be here for the next person too. Usually the next day.')
}

function entryTitle(id: string | null): string {
  return props.entries.find((e) => e.id === id)?.title ?? ''
}

// Markdown-lite, escaped first — same rule as the page's own prose.
function md(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

onMounted(async () => { mine.value = await fetchMyHandbookQuestions() })
</script>

<template>
  <section id="hb-ask" class="schools-card schools-card-pad hb-ask" data-handbook-ask>
    <template v-if="mine.length">
      <h2 class="arsenal hb-ask-title">{{ t('schools.handbookPage.yourQuestions', 'Your questions') }}</h2>
      <ul class="hb-q-list">
        <li v-for="q in mine" :key="q.id" class="hb-q" :data-question-status="q.status">
          <p class="hb-q-text">{{ q.question }}</p>
          <template v-if="answeringEntryId(q)">
            <p class="hb-q-status">
              {{ t('schools.handbookPage.answeredInHandbook', 'Answered in the handbook:') }}
              <button type="button" class="hb-q-link" @click="emit('open-entry', answeringEntryId(q)!)">{{ entryTitle(answeringEntryId(q)) || answeringEntryId(q) }}</button>
            </p>
          </template>
          <template v-else-if="q.status === 'answered' && q.answer">
            <!-- eslint-disable-next-line vue/no-v-html — an admin's answer, escaped in md() -->
            <p class="hb-q-answer" v-html="md(q.answer)"></p>
            <p class="hb-q-status hb-q-unchecked">{{ t('schools.handbookPage.answeredNotChecked', 'Answered on {date}, not yet checked into the handbook.').replace('{date}', questionDay(q.answered_at, locale)) }}</p>
          </template>
          <template v-else-if="q.status === 'declined'">
            <p class="hb-q-status">{{ t('schools.handbookPage.couldNotAnswer', 'We could not answer this one.') }}<template v-if="q.answer"> {{ q.answer }}</template></p>
          </template>
          <p v-else class="hb-q-status">{{ t('schools.handbookPage.notAnsweredYet', 'Asked on {date}. Not answered yet.').replace('{date}', questionDay(q.created_at, locale)) }}</p>
        </li>
      </ul>
    </template>

    <h2 class="arsenal hb-ask-title">{{ t('schools.handbookPage.notInHere', 'Not in here?') }}</h2>
    <p class="hb-ask-lede">{{ t('schools.handbookPage.askLede', 'Ask, and the answer gets written into this page for the next person too.') }}</p>
    <textarea
      ref="box"
      v-model="text"
      class="hb-ask-box"
      rows="3"
      maxlength="600"
      :placeholder="t('schools.handbookPage.askPlaceholder', 'What were you trying to do?')"
      :aria-label="t('schools.handbookPage.notInHere', 'Not in here?')"
      @input="sentMessage = ''; askAnyway = false"
    ></textarea>
    <div v-if="deflection" class="hb-deflect" data-handbook-deflection>
      <span class="hb-deflect-text">{{ t('schools.handbookPage.mightBeIt', 'This might be it') }} — <strong>{{ deflection.title }}</strong></span>
      <span class="hb-deflect-actions">
        <button type="button" class="btn-play" @click="emit('open-entry', deflection.id)">{{ t('schools.handbookPage.openIt', 'Open it') }}</button>
        <button type="button" class="btn-ghost" @click="askAnyway = true">{{ t('schools.handbookPage.askAnyway', 'Ask anyway') }}</button>
      </span>
    </div>
    <div v-else class="hb-ask-actions">
      <button type="button" class="btn-play" :disabled="!canAsk" data-handbook-ask-submit @click="ask">{{ t('schools.handbookPage.askButton', 'Ask') }}</button>
    </div>
    <p v-if="sentMessage" class="hb-ask-sent" role="status">{{ sentMessage }}</p>
    <p v-if="failMessage" class="hb-ask-fail" role="alert">{{ failMessage }}</p>
  </section>
</template>

<style scoped>
.hb-ask { display: flex; flex-direction: column; gap: var(--space-3); }
.hb-ask-title { margin: 0; font-size: var(--text-lg); }
.hb-ask-lede { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); }
.hb-ask-box {
  width: 100%; padding: 10px 12px; font: inherit; resize: vertical;
  border: 1px solid var(--schools-border-strong, rgba(15,18,18,.18)); border-radius: 10px;
  background: var(--schools-card, #fff); color: var(--schools-fg, #0F1212);
}
.hb-ask-actions { display: flex; justify-content: flex-end; }
.hb-deflect {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2);
  padding: var(--space-3); border-radius: 10px; background: var(--schools-bg, #F3F1EE);
  font-size: var(--text-sm); color: var(--schools-fg-2, #555);
}
.hb-deflect-text strong { color: var(--schools-fg, #0F1212); }
.hb-deflect-actions { display: flex; gap: var(--space-2); }
.hb-ask-sent { margin: 0; font-size: var(--text-sm); color: var(--schools-fg-2, #555); }
.hb-ask-fail { margin: 0; font-size: var(--text-sm); color: var(--schools-red, #DB1E17); }
.hb-q-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.hb-q { padding: 10px 0; border-top: 1px solid var(--schools-border, rgba(15,18,18,.10)); display: flex; flex-direction: column; gap: 4px; }
.hb-q:first-child { border-top: none; padding-top: 0; }
.hb-q-text { margin: 0; color: var(--schools-fg, #0F1212); font-size: var(--text-sm); font-weight: var(--font-semibold); }
.hb-q-answer { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); line-height: 1.6; }
.hb-q-answer :deep(strong) { color: var(--schools-fg, #0F1212); }
.hb-q-status { margin: 0; color: var(--schools-fg-3, #6b6b6b); font-size: var(--text-xs); }
.hb-q-unchecked { font-style: italic; }
.hb-q-link {
  background: none; border: none; cursor: pointer; padding: 0; font: inherit; font-size: var(--text-xs);
  color: var(--schools-red, #DB1E17); text-decoration: underline; text-underline-offset: 3px;
}
</style>
