<script setup lang="ts">
/**
 * Messages — the admin-to-learner composer (job #821).
 *
 * Tom, 2026-09-15: "reaching out to learners with the ability to let them
 * know about new features, other things that have gone live, new PODS and so
 * on… by course… once they message support then the channel becomes live".
 *
 * ONE SCREEN, PHONE FIRST — Tom writes these on his phone. Pick the audience
 * (one course is the default; one learner through the People search; or
 * everyone), a title, a short body, see the count, send. The broadcast id is
 * minted the moment the form opens, so a double tap or a retry after a
 * timeout upserts the same message and never double-sends. Sent messages
 * land in the learner inbox with the quiet unread dot and nothing else: no
 * push, no email, no nag. A learner's reply comes back through Support.
 *
 * Copy rule: pods are 1-indexed in anything a learner reads — "Pod 1", never
 * "pod-0".
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { renderMarkdownLight } from '@/utils/markdownLight'

type Kind = 'course' | 'one' | 'all'
interface CourseRow { courseCode: string; displayName: string; learners: number }
/** One SEND. The server folds a per-recipient loop into one of these, so `recipient_count` is the whole send. */
interface SentRow { id: string; audience_kind: Kind; course_code: string | null; target_user_id: string | null; title: string; body: string; recipient_count: number; created_at: string; sent_at: string | null; parts?: number }
interface Person { id: string; user_id: string; display_name: string | null; primary_email: string | null }

const { getAuthToken } = useAdminClient()

const kind = ref<Kind>('course')
const courseCode = ref('')
const person = ref<Person | null>(null)
const personQuery = ref('')
const people = ref<Person[]>([])
const searching = ref(false)
const title = ref('')
const body = ref('')
const messageId = ref(mintId())

const courses = ref<CourseRow[]>([])
const allCount = ref(0)
const sent = ref<SentRow[]>([])
const loadError = ref('')
const loading = ref(true)

const audienceCount = ref<number | null>(null)
const audienceSample = ref<string[]>([])
const previewing = ref(false)
const sendingNow = ref(false)
const outcome = ref('')
const sendError = ref('')

function mintId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

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
    const data = await api('/api/admin/messages')
    courses.value = data.courses ?? []
    allCount.value = data.all ?? 0
    sent.value = data.sent ?? []
    if (!courseCode.value && courses.value[0]) courseCode.value = courses.value[0].courseCode
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load'
  } finally {
    loading.value = false
  }
}

const audienceQuery = computed(() => {
  if (kind.value === 'all') return 'kind=all'
  if (kind.value === 'course') return courseCode.value ? `kind=course&course_code=${encodeURIComponent(courseCode.value)}` : ''
  return person.value ? `kind=one&user_id=${encodeURIComponent(person.value.user_id)}` : ''
})

async function preview(): Promise<void> {
  audienceCount.value = null
  audienceSample.value = []
  if (!audienceQuery.value) return
  previewing.value = true
  try {
    const data = await api(`/api/admin/messages/audience?${audienceQuery.value}`)
    audienceCount.value = data.count ?? 0
    audienceSample.value = data.sample ?? []
  } catch {
    audienceCount.value = null
  } finally {
    previewing.value = false
  }
}
watch(audienceQuery, () => { void preview() })

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(personQuery, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  const term = q.trim()
  if (term.length < 2) { people.value = []; return }
  searchTimer = setTimeout(async () => {
    searching.value = true
    try {
      const data = await api(`/api/admin/users?limit=8&search=${encodeURIComponent(term)}`)
      people.value = data.users ?? []
    } catch {
      people.value = []
    } finally {
      searching.value = false
    }
  }, 250)
})

function pick(p: Person): void {
  person.value = p
  people.value = []
  personQuery.value = ''
}

const audienceWords = computed(() => {
  if (kind.value === 'all') return 'every learner'
  if (kind.value === 'course') {
    const c = courses.value.find((x) => x.courseCode === courseCode.value)
    return c ? `learners with progress on ${c.displayName}` : 'a course'
  }
  return person.value ? (person.value.display_name || person.value.primary_email || 'one learner') : 'one learner'
})

const canSend = computed(() =>
  !sendingNow.value && title.value.trim().length > 0 && body.value.trim().length > 0 && !!audienceQuery.value && (audienceCount.value ?? 0) > 0,
)

const confirmArmed = ref(false)

async function send(): Promise<void> {
  if (!canSend.value) return
  if (!confirmArmed.value) { confirmArmed.value = true; return }
  sendingNow.value = true
  sendError.value = ''
  outcome.value = ''
  try {
    const bodyOut: Record<string, unknown> = { id: messageId.value, kind: kind.value, title: title.value.trim(), body: body.value.trim() }
    if (kind.value === 'course') bodyOut.course_code = courseCode.value
    if (kind.value === 'one') bodyOut.user_id = person.value?.user_id
    const r = await api('/api/admin/messages/send', { method: 'POST', body: JSON.stringify(bodyOut) })
    outcome.value = r.sent === 0 && r.audience > 0
      ? `Already sent to ${r.audience} — nothing was sent twice.`
      : `Sent to ${r.sent} ${r.sent === 1 ? 'inbox' : 'inboxes'}.`
    title.value = ''
    body.value = ''
    messageId.value = mintId()
    confirmArmed.value = false
    await load()
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : 'That did not send'
  } finally {
    sendingNow.value = false
  }
}

