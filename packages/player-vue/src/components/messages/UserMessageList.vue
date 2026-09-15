<script setup lang="ts">
/**
 * The inbox list (job #684), shared by the schools Inbox page and the learner
 * Inbox page. A tap opens the message and marks it read — that tap, nothing
 * earlier, is what "read" means. An opened message shows its one action; a
 * taken action stays visible as done rather than vanishing.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { useUserRole } from '@/composables/useUserRole'
import { useUserMessages, type UserMessage, type ThreadTurn } from '@/composables/useUserMessages'
import { renderMarkdownLight } from '@/utils/markdownLight'

const emit = defineEmits<{ (e: 'open-support'): void }>()
const { t } = useI18n()
const { isViewingAs } = useUserRole()
const { messages, loaded, loadError, refresh, markRead, act, loadThread, reply } = useUserMessages()

const openId = ref<string | null>(null)
const acting = ref<string | null>(null)
const actError = ref<Record<string, string>>({})

// An admin message (job #821) opens with the conversation under it and a
// write-back box. The reply is what makes the channel live.
const turns = ref<Record<string, ThreadTurn[]>>({})
const threadError = ref<Record<string, string>>({})
const draft = ref<Record<string, string>>({})
const sending = ref<string | null>(null)
const replyNote = ref<Record<string, string>>({})

async function open(m: UserMessage): Promise<void> {
  openId.value = openId.value === m.id ? null : m.id
  if (openId.value !== m.id) return
  await markRead(m.id)
  if (m.source === 'admin_message') {
    threadError.value = { ...threadError.value, [m.id]: '' }
    try {
      turns.value = { ...turns.value, [m.id]: await loadThread(m.id) }
    } catch {
      threadError.value = { ...threadError.value, [m.id]: t('inbox.threadLoadFailed') }
    }
  }
}

async function sendReply(m: UserMessage): Promise<void> {
  const text = (draft.value[m.id] ?? '').trim()
  if (!text || sending.value) return
  sending.value = m.id
  replyNote.value = { ...replyNote.value, [m.id]: '' }
  const r = await reply(m.id, text)
  if (r.ok) {
    turns.value = { ...turns.value, [m.id]: [...(turns.value[m.id] ?? []), r.turn] }
    draft.value = { ...draft.value, [m.id]: '' }
    replyNote.value = { ...replyNote.value, [m.id]: t('inbox.replySent') }
  } else {
    replyNote.value = { ...replyNote.value, [m.id]: t('inbox.replyFailed') }
  }
  sending.value = null
}

async function runAction(m: UserMessage): Promise<void> {
  if (!m.action || acting.value) return
  if (m.action.kind === 'open_support') { emit('open-support'); return }
  acting.value = m.id
  actError.value = { ...actError.value, [m.id]: '' }
  const outcome = await act(m.id)
  if (!outcome.ok) actError.value = { ...actError.value, [m.id]: outcome.error || t('inbox.actionFailed') }
  acting.value = null
}

function actionWords(m: UserMessage): string {
  if (!m.action) return ''
  if (m.action_taken_at) return m.action.kind === 'undo_class_play_copy' ? t('inbox.undone') : m.action.label
  if (m.action.kind === 'undo_class_play_copy') return t('inbox.undo')
  if (m.action.kind === 'open_support') return t('inbox.openSupport')
  return m.action.label
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dayClock = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
function stamp(iso: string): string {
  const d = new Date(iso)
  return Date.now() - d.getTime() < 86400000 ? clock.format(d) : dayClock.format(d)
}

function onFocus(): void {
  if (document.visibilityState === 'visible') void refresh()
}
onMounted(() => {
  void refresh()
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
</script>

<template>
  <div class="inbox-list" aria-live="polite">
    <p v-if="isViewingAs" class="inbox-state">{{ t('inbox.viewAsReadOnly') }}</p>
    <p v-else-if="loadError" class="inbox-error" role="alert">{{ t('inbox.loadFailed') }}</p>
    <p v-else-if="loaded && !messages.length" class="inbox-empty">{{ t('inbox.empty') }}</p>
    <article
      v-for="m in messages"
      :key="m.id"
      class="inbox-msg"
      :class="{ 'is-unread': !m.read_at, 'is-open': openId === m.id }"
    >
      <button type="button" class="inbox-msg-head" @click="open(m)" :aria-expanded="openId === m.id">
        <span class="inbox-dot" aria-hidden="true"></span>
        <span class="inbox-msg-title">
          <span v-if="m.source === 'admin_message'" class="inbox-msg-from">{{ t('inbox.fromSsi') }}</span>
          {{ m.title }}
        </span>
        <time class="inbox-msg-time" :datetime="m.created_at">{{ stamp(m.created_at) }}</time>
      </button>
      <div v-if="openId === m.id" class="inbox-msg-body">
        <div v-if="m.source === 'admin_message'" class="inbox-msg-rich">
          <p v-for="(para, pi) in renderMarkdownLight(m.body)" :key="pi" class="inbox-msg-text">
            <template v-for="(line, li) in para" :key="li">
              <br v-if="li > 0" />
              <template v-for="(run, ri) in line" :key="ri">
                <a v-if="run.href" :href="run.href" target="_blank" rel="noopener" :class="{ 'is-bold': run.bold }">{{ run.text }}</a>
                <strong v-else-if="run.bold">{{ run.text }}</strong>
                <template v-else>{{ run.text }}</template>
              </template>
            </template>
          </p>
          <ul v-if="(turns[m.id] ?? []).length" class="inbox-turns">
            <li v-for="turn in turns[m.id]" :key="turn.id" class="inbox-turn" :class="turn.direction === 'in' ? 'is-mine' : 'is-theirs'">
              <span class="inbox-turn-who">{{ turn.direction === 'in' ? t('inbox.you') : (turn.author_name || t('inbox.ssi')) }}</span>
              <span class="inbox-turn-text">{{ turn.body }}</span>
              <time class="inbox-turn-time" :datetime="turn.created_at">{{ stamp(turn.created_at) }}</time>
            </li>
          </ul>
          <p v-if="threadError[m.id]" class="inbox-error" role="alert">{{ threadError[m.id] }}</p>
          <form v-if="!isViewingAs" class="inbox-reply" @submit.prevent="sendReply(m)">
            <label class="inbox-reply-label" :for="`reply-${m.id}`">{{ t('inbox.replyLabel') }}</label>
            <textarea
              :id="`reply-${m.id}`"
              v-model="draft[m.id]"
              class="inbox-reply-box"
              rows="3"
              maxlength="2000"
              :placeholder="t('inbox.replyPlaceholder')"
            ></textarea>
            <div class="inbox-reply-row">
              <button type="submit" class="inbox-action" :disabled="sending === m.id || !(draft[m.id] ?? '').trim()">
                {{ sending === m.id ? t('inbox.sending') : t('inbox.send') }}
              </button>
              <span v-if="replyNote[m.id]" class="inbox-reply-note" aria-live="polite">{{ replyNote[m.id] }}</span>
            </div>
          </form>
        </div>
        <p v-else class="inbox-msg-text">{{ m.body }}</p>
        <div v-if="m.action" class="inbox-msg-actions">
          <button
            type="button"
            class="inbox-action"
            :class="{ 'is-done': !!m.action_taken_at }"
            :disabled="!!m.action_taken_at || acting === m.id || isViewingAs"
            @click="runAction(m)"
          >{{ acting === m.id ? t('inbox.working') : actionWords(m) }}</button>
          <p v-if="actError[m.id]" class="inbox-error" role="alert">{{ actError[m.id] }}</p>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.inbox-list { display: flex; flex-direction: column; gap: 8px; }
.inbox-state, .inbox-empty { margin: 0; font-size: 14px; color: var(--ink-secondary, var(--schools-fg-2, #6B635C)); }
.inbox-error { margin: 0; font-size: 13px; color: var(--schools-red, #b3312f); }
.inbox-msg { border: 1px solid var(--border-subtle, var(--schools-border, #e5e1dc)); border-radius: 12px; background: var(--bg-card, #fff); overflow: hidden; }
.inbox-msg-head {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px;
  background: none; border: 0; text-align: left; font: inherit; color: inherit; cursor: pointer;
}
.inbox-dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; flex: 0 0 8px; }
.inbox-msg.is-unread .inbox-dot { background: var(--belt-color, var(--schools-accent, #c23a3a)); }
.inbox-msg-title { flex: 1; font-size: 15px; color: var(--ink-primary, var(--schools-fg, #2C2622)); }
.inbox-msg.is-unread .inbox-msg-title { font-weight: 600; }
.inbox-msg-time { font-size: 12px; color: var(--ink-tertiary, var(--schools-fg-3, #8A8078)); white-space: nowrap; }
.inbox-msg-body { padding: 0 14px 14px 32px; display: flex; flex-direction: column; gap: 10px; }
.inbox-msg-text { margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; color: var(--ink-primary, var(--schools-fg, #2C2622)); }
.inbox-msg-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.inbox-action {
  padding: 8px 16px; border-radius: 999px; font: inherit; font-size: 14px; cursor: pointer;
  border: 1px solid var(--belt-color, var(--schools-accent, #c23a3a));
  background: var(--belt-color, var(--schools-accent, #c23a3a)); color: #fff;
}
.inbox-action:disabled { cursor: default; opacity: 0.7; }
.inbox-msg-from { display: block; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-tertiary, var(--schools-fg-3, #8A8078)); font-weight: 500; }
.inbox-msg-rich { display: flex; flex-direction: column; gap: 10px; }
.inbox-msg-rich a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.inbox-turns { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border-subtle, var(--schools-border, #e5e1dc)); padding-top: 10px; }
.inbox-turn { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px; background: var(--bg-primary, #e8e3dd); max-width: 92%; }
.inbox-turn.is-mine { align-self: flex-end; }
.inbox-turn.is-theirs { align-self: flex-start; background: var(--bg-card, #fff); border: 1px solid var(--border-subtle, var(--schools-border, #e5e1dc)); }
.inbox-turn-who { font-size: 11px; font-weight: 600; color: var(--ink-secondary, var(--schools-fg-2, #6B635C)); }
.inbox-turn-text { font-size: 14px; line-height: 1.45; white-space: pre-wrap; color: var(--ink-primary, var(--schools-fg, #2C2622)); }
.inbox-turn-time { font-size: 11px; color: var(--ink-tertiary, var(--schools-fg-3, #8A8078)); }
.inbox-reply { display: flex; flex-direction: column; gap: 6px; }
.inbox-reply-label { font-size: 12px; color: var(--ink-secondary, var(--schools-fg-2, #6B635C)); }
.inbox-reply-box {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; line-height: 1.4; padding: 10px 12px;
  border: 1px solid var(--border-subtle, var(--schools-border, #e5e1dc)); border-radius: 10px; background: var(--bg-card, #fff); color: inherit; resize: vertical;
}
.inbox-reply-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.inbox-reply-note { font-size: 13px; color: var(--ink-secondary, var(--schools-fg-2, #6B635C)); }
.inbox-action.is-done { background: transparent; color: var(--ink-secondary, var(--schools-fg-2, #6B635C)); border-color: var(--border-subtle, var(--schools-border, #e5e1dc)); opacity: 1; }
</style>
