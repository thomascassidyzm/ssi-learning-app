<script setup lang="ts">
import { computed, ref, watch } from 'vue'

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

// Is this an M-LEGO with components? → train carriage mode
const isTrainCarriage = computed(() =>
  props.components && props.components.length > 1
)

// Generate stable random scatter positions per block set
const scatterPositions = ref<{ x: number; y: number; rotate: number }[]>([])

const generateScatter = (count: number) => {
  const positions = []
  for (let i = 0; i < count; i++) {
    positions.push({
      x: -30 + Math.random() * 60,
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
      instantHide.value = true
      assemblyPhase.value = 'hidden'
  }
}, { immediate: true })

// Animation duration for assembling — match voice1 audio
const assembleDuration = computed(() => {
  const ms = props.voice1DurationMs || 2000
  return `${(ms * 0.8) / 1000}s`
})

// Stagger delay per block
const staggerDelay = (index: number): string => {
  const total = props.blocks.length || 1
  const ms = props.voice1DurationMs || 2000
  const stagger = (ms * 0.5) / total
  return `${(stagger * index) / 1000}s`
}
</script>

<template>
  <div class="lego-assembly" :class="[assemblyPhase, { 'instant-hide': instantHide }]">

    <!-- ═══════════════════════════════════════════
         TRAIN CARRIAGE MODE — M-LEGO with components
         Target carriages linked together, known underneath
         ═══════════════════════════════════════════ -->
    <div
      v-if="isTrainCarriage"
      class="train"
      :class="[assemblyPhase, { salient: blocks[0]?.isSalient }]"
      :style="{
        '--assemble-duration': assembleDuration,
        '--stagger-delay': '0s',
        '--belt-accent': beltColor,
        '--belt-glow': beltGlow,
      }"
    >
      <!-- Columns: each component is a column, couplers between -->
      <div class="train-columns">
        <template v-for="(comp, i) in components" :key="i">
          <div class="train-col">
            <div class="carriage carriage--target">
              <span class="carriage-text">{{ comp.target }}</span>
            </div>
            <div class="carriage carriage--known">
              <span class="carriage-text">{{ comp.known }}</span>
            </div>
          </div>
          <div v-if="i < components!.length - 1" class="coupler-col">
            <div class="coupler-dot"></div>
          </div>
        </template>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         SINGLE BLOCK MODE — A-LEGOs and practice phrases
         ═══════════════════════════════════════════ -->
    <template v-else>
      <!-- Single A-LEGO with component (shows known underneath) -->
      <div
        v-if="components && components.length === 1 && blocks.length === 1"
        class="single-lego"
        :class="[assemblyPhase, { salient: blocks[0]?.isSalient }]"
        :style="{
          '--assemble-duration': assembleDuration,
          '--stagger-delay': '0s',
          '--belt-accent': beltColor,
          '--belt-glow': beltGlow,
          '--char-count': blocks[0]?.targetText.length || 8,
        }"
      >
        <span class="block-text">{{ blocks[0].targetText }}</span>
        <span class="block-known">{{ components[0].known }}</span>
      </div>

      <!-- Practice phrase blocks (multiple LEGOs, no component data) -->
      <TransitionGroup v-else :name="instantHide ? '' : 'lego-block'">
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
    </template>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════════
   LAYOUT CONTAINER
   ═══════════════════════════════════════════════════════════════ */
.lego-assembly {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
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
.lego-assembly.instant-hide .lego-block,
.lego-assembly.instant-hide .train,
.lego-assembly.instant-hide .single-lego {
  transition: none !important;
  animation: none !important;
}

/* ═══════════════════════════════════════════════════════════════
   TRAIN CARRIAGE — M-LEGO with linked components
   ═══════════════════════════════════════════════════════════════ */
.train {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 2rem);
  transition-property: transform, opacity;
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, opacity;
}

.train.hidden {
  opacity: 0;
  transform: scale(0.85);
}

.train.assembling {
  opacity: 1;
  transform: scale(1);
  transition-duration: var(--assemble-duration, 1.5s);
  animation: train-arrive var(--assemble-duration, 1.5s) both;
}

.train.assembled {
  opacity: 1;
  transform: scale(1);
  transition-duration: 0.6s;
}

.train-columns {
  display: flex;
  align-items: stretch;
  justify-content: center;
}

.train-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* --- Carriages --- */
.carriage {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5em 1em;
  backdrop-filter: blur(8px);
  transition: all 0.3s ease;
}

.carriage--target {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  min-height: 2.8em;
}

/* First column: rounded left corners */
.train-col:first-of-type .carriage--target { border-radius: 10px 0 0 10px; }
.train-col:first-of-type .carriage--known { border-radius: 10px 0 0 10px; }

