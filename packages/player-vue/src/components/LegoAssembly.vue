<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'

export interface LegoBlock {
  id: string
  targetText: string
  isSalient?: boolean
}

type AssemblyPhase = 'hidden' | 'scattered' | 'assembling' | 'assembled' | 'dissolving'

const props = defineProps<{
  blocks: LegoBlock[]
  phase: string // UI phase: 'prompt' | 'speak' | 'voice1' | 'voice2'
  beltColor: string
  beltGlow: string
  voice1DurationMs?: number
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

// Map UI phases to assembly phases
const assemblyPhase = computed<AssemblyPhase>(() => {
  if (props.blocks.length === 0) return 'hidden'
  switch (props.phase) {
    case 'prompt':
    case 'speak': // pause phase
      return 'hidden'
    case 'voice1':
    case 'voice_1':
      return 'assembling'
    case 'voice2':
    case 'voice_2':
      return 'assembled'
    default:
      return 'hidden'
  }
})

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
  <div class="lego-assembly" :class="assemblyPhase">
    <TransitionGroup name="lego-block">
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
        }"
      >
        <span class="block-text">{{ block.targetText }}</span>
      </div>
    </TransitionGroup>
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
  font-size: 1.35rem;
  font-weight: 600;
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
  font-weight: 700;
  font-size: 1.6rem;
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

/* Mobile: still readable at a distance */
@media (max-width: 600px) {
  .block-text {
    font-size: 1.15rem;
  }
  .lego-block {
    padding: 0.5em 0.9em;
  }
  .lego-block.salient {
    padding: 0.6em 1.1em;
  }
  .lego-block.salient .block-text {
    font-size: 1.35rem;
  }
}
</style>

<!-- Mist theme: paper LEGO chips instead of glass -->
<style>
:root[data-theme="mist"] .lego-block {
  background: #ffffff;
  backdrop-filter: none;
  border: 1px solid rgba(100, 80, 55, 0.12);
  box-shadow: 0 1px 2px rgba(60, 45, 30, 0.06), 0 2px 8px rgba(60, 45, 30, 0.04);
}

:root[data-theme="mist"] .lego-block .block-text {
  color: #2c2520;
}

:root[data-theme="mist"] .lego-block.assembled {
  background: #ffffff;
  border-color: var(--belt-accent, rgba(100, 80, 55, 0.2));
  box-shadow:
    0 1px 3px rgba(60, 45, 30, 0.06),
    0 4px 12px color-mix(in srgb, var(--belt-accent, rgba(100, 80, 55, 0.2)) 15%, transparent);
}

:root[data-theme="mist"] .lego-block.salient {
  background: #ffffff;
  border-color: var(--belt-accent, rgba(100, 80, 55, 0.3));
  border-width: 2px;
  box-shadow:
    0 1px 3px rgba(60, 45, 30, 0.08),
    0 4px 16px color-mix(in srgb, var(--belt-accent, rgba(100, 80, 55, 0.2)) 20%, transparent);
}

:root[data-theme="mist"] .lego-block.salient .block-text {
  color: #2c2520;
}

:root[data-theme="mist"] .lego-block.salient.assembled {
  background: #fafaf7;
  box-shadow:
    0 2px 4px rgba(60, 45, 30, 0.08),
    0 4px 20px color-mix(in srgb, var(--belt-accent, rgba(100, 80, 55, 0.2)) 25%, transparent);
}
</style>
