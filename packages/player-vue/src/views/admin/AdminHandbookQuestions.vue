<script setup lang="ts">
/**
 * AdminHandbookQuestions — the answering half of the Handbook's ASK loop
 * (job #386). Every question a reader asked on /schools/handbook and could
 * not find, in one list, oldest unanswered first. An answer written here
 * lands on the asker's own Handbook page the next time they open it, as
 * "Answered on 8 September, not yet checked into the handbook" — and the
 * real fix is to write the capability's HANDBOOK comment beside its button
 * and mark the question "In the page", which links the asker to the entry.
 *
 * No batch answerer exists. This page is the loop, by hand, until one does.
 */
import { ref, computed, onMounted } from 'vue'
import {
  fetchAllHandbookQuestions, answerHandbookQuestion, questionDay,
  type HandbookQuestionFull, type HandbookQuestionStatus,
} from '@/walkthrough/handbookQuestions'
import { handbookEntries } from '@/walkthrough/handbook'

const questions = ref<HandbookQuestionFull[]>([])
const loading = ref(true)
const error = ref('')
const showDone = ref(false)
const busy = ref<string | null>(null)
const drafts = ref<Record<string, { answer: string; entry: string }>>({})

const entries = handbookEntries()

const visible = computed(() => {
  const list = showDone.value ? questions.value : questions.value.filter((q) => q.status === 'new')
  // Oldest unanswered first: the person who has waited longest is served first.
  return [...list].sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1) || a.created_at.localeCompare(b.created_at))
})
const openCount = computed(() => questions.value.filter((q) => q.status === 'new').length)

function draft(q: HandbookQuestionFull) {
  if (!drafts.value[q.id]) drafts.value[q.id] = { answer: q.answer ?? '', entry: q.entry_id ?? q.matched_entry_id ?? '' }
  return drafts.value[q.id]
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try { questions.value = await fetchAllHandbookQuestions() } catch (e) { error.value = (e as Error).message }
  loading.value = false
}

async function setStatus(q: HandbookQuestionFull, status: HandbookQuestionStatus): Promise<void> {
  const d = draft(q)
  if (status === 'answered' && !d.answer.trim()) { error.value = 'Write the answer first.'; return }
  if ((status === 'in_page' || status === 'duplicate') && !d.entry) { error.value = 'Pick the entry that answers it first.'; return }
  busy.value = q.id
  error.value = ''
  try {
    const updated = await answerHandbookQuestion({
      id: q.id, status,
      answer: d.answer.trim() || null,
      entry_id: status === 'in_page' ? d.entry : null,
      matched_entry_id: status === 'duplicate' ? d.entry : null,
    })
    questions.value = questions.value.map((x) => (x.id === q.id ? updated : x))
  } catch (e) { error.value = (e as Error).message }
  busy.value = null
}

onMounted(load)
</script>

<template>
  <div class="hbq schools-surface">
    <header class="hbq-head">
      <span class="schools-kicker">Handbook</span>
      <h1 class="arsenal hbq-title">Questions readers could not find an answer to</h1>
      <p class="hbq-lede">{{ openCount }} waiting. An answer here appears on the asker's Handbook page. The real fix is a HANDBOOK comment beside the button, then mark it In the page.</p>
      <label class="hbq-toggle"><input v-model="showDone" type="checkbox" /> Show answered too</label>
    </header>
    <p v-if="error" class="hbq-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="hbq-muted">Loading…</p>
    <p v-else-if="!visible.length" class="hbq-muted">Nothing waiting.</p>
    <article v-for="q in visible" :key="q.id" class="schools-card schools-card-pad hbq-card" :data-question-id="q.id">
      <p class="hbq-q">{{ q.question }}</p>
      <p class="hbq-meta">{{ q.persona }} · {{ q.route }} · {{ q.env }} · asked {{ questionDay(q.created_at) }}<template v-if="q.deflected_entry_id"> · was offered “{{ q.deflected_entry_id }}”</template> · <span class="status-pill tone-muted">{{ q.status }}</span></p>
      <textarea v-model="draft(q).answer" class="hbq-answer" rows="3" placeholder="The answer, in the handbook's voice: mechanism only, British English, no parentheses. **Bold** a label the reader can see."></textarea>
      <div class="hbq-row">
        <select v-model="draft(q).entry" class="hbq-select" aria-label="The handbook entry that answers it">
          <option value="">— the entry that answers it —</option>
          <option v-for="e in entries" :key="e.id" :value="e.id">{{ e.title }}</option>
        </select>
      </div>
      <div class="hbq-actions">
        <button type="button" class="btn-play" :disabled="busy === q.id" @click="setStatus(q, 'answered')">Answer</button>
        <button type="button" class="btn-ghost" :disabled="busy === q.id" @click="setStatus(q, 'duplicate')">Already in the handbook</button>
        <button type="button" class="btn-ghost" :disabled="busy === q.id" @click="setStatus(q, 'in_page')">In the page now</button>
        <button type="button" class="btn-ghost" :disabled="busy === q.id" @click="setStatus(q, 'declined')">Decline</button>
      </div>
    </article>
  </div>
</template>

<style scoped>
/* Clears the admin shell's fixed bottom nav so the last card's buttons are tappable on a phone. */
.hbq { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-4) var(--space-4) calc(var(--nav-height-safe, 80px) + var(--space-4)); max-width: 72ch; }
.hbq-head { display: flex; flex-direction: column; gap: 6px; }
.schools-kicker { font-family: var(--font-mono, monospace); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17); }
.hbq-title { margin: 0; }
.hbq-lede, .hbq-muted { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); }
.hbq-toggle { font-size: var(--text-xs); color: var(--schools-fg-2, #555); display: inline-flex; gap: 6px; align-items: center; }
.hbq-error { margin: 0; color: var(--schools-red, #DB1E17); font-size: var(--text-sm); }
.hbq-card { display: flex; flex-direction: column; gap: var(--space-2); }
.hbq-q { margin: 0; font-weight: var(--font-semibold); color: var(--schools-fg, #0F1212); }
.hbq-meta { margin: 0; font-size: var(--text-xs); color: var(--schools-fg-3, #6b6b6b); }
.hbq-answer, .hbq-select {
  width: 100%; padding: 8px 10px; font: inherit; font-size: var(--text-sm);
  border: 1px solid var(--schools-border-strong, rgba(15,18,18,.18)); border-radius: 8px;
  background: var(--schools-card, #fff); color: var(--schools-fg, #0F1212);
}
.hbq-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
