<script setup lang="ts">
// ============================================================================
// AdminOnboardingView.vue — /admin/onboarding. Live-editable home for the
// onboarding message series (docs/onboarding/onboarding-series-draft.md).
// Content as data, editable without a deploy — same idiom as the living
// board report (BoardReportView.vue / api/admin/board-snapshot.ts).
//
// This IS the copy the (future) send system reads — there is no separate
// "publish" step. Saving here changes what would actually go out once the
// sender/cron pipeline exists.
// ============================================================================
import { ref, computed, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'

interface OnboardingMessage {
  id: string
  message_key: string
  title: string
  channel: 'email' | 'in_app'
  subject: string | null
  preheader: string | null
  body: string
  trigger_description: string
  notes: string | null
  sort_order: number
  active: boolean
  updated_at: string
  updated_by: string | null
}

const { getAuthToken } = useAdminClient()

const messages = ref<OnboardingMessage[]>([])
const isLoading = ref(false)
const loadError = ref<string | null>(null)

const selectedId = ref<string | null>(null)
const draft = ref<Partial<OnboardingMessage>>({})
const isSaving = ref(false)
const saveError = ref<string | null>(null)
const saveSuccess = ref(false)
const togglingId = ref<string | null>(null)

const selected = computed(() => messages.value.find(m => m.id === selectedId.value) || null)

// Minimal markdown-to-html for preview only — headings, bold, italic,
// blockquotes, lists, links. No dependency; this never touches send copy.
function renderPreview(markdown: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = escape(markdown || '').split('\n')
  const html: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[(.+?)\]/g, '<span class="preview-cta">$1</span>')
    if (/^&gt;\s?/.test(line)) {
      html.push(`<blockquote>${line.replace(/^&gt;\s?/, '')}</blockquote>`)
      continue
    }
    if (/^-\s+/.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true }
      html.push(`<li>${line.replace(/^-\s+/, '')}</li>`)
      continue
    }
    if (inList) { html.push('</ul>'); inList = false }
    if (line.trim() === '') { html.push('<br>'); continue }
    html.push(`<p>${line}</p>`)
  }
  if (inList) html.push('</ul>')
  return html.join('\n')
}

const previewHtml = computed(() => renderPreview(draft.value.body || ''))

async function fetchMessages(): Promise<void> {
  isLoading.value = true
  loadError.value = null
  try {
    const token = await getAuthToken()
    if (!token) { loadError.value = 'Not authenticated'; return }
    const response = await fetch('/api/admin/onboarding-messages', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }
    const data = await response.json()
    messages.value = data.messages || []
    if (!selectedId.value && messages.value.length > 0) selectMessage(messages.value[0].id)
  } catch (err: any) {
    loadError.value = err.message || 'Failed to load onboarding messages'
  } finally {
    isLoading.value = false
  }
}

function selectMessage(id: string): void {
  const msg = messages.value.find(m => m.id === id)
  if (!msg) return
  selectedId.value = id
  draft.value = { ...msg }
  saveError.value = null
  saveSuccess.value = false
}

async function saveDraft(): Promise<void> {
  if (!selected.value) return
  isSaving.value = true
  saveError.value = null
  saveSuccess.value = false
  try {
    const token = await getAuthToken()
    if (!token) { saveError.value = 'Not authenticated'; return }
    const response = await fetch('/api/admin/onboarding-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'update',
        id: selected.value.id,
        title: draft.value.title,
        channel: draft.value.channel,
        subject: draft.value.subject,
        preheader: draft.value.preheader,
        body: draft.value.body,
        trigger_description: draft.value.trigger_description,
        notes: draft.value.notes,
        active: draft.value.active,
      }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to save')
    }
    const updated = await response.json()
    const idx = messages.value.findIndex(m => m.id === updated.id)
    if (idx >= 0) messages.value[idx] = updated
    saveSuccess.value = true
    setTimeout(() => { saveSuccess.value = false }, 1800)
  } catch (err: any) {
    saveError.value = err.message || 'Failed to save'
  } finally {
    isSaving.value = false
  }
}

async function toggleActive(msg: OnboardingMessage): Promise<void> {
  togglingId.value = msg.id
  try {
    const token = await getAuthToken()
    if (!token) return
    const response = await fetch('/api/admin/onboarding-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'update', id: msg.id, active: !msg.active }),
    })
    if (!response.ok) return
    const updated = await response.json()
    const idx = messages.value.findIndex(m => m.id === updated.id)
    if (idx >= 0) messages.value[idx] = updated
    if (selectedId.value === updated.id) draft.value.active = updated.active
  } finally {
    togglingId.value = null
  }
}

function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

onMounted(fetchMessages)
</script>

