<script setup lang="ts">
/**
 * ReportBugSheet — the learner postbox. One heading, one box, one optional
 * screenshot, one Send. On success the body becomes "Got it, thank you." and
 * nothing else: no ticket number, no promise of a reply. Tom's ruling
 * (2026-09-12): reports go to one channel and no agent ever replies to a
 * learner. Opened from Settings and from the learner's own page; both mount
 * this same sheet.
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { useBugReport } from '@/composables/useBugReport'

const props = defineProps<{ courseCode?: string | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { submit, supabase } = useBugReport()

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_CHARS = 2000
const CLOSE_AFTER_MS = 2500

const text = ref('')
const file = ref<File | null>(null)
const preview = ref<string | null>(null)
const fileError = ref(false)
const sending = ref(false)
const failed = ref(false)
const sent = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | null = null

const canSend = computed(() => text.value.trim().length > 0 && !sending.value)

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

// The same bucket and path shape as the tester widget. Failure is
// non-blocking: the report still goes, without the picture.
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

async function send() {
  if (!canSend.value) return
  sending.value = true
  failed.value = false
  try {
    const url = await upload()
    const ok = await submit(text.value.trim().slice(0, MAX_CHARS), url, props.courseCode ?? null)
    if (!ok) { failed.value = true; return }
    sent.value = true
    closeTimer = setTimeout(() => emit('close'), CLOSE_AFTER_MS)
  } finally {
    sending.value = false
  }
}

onBeforeUnmount(() => { if (closeTimer) clearTimeout(closeTimer) })
</script>

<template>
  <div class="bug-scrim" data-walk="report-bug-sheet" @click.self="emit('close')">
    <section class="bug-sheet" role="dialog" aria-modal="true" :aria-label="t('bugReport.title')">
      <template v-if="sent">
        <p class="bug-thanks" role="status" data-walk="report-bug-thanks" @click="emit('close')">{{ t('bugReport.thanks') }}</p>
      </template>
      <template v-else>
        <header class="bug-head">
          <h2 class="bug-title">{{ t('bugReport.title') }}</h2>
          <button class="bug-close" type="button" :aria-label="t('sector.close')" @click="emit('close')">×</button>
        </header>
        <textarea
          v-model="text"
          class="bug-text"
          data-walk="report-bug-text"
          :maxlength="MAX_CHARS"
          :placeholder="t('bugReport.placeholder')"
          rows="5"
        ></textarea>
        <div class="bug-shot">
          <template v-if="preview">
            <img :src="preview" class="bug-preview" alt="" />
            <button class="bug-link" type="button" @click="removeFile">{{ t('bugReport.removeScreenshot') }}</button>
          </template>
          <label v-else class="bug-link">
            {{ t('bugReport.addScreenshot') }}
            <input type="file" accept="image/*" class="bug-file" @change="onFile" />
          </label>
          <span v-if="fileError" class="bug-note">{{ t('bugReport.tooLarge') }}</span>
        </div>
        <p v-if="failed" class="bug-note" role="alert">{{ t('bugReport.failed') }}</p>
        <button class="bug-send" type="button" data-walk="report-bug-send" :disabled="!canSend" @click="send">
          {{ sending ? t('bugReport.sending') : t('bugReport.send') }}
        </button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.bug-scrim {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(44, 38, 34, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bug-sheet {
  width: 100%;
  max-width: 560px;
  background: var(--bg-elevated, #ffffff);
  border-radius: 16px 16px 0 0;
  padding: var(--space-4, 16px);
  padding-bottom: calc(var(--space-5, 20px) + env(safe-area-inset-bottom, 0px));
  padding-left: max(var(--space-4, 16px), env(safe-area-inset-left, 0px));
  padding-right: max(var(--space-4, 16px), env(safe-area-inset-right, 0px));
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
}
.bug-head { display: flex; align-items: center; justify-content: space-between; }
.bug-title {
  margin: 0;
  font-size: var(--text-lg, 18px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
}
.bug-close {
  border: 0; background: none; font-size: 24px; line-height: 1;
  color: var(--ink-tertiary, #8A8078); padding: 4px 8px; cursor: pointer;
}
.bug-text {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: inherit;
  font-size: 16px;
  color: var(--ink-primary, #2C2622);
  background: var(--bg-primary, #e8e3dd);
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 12px;
}
.bug-text:focus { outline: none; border-color: var(--accent-belt, #7C6A58); }
.bug-shot { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.bug-preview { max-height: 120px; border-radius: 8px; }
.bug-link {
  font-size: var(--text-sm, 13px);
  color: var(--ink-secondary, #6B635C);
  text-decoration: underline;
  text-underline-offset: 3px;
  background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit;
}
.bug-file { display: none; }
.bug-note { font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078); margin: 0; }
.bug-send {
  align-self: stretch;
  padding: 14px;
  border: 0;
  border-radius: 12px;
  font: inherit;
  font-weight: var(--font-semibold, 600);
  color: #fff;
  background: var(--accent-belt, #7C6A58);
  cursor: pointer;
}
.bug-send:disabled { opacity: 0.45; cursor: default; }
.bug-thanks {
  margin: 0;
  padding: var(--space-6, 24px) 0;
  text-align: center;
  font-size: var(--text-lg, 18px);
  color: var(--ink-primary, #2C2622);
}
</style>
