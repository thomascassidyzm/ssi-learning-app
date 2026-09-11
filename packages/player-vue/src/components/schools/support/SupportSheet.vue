<script setup lang="ts">
/**
 * Door one (spec §2): "Does this look wrong?" — the sheet that opens on the
 * thing that is wrong, already knowing which number she tapped and what it
 * read. One text box, one Send. The server adds what it computed underneath.
 *
 * Admins only: the parent renders the affordance only for a school or org
 * admin, and the route refuses anyone else regardless.
 */
import { ref, watch } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { useSupportChannel } from '@/composables/schools/useSupportChannel'

const props = defineProps<{
  open: boolean
  anchor: string
  displayedLabel: string
  displayedValue: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const { sendMessage } = useSupportChannel()

const text = ref('')
const sending = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

watch(() => props.open, (isOpen) => {
  if (isOpen) { text.value = ''; sent.value = false; error.value = null }
})

async function send(): Promise<void> {
  const body = text.value.trim()
  if (!body || sending.value) return
  sending.value = true
  error.value = null
  try {
    await sendMessage({ text: body, anchor: props.anchor, displayed_label: props.displayedLabel, displayed_value: props.displayedValue })
    sent.value = true
  } catch {
    error.value = t('schools.support.sendFailed', 'Could not send. Try again.')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sheet-overlay" @click.self="emit('close')">
      <div class="sheet schools-surface" role="dialog" aria-modal="true" aria-labelledby="support-sheet-title">
        <h2 id="support-sheet-title" class="sheet-title">{{ t('schools.support.doorTitle', 'Does this look wrong?') }}</h2>
        <p class="sheet-context">
          {{ t('schools.support.youAskedAbout', 'You are asking about: {label} — it reads {value}').replace('{label}', displayedLabel).replace('{value}', displayedValue) }}
        </p>
        <template v-if="!sent">
          <textarea
            v-model="text"
            class="sheet-input"
            rows="4"
            :placeholder="t('schools.support.tellUs', 'Tell us what you see')"
            :aria-label="t('schools.support.tellUs', 'Tell us what you see')"
          ></textarea>
          <p class="sheet-door-line">{{ t('schools.support.doorLine', 'This thread belongs to your school, and any admin of your school can read it.') }}</p>
          <p v-if="error" class="sheet-error" role="alert">{{ error }}</p>
          <div class="sheet-actions">
            <button type="button" class="btn-ghost btn-small" @click="emit('close')">{{ t('schools.support.notNow', 'Not now') }}</button>
            <button type="button" class="btn-play btn-small" :disabled="sending || !text.trim()" @click="send">
              {{ sending ? t('schools.support.sending', 'Sending…') : t('schools.support.send', 'Send') }}
            </button>
          </div>
        </template>
        <template v-else>
          <p class="sheet-sent">{{ t('schools.support.sentNote', 'Sent. A reply will appear in Support, usually within a minute.') }}</p>
          <div class="sheet-actions">
            <button type="button" class="btn-ghost btn-small" @click="emit('close')">{{ t('schools.support.close', 'Close') }}</button>
            <router-link class="btn-play btn-small" to="/schools/support" @click="emit('close')">{{ t('schools.support.openSupport', 'Open Support') }}</router-link>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* A bottom sheet on phones, a centred card on wider screens. Every edge pads
   out of the safe area per the repo's standing rule: the sheet sits at the
   bottom edge, so the home indicator is the one that matters most. */
.sheet-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: flex-end; justify-content: center;
  padding: max(16px, env(safe-area-inset-top, 0px)) max(0px, env(safe-area-inset-right, 0px)) 0 max(0px, env(safe-area-inset-left, 0px));
}
.sheet {
  width: 100%; max-width: 520px;
  background: #fff; color: var(--schools-fg, #222);
  border-radius: 16px 16px 0 0;
  padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
  display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.2);
}
@media (min-width: 640px) {
  .sheet-overlay { align-items: center; padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); }
  .sheet { border-radius: 16px; padding-bottom: 20px; }
}
.sheet-title { margin: 0; font-size: 18px; font-weight: 700; }
.sheet-context { margin: 0; font-size: 13px; color: var(--schools-fg-2, #555); }
.sheet-input {
  width: 100%; box-sizing: border-box; resize: vertical;
  padding: 10px 12px; font: inherit; font-size: 14px;
  border: 1px solid var(--schools-border, #ddd); border-radius: 10px;
}
.sheet-door-line { margin: 0; font-size: 12px; color: var(--schools-fg-3, #777); }
.sheet-error { margin: 0; font-size: 13px; color: var(--schools-red, #b3312f); }
.sheet-sent { margin: 0; font-size: 14px; }
.sheet-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
