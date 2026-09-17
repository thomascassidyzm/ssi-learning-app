<script setup lang="ts">
/**
 * ReportBugModal — "Report a bug" from the schools dashboard account menu.
 *
 * Tom's ruling (2026-09-14): school admins and teachers report a bug or a
 * suggestion from the dashboard itself, "because the bug might be with the
 * dashboard side of things", rather than hunting for the player's Settings.
 * Same postbox as the learner sheet (ReportBugSheet.vue): the same
 * useBugReport.submit, the same /api/report/bug, the same bug_reports table
 * and the same channel — with source 'schools_dashboard' and the page and
 * entity in view attached, so a dashboard bug is diagnosable. Bug reports are
 * NOT support messages: nothing here touches support_messages.
 *
 * One way, like the sheet: the parent shows a thank-you toast and that is the
 * whole reply.
 */
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import { useBugReport } from '@/composables/useBugReport'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useUserRole } from '@/composables/useUserRole'

const emit = defineEmits<{ close: []; sent: [] }>()

const { t } = useI18n()
const route = useRoute()
const { submit, supabase } = useBugReport()
const { currentUser, isGovtAdmin, isSchoolAdmin } = useSchoolContext()
// View-as (job #68): an admin looking at someone else's dashboard may still
// report what they see. The note is theirs, filed under their own bearer —
// nothing is written as the persona — so the modal says so out loud and the
// persona rides in the context.
const { isViewingAs, viewingAs } = useUserRole()

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_CHARS = 2000

const happened = ref('')
const expected = ref('')
const file = ref<File | null>(null)
const preview = ref<string | null>(null)
const fileError = ref(false)
const sending = ref(false)
const failed = ref(false)

const canSend = computed(() => happened.value.trim().length > 0 && !sending.value)

/** The page, as a person would name it: the URL path is what the row stores. */
const pagePath = computed(() => route?.fullPath ?? (typeof window !== 'undefined' ? window.location.pathname : ''))

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  if (f.size > MAX_FILE_SIZE) { fileError.value = true; return }
  fileError.value = false
  file.value = f
  const reader = new FileReader()
  reader.onload = (ev) => { preview.value = (ev.target?.result as string) ?? null }
  reader.readAsDataURL(f)
}

function removeFile() {
  file.value = null
  preview.value = null
  fileError.value = false
}

// Same bucket and path shape as the learner sheet. Failure is non-blocking.
async function upload(): Promise<string | null> {
  const sb = supabase?.value
  if (!file.value || !sb) return null
  try {
    const ext = file.value.name.split('.').pop() || 'png'
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await sb.storage.from('feedback-screenshots').upload(name, file.value, { contentType: file.value.type })
    if (error) return null
    const { data } = sb.storage.from('feedback-screenshots').getPublicUrl(name)
    return data?.publicUrl ?? null
  } catch {
    return null
  }
}

/** What the dashboard has in view. The URL itself rides in the envelope's route. */
function contextInView(): Record<string, string | null | undefined> {
  const u = currentUser.value
  const params = (route?.params ?? {}) as Record<string, string | string[] | undefined>
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
  const role = isGovtAdmin.value ? 'govt_admin' : isSchoolAdmin.value ? 'school_admin' : 'teacher'
  const onClass = String(route?.path ?? '').startsWith('/schools/classes/')
  return {
    role,
    school_id: u?.school_id,
    school_name: u?.school_name,
    group_id: u?.group_id,
    class_id: onClass ? first(params.id) ?? first(params.classId) : first(params.classId),
    node_id: String(route?.path ?? '').startsWith('/org/') ? first(params.id) ?? first(params.nodeId) : undefined,
    page_title: typeof document !== 'undefined' ? document.title : undefined,
    viewing_as: isViewingAs.value ? `${viewingAs.value?.role ?? ''} ${viewingAs.value?.name ?? ''}`.trim() : undefined,
  }
}

function composeBody(): string {
  const what = happened.value.trim()
  const exp = expected.value.trim()
  const body = exp ? `${what}\n\nExpected: ${exp}` : what
  return body.slice(0, MAX_CHARS)
}

