<script setup lang="ts">
/**
 * BrainNodeChip — tiny floating tag for the focused brain node.
 *
 * Replaces the v1 side panel. Shows ONLY the target text + two voice
 * buttons. No L1, no translation, no "sentences you can make", no
 * "connects with" chips. The visualisation is the artefact; the chip
 * is the audio handle and nothing more.
 *
 * Position: parent passes `screenX`/`screenY` from BrainView's
 * `nodeTap` event. The chip nudges itself off the node so it doesn't
 * cover the dot.
 *
 * Dismiss: parent watches for taps outside the chip (the chip's own
 * close button is sufficient for keyboard / desktop). The chip emits
 * `close` and the parent clears the focused node.
 *
 * Audio: single reusable Audio element (same iOS gesture-unlock rule
 * as BrainSidePanel had). Voice 1 uses `node.audioId` directly. Voice
 * 2 is resolved on open via a tiny `course_practice_phrases` lookup
 * for the LEGO's debut row; the button stays disabled until/unless
 * we find a `target2_audio_id`.
 */
import { computed, inject, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { NetworkNode } from '../types/brainNetwork'

const props = defineProps<{
  node: NetworkNode | null
  /** Viewport-relative screen coordinate of the focused node, in pixels. */
  screenX: number
  screenY: number
  /** Optional course code so we can resolve voice 2 audio. */
  courseCode?: string
}>()

const emit = defineEmits<{
  close: []
}>()

// ---- Audio: single reusable element (iOS gesture-unlock rule) ----------------

const audioEl = ref<HTMLAudioElement | null>(null)
const playingVoice = ref<1 | 2 | null>(null)

const ensureAudio = (): HTMLAudioElement => {
  if (!audioEl.value) {
    const el = new Audio()
    el.addEventListener('ended', () => { playingVoice.value = null })
    el.addEventListener('error', () => { playingVoice.value = null })
    audioEl.value = el
  }
  return audioEl.value
}

const stopAudio = () => {
  playingVoice.value = null
  if (audioEl.value) {
    try { audioEl.value.pause() } catch { /* ignore */ }
  }
}

// ---- Voice 2 resolution (lazy, on chip open) ---------------------------------

const supabaseRef = inject<Ref<unknown> | unknown>('supabase', null)
const getClient = (): { from: (t: string) => unknown } | null => {
  const r = supabaseRef as { value?: unknown } | unknown
  const client = r && typeof r === 'object' && 'value' in (r as object)
    ? (r as { value: unknown }).value
    : r
  return (client && typeof client === 'object' && 'from' in (client as object))
    ? (client as { from: (t: string) => unknown })
    : null
}

const voice2AudioId = ref<string | null>(null)

const parseLegoId = (legoId: string): { seedNumber: number; legoIndex: number } | null => {
  const match = legoId.match(/^S(\d+)L(\d+)$/)
  if (!match) return null
  return { seedNumber: parseInt(match[1]!, 10), legoIndex: parseInt(match[2]!, 10) }
}

const loadVoice2 = async (node: NetworkNode) => {
  voice2AudioId.value = null
  const client = getClient()
  if (!client || !props.courseCode) return
  const parsed = parseLegoId(node.legoId)
  if (!parsed) return

  try {
    const builder = (client.from('course_practice_phrases') as {
      select: (s: string) => {
        eq: (k: string, v: unknown) => {
          eq: (k: string, v: unknown) => {
            eq: (k: string, v: unknown) => {
              order: (k: string, opts: { ascending: boolean }) => {
                limit: (n: number) => Promise<{
                  data: Array<{ target2_audio_id: string | null; position: number | null }> | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      }
    })
      .select('target2_audio_id, position')
      .eq('course_code', props.courseCode)
      .eq('seed_number', parsed.seedNumber)
      .eq('lego_index', parsed.legoIndex)
      .order('position', { ascending: true })
      .limit(5)

    const { data, error } = await builder
    if (error) {
      console.warn('[BrainNodeChip] voice2 lookup failed:', error.message)
      return
    }
    const rows = data ?? []
    const debut = rows.find(r => r.position === 1 && r.target2_audio_id)
      ?? rows.find(r => !!r.target2_audio_id)
    voice2AudioId.value = debut?.target2_audio_id ?? null
  } catch (err) {
    console.warn('[BrainNodeChip] voice2 lookup error', err)
  }
}

// ---- Playback ----------------------------------------------------------------

const playVoice = async (voice: 1 | 2) => {
  if (!props.node) return
  const audioId = voice === 2 && voice2AudioId.value
    ? voice2AudioId.value
    : props.node.audioId
  if (!audioId) return

  try {
    const el = ensureAudio()
    el.src = `/api/audio/${audioId}${props.courseCode ? `?courseId=${encodeURIComponent(props.courseCode)}` : ''}`
    playingVoice.value = voice
    await el.play()
  } catch (err) {
    playingVoice.value = null
    console.warn('[BrainNodeChip] audio play failed', err)
  }
}

const handleClose = () => {
  stopAudio()
  emit('close')
}

// ---- Watch focused node: stop any audio, refresh voice2 ----------------------

watch(
  () => props.node?.legoId,
  (legoId) => {
    stopAudio()
    voice2AudioId.value = null
    if (props.node && legoId) {
      void loadVoice2(props.node)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopAudio()
})

// ---- Positioning -------------------------------------------------------------

// Chip is anchored above and slightly to the right of the focused node so the
// dot stays visible. The transform handles centring horizontally. CSS clamps
// keep it inside the viewport for edge nodes.
const chipStyle = computed(() => {
  if (!props.node) return { display: 'none' }
  return {
    left: `${props.screenX}px`,
    top: `${props.screenY}px`,
    '--belt-color': `var(--belt-${props.node.beltIndex}-color, #2c2622)`,
  } as Record<string, string>
})

const targetTextStyle = computed(() => {
  if (!props.node) return {}
  return { color: 'var(--belt-color, var(--text-primary, #2c2622))' }
})
</script>

<template>
  <Transition name="brain-chip">
    <aside
      v-if="node"
      class="brain-chip"
      :style="chipStyle"
      role="dialog"
      aria-label="Word details"
    >
      <button
        class="brain-chip-close"
        type="button"
        aria-label="Close"
        @click="handleClose"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      <h2 class="brain-chip-target" :style="targetTextStyle">{{ node.text }}</h2>

      <div class="brain-chip-audio">
        <button
          class="brain-chip-voice-btn"
          :class="{ 'is-playing': playingVoice === 1 }"
          type="button"
          :aria-label="`Play voice 1: ${node.text}`"
          @click="playVoice(1)"
        >
          <svg class="brain-chip-voice-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          <span>voice 1</span>
        </button>
        <button
          class="brain-chip-voice-btn"
          :class="{ 'is-playing': playingVoice === 2 }"
          :disabled="!voice2AudioId"
          type="button"
          :aria-label="`Play voice 2: ${node.text}`"
          @click="playVoice(2)"
        >
          <svg class="brain-chip-voice-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          <span>voice 2</span>
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.brain-chip {
  position: fixed;
  z-index: 230;
  /* Anchor point is screenX/screenY; transform lifts the chip above the
     node and centres it horizontally. */
  transform: translate(-50%, calc(-100% - 16px));

  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;

  min-width: 160px;
  max-width: min(280px, calc(100vw - 24px));
  padding: 0.625rem 0.75rem 0.75rem;

  background: rgba(20, 20, 28, 0.92);
  color: #e8e4df;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow:
    0 4px 18px rgba(0, 0, 0, 0.45),
    0 1px 3px rgba(0, 0, 0, 0.35);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);

  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  /* Hover/tap-outside dismissal is owned by the parent; the chip itself
     ignores pointer events on its tail so a precise tap on the node
     dispatches to the canvas, not the chip. */
}

/* Little tail pointing at the node */
.brain-chip::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 12px;
  height: 12px;
  background: rgba(20, 20, 28, 0.92);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  transform: translateX(-50%) rotate(45deg);
}

.brain-chip-close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: rgba(232, 228, 223, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s, background 0.15s;
}

.brain-chip-close:hover {
  color: #e8e4df;
  background: rgba(255, 255, 255, 0.06);
}

.brain-chip-close svg {
  width: 12px;
  height: 12px;
}

.brain-chip-target {
  margin: 0;
  padding-right: 18px;
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  /* color comes from inline style — belt-tinted */
  word-break: break-word;
}

.brain-chip-audio {
  display: flex;
  gap: 0.375rem;
}

.brain-chip-voice-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.4rem 0.5rem;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  color: #e8e4df;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.brain-chip-voice-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.18);
}

.brain-chip-voice-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.brain-chip-voice-btn.is-playing {
  color: var(--belt-color, #fcd34d);
  border-color: var(--belt-color, rgba(255, 255, 255, 0.18));
  background: color-mix(in srgb, var(--belt-color, #ffffff) 12%, transparent);
}

.brain-chip-voice-icon {
  width: 10px;
  height: 10px;
}

/* Enter/leave transition */
.brain-chip-enter-active,
.brain-chip-leave-active {
  transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}

.brain-chip-enter-from,
.brain-chip-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% - 8px)) scale(0.95);
}

.brain-chip-enter-to,
.brain-chip-leave-from {
  opacity: 1;
  transform: translate(-50%, calc(-100% - 16px)) scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .brain-chip-enter-active,
  .brain-chip-leave-active {
    transition: none;
  }
}
</style>
