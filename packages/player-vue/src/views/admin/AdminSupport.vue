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

const { getAuthToken } = useAdminClient()

const reports = ref<Report[]>([])
const unanswered = ref(0)
const loading = ref(true)
const loadError = ref('')
const openId = ref<string | null>(null)
const drafts = ref<Record<string, string>>({})
const sending = ref<string | null>(null)
const sendError = ref<Record<string, string>>({})
const showAnswered = ref(false)

const key = (r: Report) => `${r.source}:${r.id}`

const shown = computed(() => (showAnswered.value ? reports.value : reports.value.filter((r) => !r.repliedAt)))

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
    const data = await api('/api/admin/reports')
    reports.value = data.reports ?? []
    unanswered.value = data.unanswered ?? 0
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load'
  } finally {
    loading.value = false
  }
}
onMounted(load)

function toggle(r: Report): void {
  openId.value = openId.value === key(r) ? null : key(r)
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
    unanswered.value = reports.value.filter((x) => !x.repliedAt).length
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
        Every report sent from inside the app. {{ unanswered }} not answered.
      </p>
      <label class="support-toggle">
        <input type="checkbox" v-model="showAnswered" />
        Show answered too
      </label>
    </header>

    <p v-if="loading" class="support-state">Loading…</p>
    <p v-else-if="loadError" class="support-error" role="alert">{{ loadError }}</p>
    <p v-else-if="!shown.length" class="support-state">Nothing waiting.</p>

    <article
      v-for="r in shown"
      :key="key(r)"
      class="report"
      :class="{ 'is-open': openId === key(r), 'is-answered': !!r.repliedAt }"
    >
      <button type="button" class="report-head" @click="toggle(r)" :aria-expanded="openId === key(r)">
        <span class="report-dot" aria-hidden="true"></span>
        <span class="report-lines">
          <span class="report-who">{{ r.who }}<span v-if="r.courseCode" class="report-course"> · {{ r.courseCode }}</span></span>
          <span class="report-snippet">{{ r.title || r.body }}</span>
          <span class="report-state">{{ replyState(r) }}</span>
        </span>
        <time class="report-time" :datetime="r.createdAt">{{ when(r.createdAt) }}</time>
      </button>

      <div v-if="openId === key(r)" class="report-body">
        <p v-if="r.title" class="report-title">{{ r.title }}</p>
        <p class="report-text">{{ r.body }}</p>

        <dl class="report-facts">
          <div v-if="r.position"><dt>Where</dt><dd>{{ r.position }}</dd></div>
          <div v-if="r.device"><dt>Device</dt><dd>{{ r.device }}</dd></div>
          <div v-if="r.appVersion"><dt>Build</dt><dd>{{ r.appVersion }}<span v-if="r.deploymentEnv"> · {{ r.deploymentEnv }}</span></dd></div>
          <div v-if="r.status"><dt>Status</dt><dd>{{ r.status }}</dd></div>
          <div><dt>Sent</dt><dd>{{ when(r.createdAt) }} · {{ r.source === 'bug_report' ? 'Report a bug' : 'tester panel' }}</dd></div>
        </dl>

        <a v-if="r.screenshotUrl" class="report-shot" :href="r.screenshotUrl" target="_blank" rel="noopener">Screenshot</a>

        <div v-if="r.repliedAt" class="report-reply-sent">
          <p class="report-reply-label">{{ replyState(r) }}</p>
          <p class="report-text">{{ r.replyText }}</p>
        </div>

        <div v-else-if="!r.authUserId" class="report-reply-sent">
          <p class="report-reply-label">Sent by a guest, so there is no inbox to reply to.</p>
        </div>

        <div v-else class="report-reply">
          <label :for="`reply-${key(r)}`">Reply</label>
          <textarea
            :id="`reply-${key(r)}`"
            v-model="drafts[key(r)]"
            rows="5"
            placeholder="She reads this in the app, under her own report."
          ></textarea>
          <button type="button" class="report-send" :disabled="sending === key(r) || !(drafts[key(r)] || '').trim()" @click="send(r)">
            {{ sending === key(r) ? 'Sending…' : 'Send reply' }}
          </button>
          <p v-if="sendError[key(r)]" class="support-error" role="alert">{{ sendError[key(r)] }}</p>
        </div>
      </div>
    </article>
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
.report-reply-sent { border-left: 3px solid var(--schools-border, #e5e1dc); padding-left: 12px; display: flex; flex-direction: column; gap: 6px; }
.report-reply-label { margin: 0; font-size: 12px; color: var(--schools-fg-3, #8A8078); }
.report-reply { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.report-reply label { font-size: 13px; color: var(--schools-fg-2, #6B635C); }
.report-reply textarea { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid var(--schools-border, #e5e1dc); font: inherit; font-size: 14px; resize: vertical; }
.report-send { padding: 9px 18px; border-radius: 999px; font: inherit; font-size: 14px; cursor: pointer; border: 1px solid var(--schools-accent, #c23a3a); background: var(--schools-accent, #c23a3a); color: #fff; }
.report-send:disabled { opacity: 0.6; cursor: default; }
</style>
