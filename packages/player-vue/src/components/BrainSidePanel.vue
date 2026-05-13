<script setup lang="ts">
/**
 * Side panel for the brain view. Slides in from the right when a node
 * is tapped. Shows the word/phrase, translation, audio buttons, where
 * it was first learned, sentences the learner can now make with it,
 * and chips for other words it connects to.
 *
 * Vocabulary rule: nothing says "lego", "seed" or "round" out here.
 * We translate at the boundary — `node.legoId` becomes the audio path
 * and a server filter, never something the learner sees.
 */
import { computed, ref, watch, inject, type Ref } from 'vue'
import type { NetworkNode } from '../types/brainNetwork'

interface ConnectedLego {
  legoId: string
  text: string
}

interface PracticePhraseRow {
  target_text: string
  position?: number | null
}

const props = defineProps<{
  node: NetworkNode | null
  beltName: string
  /** Words/phrases the parent has resolved as neighbours in the network. */
  connectedLegos?: ConnectedLego[]
  /** Optional course code so the side panel can query the correct phrases. */
  courseCode?: string
}>()

const emit = defineEmits<{
  close: []
  nodeFocus: [legoId: string]
}>()

// Injected supabase client — same pattern as BrowseScreen/LearningPlayer.
const supabaseRef = inject<Ref<any> | any>('supabase', null)
const getClient = () => {
  const r: any = supabaseRef
  if (!r) return null
  if (typeof r === 'object' && 'value' in r) return r.value ?? null
  return r
}

// Audio — reuse a single Audio element so iOS doesn't lose its gesture
// unlock between taps. Matches the rule in CLAUDE.md.
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

const playVoice = async (voice: 1 | 2) => {
  if (!props.node) return
  // The contract gives us node.audioId for voice 1; voice 2 needs the
  // target2 audio. We don't have it on the contract directly, so we
  // look it up via the practice-phrases query result (debut row, which
  // carries the LEGO's own canonical audio). For now, fall back to the
  // voice-1 audio if voice 2 isn't independently available.
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
    console.warn('[BrainSidePanel] audio play failed', err)
  }
}

// "Sentences you can make" — practice phrases for this LEGO. The
// course_practice_phrases table has no components[] column (that lives
// on course_legos), so the simplest reliable signal is: phrases where
// seed_number + lego_index equal this LEGO. Those are the phrases the
// learner has been taught to say with it.
const phrases = ref<PracticePhraseRow[]>([])
const phrasesLoading = ref(false)
const phrasesError = ref<string | null>(null)
const showAllPhrases = ref(false)
const voice2AudioId = ref<string | null>(null)

const parseLegoId = (legoId: string): { seedNumber: number; legoIndex: number } | null => {
  const match = legoId.match(/^S(\d+)L(\d+)$/)
  if (!match) return null
  return { seedNumber: parseInt(match[1]!, 10), legoIndex: parseInt(match[2]!, 10) }
}

const loadPhrases = async (node: NetworkNode) => {
  const client = getClient()
  if (!client || !props.courseCode) {
    phrases.value = []
    voice2AudioId.value = null
    return
  }
  const parsed = parseLegoId(node.legoId)
  if (!parsed) {
    phrases.value = []
    voice2AudioId.value = null
    return
  }

  phrasesLoading.value = true
  phrasesError.value = null
  try {
    const { data, error } = await client
      .from('course_practice_phrases')
      .select('target_text, position, target2_audio_id')
      .eq('course_code', props.courseCode)
      .eq('seed_number', parsed.seedNumber)
      .eq('lego_index', parsed.legoIndex)
      .order('position', { ascending: true })
      .limit(20)

    if (error) throw error

    const rows = (data ?? []) as Array<PracticePhraseRow & { target2_audio_id?: string | null }>
    // Pick a voice-2 sample (debut row is position 1) for the second
    // audio button. Falls back to whichever row has a target2 id.
    const debut = rows.find(r => r.position === 1 && r.target2_audio_id)
      ?? rows.find(r => !!r.target2_audio_id)
    voice2AudioId.value = debut?.target2_audio_id ?? null

    // Skip position-0 component rows from the learner-visible list —
    // those aren't "sentences they can make", they're sub-pieces.
    phrases.value = rows.filter(r => (r.position ?? 0) > 0)
  } catch (err) {
    console.warn('[BrainSidePanel] failed to load phrases', err)
    phrasesError.value = 'Could not load sentences right now.'
    phrases.value = []
    voice2AudioId.value = null
  } finally {
    phrasesLoading.value = false
  }
}

