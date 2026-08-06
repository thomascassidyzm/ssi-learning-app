<script setup lang="ts">
/**
 * AdherencePanel — LAYER 1 of the learner profile: celebrate showing up.
 *
 * Founder ruling 2026-08-03: the only rewarded thing is showing up and giving
 * it a go. Speaking opportunities are called GOES. Return is celebrated;
 * absence is NEVER mentioned — and cannot be, because the payload has no way
 * to express it (no streak, no gap, no days-since).
 *
 * Dog energy (pedagogy-core): unconditionally warm, brief warmth bursts, never
 * disappointed. The numbers here are descriptive insights the learner could
 * count themselves — goes, minutes. Never points, never a score.
 */
import { computed } from 'vue'
import type { LearnerProfile } from '@/composables/useLearnerProfile'

const props = defineProps<{ adherence: LearnerProfile['adherence'] }>()

// Warmth that scales with what actually happened, and reads the same whether
// the learner came back after a day or after a year. Nothing here can be
// phrased as a shortfall, because nothing here knows what "enough" would be.
const greeting = computed(() => {
  const d = props.adherence.daysPresentThisWeek
  if (d >= 5) return 'Lovely — you have been at it properly this week.'
  if (d >= 2) return 'Good to see you. That is real work going in.'
  return 'Good to see you — every go counts, and they add up faster than it feels.'
})
</script>

<template>
  <section class="panel">
    <p class="greeting">{{ greeting }}</p>

    <div class="hero">
      <span class="hero-number">{{ adherence.goesThisWeek.toLocaleString() }}</span>
      <span class="hero-label">goes this week</span>
    </div>

    <p class="detail">
      <span>{{ adherence.speakingMinutesThisWeek }} minutes speaking</span>
      <span class="dot" aria-hidden="true">·</span>
      <span>{{ adherence.listeningMinutesThisWeek }} minutes listening</span>
    </p>

    <p class="footnote">
      A go is one time you opened your mouth and had a crack at it. That is the whole game.
    </p>

    <p v-if="adherence.source === 'mock'" class="sample">Sample data — not your real numbers yet.</p>
  </section>
</template>

<style scoped>
.panel {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}
.greeting {
  margin: 0;
  font-size: var(--text-base, 15px);
  color: var(--ink-primary, #2C2622);
  line-height: 1.5;
}
.hero { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.hero-number {
  font-size: 44px;
  font-weight: var(--font-semibold, 600);
  line-height: 1;
  color: var(--ink-primary, #2C2622);
  font-variant-numeric: tabular-nums;
}
.hero-label { font-size: var(--text-base, 15px); color: var(--ink-secondary, #6B635C); }
.detail {
  margin: 0;
  display: flex; gap: 8px; flex-wrap: wrap;
  font-size: var(--text-sm, 13px);
  color: var(--ink-secondary, #6B635C);
}
.dot { opacity: 0.5; }
.footnote {
  margin: 0;
  font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078);
  line-height: 1.55;
}
.sample {
  margin: 0;
  font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078);
  font-style: italic;
}
</style>
