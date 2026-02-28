<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface LegoBlock {
  id: string
  targetText: string
  knownText?: string
  isSalient?: boolean
  /** M-LEGO component breakdown */
  components?: { known: string; target: string }[]
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

// Detect M-LEGO: multiple components on the salient block or in props
const mLegoComponents = computed(() => {
  if (props.components && props.components.length > 1) return props.components
  // Check if any block has components
  for (const b of props.blocks) {
    if (b.components && b.components.length > 1) return b.components
  }
  return null
})

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

// For intro/single-lego: compute known text from components or props
const knownText = computed(() => {
  if (props.components && props.components.length === 1) {
    return props.components[0].known
  }
  if (props.blocks.length === 1 && props.blocks[0].knownText) {
    return props.blocks[0].knownText
  }
  return ''
})

// Do any blocks in the current phrase have known text? (for placeholder alignment)
const hasAnyKnownText = computed(() =>
  props.blocks.some(b => b.knownText || (b.components && b.components.some(c => c.known)))
)
</script>

<template>
  <div class="lego-assembly" :class="[assemblyPhase, { 'instant-hide': instantHide }]">

    <!-- ═══════════════════════════════════════════
         SINGLE TILE MODE — M-LEGO (with stubs) or A-LEGO
         Used for intro/debut: shows known text underneath
         ═══════════════════════════════════════════ -->
    <div
      v-if="blocks.length === 1 && (components || blocks[0]?.components)"
      class="lego-tile"
      :class="[assemblyPhase, { salient: blocks[0]?.isSalient }]"
      :style="{
        '--assemble-duration': assembleDuration,
        '--stagger-delay': '0s',
        '--belt-accent': beltColor,
        '--belt-glow': beltGlow,
        '--char-count': blocks[0]?.targetText.length || 8,
      }"
    >
      <!-- Target row: single tile, components are spans with stubs between -->
      <div class="tile-target" :class="{ 'has-components': !!mLegoComponents }">
        <template v-if="mLegoComponents">
          <span
            v-for="(comp, i) in mLegoComponents"
            :key="i"
            class="comp"
          >{{ comp.target }}</span>
        </template>
        <span v-else class="comp">{{ blocks[0]?.targetText }}</span>
      </div>
      <!-- Known row: per-component aligned text -->
      <div v-if="mLegoComponents" class="tile-known-row">
        <span
          v-for="(comp, i) in mLegoComponents"
          :key="i"
          class="tile-known-comp"
        >{{ comp.known || '·' }}</span>
      </div>
      <div v-else-if="knownText" class="tile-known">{{ knownText }}</div>
    </div>

    <!-- ═══════════════════════════════════════════
         PRACTICE PHRASE BLOCKS — multiple LEGOs in a phrase
         Each block is a tile; M-LEGOs render with stubs internally
         ═══════════════════════════════════════════ -->
    <template v-else>
      <TransitionGroup :name="instantHide ? '' : 'lego-block'">
        <div
          v-for="(block, index) in blocks"
          :key="block.id"
          class="lego-block-wrapper"
          :class="[assemblyPhase]"
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
          <div
            class="lego-block"
            :class="{ salient: block.isSalient, 'has-components': block.components && block.components.length > 1 }"
          >
            <!-- M-LEGO in practice phrase: same stubs rendering -->
            <template v-if="block.components && block.components.length > 1">
              <span
                v-for="(comp, ci) in block.components"
                :key="ci"
                class="comp block-text"
              >{{ comp.target }}</span>
            </template>
            <span v-else class="block-text">{{ block.targetText }}</span>
          </div>
          <!-- Known text: per-component for M-LEGOs, single for A-LEGOs -->
          <div v-if="block.components && block.components.length > 1" class="block-known-row">
            <span
              v-for="(comp, ci) in block.components"
              :key="ci"
              class="block-known-comp"
            >{{ comp.known || '·' }}</span>
          </div>
          <span v-else-if="block.knownText" class="block-known">{{ block.knownText }}</span>
          <span v-else-if="hasAnyKnownText" class="block-known block-known--placeholder">·</span>
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
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  justify-content: center;
  gap: 6px;
  padding: 0 0.75rem;
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
.lego-assembly.instant-hide .lego-block-wrapper,
.lego-assembly.instant-hide .lego-tile {
  transition: none !important;
  animation: none !important;
}

