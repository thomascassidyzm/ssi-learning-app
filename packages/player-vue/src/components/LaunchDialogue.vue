<script setup lang="ts">
/**
 * Launch dialogue — a single quiet "firing up the engines…" message
 * that shows for a few hundred ms while the player awakens, then
 * fades out. Independent of isPlayerReady — on fast loads the real
 * player card lands roughly as this one finishes fading.
 *
 * Localisation: t() with eng fallback. eng is statically bundled,
 * so first paint always shows immediate English; non-English locales
 * swap in reactively once their chunk lands (typically before the
 * fade starts).
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { t } from '@/composables/useI18n'

const VISIBLE_MS = 300

const visible = ref(true)
let timer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  timer = setTimeout(() => {
    visible.value = false
  }, VISIBLE_MS)
})

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <Transition name="launch-fade">
    <div v-if="visible" class="launch-dialogue" role="status" aria-live="polite">
      <div class="launch-dialogue__eyebrow">
        {{ t('launch.warming.eyebrow', 'starting up') }}
      </div>
      <div class="launch-dialogue__body">
        {{ t('launch.warming.body', 'firing up the engines…') }}
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.launch-dialogue {
  /* Dead-centre — the real player card lives at the top, the rest
     state's content sits near the bottom, so the middle is empty
     space we can occupy without competing with either. Same
     frost-glass + eyebrow + mono-body design language as the
     existing player card. */
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: calc(100% - 2rem);
  max-width: 480px;
  padding: 18px 24px 20px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 16px;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.07);
  text-align: center;
  pointer-events: none;
  z-index: 40;
}

.launch-dialogue__eyebrow {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-muted, rgba(0, 0, 0, 0.45));
  margin-bottom: 6px;
}

.launch-dialogue__body {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 22px;
  line-height: 1.3;
  color: var(--ink-primary, rgba(0, 0, 0, 0.85));
  letter-spacing: 0.04em;
}

/* No enter animation — appear immediately on first paint so the user
   sees something straight away. Only animate the leave. */
.launch-fade-leave-active {
  transition: opacity 500ms ease, transform 500ms ease;
}
.launch-fade-leave-to {
  opacity: 0;
  /* Slight downward drift on leave so it reads as "settling" rather
     than snapping out. */
  transform: translate(-50%, -46%);
}
</style>
