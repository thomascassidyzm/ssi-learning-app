<script setup lang="ts">
/**
 * HowThisWorksLearner — the learner-side "using the app" explainer.
 *
 * Same mechanic as the admin/schools/orgs How-this-works surface: one quiet
 * text link carrying a soft-pulsing dot until it is opened for the first time,
 * seen-state persisted in localStorage, pulse stops on open. Nothing ever opens
 * uninvited, and the dot respects prefers-reduced-motion.
 *
 * Red pulse — the existing pulse flavour. Its sibling WhyThisWorks carries the
 * blue one and keeps its own independent seen-state.
 *
 * Prose lives in the content module, never inline here.
 */
import { ref, computed } from 'vue'
import { HOW_THIS_WORKS_LEARNER as section } from '@/explainer/learnerExplainers'
import ExplainerFigure from './ExplainerFigure.vue'
import PlayerScreenFigure from './PlayerScreenFigure.vue'
import { shouldThrob, markSeen } from '@/explainer/learnerThrob'

const props = withDefaults(defineProps<{
  /** Auth uid where the mount knows it; 'anon' keeps the state per-device. */
  viewerId?: string
  /**
   * Override for the link + kicker label. The Library panel (A-159) is itself
   * called "How this works", so this section sits inside it as "Using the app"
   * rather than repeating its parent's name. Prose is never overridden.
   */
  linkLabel?: string
}>(), { viewerId: 'anon', linkLabel: '' })

const label = computed(() => props.linkLabel || section.linkLabel)

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
  <section class="lx">
    <button type="button" class="lx-toggle" :class="{ 'is-armed': throbbing && !open }" @click="toggle">
      <span v-if="throbbing && !open" class="lx-dot" aria-hidden="true"></span>
      {{ open ? 'Close' : label }}
    </button>
    <transition name="lx-fade">
      <div v-if="open" class="lx-card">
        <span class="lx-kicker">{{ label }}</span>
        <p class="lx-intro">{{ section.intro }}</p>
        <PlayerScreenFigure v-if="section.figure === 'player-screen'" />
        <div v-for="block in section.blocks" :key="block.heading" class="lx-block">
          <h3 class="lx-heading">{{ block.heading }}</h3>
          <p v-for="(para, i) in block.body" :key="i" class="lx-para">{{ para }}</p>
          <ExplainerFigure v-if="block.figure" :name="block.figure" />
          <ul v-if="block.points" class="lx-points">
            <li v-for="(point, i) in block.points" :key="i">{{ point }}</li>
          </ul>
        </div>
      </div>
    </transition>
  </section>
</template>

<style scoped>
.lx { display: flex; flex-direction: column; gap: var(--space-3, 12px); }
.lx-toggle {
  align-self: flex-end; background: none; border: none; cursor: pointer; padding: 2px 4px;
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(44, 38, 34, 0.25);
}
.lx-toggle:hover, .lx-toggle.is-armed { color: var(--ink-secondary, #6B635C); }
/* Armed = discoverable but never attention-trapping: a small soft-pulsing dot. */
.lx-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: var(--schools-red, #DB1E17);
  animation: lx-throb 2.6s ease-in-out infinite;
}
@keyframes lx-throb {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .lx-dot { animation: none; opacity: 0.55; }
}
.lx-card {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex; flex-direction: column; gap: var(--space-4, 16px);
}
.lx-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.lx-intro {
  margin: 0;
  font-size: var(--text-base, 15px); color: var(--ink-primary, #2C2622); line-height: 1.55;
}
.lx-block { display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.lx-heading {
  margin: 0;
  font-size: var(--text-sm, 13px); font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
}
.lx-para {
  margin: 0;
  font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); line-height: 1.6;
}
.lx-points {
  margin: 0; padding-left: 18px;
  display: flex; flex-direction: column; gap: 4px;
  font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); line-height: 1.6;
}
.lx-fade-enter-active, .lx-fade-leave-active { transition: opacity 0.15s ease; }
.lx-fade-enter-from, .lx-fade-leave-to { opacity: 0; }
</style>