/* ═══════════════════════════════════════════════════════════════
   SINGLE TILE — intro/debut (A-LEGO or M-LEGO with stubs)
   ═══════════════════════════════════════════════════════════════ */
.lego-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: calc(100vw - 2rem);
  transition-property: transform, opacity;
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, opacity;
}

.lego-tile.hidden {
  opacity: 0;
  transform: scale(0.85);
}

.lego-tile.assembling {
  opacity: 1;
  transform: scale(1);
  transition-duration: var(--assemble-duration, 1.5s);
  animation: tile-arrive var(--assemble-duration, 1.5s) both;
}

.lego-tile.assembled {
  opacity: 1;
  transform: scale(1);
  transition-duration: 0.6s;
}

/* Target row: the actual tile */
.tile-target {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 0.6em 1.2em;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
  position: relative;
  max-width: 100%;
}

.tile-target .comp {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: clamp(1.1rem, calc(2.2rem - var(--char-count, 8) * 0.035rem), 2rem);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  overflow-wrap: break-word;
  word-break: break-word;
  letter-spacing: 0.02em;
  position: relative;
  padding: 0 0.35em;
}

/* Stubs-bright: short lines from top & bottom edges, open middle */
.tile-target.has-components .comp + .comp::before,
.tile-target.has-components .comp + .comp::after {
  content: '';
  position: absolute;
  left: 0;
  width: 1px;
  height: 25%;
  background: rgba(255, 255, 255, 0.3);
  z-index: 2;
  pointer-events: none;
}
.tile-target.has-components .comp + .comp::before {
  top: 0;
}
.tile-target.has-components .comp + .comp::after {
  bottom: 0;
}

/* Known text underneath (single A-LEGO) */
.tile-known {
  font-family: var(--font-body, system-ui);
  font-size: 0.8rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
}

/* Known text row: per-component aligned with target (M-LEGO) */
.tile-known-row {
  display: inline-flex;
  align-items: baseline;
  /* Match tile-target horizontal padding so component widths align */
  padding: 0 1.2em;
}
.tile-known-comp {
  font-family: var(--font-body, system-ui);
  font-size: 0.8rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  text-align: center;
  /* Match target comp padding so widths stay in sync */
  padding: 0 0.35em;
}

/* Salient (intro/debut) — belt accent glow */
.lego-tile.salient .tile-target {
  border-color: var(--belt-accent, rgba(255, 255, 255, 0.3));
  border-width: 2px;
  background: rgba(255, 255, 255, 0.15);
}

.lego-tile.salient.assembled .tile-target {
  box-shadow:
    0 0 20px 5px var(--belt-glow, rgba(255, 255, 255, 0.25)),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  animation: salient-pulse 2.5s ease-in-out infinite;
}

/* ═══════════════════════════════════════════════════════════════
   PRACTICE BLOCKS — multiple LEGOs in a phrase (horizontal flow)
   ═══════════════════════════════════════════════════════════════ */

/* Wrapper: handles animation/positioning, contains tile + known text */
.lego-block-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transition-property: transform, opacity;
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, opacity;
}

/* The visual tile */
.lego-block {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 0.6em 1.1em;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 0 0 0 var(--belt-glow, rgba(255, 255, 255, 0.1)),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  max-width: calc(100vw - 3rem);
  overflow: hidden;
  position: relative;
}

/* Known text under each practice block (A-LEGO) */
.block-known {
  font-family: var(--font-body, system-ui);
  font-size: 0.75rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  text-align: center;
  max-width: calc(100vw - 3rem);
  overflow: hidden;
  text-overflow: ellipsis;
}

.block-known--placeholder {
  opacity: 0.3;
}

/* Known text row: per-component aligned with target (practice M-LEGO) */
.block-known-row {
  display: inline-flex;
  align-items: baseline;
  /* Match lego-block horizontal padding so comp widths align */
  padding: 0 1.1em;
}
.block-known-comp {
  font-family: var(--font-body, system-ui);
  font-size: 0.75rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  text-align: center;
  /* Match target comp padding for alignment */
  padding: 0 0.35em;
}

.lego-block .block-text {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: clamp(1.1rem, calc(2.2rem - var(--char-count, 8) * 0.035rem), 1.875rem);
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  overflow-wrap: break-word;
  word-break: break-word;
  letter-spacing: 0.02em;
  user-select: none;
  position: relative;
  padding: 0 0.35em;
}

