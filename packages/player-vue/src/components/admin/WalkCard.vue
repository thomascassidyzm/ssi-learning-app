<script setup lang="ts">
/**
 * WalkCard — the app-as-teacher card, on its own.
 *
 * Extracted from WalkOverlay.vue (2026-08-06) so the ONE teaching genre has
 * ONE implementation. WalkOverlay positions it against a real anchored
 * element; ManagerOnboardingGate holds it still in the middle of a gate. Both
 * get the same kicker, the same paced Back/Next, the same step dots, the same
 * voice — which is the point: a manager being walked through setting a
 * password should not be able to tell it is a different mechanism from the
 * walk that showed them how to invite their first person.
 *
 * Purely presentational. It owns no state, decides no flow, and knows nothing
 * about the walkthrough pack — the caller drives it.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Small uppercase label — the walk's own title. */
    kicker: string
    /** The step's words. Markdown-lite: **bold** only. */
    say: string
    /** How many dots to draw. */
    stepCount: number
    /** Which dot is lit. */
    stepIndex: number
    /** All dots read as done — the terminal beat. */
    allDone?: boolean
    showBack?: boolean
    showNext?: boolean
    nextLabel?: string
    /** Shown under the words when the card is waiting on a real tap. */
    hint?: string
    /**
     * Whether to offer the × escape. FALSE is a deliberate, rare choice —
     * the org password step has no skip, because a manager who arrived by a
     * magic link has no other way back into their organisation.
     */
    dismissible?: boolean
  }>(),
  { showBack: false, showNext: true, nextLabel: 'Next', allDone: false, dismissible: true },
)

defineEmits<{ back: []; next: []; skip: [] }>()

// Markdown-lite: **bold** only, escaped first (same rule as HowThisWorks and
// the walkthrough pack — the content is repo-authored, never user input).
const rendered = computed(() => {
  const escaped = props.say
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
})
</script>

<template>
  <div class="walk-card" data-walk-card>
    <div class="walk-card-head">
      <span class="walk-kicker">{{ kicker }}</span>
      <button
        v-if="dismissible" type="button" class="walk-close" aria-label="Skip tour"
        @click="$emit('skip')"
      >×</button>
    </div>
    <!-- eslint-disable-next-line vue/no-v-html — repo-authored content, escaped above -->
    <p class="walk-say" v-html="rendered"></p>
    <p v-if="hint" class="walk-hint">{{ hint }}</p>

    <!-- Whatever the step needs the person to actually DO. -->
    <slot />

    <div class="walk-foot">
      <div class="walk-dots">
        <span
          v-for="i in stepCount" :key="i"
          class="walk-dot"
          :class="{ 'is-active': !allDone && i - 1 === stepIndex, 'is-done': allDone || i - 1 < stepIndex }"
        ></span>
      </div>
      <div class="walk-nav">
        <button v-if="showBack" type="button" class="walk-btn" @click="$emit('back')">Back</button>
        <button
          v-if="showNext" type="button" class="walk-btn walk-btn-primary"
          @click="$emit('next')"
        >{{ nextLabel }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.walk-card {
  pointer-events: auto;
  background: #fff;
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 8px 30px rgba(44, 38, 34, 0.18);
  padding: 14px 16px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.walk-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.walk-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.walk-close {
  background: none; border: none; cursor: pointer; padding: 0 2px; line-height: 1;
  font-size: 18px; color: var(--schools-fg-3, #8A8078);
}
.walk-close:hover { color: var(--schools-fg, #0F1212); }
.walk-say { margin: 0; font-size: var(--text-sm, 14px); line-height: 1.55; color: var(--schools-fg-2, #555); }
.walk-say :deep(strong) { color: var(--ink-primary, #2C2622); font-weight: 600; }
.walk-hint { margin: 0; font-size: var(--text-xs, 12px); color: var(--schools-fg-3, #8A8078); font-style: italic; }

.walk-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.walk-dots { display: flex; gap: 5px; }
.walk-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(44, 38, 34, 0.18);
  transition: all 0.2s ease;
}
.walk-dot.is-active { background: var(--schools-red, #DB1E17); transform: scale(1.35); }
.walk-dot.is-done { background: rgba(219, 30, 23, 0.45); }

.walk-nav { display: flex; gap: 6px; }
.walk-btn {
  padding: 6px 14px; font: inherit; font-size: var(--text-xs, 12px); font-weight: 600;
  border-radius: var(--radius-full, 999px); border: 1px solid rgba(44, 38, 34, 0.14);
  background: rgba(44, 38, 34, 0.04); color: var(--schools-fg-2, #555); cursor: pointer;
}
.walk-btn:hover { background: rgba(44, 38, 34, 0.10); }
.walk-btn:disabled { opacity: 0.5; cursor: wait; }
.walk-btn-primary { background: var(--schools-red, #DB1E17); border-color: transparent; color: #fff; }
.walk-btn-primary:hover:not(:disabled) { background: #c01812; }
</style>
