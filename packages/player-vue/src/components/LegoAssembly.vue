<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'

export interface LegoBlock {
  id: string
  targetText: string
  isSalient?: boolean
}

type AssemblyPhase = 'hidden' | 'scattered' | 'assembling' | 'assembled' | 'dissolving'

export interface ComponentBreakdown {
  known: string
  target: string
}

const props = defineProps<{
  blocks: LegoBlock[]
  phase: string // UI phase: 'prompt' | 'speak' | 'voice1' | 'voice2'
  beltColor: string
  beltGlow: string
  voice1DurationMs?: number
  components?: ComponentBreakdown[]
}>()

// Generate stable random scatter positions per block set
const scatterPositions = ref<{ x: number; y: number; rotate: number }[]>([])

const generateScatter = (count: number) => {
  const positions = []
  for (let i = 0; i < count; i++) {
    positions.push({
      x: -30 + Math.random() * 60, // % offset from center
      y: -20 + Math.random() * 40,
      rotate: -15 + Math.random() * 30,
    })
  }
  return positions
}

watch(() => props.blocks, (newBlocks) => {
  scatterPositions.value = generateScatter(newBlocks.length)
}, { immediate: true })

// Map UI phases to assembly phases.
// Tiles appear at VOICE_1 (with short delay so learner hears before reading).
// On stop/hidden, tiles vanish instantly (no fade) to stay in sync with audio.
const VOICE1_REVEAL_DELAY_MS = 1000
const assemblyPhase = ref<AssemblyPhase>('hidden')
// Track whether we're instant-hiding (skip transition)
const instantHide = ref(false)
let voice1Timer: ReturnType<typeof setTimeout> | null = null

watch(() => props.phase, (phase) => {
  if (voice1Timer) { clearTimeout(voice1Timer); voice1Timer = null }

  if (props.blocks.length === 0) {
    instantHide.value = true
    assemblyPhase.value = 'hidden'
    return
  }

  switch (phase) {
    case 'prompt':
    case 'speak':
      assemblyPhase.value = 'hidden'
      break
    case 'voice1':
    case 'voice_1':
      // Delay reveal so learner hears target before reading tiles
      instantHide.value = false
      voice1Timer = setTimeout(() => {
        assemblyPhase.value = 'assembling'
      }, VOICE1_REVEAL_DELAY_MS)
      break
    case 'voice2':
    case 'voice_2':
      instantHide.value = false
      assemblyPhase.value = 'assembled'
      break
    default:
      // Stop/unknown phase — instant hide, no animation
      instantHide.value = true
      assemblyPhase.value = 'hidden'
  }
}, { immediate: true })

// Animation duration for assembling — match voice1 audio
const assembleDuration = computed(() => {
  const ms = props.voice1DurationMs || 2000
  return `${(ms * 0.8) / 1000}s` // use 80% of voice1 duration
})

// Stagger delay per block
const staggerDelay = (index: number): string => {
  const total = props.blocks.length || 1
  const ms = props.voice1DurationMs || 2000
  const stagger = (ms * 0.5) / total // spread across first 50% of voice1
  return `${(stagger * index) / 1000}s`
}
</script>

<template>
  <div class="lego-assembly" :class="[assemblyPhase, { 'instant-hide': instantHide }]">
    <TransitionGroup :name="instantHide ? '' : 'lego-block'">
      <div
        v-for="(block, index) in blocks"
        :key="block.id"
        class="lego-block"
        :class="[assemblyPhase, { salient: block.isSalient }]"
        :style="{
          '--scatter-x': `${scatterPositions[index]?.x ?? 0}%`,
          '--scatter-y': `${scatterPositions[index]?.y ?? 0}%`,
          '--scatter-rotate': `${scatterPositions[index]?.rotate ?? 0}deg`,
          '--assemble-duration': assembleDuration,
          '--stagger-delay': staggerDelay(index),
          '--belt-accent': beltColor,
          '--belt-glow': beltGlow,
          '--block-index': index,
          '--block-total': blocks.length,
          '--char-count': block.targetText.length,
        }"
      >
        <span class="block-text">{{ block.targetText }}</span>
      </div>
    </TransitionGroup>

    <!-- Component breakdown for M-type LEGOs: shows atomic pieces below the main tile -->
    <div v-if="components && components.length > 0" class="component-breakdown">
      <template v-for="(comp, i) in components" :key="i">
        <div class="comp-tile">
          <span class="comp-target">{{ comp.target }}</span>
          <span class="comp-known">{{ comp.known }}</span>
        </div>
        <span v-if="i < components.length - 1" class="comp-plus">+</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.lego-assembly {
  position: absolute;
  inset: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  justify-content: center;
  gap: 6px;
  padding: 0 1rem;
  pointer-events: none;
  z-index: 3;
  transition: opacity 0.4s ease;
}