<template>
  <div class="onboarding-admin-view">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Onboarding series</span>
        <h1 class="arsenal">Onboarding messages</h1>
        <p class="subtitle">
          Seven messages, series order. Edit and save here — no deploy needed.
        </p>
      </div>
    </header>

    <div class="banner banner-notice">
      This is the live source — the send system reads these messages.
    </div>

    <Transition name="fade">
      <div v-if="loadError" class="banner banner-error">{{ loadError }}</div>
    </Transition>
    <div v-if="isLoading" class="loading">Loading onboarding messages…</div>

    <div v-else class="layout">
      <!-- List -->
      <div class="schools-card list-card">
        <ul class="message-list">
          <li
            v-for="msg in messages"
            :key="msg.id"
            :class="['message-row', { active: msg.id === selectedId }]"
            @click="selectMessage(msg.id)"
          >
            <div class="row-main">
              <span class="row-order frost-mono-nums">{{ msg.sort_order }}</span>
              <div class="row-text">
                <span class="row-title">{{ msg.title }}</span>
                <span class="row-meta">
                  <span class="channel-pill" :class="`channel-${msg.channel}`">{{ msg.channel === 'email' ? 'Email' : 'In-app' }}</span>
                  <span class="row-trigger">{{ msg.trigger_description }}</span>
                </span>
              </div>
            </div>
            <button
              type="button"
              class="active-toggle"
              :class="{ 'is-active': msg.active }"
              :disabled="togglingId === msg.id"
              :title="msg.active ? 'Active — click to deactivate' : 'Inactive — click to activate'"
              @click.stop="toggleActive(msg)"
            >
              <span class="toggle-dot"></span>{{ msg.active ? 'Active' : 'Inactive' }}
            </button>
          </li>
        </ul>
      </div>

      <!-- Editor -->
      <div v-if="selected" class="schools-card editor-card">
        <div class="panel-head">
          <span class="schools-kicker">{{ selected.message_key }}</span>
          <p class="appendix-subtitle">Last saved {{ formatUpdated(selected.updated_at) }}<span v-if="selected.updated_by"> by {{ selected.updated_by }}</span></p>
        </div>

        <div class="editor-body">
          <label class="field">
            <span class="field-label">Title (internal)</span>
            <input v-model="draft.title" type="text" class="frost-input" />
          </label>

          <label class="field">
            <span class="field-label">Channel</span>
            <select v-model="draft.channel" class="frost-input">
              <option value="email">Email</option>
              <option value="in_app">In-app</option>
            </select>
          </label>

          <label v-if="draft.channel === 'email'" class="field">
            <span class="field-label">Subject</span>
            <input v-model="draft.subject" type="text" class="frost-input" />
          </label>

          <label v-if="draft.channel === 'email'" class="field">
            <span class="field-label">Preheader</span>
            <input v-model="draft.preheader" type="text" class="frost-input" />
          </label>

          <div class="field-pair">
            <label class="field">
              <span class="field-label">Body (markdown)</span>
              <textarea v-model="draft.body" class="frost-input body-textarea" rows="16"></textarea>
            </label>
            <div class="field preview-pane">
              <span class="field-label">Preview</span>
              <div class="preview-box" v-html="previewHtml"></div>
            </div>
          </div>

          <label class="field">
            <span class="field-label">Trigger</span>
            <textarea v-model="draft.trigger_description" class="frost-input" rows="2"></textarea>
          </label>

          <label class="field">
            <span class="field-label">Notes (never sent to learners)</span>
            <textarea v-model="draft.notes" class="frost-input" rows="3"></textarea>
          </label>

          <label class="field-inline">
            <input v-model="draft.active" type="checkbox" />
            <span>Active</span>
          </label>
        </div>

        <div class="editor-actions">
          <button type="button" class="btn-primary" :disabled="isSaving" @click="saveDraft">
            <span v-if="isSaving" class="spinner"></span>
            {{ isSaving ? 'Saving…' : 'Save' }}
          </button>
          <Transition name="fade">
            <span v-if="saveSuccess" class="save-ok">Saved</span>
          </Transition>
          <Transition name="fade">
            <span v-if="saveError" class="save-error">{{ saveError }}</span>
          </Transition>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-admin-view { max-width: 1100px; margin: 0 auto; }
