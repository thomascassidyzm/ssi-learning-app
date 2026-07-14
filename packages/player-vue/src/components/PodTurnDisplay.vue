<!--
  PodTurnDisplay.vue — always-visible whole-turn display for main-flow
  Listening Pod moments (2026-07-14, Tom + Aran founders' decision).

  Replaces Stage-0's AUDIO breakdown ladder. Shows the WHOLE dialogue turn
  currently in play (one or more glued sentences — see @ssi/core/pods'
  podTurns.ts), each sentence rendered as a LEGO-tile breakdown via
  LegoAssembly (the SAME engine the main speaking cycle's intro/debut tiles
  use) — one tile per atom_map entry, its known-language gloss always shown
  beneath, in target-sentence order: "the visuals betray the target
  language grammar". The sentence currently sounding gets an `is-active`
  glow; the rest of the turn sits dimmed. No reveal-gating (no VOICE_2 rule —
  that governs the SPEAKING cycle, not pod listening; matches how Dialogues
  mode's teleprompter already shows text unconditionally).

  A sentence with no atom_map renders as one plain tile (LegoAssembly's
  existing single-block fallback) — never a missing display.
-->
<script setup lang="ts">
import { computed } from 'vue'
import LegoAssembly from './LegoAssembly.vue'
import type { LegoBlock } from './LegoAssembly.vue'
import type { PodSentenceRow } from '../composables/usePodLapScheduler'

const props = defineProps<{
  /** The current turn's sentences, in order (from turnSpanForIndex). */
  sentences: PodSentenceRow[]
  /** Index into `sentences` of the one currently sounding. Null → none lit
   *  yet (e.g. during the intro bookend, before the first sentence play). */
  activeIndex: number | null
  targetLang?: string
  showRomanization?: boolean
}>()

/** One LegoBlock per atom_map entry (spoken kinds only), in target-sentence
 *  order — the flat breakdown IS the tile row. No atom_map → a single block
 *  holding the whole sentence (LegoAssembly's normal single-tile fallback). */
function blocksFor(sentence: PodSentenceRow): LegoBlock[] {
  const atoms = (sentence.atom_map || []).filter((e) => e.kind === 'atom' || e.kind === 'passthrough')
  const key = sentence.sentence_id || String(sentence.global_order)
  if (atoms.length === 0) {
    return [{ id: key, targetText: sentence.target_text, knownText: sentence.known_text }]
  }
  return atoms.map((a, i) => ({
    id: `${key}:a${i}`,
    targetText: a.target_surface,
    knownText: a.gloss,
  }))
}

const rows = computed(() =>
  props.sentences.map((sentence, i) => ({
    sentence,
    blocks: blocksFor(sentence),
    isActive: i === props.activeIndex,
  })),
)
</script>

<template>
  <div class="pod-turn-display">
    <div
      v-for="row in rows"
      :key="row.sentence.sentence_id || row.sentence.global_order"
      class="pod-turn-row"
      :class="{ 'is-active': row.isActive }"
    >
      <div class="pod-turn-tiles">
        <LegoAssembly
          :blocks="row.blocks"
          phase="voice2"
          cycle-type="debut"
          :target-lang="targetLang"
          :show-romanization="showRomanization"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pod-turn-display {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding: calc(env(safe-area-inset-top, 0px) + 90px) 1rem calc(env(safe-area-inset-bottom, 0px) + 110px);
  pointer-events: none;
  z-index: 3;
  overflow: hidden;
}

.pod-turn-row {
  display: flex;
  justify-content: center;
  width: 100%;
  opacity: 0.45;
  transform: scale(0.96);
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.pod-turn-row.is-active {
  opacity: 1;
  transform: scale(1);
}

.pod-turn-tiles {
  position: relative;
  width: 100%;
  min-height: 3.5rem;
}

/* LegoAssembly is normally a full-screen absolute overlay (it's the ONLY
   thing on screen during the main speaking cycle). Reused here as one row
   among several stacked turn sentences, so its root is repositioned to flow
   inline instead of covering the viewport. Everything else — tiling,
   component alignment, hyphenation, CJK/RTL handling — is untouched. */
.pod-turn-tiles :deep(.lego-assembly) {
  position: static;
  inset: auto;
  padding: 0;
  flex-wrap: wrap;
  justify-content: center;
}
</style>