/* Last column: rounded right corners */
.train-col:last-of-type .carriage--target { border-radius: 0 10px 10px 0; }
.train-col:last-of-type .carriage--known { border-radius: 0 10px 10px 0; }

/* Solo column: all corners rounded */
.train-col:only-of-type .carriage--target { border-radius: 10px; }
.train-col:only-of-type .carriage--known { border-radius: 10px; }

.carriage--target .carriage-text {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: clamp(1.1rem, 1.8rem, 2rem);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  white-space: nowrap;
  letter-spacing: 0.02em;
}

/* --- Known carriages (smaller, muted) --- */
.carriage--known {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0.3em 1em;
}

.carriage--known .carriage-text {
  font-family: var(--font-body, system-ui);
  font-size: 0.85rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
}

/* --- Coupler column (vertically centered dot between carriage columns) --- */
.coupler-col {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  flex-shrink: 0;
}

.coupler-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--belt-accent, rgba(255, 255, 255, 0.3));
  box-shadow: 0 0 6px var(--belt-glow, rgba(255, 255, 255, 0.15));
}

/* Salient train (intro/debut) — belt accent glow */
.train.salient .carriage--target {
  border-color: var(--belt-accent, rgba(255, 255, 255, 0.3));
  border-width: 2px;
  background: rgba(255, 255, 255, 0.15);
}

.train.salient.assembled .carriage--target {
  box-shadow:
    0 0 12px 2px var(--belt-glow, rgba(255, 255, 255, 0.15)),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  animation: assembled-pulse 2.5s ease-in-out infinite;
}

/* ═══════════════════════════════════════════════════════════════
   SINGLE LEGO — A-type with known text underneath
   ═══════════════════════════════════════════════════════════════ */
.single-lego {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0.7em 1.3em;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  max-width: calc(100vw - 3rem);
  transition-property: transform, opacity, box-shadow, background;
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, opacity;
}

.single-lego .block-text {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: clamp(1.1rem, calc(2.2rem - var(--char-count, 8) * 0.035rem), 2rem);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.single-lego .block-known {
  font-family: var(--font-body, system-ui);
  font-size: 0.85rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.5);
}

.single-lego.hidden {
  opacity: 0;
  transform: scale(0.85);
}

.single-lego.assembling {
  opacity: 1;
  transform: scale(1);
  transition-duration: var(--assemble-duration, 1.5s);
  animation: train-arrive var(--assemble-duration, 1.5s) both;
}

.single-lego.assembled {
  opacity: 1;
  transform: scale(1);
  transition-duration: 0.6s;
}

.single-lego.salient {
  border-color: var(--belt-accent, rgba(255, 255, 255, 0.3));
  border-width: 2px;
  background: rgba(255, 255, 255, 0.15);
}

.single-lego.salient.assembled {
  box-shadow:
    0 0 20px 5px var(--belt-glow, rgba(255, 255, 255, 0.25)),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  animation: salient-pulse 2.5s ease-in-out infinite;
}

/* ═══════════════════════════════════════════════════════════════
   PRACTICE BLOCKS — multiple LEGOs in a phrase
   ═══════════════════════════════════════════════════════════════ */
.lego-block {
  display: inline-flex;
  align-items: center;
  padding: 0.6em 1.1em;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 0 0 0 var(--belt-glow, rgba(255, 255, 255, 0.1)),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  max-width: calc(100vw - 3rem);
  transition-property: transform, opacity, box-shadow, background;
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, opacity;
}

.lego-block .block-text {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  /* Softer scaling: stays larger for longer, floor at 1.1rem */
  font-size: clamp(1.1rem, calc(2.2rem - var(--char-count, 8) * 0.035rem), 1.875rem);
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

/* --- ASSEMBLED (with gentle pulse) --- */
.lego-block.assembled {
  opacity: 1;
  transform: translate(0, 0) rotate(0deg);
  transition-duration: 0.6s;
  border-color: var(--belt-accent, rgba(255, 255, 255, 0.2));
  box-shadow:
    0 0 12px 2px var(--belt-glow, rgba(255, 255, 255, 0.15)),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.1);
  animation: assembled-pulse 2.5s ease-in-out infinite;
}

