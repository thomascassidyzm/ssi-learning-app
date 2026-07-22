<!--
  PodTurnDisplay.vue — always-visible whole-DIALOGUE display for main-flow
  Listening Pod moments (2026-07-22, product owner decision: Spotify/
  karaoke-style scrolling line display, replacing the 2026-07-14 LEGO-tile
  whole-turn ladder).

  Dialogues are linear, so the display now shows the WHOLE pod's sentence
  list scrolling — via the shared TeleprompterScroll component (the same
  pattern ListeningOverlay's Dialogues listening mode already uses): the
  currently-sounding sentence at full prominence, earlier sentences scrolled
  up and dimmed, later ones visible below at reduced opacity. Long dialogues
  never need to cram onto one screen — they scroll, they don't shrink.

  A speaker chip appears on the first sentence of each TURN (a run of
  consecutive sentences glued by `glue_to_next` — see @ssi/core/pods'
  computeTurnSpans), so a speaker's consecutive lines read as one paragraph
  rather than repeating the name on every line. Speaker colour is assigned
  in order of first appearance from the same palette ListeningOverlay uses
  (SPEAKER_PALETTE), so the colouring language matches across both surfaces.

  No reveal-gating (no VOICE_2 rule — that governs the SPEAKING cycle, not
  pod listening; matches how Dialogues mode's teleprompter already shows
  text unconditionally): the current line's known-language gloss is always
  shown alongside it.
-->
<script setup lang="ts">
import { computed } from 'vue'
import TeleprompterScroll from './TeleprompterScroll.vue'
import type { TeleprompterLine } from './TeleprompterScroll.vue'
import { computeTurnSpans } from '@ssi/core/pods'
import { SPEAKER_PALETTE } from '../composables/useListeningPods'
import type { PodSentenceRow } from '../composables/usePodLapScheduler'

const props = defineProps<{
  /** The pod's full flat sentence list, in order (podScheduler.podSentences). */
  sentences: PodSentenceRow[]
  /** Index into `sentences` of the one currently sounding. Null → none lit
   *  yet (e.g. during the intro bookend, before the first sentence play). */
  activeIndex: number | null
  /** Extra top clearance (px) to reserve while the transient pod-start
   *  reminder banner is showing, so its text never overlaps the current
   *  line regardless of dialogue length or screen size. 0 once the
   *  reminder has faded (the normal top padding already clears the app
   *  chrome). */
  reminderTopInset?: number
}>()

// A speaker chip shows only on a turn's first sentence — consecutive
// sentences from the same speaker (glued by flattenPodRows) read as one
// paragraph, matching ListeningOverlay's Dialogues teleprompter convention.
const turnStarts = computed(() => new Set(computeTurnSpans(props.sentences).map((s) => s.start)))

// Stable speaker → palette colour, assigned in order of first appearance —
// the same palette ListeningOverlay's Dialogues scenes use.
const colorForSpeaker = computed(() => {
  const map = new Map<string, string>()
  for (const s of props.sentences) {
    const key = (s.speaker || '').trim()
    if (key && !map.has(key)) map.set(key, SPEAKER_PALETTE[map.size % SPEAKER_PALETTE.length])
  }
  return map
})

const lines = computed<TeleprompterLine[]>(() =>
  props.sentences.map((s, i) => {
    const speaker = (s.speaker || '').trim()
    return {
      id: s.sentence_id || String(s.global_order),
      target: s.target_text,
      known: s.known_text,
      speakerName: turnStarts.value.has(i) ? speaker : '',
      speakerColor: speaker ? colorForSpeaker.value.get(speaker) : undefined,
    }
  }),
)

const topPadding = computed(() =>
  `calc(env(safe-area-inset-top, 0px) + ${90 + (props.reminderTopInset || 0)}px)`,
)
</script>

<template>
  <div class="pod-turn-display" :style="{ paddingTop: topPadding }">
    <TeleprompterScroll
      :lines="lines"
      :current-index="activeIndex ?? -1"
      :pad-block-vh="35"
      :anchor-fraction="0.33"
    />
  </div>
</template>

<style scoped>
.pod-turn-display {
  position: absolute;
  inset: 0;
  padding-right: 1rem;
  padding-left: 1rem;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 110px);
  transition: padding-top 0.3s ease;
  pointer-events: none;
  z-index: 3;
  overflow: hidden;
}
</style>
