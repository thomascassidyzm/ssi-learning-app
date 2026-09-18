<script setup lang="ts">
/**
 * Support — every in-app report a learner has sent us, and the reply (job #28).
 *
 * Tom, 2026-09-16 22:50Z: Tom, Kai and any ssi_admin must be able to SEE every
 * in-app report and reply from there, even though agents may end up handling
 * most of them.
 *
 * PLAIN, NOT A DASHBOARD. One list, unanswered first, newest first. A row opens
 * to the whole report — what she wrote, where she was, on what — and a reply
 * box. The reply goes out as a message to her inbox, which she meets on the
 * Library notice card, and the row then shows whether she has opened it.
 *
 * TWO POSTBOXES, ONE LIST: the player's Report a bug writes bug_reports, the
 * older tester panel writes tester_feedback. Both are read here.
 *
 * AND THE SCHOOLS CHANNEL, IN THE SAME LIST (job #220, Tom 2026-09-18). A
 * school's or an org's support thread sits among the learner reports, ordered
 * the same way: waiting first, newest first. A row names the school and the
 * person; opening it shows the whole exchange, what her screen said when she
 * wrote, and a reply box. The reply goes out as SSi, authored as the admin who
 * typed it — never as the school admin, even while touring under View As.
 */
import { ref, computed, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'

type ReportSource = 'bug_report' | 'tester_feedback'
interface Report {
  source: ReportSource
  id: string
  createdAt: string
  authUserId: string | null
  who: string
  courseCode: string | null
  position: string | null
  device: string | null
  appVersion: string | null
  deploymentEnv: string | null
  title: string | null
  body: string
  screenshotUrl: string | null
  status: string | null
  repliedAt: string | null
  repliedBy: string | null
  replyMessageId: string | null
  replyText: string | null
  replySeenAt: string | null
}

interface ThreadSummary {
  id: string
  kind: 'school' | 'group'
  who: string
  person: string | null
  language: string | null
  createdAt: string
  lastMessageAt: string | null
  lastBody: string
  lastDirection: 'in' | 'out' | null
  unanswered: number
  messageCount: number
  lastReadAt: string | null
}
interface ThreadMessage {
  id: string
  body: string
  direction: 'in' | 'out'
  author_source: string
  author_name: string | null
  created_at: string
}
interface ThreadContext {
  route: string | null
  anchor: string | null
  displayedLabel: string | null
  displayedValue: string | null
  build: string | null
  device: string | null
  server: Record<string, any> | null
  signalKey: string | null
  computedAt: string | null
}
interface ThreadDetail extends ThreadSummary {
  messages: ThreadMessage[]
  context: ThreadContext | null
}

/** One row of the list, whichever door it came in by. */
type Row =
  | { kind: 'report'; key: string; answered: boolean; at: string; report: Report }
  | { kind: 'thread'; key: string; answered: boolean; at: string; thread: ThreadSummary }

const { getAuthToken } = useAdminClient()

const reports = ref<Report[]>([])
const threads = ref<ThreadSummary[]>([])
const openThread = ref<ThreadDetail | null>(null)
const threadLoading = ref(false)
const threadError = ref('')
const unanswered = ref(0)
const loading = ref(true)
const loadError = ref('')
const openId = ref<string | null>(null)
const drafts = ref<Record<string, string>>({})
const sending = ref<string | null>(null)
const sendError = ref<Record<string, string>>({})
const showAnswered = ref(false)

const key = (r: Report) => `${r.source}:${r.id}`

/** Waiting first, then newest first — across both doors, one order. */
const rows = computed<Row[]>(() => {
  const all: Row[] = [
    ...reports.value.map((r) => ({ kind: 'report' as const, key: `report:${key(r)}`, answered: !!r.repliedAt, at: r.createdAt, report: r })),
    ...threads.value.map((t) => ({ kind: 'thread' as const, key: `thread:${t.id}`, answered: t.unanswered === 0, at: t.lastMessageAt ?? t.createdAt, thread: t })),
  ]
  return all.sort((a, b) => {
    if (a.answered !== b.answered) return a.answered ? 1 : -1
    return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)
  })
})