const visiblePhrases = computed(() => {
  if (showAllPhrases.value) return phrases.value
  return phrases.value.slice(0, 5)
})

const remainingPhraseCount = computed(() =>
  Math.max(0, phrases.value.length - visiblePhrases.value.length),
)

// Reload phrases + reset state whenever the focused node changes.
watch(
  () => props.node?.legoId,
  (legoId) => {
    showAllPhrases.value = false
    playingVoice.value = null
    if (audioEl.value) {
      try { audioEl.value.pause() } catch { /* ignore */ }
    }
    if (props.node && legoId) {
      void loadPhrases(props.node)
    } else {
      phrases.value = []
      voice2AudioId.value = null
    }
  },
  { immediate: true },
)

const handleClose = () => {
  if (audioEl.value) {
    try { audioEl.value.pause() } catch { /* ignore */ }
  }
  playingVoice.value = null
  emit('close')
}

const handleChipTap = (legoId: string) => {
  emit('nodeFocus', legoId)
}

const connections = computed<ConnectedLego[]>(() => props.connectedLegos ?? [])

const targetTextStyle = computed(() => {
  if (!props.node) return {}
  return { color: 'var(--belt-color, var(--text-primary))' }
})

const beltCssVars = computed(() => {
  // The brain view's parent sets --belt-color from the focused node's
  // beltIndex; we just propagate. Provide a safe default so the panel
  // still looks right when it's previewed in isolation.
  return {
    '--belt-color': 'var(--belt-color, #2c2622)',
  } as Record<string, string>
})
</script>

<template>
  <Transition name="brain-side-panel">
    <aside
      v-if="node"
      class="brain-side-panel"
      :style="beltCssVars"
      role="dialog"
      aria-label="Word details"
    >
      <header class="bsp-header">
        <button
          class="bsp-close"
          type="button"
          aria-label="Close"
          @click="handleClose"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div class="bsp-body">
        <!-- Target word/phrase + translation -->
        <section class="bsp-headline">
          <h2 class="bsp-target" :style="targetTextStyle">{{ node.text }}</h2>
          <p class="bsp-known">{{ node.knownText }}</p>
        </section>

        <!-- Audio buttons -->
        <section class="bsp-audio">
          <button
            class="bsp-voice-btn"
            :class="{ 'is-playing': playingVoice === 1 }"
            type="button"
            :aria-label="`Play voice 1: ${node.text}`"
            @click="playVoice(1)"
          >
            <svg class="bsp-voice-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>voice 1</span>
          </button>
          <button
            class="bsp-voice-btn"
            :class="{ 'is-playing': playingVoice === 2 }"
            :disabled="!voice2AudioId"
            type="button"
            :aria-label="`Play voice 2: ${node.text}`"
            @click="playVoice(2)"
          >
            <svg class="bsp-voice-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>voice 2</span>
          </button>
        </section>

        <!-- Belt provenance -->
        <p class="bsp-belt-note">
          First learned at
          <strong class="bsp-belt-name">{{ beltName }}</strong>
        </p>

        <!-- Sentences you can make -->
        <section class="bsp-section">
          <h3 class="bsp-section-title">Sentences you can make</h3>

          <div v-if="phrasesLoading" class="bsp-loading">…</div>

          <div v-else-if="phrasesError" class="bsp-empty">
            {{ phrasesError }}
          </div>

          <div v-else-if="phrases.length === 0" class="bsp-empty">
            More sentences will appear as you keep practising.
          </div>

          <ul v-else class="bsp-phrases">
            <li
              v-for="(phrase, idx) in visiblePhrases"
              :key="`${idx}-${phrase.target_text}`"
              class="bsp-phrase"
            >
              <span class="bsp-phrase-dot" aria-hidden="true" />
              <span class="bsp-phrase-text">{{ phrase.target_text }}</span>
            </li>
            <li v-if="remainingPhraseCount > 0" class="bsp-phrase-more">
              <button
                type="button"
                class="bsp-show-all"
                @click="showAllPhrases = true"
              >
                + {{ remainingPhraseCount }} more
              </button>
            </li>
          </ul>
        </section>

        <!-- Connects with -->
        <section v-if="connections.length > 0" class="bsp-section">
          <h3 class="bsp-section-title">Connects with</h3>
          <div class="bsp-chips">
            <button
              v-for="chip in connections"
              :key="chip.legoId"
              type="button"
              class="bsp-chip"
              @click="handleChipTap(chip.legoId)"
            >
              {{ chip.text }}
            </button>
          </div>
        </section>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.brain-side-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(380px, 100vw);
  z-index: 220;

  display: flex;
  flex-direction: column;

  background: #ffffff;
  border-left: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow:
    0 1px 3px rgba(44, 38, 34, 0.14),
    0 8px 24px rgba(44, 38, 34, 0.18),
    -24px 0 64px rgba(44, 38, 34, 0.10);

  color: #2c2622;
  font-family: var(--font-body);

  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.bsp-header {
  display: flex;
  justify-content: flex-end;
  padding: 0.75rem 0.75rem 0;
}