.page-header { margin-bottom: 16px; }
.schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.page-header h1 {
  font-size: clamp(30px, 4vw, 44px);
  line-height: 1.04;
  letter-spacing: -0.015em;
  color: var(--ink-primary, #2C2622);
  margin: 8px 0 10px;
}
.subtitle {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  max-width: 64ch;
  margin: 0;
}

.banner { margin: 0 0 16px; padding: 10px 14px; border-radius: var(--radius-lg, 10px); font-size: var(--text-sm, 13px); }
.banner-notice { background: rgba(44, 38, 34, 0.05); border: 1px solid rgba(44, 38, 34, 0.10); color: var(--schools-fg-2, #4a433d); }
.banner-error { background: rgba(var(--tone-red, 194, 58, 58), 0.08); border: 1px solid rgba(var(--tone-red, 194, 58, 58), 0.28); color: rgb(var(--tone-red, 194, 58, 58)); }

.loading { text-align: center; padding: var(--space-8, 32px); color: var(--schools-fg-3, #8A8078); }

.layout { display: grid; grid-template-columns: 340px 1fr; gap: 20px; align-items: start; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }

.list-card { padding: 0; overflow: hidden; }
.message-list { list-style: none; margin: 0; padding: 0; }
.message-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid rgba(44, 38, 34, 0.06); cursor: pointer;
  transition: background 140ms ease;
}
.message-row:last-child { border-bottom: none; }
.message-row:hover { background: rgba(44, 38, 34, 0.03); }
.message-row.active { background: rgba(219, 30, 23, 0.06); }
.row-main { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.row-order { font-size: 12px; color: var(--schools-fg-3, #8A8078); padding-top: 2px; }
.row-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.row-title { font-size: 14px; font-weight: var(--font-medium, 500); color: var(--schools-fg, #2C2622); }
.row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row-trigger { font-size: 11px; color: var(--schools-fg-3, #8A8078); }

.channel-pill {
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: var(--radius-full, 999px);
  font-size: 10px; font-weight: var(--font-medium, 500); text-transform: uppercase; letter-spacing: 0.06em;
}
.channel-email { background: rgba(44, 38, 34, 0.06); color: var(--schools-fg-2, #4a433d); }
.channel-in_app { background: rgba(var(--tone-green, 63, 145, 90), 0.12); color: rgb(var(--tone-green, 63, 145, 90)); }

.active-toggle {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--radius-full, 999px);
  font-size: 11px; font-weight: var(--font-medium, 500); border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(255,255,255,0.6); color: var(--schools-fg-3, #8A8078); cursor: pointer; flex-shrink: 0;
}
.active-toggle.is-active { background: rgba(var(--tone-green, 63, 145, 90), 0.12); border-color: rgba(var(--tone-green, 63, 145, 90), 0.35); color: rgb(var(--tone-green, 63, 145, 90)); }
.toggle-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.editor-card { padding: 0; overflow: hidden; }
.panel-head { padding: var(--space-4, 16px) var(--space-6, 24px) var(--space-3, 12px); border-bottom: 1px solid rgba(44, 38, 34, 0.06); }
.appendix-subtitle { margin: 4px 0 0; font-size: 13px; color: var(--schools-fg-3, #8A8078); }

.editor-body { padding: var(--space-5, 20px) var(--space-6, 24px); display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: var(--font-medium, 500); color: var(--schools-fg-3, #8A8078); }
.field-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 700px) { .field-pair { grid-template-columns: 1fr; } }
.body-textarea { font-family: var(--font-mono, 'Spline Sans Mono', monospace); font-size: 13px; line-height: 1.55; }
.field-inline { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--schools-fg, #2C2622); }

.preview-pane { min-width: 0; }
.preview-box {
  border: 1px solid rgba(44, 38, 34, 0.12); border-radius: var(--radius-lg, 10px);
  padding: 14px 16px; background: rgba(255,255,255,0.6); font-size: 14px; line-height: 1.6;
  color: var(--schools-fg-2, #4a433d); overflow-y: auto; max-height: 340px;
}
.preview-box :deep(p) { margin: 0 0 10px; }
.preview-box :deep(ul) { margin: 0 0 10px; padding-left: 20px; }
.preview-box :deep(blockquote) { margin: 0 0 10px; padding-left: 12px; border-left: 2px solid rgba(var(--tone-red, 194, 58, 58), 0.4); color: var(--schools-fg, #2C2622); }
.preview-box :deep(.preview-cta) { display: inline-block; padding: 2px 8px; border-radius: var(--radius-md, 8px); background: var(--schools-red, #DB1E17); color: #fff; font-size: 12px; }

.frost-input {
  font: inherit;
  font-size: var(--text-base, 15px);
  padding: 10px 14px;
  color: var(--schools-fg, #2C2622);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg, 10px);
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}
.frost-input:focus { outline: none; border-color: rgba(var(--tone-red, 194, 58, 58), 0.55); box-shadow: 0 0 0 3px rgba(var(--tone-red, 194, 58, 58), 0.14); }

.editor-actions { display: flex; align-items: center; gap: 12px; padding: var(--space-4, 16px) var(--space-6, 24px); border-top: 1px solid rgba(44, 38, 34, 0.06); }
.btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 18px; font: inherit; font-size: var(--text-sm, 13px); font-weight: var(--font-semibold, 600);
  border-radius: var(--radius-full, 999px); border: 1px solid transparent;
  background: var(--schools-red, #DB1E17); color: #fff; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.save-ok { color: rgb(var(--tone-green, 63, 145, 90)); font-size: 13px; }
.save-error { color: rgb(var(--tone-red, 194, 58, 58)); font-size: 13px; }

.fade-enter-active, .fade-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