async function send() {
  if (!canSend.value) return
  sending.value = true
  failed.value = false
  try {
    const url = await upload()
    const ok = await submit(composeBody(), url, null, { source: 'schools_dashboard', context: contextInView() })
    if (!ok) { failed.value = true; return }
    emit('sent')
    emit('close')
  } finally {
    sending.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="rb-overlay" data-walk="schools-report-bug-modal" @click.self="emit('close')" @keydown="onKeydown">
      <section class="rb-modal" role="dialog" aria-modal="true" :aria-label="t('schools.bugReport.title', 'Report a bug')">
        <header class="rb-head">
          <h2 class="rb-title">{{ t('schools.bugReport.title', 'Report a bug') }}</h2>
          <button class="rb-close" type="button" :aria-label="t('schools.bugReport.closeAria', 'Close')" @click="emit('close')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <p class="rb-lede">{{ t('schools.bugReport.lede', 'A bug or a suggestion. The page you are on is attached for you.') }}</p>
        <p v-if="isViewingAs" class="rb-note">{{ t('schools.bugReport.viewAsNote', 'You are viewing as {name}. This goes from your own account, with that noted.').replace('{name}', viewingAs?.name || '') }}</p>

        <label class="rb-label" for="rb-happened">{{ t('schools.bugReport.happenedLabel', 'What happened?') }}</label>
        <textarea
          id="rb-happened"
          v-model="happened"
          class="rb-text"
          data-walk="schools-report-bug-happened"
          :maxlength="MAX_CHARS"
          :placeholder="t('schools.bugReport.happenedPlaceholder', 'What you saw, or what you would like to see')"
          rows="4"
        ></textarea>

        <label class="rb-label" for="rb-expected">{{ t('schools.bugReport.expectedLabel', 'What did you expect?') }}</label>
        <textarea
          id="rb-expected"
          v-model="expected"
          class="rb-text"
          data-walk="schools-report-bug-expected"
          :maxlength="600"
          :placeholder="t('schools.bugReport.expectedPlaceholder', 'Optional')"
          rows="2"
        ></textarea>

        <div class="rb-shot">
          <template v-if="preview">
            <img :src="preview" class="rb-preview" alt="" />
            <button class="rb-link" type="button" @click="removeFile">{{ t('schools.bugReport.removeScreenshot', 'Remove screenshot') }}</button>
          </template>
          <label v-else class="rb-link">
            {{ t('schools.bugReport.addScreenshot', 'Add a screenshot') }}
            <input type="file" accept="image/*" class="rb-file" @change="onFile" />
          </label>
          <span v-if="fileError" class="rb-note">{{ t('schools.bugReport.tooLarge', 'The image must be under 5MB') }}</span>
        </div>

        <p class="rb-page">{{ t('schools.bugReport.pageLine', 'Page: {page}').replace('{page}', pagePath) }}</p>
        <p v-if="failed" class="rb-note rb-error" role="alert">{{ t('schools.bugReport.failed', 'That did not send. Please try again.') }}</p>

        <footer class="rb-actions">
          <button class="rb-btn rb-btn-ghost" type="button" @click="emit('close')">{{ t('schools.bugReport.cancel', 'Cancel') }}</button>
          <button class="rb-btn rb-btn-primary" type="button" data-walk="schools-report-bug-send" :disabled="!canSend" @click="send">
            {{ sending ? t('schools.bugReport.sending', 'Sending…') : t('schools.bugReport.send', 'Send') }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.rb-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(44, 38, 34, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-family: var(--font-body);
}
.rb-modal {
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--schools-border);
  border-radius: 14px;
  box-shadow: 0 24px 64px -16px rgba(0, 0, 0, 0.35);
  padding: 20px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rb-head { display: flex; align-items: center; justify-content: space-between; }
.rb-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  color: var(--schools-fg);
}
.rb-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border: 0; background: none; border-radius: 8px;
  color: var(--schools-fg-2); cursor: pointer;
}
.rb-close:hover { background: #f6f5f1; }
.rb-lede { margin: 0; font-size: 13.5px; color: var(--schools-fg-2); }
.rb-label { font-size: 12.5px; font-weight: 600; color: var(--schools-fg); margin-top: 4px; }
.rb-text {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: inherit;
  font-size: 14px;
  color: var(--schools-fg);
  background: #fafaf6;
  border: 1px solid var(--schools-border);
  border-radius: 8px;
  padding: 10px 12px;
}
.rb-text:focus { outline: none; border-color: var(--schools-border-strong); }
.rb-shot { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.rb-preview { max-height: 120px; border-radius: 8px; border: 1px solid var(--schools-border); }
.rb-link {
  font-size: 13px; color: var(--schools-fg-2); text-decoration: underline; text-underline-offset: 3px;
  background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit;
}
.rb-file { display: none; }
.rb-page { margin: 0; font-size: 12px; color: var(--schools-fg-3); word-break: break-all; }
.rb-note { font-size: 12px; color: var(--schools-fg-3); margin: 0; }
.rb-error { color: var(--schools-red, #b3312f); }
.rb-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.rb-btn {
  padding: 9px 16px; border-radius: 999px; font: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; min-height: 40px;
}
.rb-btn-ghost { background: #fff; color: var(--schools-fg); border-color: var(--schools-border); }
.rb-btn-ghost:hover { border-color: var(--schools-border-strong); }
.rb-btn-primary { background: var(--schools-red); color: #fff; }
.rb-btn-primary:hover { background: var(--schools-red-deep); }
.rb-btn-primary:disabled { opacity: 0.45; cursor: default; }

@media (max-width: 480px) {
  .rb-overlay { padding: 12px; align-items: flex-end; }
  .rb-modal { padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px)); }
}
</style>