/* --- SALIENT LEGO (newly introduced) --- */
.lego-block.salient {
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--belt-accent, rgba(255, 255, 255, 0.3));
  border-width: 2px;
  padding: 0.7em 1.3em;
  box-shadow:
    0 0 14px 3px var(--belt-glow, rgba(255, 255, 255, 0.2)),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.lego-block.salient .block-text {
  color: rgba(255, 255, 255, 1);
  font-weight: 600;
  font-size: clamp(1.1rem, calc(2.3rem - var(--char-count, 8) * 0.035rem), 2.125rem);
}
.lego-block.salient.assembled {
  background: rgba(255, 255, 255, 0.18);
  box-shadow:
    0 0 20px 5px var(--belt-glow, rgba(255, 255, 255, 0.25)),
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

/* ═══════════════════════════════════════════════════════════════
   KEYFRAMES
   ═══════════════════════════════════════════════════════════════ */
@keyframes gentle-float {
  0%, 100% { transform: translate(var(--scatter-x), var(--scatter-y)) rotate(var(--scatter-rotate)); }
  50% { transform: translate(calc(var(--scatter-x) + 2%), calc(var(--scatter-y) - 1.5%)) rotate(calc(var(--scatter-rotate) + 2deg)); }
}

@keyframes snap-arrive {
  0% {
    transform: translate(var(--scatter-x), var(--scatter-y)) rotate(var(--scatter-rotate)) scale(0.9);
    opacity: 0.4;
  }
  70% { transform: translate(0, 0) rotate(0deg) scale(1.06); opacity: 1; }
  85% { transform: translate(0, 0) rotate(0deg) scale(0.97); }
  100% { transform: translate(0, 0) rotate(0deg) scale(1); }
}

@keyframes train-arrive {
  0% { transform: scale(0.85); opacity: 0; }
  70% { transform: scale(1.03); opacity: 1; }
  85% { transform: scale(0.98); }
  100% { transform: scale(1); }
}

@keyframes assembled-pulse {
  0%, 100% {
    box-shadow:
      0 0 12px 2px var(--belt-glow, rgba(255, 255, 255, 0.15)),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }
  50% {
    box-shadow:
      0 0 18px 4px var(--belt-glow, rgba(255, 255, 255, 0.2)),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }
}

@keyframes salient-pulse {
  0%, 100% {
    box-shadow:
      0 0 20px 5px var(--belt-glow, rgba(255, 255, 255, 0.25)),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }
  50% {
    box-shadow:
      0 0 28px 8px var(--belt-glow, rgba(255, 255, 255, 0.35)),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }
}

/* ═══════════════════════════════════════════════════════════════
   MOBILE
   ═══════════════════════════════════════════════════════════════ */
@media (max-width: 600px) {
  .lego-block .block-text {
    font-size: clamp(1rem, calc(1.9rem - var(--char-count, 8) * 0.03rem), 1.625rem);
  }
  .lego-block {
    padding: 0.5em 0.9em;
  }
  .lego-block.salient {
    padding: 0.6em 1.1em;
  }
  .lego-block.salient .block-text {
    font-size: clamp(1rem, calc(2rem - var(--char-count, 8) * 0.03rem), 1.875rem);
  }

  .carriage--target .carriage-text {
    font-size: clamp(1rem, 1.5rem, 1.75rem);
  }
  .carriage--target {
    padding: 0.4em 0.8em;
  }
  .carriage--known {
    padding: 0.25em 0.8em;
  }

  .single-lego .block-text {
    font-size: clamp(1rem, calc(2rem - var(--char-count, 8) * 0.03rem), 1.75rem);
  }
}
</style>

<!-- Mist theme overrides -->
<style>
:root[data-theme="mist"] .lego-block {
  background: #F2F0ED;
  border: 1px solid rgba(122, 110, 98, 0.12);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.06), 0 4px 12px rgba(44, 38, 34, 0.05);
}

:root[data-theme="mist"] .lego-block .block-text {
  color: #1A1614;
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

:root[data-theme="mist"] .lego-block.salient.assembled {
  background: #ECEAE7;
  box-shadow:
    0 2px 6px rgba(44, 38, 34, 0.07),
    0 8px 28px color-mix(in srgb, var(--belt-accent, rgba(122, 110, 98, 0.18)) 28%, transparent);
}

/* Train carriage mist overrides */
:root[data-theme="mist"] .carriage--target {
  background: #F2F0ED;
  border-color: rgba(122, 110, 98, 0.15);
}
:root[data-theme="mist"] .carriage--target .carriage-text {
  color: #1A1614;
}
:root[data-theme="mist"] .carriage--known {
  background: #E8E5E1;
  border-color: rgba(122, 110, 98, 0.1);
}
:root[data-theme="mist"] .carriage--known .carriage-text {
  color: #7A6E62;
}
:root[data-theme="mist"] .coupler-dot {
  background: color-mix(in srgb, var(--belt-accent, #7A6E62) 50%, #A89C8E);
}

:root[data-theme="mist"] .single-lego {
  background: #F2F0ED;
  border-color: rgba(122, 110, 98, 0.12);
}
:root[data-theme="mist"] .single-lego .block-text {
  color: #1A1614;
}
:root[data-theme="mist"] .single-lego .block-known {
  color: #7A6E62;
}

:root[data-theme="mist"] .train.salient .carriage--target {
  border-color: var(--belt-accent, rgba(122, 110, 98, 0.28));
  background: #ECEAE7;
}
</style>