const shown = computed(() => (showAnswered.value ? rows.value : rows.value.filter((r) => !r.answered)))

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getAuthToken()
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`)
  return data
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const [reportData, threadData] = await Promise.all([api('/api/admin/reports'), api('/api/admin/support')])
    reports.value = reportData.reports ?? []
    threads.value = threadData.threads ?? []
    unanswered.value = (reportData.unanswered ?? 0) + (threadData.unanswered ?? 0)
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load'
  } finally {
    loading.value = false
  }
}
onMounted(load)

function toggle(row: Row): void {
  const next = openId.value === row.key ? null : row.key
  openId.value = next
  if (row.kind === 'thread' && next) void openThreadDetail(row.thread.id)
  if (row.kind === 'thread' && !next) openThread.value = null
}

async function openThreadDetail(id: string): Promise<void> {
  threadLoading.value = true
  threadError.value = ''
  openThread.value = null
  try {
    const data = await api(`/api/admin/support?id=${encodeURIComponent(id)}`)
    openThread.value = data.thread ?? null
  } catch (err) {
    threadError.value = err instanceof Error ? err.message : 'Could not open the thread'
  } finally {
    threadLoading.value = false
  }
}

function recount(): void {
  unanswered.value = reports.value.filter((r) => !r.repliedAt).length + threads.value.filter((t) => t.unanswered > 0).length
}

async function sendThreadReply(t: ThreadSummary): Promise<void> {
  const k = `thread:${t.id}`
  const text = (drafts.value[k] ?? '').trim()
  if (!text || sending.value) return
  sending.value = k
  sendError.value = { ...sendError.value, [k]: '' }
  try {
    const out = await api('/api/admin/support/reply', { method: 'POST', body: JSON.stringify({ threadId: t.id, text }) })
    if (out.thread) {
      openThread.value = out.thread
      threads.value = threads.value.map((x) => (x.id === t.id ? { ...x, ...out.thread, messages: undefined } as ThreadSummary : x))
    }
    drafts.value = { ...drafts.value, [k]: '' }
    recount()
  } catch (err) {
    sendError.value = { ...sendError.value, [k]: err instanceof Error ? err.message : 'Could not send' }
  } finally {
    sending.value = null
  }
}

async function send(r: Report): Promise<void> {
  const k = key(r)
  const text = (drafts.value[k] ?? '').trim()
  if (!text || sending.value) return
  sending.value = k
  sendError.value = { ...sendError.value, [k]: '' }
  try {
    const out = await api('/api/admin/reports/reply', { method: 'POST', body: JSON.stringify({ source: r.source, id: r.id, text }) })
    reports.value = reports.value.map((x) => (key(x) === k && out.report ? out.report : x))
    drafts.value = { ...drafts.value, [k]: '' }
    recount()
  } catch (err) {
    sendError.value = { ...sendError.value, [k]: err instanceof Error ? err.message : 'Could not send' }
  } finally {
    sending.value = null
  }
}

const stamp = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : stamp.format(d)
}

/** What a school thread's row says about its state, in a few words. */
function threadState(t: ThreadSummary): string {
  if (t.unanswered > 0) return `Waiting since ${when(t.lastMessageAt ?? t.createdAt)}`
  if (t.lastDirection !== 'out') return `${t.messageCount} messages`
  const read = t.lastReadAt ? Date.parse(t.lastReadAt) : 0
  const sent = Date.parse(t.lastMessageAt ?? t.createdAt) || 0
  return read > sent ? `Answered ${when(t.lastMessageAt)} · read` : `Answered ${when(t.lastMessageAt)} · not opened yet`
}

/** What the row says about the reply, in a few words. */
function replyState(r: Report): string {
  if (!r.repliedAt) return 'Not answered'
  if (r.replySeenAt) return `Answered ${when(r.repliedAt)} · read ${when(r.replySeenAt)}`
  return `Answered ${when(r.repliedAt)} · not opened yet`
}
</script>

<template>
  <div class="support">
    <header class="support-head">
      <h1>Support</h1>
      <p class="support-sub">
        Every report sent from inside the app, and every school's support thread. {{ unanswered }} not answered.
      </p>
      <label class="support-toggle">
        <input type="checkbox" v-model="showAnswered" />
        Show answered too
      </label>
    </header>

    <p v-if="loading" class="support-state">Loading…</p>
    <p v-else-if="loadError" class="support-error" role="alert">{{ loadError }}</p>
    <p v-else-if="!shown.length" class="support-state">Nothing waiting.</p>

    <template v-for="row in shown" :key="row.key">
      <!-- A learner's report from inside the player. -->
      <article
        v-if="row.kind === 'report'"
        class="report"
        :class="{ 'is-open': openId === row.key, 'is-answered': row.answered }"
      >
        <button type="button" class="report-head" @click="toggle(row)" :aria-expanded="openId === row.key">
          <span class="report-dot" aria-hidden="true"></span>
          <span class="report-lines">
            <span class="report-who">{{ row.report.who }}<span v-if="row.report.courseCode" class="report-course"> · {{ row.report.courseCode }}</span></span>
            <span class="report-snippet">{{ row.report.title || row.report.body }}</span>
            <span class="report-state">{{ replyState(row.report) }}</span>
          </span>
          <time class="report-time" :datetime="row.report.createdAt">{{ when(row.report.createdAt) }}</time>
        </button>

        <div v-if="openId === row.key" class="report-body">
          <p v-if="row.report.title" class="report-title">{{ row.report.title }}</p>
          <p class="report-text">{{ row.report.body }}</p>

          <dl class="report-facts">
            <div v-if="row.report.position"><dt>Where</dt><dd>{{ row.report.position }}</dd></div>
            <div v-if="row.report.device"><dt>Device</dt><dd>{{ row.report.device }}</dd></div>
            <div v-if="row.report.appVersion"><dt>Build</dt><dd>{{ row.report.appVersion }}<span v-if="row.report.deploymentEnv"> · {{ row.report.deploymentEnv }}</span></dd></div>
            <div v-if="row.report.status"><dt>Status</dt><dd>{{ row.report.status }}</dd></div>
            <div><dt>Sent</dt><dd>{{ when(row.report.createdAt) }} · {{ row.report.source === 'bug_report' ? 'Report a bug' : 'tester panel' }}</dd></div>
          </dl>

          <a v-if="row.report.screenshotUrl" class="report-shot" :href="row.report.screenshotUrl" target="_blank" rel="noopener">Screenshot</a>

          <div v-if="row.report.repliedAt" class="report-reply-sent">
            <p class="report-reply-label">{{ replyState(row.report) }}</p>
            <p class="report-text">{{ row.report.replyText }}</p>
          </div>

          <div v-else-if="!row.report.authUserId" class="report-reply-sent">
            <p class="report-reply-label">Sent by a guest, so there is no inbox to reply to.</p>
          </div>

          <div v-else class="report-reply">
            <label :for="`reply-${key(row.report)}`">Reply</label>
            <textarea
              :id="`reply-${key(row.report)}`"
              v-model="drafts[key(row.report)]"
              rows="5"
              placeholder="She reads this in the app, under her own report."
            ></textarea>
            <button type="button" class="report-send" :disabled="sending === key(row.report) || !(drafts[key(row.report)] || '').trim()" @click="send(row.report)">
              {{ sending === key(row.report) ? 'Sending…' : 'Send reply' }}
            </button>
            <p v-if="sendError[key(row.report)]" class="support-error" role="alert">{{ sendError[key(row.report)] }}</p>
          </div>
        </div>
      </article>

      <!-- A school's or an org's support thread. -->
      <article
        v-else
        class="report"
        :class="{ 'is-open': openId === row.key, 'is-answered': row.answered }"
      >
        <button type="button" class="report-head" @click="toggle(row)" :aria-expanded="openId === row.key">
          <span class="report-dot" aria-hidden="true"></span>
          <span class="report-lines">
            <span class="report-who">
              {{ row.thread.who }}
              <span class="report-course"> · {{ row.thread.kind === 'school' ? 'school' : 'organisation' }}<span v-if="row.thread.person"> · {{ row.thread.person }}</span></span>
            </span>
            <span class="report-snippet">{{ row.thread.lastBody }}</span>
            <span class="report-state">{{ threadState(row.thread) }}</span>
          </span>
          <time class="report-time" :datetime="row.thread.lastMessageAt || row.thread.createdAt">{{ when(row.thread.lastMessageAt || row.thread.createdAt) }}</time>
        </button>

        <div v-if="openId === row.key" class="report-body">
          <p v-if="threadLoading" class="support-state">Loading…</p>
          <p v-else-if="threadError" class="support-error" role="alert">{{ threadError }}</p>

          <template v-else-if="openThread && openThread.id === row.thread.id">
            <div v-for="m in openThread.messages" :key="m.id" class="turn" :class="m.direction === 'out' ? 'turn-out' : 'turn-in'">
              <p class="report-reply-label">
                {{ m.direction === 'out' ? (m.author_name || 'SSi') : (m.author_name || row.thread.who) }} · {{ when(m.created_at) }}
              </p>
              <p class="report-text">{{ m.body }}</p>
            </div>

            <dl v-if="openThread.context" class="report-facts">
              <div v-if="openThread.context.route"><dt>Where</dt><dd>{{ openThread.context.route }}<span v-if="openThread.context.anchor"> · {{ openThread.context.anchor }}</span></dd></div>
              <div v-if="openThread.context.displayedLabel"><dt>Tile</dt><dd>{{ openThread.context.displayedLabel }}<span v-if="openThread.context.displayedValue"> showed {{ openThread.context.displayedValue }}</span></dd></div>
              <div v-if="openThread.context.device"><dt>Device</dt><dd>{{ openThread.context.device }}</dd></div>
              <div v-if="openThread.context.build"><dt>Build</dt><dd>{{ openThread.context.build }}</dd></div>
              <div v-if="openThread.context.signalKey"><dt>Signal</dt><dd>{{ openThread.context.signalKey }}</dd></div>
            </dl>

            <div class="report-reply">
              <label :for="`reply-${row.key}`">Reply as SSi</label>
              <textarea
                :id="`reply-${row.key}`"
                v-model="drafts[row.key]"
                rows="5"
                placeholder="She reads this in her school's Support thread, and gets an email if she misses it."
              ></textarea>
              <button type="button" class="report-send" :disabled="sending === row.key || !(drafts[row.key] || '').trim()" @click="sendThreadReply(row.thread)">
                {{ sending === row.key ? 'Sending…' : 'Send reply' }}
              </button>
              <p v-if="sendError[row.key]" class="support-error" role="alert">{{ sendError[row.key] }}</p>
            </div>
          </template>
        </div>
      </article>
    </template>
  </div>
</template>

<style scoped>
.support { max-width: 760px; margin: 0 auto; padding: 16px 16px 64px; }
.support-head h1 { margin: 0 0 4px; font-size: 22px; color: var(--schools-fg, #2C2622); }
.support-sub { margin: 0 0 8px; font-size: 14px; color: var(--schools-fg-2, #6B635C); }
.support-toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--schools-fg-2, #6B635C); margin-bottom: 16px; }
.support-state { font-size: 14px; color: var(--schools-fg-2, #6B635C); }
.support-error { font-size: 13px; color: var(--schools-red, #b3312f); }

.report { border: 1px solid var(--schools-border, #e5e1dc); border-radius: 12px; background: #fff; overflow: hidden; margin-bottom: 8px; }
.report-head { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 12px 14px; background: none; border: 0; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.report-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--schools-accent, #c23a3a); flex: 0 0 8px; margin-top: 6px; }
.report.is-answered .report-dot { background: var(--schools-border, #e5e1dc); }
.report-lines { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.report-who { font-size: 14px; font-weight: 600; color: var(--schools-fg, #2C2622); overflow-wrap: anywhere; }
.report-course { font-weight: 400; color: var(--schools-fg-2, #6B635C); }
.report-snippet { font-size: 14px; color: var(--schools-fg, #2C2622); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
.report-state { font-size: 12px; color: var(--schools-fg-3, #8A8078); }
.report-time { font-size: 12px; color: var(--schools-fg-3, #8A8078); white-space: nowrap; }

.report-body { padding: 0 14px 14px 32px; display: flex; flex-direction: column; gap: 12px; }
.report-title { margin: 0; font-size: 15px; font-weight: 600; }
.report-text { margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; color: var(--schools-fg, #2C2622); }
.report-facts { margin: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.report-facts > div { display: flex; gap: 8px; }
.report-facts dt { flex: 0 0 64px; color: var(--schools-fg-3, #8A8078); }
.report-facts dd { margin: 0; color: var(--schools-fg-2, #6B635C); word-break: break-word; }
.report-shot { font-size: 13px; color: var(--schools-accent, #c23a3a); }
.turn { border-left: 3px solid var(--schools-border, #e5e1dc); padding-left: 12px; display: flex; flex-direction: column; gap: 4px; }
.turn-out { border-left-color: var(--schools-accent, #c23a3a); }
.report-reply-sent { border-left: 3px solid var(--schools-border, #e5e1dc); padding-left: 12px; display: flex; flex-direction: column; gap: 6px; }
.report-reply-label { margin: 0; font-size: 12px; color: var(--schools-fg-3, #8A8078); }
.report-reply { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.report-reply label { font-size: 13px; color: var(--schools-fg-2, #6B635C); }
.report-reply textarea { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid var(--schools-border, #e5e1dc); font: inherit; font-size: 14px; resize: vertical; }
.report-send { padding: 9px 18px; border-radius: 999px; font: inherit; font-size: 14px; cursor: pointer; border: 1px solid var(--schools-accent, #c23a3a); background: var(--schools-accent, #c23a3a); color: #fff; }
.report-send:disabled { opacity: 0.6; cursor: default; }
</style>