.lego-assembly.hidden {
  opacity: 0;
}

/* Instant hide: no fade, no transition — tiles vanish with audio */
.lego-assembly.instant-hide {
  transition: none !important;
}
.lego-assembly.instant-hide .lego-block {
  transition: none !important;
  animation: none !important;
}
.lego-assembly.instant-hide .component-breakdown {
  animation: none !important;
  opacity: 0;
}

.lego-block {
  display: inline-flex;
  align-items: center;
  padding: 0.6em 1.1em;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 0 0 0 var(--belt-glow, rgba(255,255,255,0.1)),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transition-property: transform, opacity, box-shadow, background;
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, opacity;
}

.block-text {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  /* Scale font down for long text: 1.875rem at 8 chars, shrinks to ~1rem at 25+ chars */
  font-size: clamp(1rem, calc(2.2rem - var(--char-count, 8) * 0.05rem), 1.875rem);
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  letter-spacing: 0.02em;
  user-select: none;
}

/* --- SCATTERED (floating gently) --- */
.lego-block.scattered {
  opacity: 0.5;
  transform: translate(var(--scatter-x), var(--scatter-y)) rotate(var(--scatter-rotate));
  transition-duration: 0.6s;
  animation: gentle-float 4s ease-in-out infinite;
  animation-delay: calc(var(--block-index, 0) * 0.3s);
}

/* --- ASSEMBLING (drift to center, snap) --- */
.lego-block.assembling {
  opacity: 1;
  transform: translate(0, 0) rotate(0deg);
  transition-duration: var(--assemble-duration, 1.5s);
  transition-delay: var(--stagger-delay, 0s);
  animation: snap-arrive var(--assemble-duration, 1.5s) var(--stagger-delay, 0s) both;
}

/* --- ASSEMBLED (fade in with gentle pulse) --- */
.lego-block.assembled {
  opacity: 1;
  transform: translate(0, 0) rotate(0deg);
  transition-duration: 0.6s;
  border-color: var(--belt-accent, rgba(255,255,255,0.2));
  box-shadow:
    0 0 12px 2px var(--belt-glow, rgba(255,255,255,0.15)),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.1);
  animation: assembled-pulse 2.5s ease-in-out infinite;
}

/* --- SALIENT LEGO (newly introduced — stands out, 50% bigger) --- */
.lego-block.salient {
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--belt-accent, rgba(255,255,255,0.3));
  border-width: 2px;
  padding: 0.7em 1.3em;
  box-shadow:
    0 0 14px 3px var(--belt-glow, rgba(255,255,255,0.2)),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.lego-block.salient .block-text {
  color: rgba(255, 255, 255, 1);
  font-weight: 600;
  font-size: clamp(1.1rem, calc(2.5rem - var(--char-count, 8) * 0.055rem), 2.125rem);
}
.lego-block.salient.assembled {
  background: rgba(255, 255, 255, 0.18);
  box-shadow:
    0 0 20px 5px var(--belt-glow, rgba(255,255,255,0.25)),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  animation: salient-pulse 2.5s ease-in-out infinite;
}

/* --- HIDDEN --- */
.lego-block.hidden {
  opacity: 0;
  transform: translate(var(--scatter-x), var(--scatter-y)) scale(0.85);
  transition-duration: 0.4s;
  transition-timing-function: ease-in;
}

/* --- Transition group enter/leave --- */
.lego-block-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.lego-block-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.lego-block-enter-from {
  opacity: 0;
  transform: scale(0.7);
}
.lego-block-leave-to {
  opacity: 0;
  transform: scale(0.85) translateY(10px);
}

/* --- Keyframes --- */
@keyframes gentle-float {
  0%, 100% { transform: translate(var(--scatter-x), var(--scatter-y)) rotate(var(--scatter-rotate)); }
  50% { transform: translate(calc(var(--scatter-x) + 2%), calc(var(--scatter-y) - 1.5%)) rotate(calc(var(--scatter-rotate) + 2deg)); }
}

