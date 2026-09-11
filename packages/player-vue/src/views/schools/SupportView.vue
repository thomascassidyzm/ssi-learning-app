<script setup lang="ts">
/**
 * Door two (spec §2, §14 item 2): the standing thread. Messages oldest-first,
 * hers plain, SSi's plain, Tom's visibly his — his name, no agent framing.
 * One text box, one Send. One line of state while a message is escalated and
 * unanswered: "Waiting on Tom since 19:40". Polls on open and on focus; no
 * socket, no typing indicator, no read receipts.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { useSupportChannel, type SupportMessage } from '@/composables/schools/useSupportChannel'

const { t } = useI18n()
const { loadThread, sendMessage } = useSupportChannel()

const messages = ref<SupportMessage[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const text = ref('')
const sending = ref(false)
const sendError = ref<string | null>(null)
const listEl = ref<HTMLElement | null>(null)

async function refresh(): Promise<void> {
  try {
    const { messages: rows } = await loadThread()
    messages.value = rows
    loadError.value = null
    requestAnimationFrame(() => { listEl.value?.scrollTo({ top: listEl.value.scrollHeight }) })
  } catch {
    loadError.value = t('schools.support.loadFailed', 'Could not load the thread.')
  } finally {
    loading.value = false
  }
}

function onFocus(): void {
  if (document.visibilityState === 'visible') void refresh()
}

// A short poll while the page is open, so a reply written seconds after her
// question appears without her doing anything. Cleared on leave.
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void refresh()
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onFocus)
  timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 15000)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onFocus)
  if (timer) clearInterval(timer)
})

async function send(): Promise<void> {
  const body = text.value.trim()
  if (!body || sending.value) return
  sending.value = true
  sendError.value = null
  try {
    const row = await sendMessage({ text: body })
    messages.value = [...messages.value, row]
    text.value = ''
    requestAnimationFrame(() => { listEl.value?.scrollTo({ top: listEl.value.scrollHeight }) })
  } catch {
    sendError.value = t('schools.support.sendFailed', 'Could not send. Try again.')
  } finally {
    sending.value = false
  }
}

/** Who wrote it, from the stamp — never from the prose. */
function authorOf(m: SupportMessage): 'you' | 'tom' | 'ssi' {
  if (m.direction === 'in') return 'you'
  return m.author_source === 'human' ? 'tom' : 'ssi'
}
function authorLabel(m: SupportMessage): string {
  const a = authorOf(m)
  if (a === 'you') return m.author_name || t('schools.support.you', 'You')
  if (a === 'tom') return m.author_name || 'Tom'
  return 'SSi'
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dayClock = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
function stamp(iso: string): string {
  const d = new Date(iso)
  return Date.now() - d.getTime() < 86400000 ? clock.format(d) : dayClock.format(d)
}

// The one state line: an escalated question with no word from Tom yet.
const waitingOnTom = computed(() => {
  const open = messages.value.filter((m) => m.escalated_at && !m.escalation_resolved_at)
  return open.length ? open[open.length - 1].escalated_at! : null
})
</script>

<template>
  <main class="support-screen">
    <header class="support-head">
      <h1 class="arsenal support-title">{{ t('schools.support.title', 'Support') }}</h1>
      <p class="support-lede">{{ t('schools.support.lede', 'Ask us anything about the dashboard. Answers appear here, and you can come back to this thread any time.') }}</p>
    </header>

    <section class="schools-card schools-card-pad support-card">
      <p v-if="waitingOnTom" class="support-state">
        {{ t('schools.support.waitingOnTom', 'Waiting on Tom since {time}').replace('{time}', stamp(waitingOnTom)) }}
      </p>
      <p v-if="loadError" class="support-error" role="alert">{{ loadError }}</p>
      <div ref="listEl" class="support-list" aria-live="polite">
        <p v-if="!loading && !messages.length" class="support-empty">
          {{ t('schools.support.empty', 'Nothing here yet. Ask anything about the dashboard, or tell us when a number looks wrong.') }}
        </p>
        <article
          v-for="m in messages"
          :key="m.id"
          class="msg"
          :class="{ 'is-you': authorOf(m) === 'you', 'is-tom': authorOf(m) === 'tom', 'is-ssi': authorOf(m) === 'ssi' }"
        >
          <header class="msg-head">
            <span class="msg-author">{{ authorLabel(m) }}</span>
            <time class="msg-time" :datetime="m.created_at">{{ stamp(m.created_at) }}</time>
          </header>
          <p class="msg-body">{{ m.body }}</p>
        </article>
      </div>
      <form class="support-compose" @submit.prevent="send">
        <textarea
          v-model="text"
          class="support-input"
          rows="3"
          :placeholder="t('schools.support.writeMessage', 'Write a message')"
          :aria-label="t('schools.support.writeMessage', 'Write a message')"
        ></textarea>
        <p class="support-door-line">{{ t('schools.support.doorLine', 'This thread belongs to your school, and any admin of your school can read it.') }}</p>
        <p v-if="sendError" class="support-error" role="alert">{{ sendError }}</p>
        <div class="support-actions">
          <button type="submit" class="btn-play btn-small" :disabled="sending || !text.trim()">
            {{ sending ? t('schools.support.sending', 'Sending…') : t('schools.support.send', 'Send') }}
          </button>
        </div>
      </form>
    </section>
  </main>
</template>

<style scoped>
.support-screen { display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px)); }
.support-head { display: flex; flex-direction: column; gap: 4px; }
.support-title { margin: 0; font-size: 22px; }
.support-lede { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); }
.support-card { display: flex; flex-direction: column; gap: var(--space-3); }
.support-state {
  margin: 0; font-size: 13px; padding: 8px 12px; border-radius: 8px;
  background: #fbf6e9; color: #6b4e00; border: 1px solid #efdfb0;
}
.support-error { margin: 0; font-size: 13px; color: var(--schools-red, #b3312f); }
.support-empty { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); }
.support-list { display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow: auto; padding: 2px; }
.msg { display: flex; flex-direction: column; gap: 4px; max-width: 92%; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--schools-border, #e5e5e5); background: #fff; }
.msg.is-you { align-self: flex-end; background: #f5f3ef; }
.msg.is-ssi { align-self: flex-start; }
.msg.is-tom { align-self: flex-start; border-color: var(--schools-red, #b3312f); }
.msg.is-tom .msg-author { color: var(--schools-red, #b3312f); }
.msg-head { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--schools-fg-2, #555); }
.msg-author { font-weight: 600; }
.msg-body { margin: 0; white-space: pre-wrap; font-size: 14px; line-height: 1.5; }
.support-compose { display: flex; flex-direction: column; gap: 8px; }
.support-input { width: 100%; box-sizing: border-box; resize: vertical; padding: 10px 12px; font: inherit; font-size: 14px; border: 1px solid var(--schools-border, #ddd); border-radius: 10px; }
.support-door-line { margin: 0; font-size: 12px; color: var(--schools-fg-3, #777); }
.support-actions { display: flex; justify-content: flex-end; }
</style>
