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
  <!-- HANDBOOK Tell us about something that went wrong
       section: your-own-account
       roles: teacher, school_admin, leader
       place: settings
       keywords: bug, report, problem, went wrong, feedback, broken
       What it's for. Sending us a note when the app misbehaves, with the details of your course and device attached for you.
       Where it is. The sheet that opens from **Report a bug** in **Settings**.
       How you do it.
       1. Tap **Report a bug** in Settings.
       2. Write what happened, add a screenshot if you have one, and tap **Send**.
       Worth knowing. Tapping outside the sheet closes it without sending. Nobody replies through the app: the note goes to one place where we read it.
       checked: b0c2520c.7fd68307
  -->
  <div class="bug-scrim" data-walk="report-bug-sheet" @click.self="emit('close')">
    <section class="bug-sheet" role="dialog" aria-modal="true" :aria-label="t('bugReport.title')">
      <template v-if="sent">
        <!-- HANDBOOK See that your report arrived
             section: your-own-account
             roles: teacher, school_admin, leader
             place: settings
             keywords: bug, report, sent, thank you, arrived
             What it's for. Confirming the note reached us.
             Where it is. The **Got it, thank you** line that replaces the form once it has sent.
             How you do it.
             1. Tap **Send** on the report sheet.
             2. Read **Got it, thank you**. The sheet closes on its own a moment later, or tap the line to close it now.
             Worth knowing. That line is the whole reply. There is no ticket number and no message back.
             checked: f3d3dddb.9de08660
        -->
        <p class="bug-thanks" role="status" data-walk="report-bug-thanks" @click="emit('close')">{{ t('bugReport.thanks') }}</p>
      </template>
      <template v-else>
        <header class="bug-head">
          <h2 class="bug-title">{{ t('bugReport.title') }}</h2>
          <button class="bug-close" type="button" :aria-label="t('sector.close')" @click="emit('close')">×</button>
        </header>
        <!-- HANDBOOK Say what happened
             section: your-own-account
             roles: teacher, school_admin, leader
             place: settings
             keywords: bug, report, describe, what happened, text
             What it's for. The box where you describe the problem in your own words.
             Where it is. The **What happened?** box on the report sheet.
             How you do it.
             1. Tap into the box and write what you saw.
             2. Keep it under 2,000 characters. Send stays off until you have written something.
             Worth knowing. Your course and device details are added for you, so you only need to describe what went wrong.
             checked: 49943f39.54391989
        -->
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
        <!-- HANDBOOK Send the report
             section: your-own-account
             roles: teacher, school_admin, leader
             place: settings
             keywords: bug, report, send, submit, screenshot
             What it's for. Sending your note, and your screenshot if you added one, to us.
             Where it is. The **Send** button at the foot of the report sheet.
             How you do it.
             1. Write what happened.
             2. Tap **Send**. It reads **Sending…** while it goes.
             Worth knowing. If the screenshot cannot upload, the note still goes without it. If the note itself does not send, the sheet says so and you can tap Send again.
             checked: 223b085a.f159a58e
        -->
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
  /* Above the bottom nav (3000) and the player's overlays (up to 3200): the
     sheet's Send sits where the nav's Play button is on a phone, and at 1200
     a real tap reached Play, not Send (job #361, 2026-09-12). */
  z-index: 3300;
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