watch([title, body, kind, courseCode, person], () => { confirmArmed.value = false })

const dayClock = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
function stamp(iso: string): string { return dayClock.format(new Date(iso)) }
/**
 * Who a send went to, counted. The 18 Sep schools note went out as 123
 * one-learner broadcasts and the list said "one learner · 1" 123 times; the
 * server now folds those into one row, so this says "123 learners" once.
 */
function sentAudience(s: SentRow): string {
  const n = s.recipient_count
  const people = `${n} ${n === 1 ? 'learner' : 'learners'}`
  if (s.audience_kind === 'all') return `everyone, ${people}`
  if (s.audience_kind === 'course') {
    const course = courses.value.find((c) => c.courseCode === s.course_code)?.displayName || s.course_code || 'a course'
    return `${course}, ${people}`
  }
  return n === 1 ? 'one learner' : people
}

onMounted(() => { void load() })
</script>

<template>
  <div class="admin-messages">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Learners</span>
        <h1 class="arsenal">Messages</h1>
        <p class="subtitle">Tell learners what has gone live. It lands in their inbox when they next open the app — no push, no email.</p>
      </div>
    </header>

    <p v-if="loadError" class="err" role="alert">{{ loadError }}</p>

    <form class="schools-card schools-card-pad composer" @submit.prevent="send">
      <fieldset class="field">
        <legend class="label">Who</legend>
        <div class="seg" role="radiogroup" aria-label="Audience">
          <label class="seg-item" :class="{ 'is-on': kind === 'course' }"><input v-model="kind" type="radio" value="course" name="kind" /> One course</label>
          <label class="seg-item" :class="{ 'is-on': kind === 'one' }"><input v-model="kind" type="radio" value="one" name="kind" /> One learner</label>
          <label class="seg-item" :class="{ 'is-on': kind === 'all' }"><input v-model="kind" type="radio" value="all" name="kind" /> Everyone</label>
        </div>
      </fieldset>

      <div v-if="kind === 'course'" class="field">
        <label class="label" for="msg-course">Course</label>
        <select id="msg-course" v-model="courseCode" class="input" data-testid="msg-course">
          <option v-for="c in courses" :key="c.courseCode" :value="c.courseCode">{{ c.displayName }} · {{ c.learners }}</option>
        </select>
        <p v-if="!loading && !courses.length" class="hint">No course has a learner with progress yet.</p>
      </div>

      <div v-if="kind === 'one'" class="field">
        <label class="label" for="msg-person">Learner</label>
        <div v-if="person" class="picked">
          <span>{{ person.display_name || 'No name yet' }} <span class="muted">{{ person.primary_email }}</span></span>
          <button type="button" class="link" @click="person = null">Change</button>
        </div>
        <template v-else>
          <input id="msg-person" v-model="personQuery" class="input" type="search" inputmode="search" placeholder="Name, email or support id" autocomplete="off" />
          <ul v-if="people.length" class="people">
            <li v-for="p in people" :key="p.id"><button type="button" class="person" @click="pick(p)">{{ p.display_name || 'No name yet' }} <span class="muted">{{ p.primary_email }}</span></button></li>
          </ul>
          <p v-else-if="searching" class="hint">Searching…</p>
        </template>
      </div>

      <div class="field">
        <label class="label" for="msg-title">Title</label>
        <input id="msg-title" v-model="title" class="input" type="text" maxlength="120" placeholder="Pod 1 is live for Spanish" data-testid="msg-title" />
      </div>
      <div class="field">
        <label class="label" for="msg-body">Message</label>
        <textarea id="msg-body" v-model="body" class="input body" rows="5" maxlength="2000" placeholder="Short and plain. **bold** and links work; nothing else does." data-testid="msg-body"></textarea>
        <p class="hint">Pods are numbered from 1 in anything a learner reads: Pod 1, never pod-0.</p>
      </div>

      <div class="preview" aria-live="polite">
        <p class="count" data-testid="msg-audience">
          <template v-if="!audienceQuery">Pick who this goes to.</template>
          <template v-else-if="previewing || audienceCount === null">Counting…</template>
          <template v-else><strong class="mono-nums">{{ audienceCount }}</strong> {{ audienceCount === 1 ? 'inbox' : 'inboxes' }} · {{ audienceWords }}<span v-if="audienceSample.length" class="muted"> · {{ audienceSample.join(', ') }}<template v-if="audienceCount > audienceSample.length">…</template></span></template>
        </p>
        <div v-if="body.trim()" class="rendered">
          <p class="rendered-title">{{ title || 'Untitled' }}</p>
          <p v-for="(para, pi) in renderMarkdownLight(body)" :key="pi" class="rendered-text">
            <template v-for="(line, li) in para" :key="li">
              <br v-if="li > 0" />
              <template v-for="(run, ri) in line" :key="ri">
                <a v-if="run.href" :href="run.href" target="_blank" rel="noopener">{{ run.text }}</a>
                <strong v-else-if="run.bold">{{ run.text }}</strong>
                <template v-else>{{ run.text }}</template>
              </template>
            </template>
          </p>
        </div>
      </div>

      <div class="actions">
        <button type="submit" class="send" :class="{ 'is-armed': confirmArmed }" :disabled="!canSend" data-testid="msg-send">
          {{ sendingNow ? 'Sending…' : confirmArmed ? `Yes, send to ${audienceCount}` : 'Send' }}
        </button>
        <button v-if="confirmArmed && !sendingNow" type="button" class="link" @click="confirmArmed = false">Not yet</button>
        <span v-if="outcome" class="ok" role="status">{{ outcome }}</span>
        <span v-if="sendError" class="err" role="alert">{{ sendError }}</span>
      </div>
    </form>

    <section class="schools-card schools-card-pad sent-list">
      <h2 class="h2">Sent</h2>
      <p v-if="!sent.length && !loading" class="hint">Nothing sent yet. Replies come back through Support.</p>
      <ul class="sent">
        <li v-for="s in sent" :key="s.id" class="sent-row">
          <span class="sent-title">{{ s.title }}</span>
          <span class="muted">{{ sentAudience(s) }} · {{ stamp(s.created_at) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.admin-messages { max-width: 720px; }
.page-header { margin-bottom: 18px; }
.subtitle { margin: 6px 0 0; color: var(--schools-fg-2); max-width: 60ch; }
.composer { display: flex; flex-direction: column; gap: 16px; margin-bottom: 18px; }
.field { display: flex; flex-direction: column; gap: 6px; border: 0; padding: 0; margin: 0; min-width: 0; }
.label { font-size: 12px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--schools-fg-2); }
.input {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; padding: 12px 12px;
  border: 1px solid var(--schools-border); border-radius: 10px; background: var(--schools-card); color: var(--schools-fg);
}
.input.body { resize: vertical; line-height: 1.45; }
.hint { margin: 0; font-size: 13px; color: var(--schools-fg-3); }
.muted { color: var(--schools-fg-3); font-weight: 400; }
.seg { display: flex; gap: 6px; flex-wrap: wrap; }
.seg-item { display: inline-flex; align-items: center; gap: 6px; padding: 10px 14px; border-radius: 999px; border: 1px solid var(--schools-border); cursor: pointer; font-size: 15px; background: var(--schools-card); }
.seg-item.is-on { background: var(--schools-fg); color: var(--schools-card); border-color: var(--schools-fg); }
.seg-item input { position: absolute; opacity: 0; width: 0; height: 0; }
.people { list-style: none; margin: 0; padding: 0; border: 1px solid var(--schools-border); border-radius: 10px; overflow: hidden; }
.person { display: block; width: 100%; text-align: left; padding: 12px; background: none; border: 0; border-bottom: 1px solid var(--schools-border); font: inherit; font-size: 15px; cursor: pointer; color: inherit; }
.person:last-child { border-bottom: 0; }
.picked { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--schools-border); border-radius: 10px; font-size: 15px; }
.link { background: none; border: 0; padding: 0; font: inherit; font-size: 14px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; color: var(--schools-fg-2); }
.preview { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 10px; background: var(--schools-bg, #f3f0ec); }
.count { margin: 0; font-size: 15px; }
.rendered { padding: 12px 14px; border-radius: 12px; background: var(--schools-card); border: 1px solid var(--schools-border); }
.rendered-title { margin: 0 0 6px; font-weight: 600; font-size: 15px; }
.rendered-text { margin: 0 0 8px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
.rendered-text:last-child { margin-bottom: 0; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.send { padding: 12px 22px; border-radius: 999px; font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; border: 1px solid var(--schools-accent, #c23a3a); background: var(--schools-accent, #c23a3a); color: #fff; }
.send.is-armed { background: #7a1f1d; border-color: #7a1f1d; }
.send:disabled { opacity: 0.5; cursor: default; }
.ok { font-size: 14px; color: var(--schools-fg-2); }
.err { font-size: 14px; color: var(--schools-red, #b3312f); }
.h2 { margin: 0 0 10px; font-size: 16px; }
.sent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sent-row { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-bottom: 1px solid var(--schools-border); font-size: 14px; }
.sent-row:last-child { border-bottom: 0; }
.sent-title { font-weight: 600; }
@media (max-width: 480px) {
  .seg-item { flex: 1 1 auto; justify-content: center; }
}
</style>