.bsp-close {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.20);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(44, 38, 34, 0.7);
  transition: all 0.18s ease;
}

.bsp-close:hover {
  color: #2c2622;
  border-color: rgba(0, 0, 0, 0.35);
}

.bsp-close svg {
  width: 18px;
  height: 18px;
}

.bsp-body {
  overflow-y: auto;
  padding: 0.5rem 1.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Headline */
.bsp-headline {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.bsp-target {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
  /* color comes from inline style — belt-tinted */
}

.bsp-known {
  margin: 0;
  font-size: 1rem;
  color: rgba(44, 38, 34, 0.55);
  line-height: 1.3;
}

/* Audio buttons */
.bsp-audio {
  display: flex;
  gap: 0.5rem;
}

.bsp-voice-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  color: #2c2622;
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.20);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.18s ease;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.06);
}

.bsp-voice-btn:hover:not(:disabled) {
  border-color: rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.10);
}

.bsp-voice-btn:active:not(:disabled) {
  transform: translateY(0);
}

.bsp-voice-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bsp-voice-btn.is-playing {
  border-color: var(--belt-color, rgba(0, 0, 0, 0.35));
  color: var(--belt-color, #2c2622);
  background: color-mix(in srgb, var(--belt-color, #ffffff) 8%, #ffffff);
}

.bsp-voice-icon {
  width: 14px;
  height: 14px;
}

/* Belt note */
.bsp-belt-note {
  margin: 0;
  font-size: 0.875rem;
  color: rgba(44, 38, 34, 0.6);
}

.bsp-belt-name {
  font-weight: 600;
  color: var(--belt-color, #2c2622);
  text-transform: capitalize;
}

/* Sections */
.bsp-section {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.bsp-section-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(44, 38, 34, 0.55);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.bsp-loading,
.bsp-empty {
  font-size: 0.875rem;
  color: rgba(44, 38, 34, 0.45);
}

/* Phrases list */
.bsp-phrases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.bsp-phrase {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  font-size: 0.9375rem;
  line-height: 1.4;
  color: #2c2622;
}

.bsp-phrase-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--belt-color, rgba(44, 38, 34, 0.4));
  transform: translateY(2px);
}

.bsp-phrase-text {
  flex: 1;
}

.bsp-phrase-more {
  list-style: none;
  padding-left: 1rem;
}

.bsp-show-all {
  background: none;
  border: none;
  padding: 0.25rem 0;
  font-family: inherit;
  font-size: 0.8125rem;
  color: rgba(44, 38, 34, 0.6);
  cursor: pointer;
  text-decoration: underline;
}

.bsp-show-all:hover {
  color: #2c2622;
}

/* Chips */
.bsp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.bsp-chip {
  padding: 0.4rem 0.75rem;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #2c2622;
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.20);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.18s ease;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.06);
}

.bsp-chip:hover {
  border-color: var(--belt-color, rgba(0, 0, 0, 0.35));
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.10);
}

.bsp-chip:active {
  transform: translateY(0);
}

/* Slide-in animation */
.brain-side-panel-enter-active,
.brain-side-panel-leave-active {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.22s ease;
}

.brain-side-panel-enter-from,
.brain-side-panel-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* Full-bleed on phones */
@media (max-width: 540px) {
  .brain-side-panel {
    width: 100vw;
    border-left: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .brain-side-panel-enter-active,
  .brain-side-panel-leave-active {
    transition: none;
  }
}
</style>
