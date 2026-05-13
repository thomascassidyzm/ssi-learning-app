<script setup lang="ts">
/**
 * Launch dialogue — shows during the brief window between Vue mount
 * and LearningPlayer being ready (course resolved, audio warmed up).
 *
 * Cycles through a small sequence of messages so the user has
 * something quiet to read instead of a blank backdrop. Hidden as
 * soon as the real player takes over its own message card.
 *
 * Localisation: messages run through t() so non-English locales
 * pick them up. eng is the statically-bundled fallback, so first
 * paint is always immediate English — no universal-symbol fallback
 * needed.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { t } from '@/composables/useI18n'

// Final "ready when you are" line removed — the real player's own
// card now handles that exact message once it mounts, and this card
// just fades out as the player takes over.
const STEPS = [
  {
    eyebrow: () => t('launch.warming.eyebrow', 'starting up'),
    body: () => t('launch.warming.body', 'firing up the engines…'),
  },
  {
    eyebrow: () => t('launch.fetching.eyebrow', 'almost there'),
    body: () => t('launch.fetching.body', 'fetching your course…'),
  },
]

const STEP_MS = 700

const index = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    if (index.value < STEPS.length - 1) {
      index.value += 1
    } else if (timer) {
      // Park on the final "ready when you are" line — the real
      // player should replace us before this matters anyway.
      clearInterval(timer)
      timer = null
    }
  }, STEP_MS)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="launch-dialogue" role="status" aria-live="polite">
    <div class="launch-dialogue__eyebrow">{{ STEPS[index].eyebrow() }}</div>
    <Transition name="launch-fade" mode="out-in">
      <div :key="index" class="launch-dialogue__body">{{ STEPS[index].body() }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.launch-dialogue {
  /* Sit dead-centre while the player is awakening — the real
     LearningPlayer message card lives at the top, and the rest
     state's course/belt content lives near the bottom, so the
     visual middle is empty space we can occupy without competing
     with either. The card is keeping the same frost-glass + eyebrow
     + mono-body design language as the existing player card. */
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

.launch-fade-enter-active,
.launch-fade-leave-active {
  transition: opacity 220ms ease;
}
.launch-fade-enter-from,
.launch-fade-leave-to {
  opacity: 0;
}
</style>
