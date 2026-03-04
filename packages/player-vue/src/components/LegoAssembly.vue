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
  voice1DurationMs?: number
  components?: ComponentBreakdown[]
}>()

// Detect M-LEGO: multiple components on the salient block or in props
// Falls back to word-aligned synthesis when known/target have matching word counts
const mLegoComponents = computed(() => {
  if (props.components && props.components.length > 1) return props.components
  // Check if any block has components
  for (const b of props.blocks) {
    if (b.components && b.components.length > 1) return b.components
  }
  // Single-tile intro/debut: synthesize word-aligned components
  if (props.blocks.length === 1) {
    const block = props.blocks[0]
    const known = block.knownText
      || (props.components?.length === 1 ? props.components[0].known : '')
    const target = block.targetText
    if (known && target) {
      const targetWords = target.trim().split(/\s+/)
      const knownWords = known.trim().split(/\s+/)
      if (targetWords.length > 1 && knownWords.length === targetWords.length) {
        return targetWords.map((t, i) => ({ known: knownWords[i], target: t }))
      }
    }
  }
  return null
})

// Map UI phases to assembly phases.
// Tiles appear at VOICE_1 (with short delay so learner hears before reading).
// On stop/hidden, tiles vanish instantly (no fade) to stay in sync with audio.
const revealDelayMs = computed(() => Math.max(1500, (props.voice1DurationMs || 2000) * 0.7))
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
      }, revealDelayMs.value)
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


// Carriage mode: long M-LEGOs (4+ components) render as groups of up to 3,
// each group is a mini M-LEGO tile with internal stubs, groups linked externally
const carriageGroups = computed(() => {
  if (props.blocks.length !== 1) return null
  if (!mLegoComponents.value || mLegoComponents.value.length <= 3) return null
  const comps = mLegoComponents.value
  const groups: ComponentBreakdown[][] = []
  for (let i = 0; i < comps.length; i += 3) {
    groups.push(comps.slice(i, i + 3))
  }
  return groups
})

// RTL detection — Arabic, Hebrew, and related scripts
const RTL_RE = /[\u0600-\u06FF\u0590-\u05FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/
const isRTL = computed(() => {
  const text = props.blocks[0]?.targetText || ''
  return RTL_RE.test(text)
})

// Uniform sentence-level scaling: all tiles in a phrase scale together
const sentenceScale = computed(() => {
  if (props.blocks.length <= 1) return 1
  const totalChars = props.blocks.reduce((sum, b) => sum + b.targetText.length, 0)
  if (totalChars <= 20) return 1
  return Math.max(0.65, 1 - (totalChars - 20) * 0.008)
})
</script>

<template>
  <div class="lego-assembly" :class="[assemblyPhase, { 'instant-hide': instantHide }]" :style="{ '--sentence-scale': sentenceScale, direction: isRTL ? 'rtl' : 'ltr' }">

    <!-- ═══════════════════════════════════════════
         CARRIAGE MODE — long M-LEGO as groups of up to 3 components
         Each group is a mini tile with internal stubs, groups linked externally
         ═══════════════════════════════════════════ -->
    <div
      v-if="carriageGroups"
      class="lego-tile"
      :class="[assemblyPhase, { salient: blocks[0]?.isSalient }]"
      :style="{ '--assemble-duration': assembleDuration, '--stagger-delay': '0s' }"
    >
      <div class="carriage-track">
        <div
          v-for="(group, gi) in carriageGroups"
          :key="gi"
          class="carriage-wagon"
        >
          <div
            class="carriage-cell"
            :class="{ 'has-components': group.length > 1 }"
            :style="{ '--char-count': group.reduce((s, c) => s + c.target.length, 0) }"
          >
            <span v-for="(comp, ci) in group" :key="ci" class="comp">{{ comp.target }}</span>
          </div>
          <div v-if="group.some(c => c.known)" class="carriage-known-row">
            <span
              v-for="(comp, ci) in group"
              :key="ci"
              class="carriage-known-comp"
            >{{ comp.known || '' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         SINGLE TILE MODE — M-LEGO (with stubs) or A-LEGO
         Used for intro/debut: shows known text underneath
         ═══════════════════════════════════════════ -->
    <div
      v-else-if="blocks.length === 1 && (components || blocks[0]?.components)"
      class="lego-tile"
      :class="[assemblyPhase, { salient: blocks[0]?.isSalient }]"
      :style="{
        '--assemble-duration': assembleDuration,
        '--stagger-delay': '0s',
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
      <div v-if="mLegoComponents && mLegoComponents.some(c => c.known)" class="tile-known-row">
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
            '--stagger-delay': staggerDelay(index),
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
          <div v-if="block.components && block.components.length > 1 && block.components.some(c => c.known)" class="block-known-row">
            <span
              v-for="(comp, ci) in block.components"
              :key="ci"
              class="block-known-comp"
            >{{ comp.known || '·' }}</span>
          </div>
          <span v-else-if="block.knownText" class="block-known">{{ block.knownText }}</span>
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
  padding: calc(var(--hero-pane-bottom, 250px) + 16px) 0.75rem calc(var(--nav-total, 100px) + 10px);
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
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.20);
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
  width: 1.5px;
  height: 35%;
  background: rgba(255, 255, 255, 0.4);
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
  font-size: 0.9rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.6);
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
  font-size: 0.9rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  text-align: center;
  /* Match target comp padding so widths stay in sync */
  padding: 0 0.35em;
}

