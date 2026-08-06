<script setup lang="ts">
/**
 * PortraitPanel — LAYER 3 of the learner profile: estimate level.
 *
 * Founder ruling 2026-08-03: difficulty × execution, where COURSE POSITION is
 * the difficulty term — brilliant on the third thing you ever learned is not
 * expert; struggling on the nine-hundredth is not weak. Surfaced as a
 * progressively-confident portrait with a NOTIONAL level estimate that
 * sharpens with data. NEVER a test result, never a pass/fail.
 *
 * The interval is the honest part: it starts wide and visibly narrows. A
 * learner watching their own estimate get sharper is watching evidence
 * accumulate, which is a different feeling from being graded.
 *
 * Position is shown as THE LEARNER'S OWN WORDS — the last thing they said, in
 * both languages — never as a number and never as an internal unit name
 * (feedback_ssi_position_is_lego_not_seed).
 */
import { computed } from 'vue'
import type { LearnerProfile } from '@/composables/useLearnerProfile'

const props = defineProps<{ portrait: LearnerProfile['portrait'] }>()

const isRange = computed(() => props.portrait.cefr.low !== props.portrait.cefr.high)

const confidencePct = computed(() => Math.round(props.portrait.confidence * 100))

const confidenceLine = computed(() => {
  const c = props.portrait.confidence
  if (c < 0.25) return 'Early days for this estimate — it will sharpen quickly now.'
  if (c < 0.5) return 'Getting clearer. Every session narrows this.'
  if (c < 0.75) return 'This is settling into shape.'
  return 'This one has enough behind it to trust.'
})
</script>

<template>
  <section class="panel">
    <h2 class="title">Roughly where you are</h2>

    <div class="estimate">
      <span class="band">{{ portrait.cefr.band }}</span>
      <span v-if="isRange" class="interval">
        somewhere between {{ portrait.cefr.low }} and {{ portrait.cefr.high }}
      </span>
    </div>

    <div class="confidence" role="img" :aria-label="`Estimate confidence ${confidencePct} percent`">
      <div class="confidence-track">
        <div class="confidence-fill" :style="{ width: `${confidencePct}%` }"></div>
      </div>
      <span class="confidence-label">{{ confidenceLine }}</span>
    </div>

    <p class="explain">
      This is our best guess, not a test — worked out from how hard the material has got
      and how it is going for you at that level. It is not something you can pass or fail.
    </p>

    <div v-if="portrait.positionTarget" class="position">
      <span class="position-kicker">The last thing you said</span>
      <p class="position-target">{{ portrait.positionTarget }}</p>
      <p v-if="portrait.positionKnown" class="position-known">{{ portrait.positionKnown }}</p>
    </div>

    <p v-if="portrait.source === 'mock'" class="sample">Sample data — not your real numbers yet.</p>
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
.title {
  margin: 0;
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-secondary, #6B635C);
}
.estimate { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.band {
  font-size: 40px; font-weight: var(--font-semibold, 600); line-height: 1;
  color: var(--ink-primary, #2C2622);
}
.interval { font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); }
.confidence { display: flex; flex-direction: column; gap: 6px; }
.confidence-track {
  height: 4px; border-radius: 2px; background: rgba(44, 38, 34, 0.08); overflow: hidden;
}
.confidence-fill {
  height: 100%; border-radius: 2px;
  background: var(--accent-belt, #7C6A58);
  transition: width 600ms ease;
}
.confidence-label { font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078); }
.explain {
  margin: 0; font-size: var(--text-sm, 13px); line-height: 1.55;
  color: var(--ink-secondary, #6B635C);
}
.position {
  border-left: 2px solid var(--accent-belt, #7C6A58);
  padding-left: var(--space-3, 12px);
  display: flex; flex-direction: column; gap: 2px;
}
.position-kicker {
  font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ink-tertiary, #8A8078);
}
.position-target {
  margin: 0; font-size: var(--text-base, 15px); color: var(--ink-primary, #2C2622);
}
.position-known { margin: 0; font-size: var(--text-sm, 13px); color: var(--ink-tertiary, #8A8078); }
.sample {
  margin: 0; font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078); font-style: italic;
}
</style>