/* Stubs-bright on practice M-LEGOs */
.lego-block.has-components .comp + .comp::before,
.lego-block.has-components .comp + .comp::after {
  content: '';
  position: absolute;
  left: 0;
  width: 1px;
  height: 25%;
  background: rgba(255, 255, 255, 0.3);
  z-index: 2;
  pointer-events: none;
}
.lego-block.has-components .comp + .comp::before {
  top: 0;
}
.lego-block.has-components .comp + .comp::after {
  bottom: 0;
}

/* --- SCATTERED (floating gently) --- */
.lego-block-wrapper.scattered {
  opacity: 0.5;
  transform: translate(var(--scatter-x), var(--scatter-y)) rotate(var(--scatter-rotate));
  transition-duration: 0.6s;
  animation: gentle-float 4s ease-in-out infinite;
  animation-delay: calc(var(--block-index, 0) * 0.3s);
}

/* --- ASSEMBLING (drift to center, snap) --- */
.lego-block-wrapper.assembling {
  opacity: 1;
  transform: translate(0, 0) rotate(0deg);
  transition-duration: var(--assemble-duration, 1.5s);
  transition-delay: var(--stagger-delay, 0s);
  animation: snap-arrive var(--assemble-duration, 1.5s) var(--stagger-delay, 0s) both;
}

/* --- ASSEMBLED (with gentle pulse on tile) --- */
.lego-block-wrapper.assembled {
  opacity: 1;
  transform: translate(0, 0) rotate(0deg);
  transition-duration: 0.6s;
}
.lego-block-wrapper.assembled .lego-block {
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
.lego-block-wrapper.assembled .lego-block.salient {
  background: rgba(255, 255, 255, 0.18);
  box-shadow:
    0 0 20px 5px var(--belt-glow, rgba(255, 255, 255, 0.25)),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  animation: salient-pulse 2.5s ease-in-out infinite;
}

/* --- HIDDEN --- */
.lego-block-wrapper.hidden {
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

@keyframes tile-arrive {
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

  .tile-target .comp {
    font-size: clamp(1rem, calc(2rem - var(--char-count, 8) * 0.03rem), 1.75rem);
  }
}
</style>

<!-- Mist theme overrides -->
<style>
:root[data-theme="mist"] .lego-block {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.22);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10),
              0 8px 20px rgba(44, 38, 34, 0.06);
  backdrop-filter: none;
}

:root[data-theme="mist"] .lego-block .block-text {
  color: var(--text-primary);
}

:root[data-theme="mist"] .lego-block-wrapper.assembled .lego-block {
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.22);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10),
              0 8px 20px rgba(44, 38, 34, 0.06);
  animation: none;
}

:root[data-theme="mist"] .lego-block.salient {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.22);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.12),
              0 8px 24px rgba(44, 38, 34, 0.08);
}

:root[data-theme="mist"] .lego-block.salient .block-text {
  color: var(--text-primary);
}

:root[data-theme="mist"] .lego-block-wrapper.assembled .lego-block.salient {
  background: #ffffff;
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.12),
              0 8px 24px rgba(44, 38, 34, 0.08);
  animation: none;
}

/* M-LEGO stubs for mist theme */
:root[data-theme="mist"] .tile-target.has-components .comp + .comp::before,
:root[data-theme="mist"] .tile-target.has-components .comp + .comp::after,
:root[data-theme="mist"] .lego-block.has-components .comp + .comp::before,
:root[data-theme="mist"] .lego-block.has-components .comp + .comp::after {
  background: rgba(44, 38, 34, 0.15);
}

/* Single tile mist overrides */
:root[data-theme="mist"] .tile-target {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.22);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10),
              0 8px 20px rgba(44, 38, 34, 0.06);
  backdrop-filter: none;
}
:root[data-theme="mist"] .tile-target .comp {
  color: var(--text-primary);
}
:root[data-theme="mist"] .tile-known,
:root[data-theme="mist"] .tile-known-comp,
:root[data-theme="mist"] .block-known,
:root[data-theme="mist"] .block-known-comp {
  color: var(--text-muted);
}
:root[data-theme="mist"] .lego-tile.salient .tile-target {
  border-color: rgba(0, 0, 0, 0.22);
  background: #ffffff;
}
:root[data-theme="mist"] .lego-tile.salient.assembled .tile-target {
  animation: none;
}
</style>
