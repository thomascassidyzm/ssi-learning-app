<script setup lang="ts">
/**
 * HowThisWorksLibrary — the Library's own How-this-works section (A-159).
 *
 * Same protocol as every other How-this-works surface in the app: one quiet
 * text link carrying a soft-pulsing dot until it is opened once, seen-state in
 * localStorage, pulse stops on open, nothing ever opens uninvited, nothing ever
 * auto-plays, and the dot respects prefers-reduced-motion.
 *
 * The one thing that is new here is the ORDER. Practical first: the panel opens
 * on the walkthroughs — what to actually do, shown on the real page over the
 * learner's own data by the walkthrough engine. The methodology prose sits
 * underneath, still collapsed, as the "why this works" layer for the curious.
 *
 * The two prose sections are the existing profile ones, reused unchanged —
 * "Using the app" is HOW_THIS_WORKS_LEARNER wearing a non-duplicating label,
 * since this panel is itself called How this works.
 */
import { ref, computed } from 'vue'
import { walksFor, startWalk } from '@/walkthrough/useWalkthrough'
import { shouldThrob, markSeen } from '@/explainer/learnerThrob'
import HowThisWorksLearner from '@/components/me/HowThisWorksLearner.vue'
import WhyThisWorks from '@/components/me/WhyThisWorks.vue'

const SECTION_ID = 'library-how-this-works' as const

const props = withDefaults(defineProps<{
  /** Auth uid where the mount knows it; 'anon' keeps the state per-device. */
  viewerId?: string
  /** Guests are offered the sign-in walk; signed-in learners are not. */
  isGuest?: boolean
}>(), { viewerId: 'anon', isGuest: false })

// Offer filtering rides the engine's own persona × place × kind, so which
// walks a learner sees is a fact about the pack, never a list held here.
const walks = computed(() => walksFor('learner', 'library', props.isGuest ? 'guest' : 'signed-in'))

const open = ref(false)
const throbbing = ref(shouldThrob(props.viewerId, SECTION_ID))

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    markSeen(props.viewerId, SECTION_ID)
    throbbing.value = false
  }
}
</script>

<template>
  <section class="hl">
    <button type="button" class="hl-toggle" :class="{ 'is-armed': throbbing && !open }" @click="toggle">
      <span v-if="throbbing && !open" class="hl-dot" aria-hidden="true"></span>
      {{ open ? 'Close' : 'How this works' }}
    </button>
    <transition name="hl-fade">
      <div v-if="open" class="hl-card">
        <span class="hl-kicker">How this works</span>
        <p class="hl-intro">Take a look round the app, right here on your own page.</p>

        <div v-if="walks.length" class="hl-walks">
          <button
            v-for="w in walks" :key="w.id" type="button" class="hl-walk-link"
            :data-walk-offer="w.id"
            @click="startWalk(w.id)"
          >Show me — {{ w.title }}</button>
        </div>

        <div class="hl-prose">
          <HowThisWorksLearner :viewer-id="viewerId" link-label="Using the app" />
          <WhyThisWorks :viewer-id="viewerId" />
        </div>
      </div>
    </transition>
  </section>
</template>

<style scoped>
.hl { display: flex; flex-direction: column; gap: var(--space-3, 12px); }
.hl-toggle {
  align-self: flex-end; background: none; border: none; cursor: pointer; padding: 2px 4px;
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(44, 38, 34, 0.25);
}
.hl-toggle:hover, .hl-toggle.is-armed { color: var(--ink-secondary, #6B635C); }
/* Armed = discoverable but never attention-trapping: a small soft-pulsing dot. */
.hl-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: var(--schools-red, #DB1E17);
  animation: hl-throb 2.6s ease-in-out infinite;
}
@keyframes hl-throb {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .hl-dot { animation: none; opacity: 0.55; }
}
.hl-card {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex; flex-direction: column; gap: var(--space-4, 16px);
}
.hl-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.hl-intro {
  margin: 0;
  font-size: var(--text-base, 15px); color: var(--ink-primary, #2C2622); line-height: 1.55;
}
.hl-walks { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.hl-walk-link {
  background: none; border: none; cursor: pointer; padding: 2px 0; text-align: left;
  font: inherit; font-size: var(--text-sm, 13px); color: var(--schools-red, #DB1E17);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(219, 30, 23, 0.3);
}
.hl-walk-link:hover { text-decoration-color: currentColor; }
/* The methodology layer sits behind the doing, still collapsed. */
.hl-prose {
  display: flex; flex-direction: column; gap: var(--space-3, 12px);
  padding-top: var(--space-3, 12px);
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}
.hl-fade-enter-active, .hl-fade-leave-active { transition: opacity 0.15s ease; }
.hl-fade-enter-from, .hl-fade-leave-to { opacity: 0; }
</style>