/* Salient (intro/debut) — neutral glow, consistent across phases */
.lego-tile.salient .tile-target {
  border-color: rgba(255, 255, 255, 0.3);
  border-width: 2px;
  background: rgba(255, 255, 255, 0.15);
  box-shadow:
    0 0 20px 5px rgba(255, 255, 255, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

/* ═══════════════════════════════════════════════════════════════
   CARRIAGE MODE — long M-LEGO as groups of ≤3, linked externally
   ═══════════════════════════════════════════════════════════════ */
.carriage-track {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  column-gap: 10px;
  row-gap: 10px;
}

.carriage-wagon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
}

/* External hyphen connector between wagon groups */
.carriage-wagon + .carriage-wagon::before {
  content: '';
  position: absolute;
  left: -7px;
  top: 1.2em;
  width: 4px;
  height: 2px;
  background: rgba(255, 255, 255, 0.4);
}

/* Each group is a mini M-LEGO tile (reuses stub styling via .has-components .comp) */
.carriage-cell {
  display: inline-flex;
  align-items: center;
  padding: 0.5em 0.9em;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.20);
  position: relative;
}

.carriage-cell .comp {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: clamp(1.1rem, calc(2rem - var(--char-count, 8) * 0.035rem), 1.7rem);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: 0.02em;
  position: relative;
  padding: 0 0.3em;
  white-space: nowrap;
}

/* Internal stubs within each carriage group (same pattern as tile-target) */
.carriage-cell.has-components .comp + .comp::before,
.carriage-cell.has-components .comp + .comp::after {
  content: '';
  position: absolute;
  left: 0;
  width: 1.5px;
  height: 35%;
  background: rgba(255, 255, 255, 0.4);
  z-index: 2;
  pointer-events: none;
}
.carriage-cell.has-components .comp + .comp::before {
  top: 0;
}
.carriage-cell.has-components .comp + .comp::after {
  bottom: 0;
}

/* Known text row per group, aligned per component */
.carriage-known-row {
  display: inline-flex;
  align-items: baseline;
  padding: 0 0.9em;
}
.carriage-known-comp {
  font-family: var(--font-body, system-ui);
  font-size: 0.85rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  text-align: center;
  padding: 0 0.3em;
}