@keyframes snap-arrive {
  0% {
    transform: translate(var(--scatter-x), var(--scatter-y)) rotate(var(--scatter-rotate)) scale(0.9);
    opacity: 0.4;
  }
  70% {
    transform: translate(0, 0) rotate(0deg) scale(1.06);
    opacity: 1;
  }
  85% {
    transform: translate(0, 0) rotate(0deg) scale(0.97);
  }
  100% {
    transform: translate(0, 0) rotate(0deg) scale(1);
  }
}

@keyframes assembled-pulse {
  0%, 100% {
    box-shadow:
      0 0 12px 2px var(--belt-glow, rgba(255,255,255,0.15)),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }
  50% {
    box-shadow:
      0 0 18px 4px var(--belt-glow, rgba(255,255,255,0.2)),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }
}

@keyframes salient-pulse {
  0%, 100% {
    box-shadow:
      0 0 20px 5px var(--belt-glow, rgba(255,255,255,0.25)),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }
  50% {
    box-shadow:
      0 0 28px 8px var(--belt-glow, rgba(255,255,255,0.35)),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }
}

/* --- Component breakdown tiles --- */
.component-breakdown {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1rem;
  opacity: 0;
  animation: comp-fade-in 0.6s 0.3s ease forwards;
}

.comp-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.4rem 0.75rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
}

.comp-target {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--belt-accent, rgba(251, 191, 36, 0.9));
  line-height: 1.3;
}

.comp-known {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.3;
}

.comp-plus {
  font-size: 0.9rem;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.35);
}

@keyframes comp-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Mobile: scale down more aggressively */
@media (max-width: 600px) {
  .block-text {
    font-size: clamp(0.9rem, calc(1.9rem - var(--char-count, 8) * 0.045rem), 1.625rem);
  }
  .lego-block {
    padding: 0.5em 0.9em;
    max-width: calc(100vw - 3rem);
  }
  .lego-block.salient {
    padding: 0.6em 1.1em;
  }
  .lego-block.salient .block-text {
    font-size: clamp(1rem, calc(2.2rem - var(--char-count, 8) * 0.05rem), 1.875rem);
  }
}
</style>

<!-- Mist theme: paper LEGO chips instead of glass -->
<style>
:root[data-theme="mist"] .lego-block {
  background: #F2F0ED;
  border: 1px solid rgba(122, 110, 98, 0.12);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.06), 0 4px 12px rgba(44, 38, 34, 0.05);
}

:root[data-theme="mist"] .lego-block .block-text {
  color: #1A1614;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
}

:root[data-theme="mist"] .lego-block.assembled {
  background: #F2F0ED;
  border-color: var(--belt-accent, rgba(122, 110, 98, 0.18));
  box-shadow:
    0 1px 3px rgba(44, 38, 34, 0.06),
    0 6px 16px color-mix(in srgb, var(--belt-accent, rgba(122, 110, 98, 0.18)) 18%, transparent);
}

:root[data-theme="mist"] .lego-block.salient {
  background: #F2F0ED;
  border-color: var(--belt-accent, rgba(122, 110, 98, 0.28));
  border-width: 2px;
  box-shadow:
    0 2px 4px rgba(44, 38, 34, 0.07),
    0 8px 24px color-mix(in srgb, var(--belt-accent, rgba(122, 110, 98, 0.18)) 25%, transparent);
}

:root[data-theme="mist"] .lego-block.salient .block-text {
  color: #1A1614;
}

:root[data-theme="mist"] .comp-tile {
  background: #F2F0ED;
  border-color: rgba(122, 110, 98, 0.15);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.06);
}

:root[data-theme="mist"] .comp-target {
  color: color-mix(in srgb, var(--belt-accent, #7A6E62) 70%, #1A1614);
}

:root[data-theme="mist"] .comp-known {
  color: #7A6E62;
}

:root[data-theme="mist"] .comp-plus {
  color: #A89C8E;
}

:root[data-theme="mist"] .lego-block.salient.assembled {
  background: #ECEAE7;
  box-shadow:
    0 2px 6px rgba(44, 38, 34, 0.07),
    0 8px 28px color-mix(in srgb, var(--belt-accent, rgba(122, 110, 98, 0.18)) 28%, transparent);
}
</style>
