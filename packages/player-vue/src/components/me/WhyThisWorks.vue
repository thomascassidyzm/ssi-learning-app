<script setup lang="ts">
/**
 * WhyThisWorks — the learner-side methodology explainer.
 *
 * Identical mechanic to HowThisWorksLearner and to the admin/schools/orgs
 * How-this-works surface: a quiet text link with a soft-pulsing dot until it is
 * first opened, seen-state in localStorage, pulse stops on open, nothing ever
 * opens uninvited, dot respects prefers-reduced-motion.
 *
 * Blue pulse — the app-update accent, var(--info) — so the two learner
 * explainers read as siblings rather than repeats. Seen-state is independent of
 * How-this-works: opening one leaves the other still armed.
 *
 * This section is the ONLY place the thirty-hour promise appears. Founder
 * ruling 2026-08-03: we are not a claims-focused company — it sits inside the
 * methodology, never as a headline. Prose lives in the content module.
 */
import { ref } from 'vue'
import { WHY_THIS_WORKS as section } from '@/explainer/learnerExplainers'
import { shouldThrob, markSeen } from '@/explainer/learnerThrob'

const props = withDefaults(defineProps<{
  /** Auth uid where the mount knows it; 'anon' keeps the state per-device. */
  viewerId?: string
}>(), { viewerId: 'anon' })

const open = ref(false)
const throbbing = ref(shouldThrob(props.viewerId, section.id))

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    markSeen(props.viewerId, section.id)
    throbbing.value = false
  }
}
</script>

<template>
  <section class="wx">
    <button type="button" class="wx-toggle" :class="{ 'is-armed': throbbing && !open }" @click="toggle">
      <span v-if="throbbing && !open" class="wx-dot" aria-hidden="true"></span>
      {{ open ? 'Close' : section.linkLabel }}
    </button>
    <transition name="wx-fade">
      <div v-if="open" class="wx-card">
        <span class="wx-kicker">{{ section.linkLabel }}</span>
        <p class="wx-intro">{{ section.intro }}</p>
        <div v-for="block in section.blocks" :key="block.heading" class="wx-block">
          <h3 class="wx-heading">{{ block.heading }}</h3>
          <p v-for="(para, i) in block.body" :key="i" class="wx-para">{{ para }}</p>
          <ul v-if="block.points" class="wx-points">
            <li v-for="(point, i) in block.points" :key="i">{{ point }}</li>
          </ul>
        </div>
      </div>
    </transition>
  </section>
</template>

<style scoped>
.wx { display: flex; flex-direction: column; gap: var(--space-3, 12px); }
.wx-toggle {
  align-self: flex-end; background: none; border: none; cursor: pointer; padding: 2px 4px;
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(44, 38, 34, 0.25);
}
.wx-toggle:hover, .wx-toggle.is-armed { color: var(--ink-secondary, #6B635C); }
/* Armed = discoverable but never attention-trapping: a small soft-pulsing dot,
   in the app-update blue so it reads as a sibling of the red How-this-works. */
.wx-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: var(--info, #60a5fa);
  animation: wx-throb 2.6s ease-in-out infinite;
}
@keyframes wx-throb {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .wx-dot { animation: none; opacity: 0.55; }
}
.wx-card {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex; flex-direction: column; gap: var(--space-4, 16px);
}
.wx-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--info, #60a5fa);
}
.wx-intro {
  margin: 0;
  font-size: var(--text-base, 15px); color: var(--ink-primary, #2C2622); line-height: 1.55;
}
.wx-block { display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.wx-heading {
  margin: 0;
  font-size: var(--text-sm, 13px); font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
}
.wx-para {
  margin: 0;
  font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); line-height: 1.6;
}
.wx-points {
  margin: 0; padding-left: 18px;
  display: flex; flex-direction: column; gap: 4px;
  font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); line-height: 1.6;
}
.wx-fade-enter-active, .wx-fade-leave-active { transition: opacity 0.15s ease; }
.wx-fade-enter-from, .wx-fade-leave-to { opacity: 0; }
</style>