/* Salient carriage styling — consistent across phases */
.lego-tile.salient .carriage-cell {
  border-color: rgba(255, 255, 255, 0.3);
  border-width: 2px;
  background: rgba(255, 255, 255, 0.15);
  box-shadow:
    0 0 12px 2px rgba(255, 255, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.lego-tile.salient .carriage-wagon + .carriage-wagon::before {
  background: rgba(255, 255, 255, 0.55);
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
  transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1.0);
  will-change: transform, opacity;
}

/* The visual tile */
.lego-block {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  padding: calc(0.6em * var(--sentence-scale, 1)) calc(1.1em * var(--sentence-scale, 1));
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow:
    0 0 12px 2px rgba(255, 255, 255, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  max-width: calc(100vw - 3rem);
  overflow: hidden;
  position: relative;
}

/* Known text under each practice block (A-LEGO) */
.block-known {
  font-family: var(--font-body, system-ui);
  font-size: 0.85rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  text-align: center;
  max-width: calc(100vw - 3rem);
  overflow: hidden;
  text-overflow: ellipsis;
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
  font-size: 0.85rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  text-align: center;
  /* Match target comp padding for alignment */
  padding: 0 0.35em;
}

.lego-block .block-text {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: calc(clamp(1.1rem, calc(2.2rem - var(--char-count, 8) * 0.035rem), 1.875rem) * var(--sentence-scale, 1));
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
  width: 1.5px;
  height: 35%;
  background: rgba(255, 255, 255, 0.4);
  z-index: 2;
  pointer-events: none;
}
.lego-block.has-components .comp + .comp::before {
  top: 0;
}
.lego-block.has-components .comp + .comp::after {
  bottom: 0;
}

/* --- ASSEMBLING (sequential reveal in reading order) --- */
.lego-block-wrapper.assembling {
  animation: block-reveal 0.6s cubic-bezier(0.25, 0.1, 0.25, 1.0) var(--stagger-delay, 0s) both;
}

/* --- ASSEMBLED (static, no style change from base) --- */
.lego-block-wrapper.assembled {
  opacity: 1;
  transform: translateY(0);
}

/* --- SALIENT LEGO (newly introduced) --- */
.lego-block.salient {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
  border-width: 2px;
  padding: calc(0.7em * var(--sentence-scale, 1)) calc(1.3em * var(--sentence-scale, 1));
  box-shadow:
    0 0 14px 3px rgba(255, 255, 255, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.lego-block.salient .block-text {
  color: rgba(255, 255, 255, 1);
  font-weight: 600;
  font-size: calc(clamp(1.1rem, calc(2.3rem - var(--char-count, 8) * 0.035rem), 2.125rem) * var(--sentence-scale, 1));
}

/* --- HIDDEN --- */
.lego-block-wrapper.hidden {
  opacity: 0;
  transform: translateY(6px);
  transition-duration: 0.3s;
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
@keyframes block-reveal {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes tile-arrive {
  0% { transform: scale(0.85); opacity: 0; }
  70% { transform: scale(1.03); opacity: 1; }
  85% { transform: scale(0.98); }
  100% { transform: scale(1); }
}

/* ═══════════════════════════════════════════════════════════════
   MOBILE
   ═══════════════════════════════════════════════════════════════ */
@media (max-width: 600px) {
  .lego-block .block-text {
    font-size: calc(clamp(1rem, calc(1.9rem - var(--char-count, 8) * 0.03rem), 1.625rem) * var(--sentence-scale, 1));
  }
  .lego-block {
    padding: calc(0.5em * var(--sentence-scale, 1)) calc(0.9em * var(--sentence-scale, 1));
  }
  .lego-block.salient {
    padding: calc(0.6em * var(--sentence-scale, 1)) calc(1.1em * var(--sentence-scale, 1));
  }
  .lego-block.salient .block-text {
    font-size: calc(clamp(1rem, calc(2rem - var(--char-count, 8) * 0.03rem), 1.875rem) * var(--sentence-scale, 1));
  }

  .tile-target .comp {
    font-size: clamp(1rem, calc(2rem - var(--char-count, 8) * 0.03rem), 1.75rem);
  }

  .carriage-cell {
    padding: 0.45em 0.7em;
  }
  .carriage-cell .comp {
    font-size: clamp(1rem, calc(1.7rem - var(--char-count, 8) * 0.03rem), 1.5rem);
  }
}
</style>

<!-- Mist theme overrides -->
<style>
:root[data-theme="mist"] .lego-block {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.14),
              0 8px 24px rgba(44, 38, 34, 0.10);
  backdrop-filter: none;
}

:root[data-theme="mist"] .lego-block .block-text {
  color: var(--text-primary);
}


:root[data-theme="mist"] .lego-block.salient {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.12),
              0 8px 24px rgba(44, 38, 34, 0.08);
}

:root[data-theme="mist"] .lego-block.salient .block-text {
  color: var(--text-primary);
}

/* M-LEGO stubs for mist theme */
:root[data-theme="mist"] .tile-target.has-components .comp + .comp::before,
:root[data-theme="mist"] .tile-target.has-components .comp + .comp::after,
:root[data-theme="mist"] .lego-block.has-components .comp + .comp::before,
:root[data-theme="mist"] .lego-block.has-components .comp + .comp::after {
  background: rgba(44, 38, 34, 0.2);
}

/* Single tile mist overrides */
:root[data-theme="mist"] .tile-target {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
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
  border-color: rgba(0, 0, 0, 0.35);
  background: #ffffff;
}

/* Carriage mist overrides */
:root[data-theme="mist"] .carriage-cell {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10);
  backdrop-filter: none;
}
:root[data-theme="mist"] .carriage-cell .comp {
  color: var(--text-primary);
}
:root[data-theme="mist"] .carriage-cell.has-components .comp + .comp::before,
:root[data-theme="mist"] .carriage-cell.has-components .comp + .comp::after {
  background: rgba(44, 38, 34, 0.2);
}
:root[data-theme="mist"] .carriage-wagon + .carriage-wagon::before {
  background: rgba(44, 38, 34, 0.25);
}
:root[data-theme="mist"] .carriage-known-comp {
  color: var(--text-muted);
}
:root[data-theme="mist"] .lego-tile.salient .carriage-cell {
  border-color: rgba(0, 0, 0, 0.35);
  background: #ffffff;
}
</style>
