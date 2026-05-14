<script setup lang="ts">
/**
 * TombolaDrawer — staggered vertical [left | LEGO | right] for one LEGO.
 *
 * Opens with the first USE phrase pre-loaded. Tap 🎲 to shuffle to a new
 * combination + auto-play the phrase audio. Tap ▶ to replay current.
 * One side may be empty (LEGO is phrase-initial or phrase-final); empty
 * slot simply doesn't render — the missing slot IS the signal.
 *
 * Layout adapts: horizontal stagger on viewports >= 480px, all-vertical
 * on narrower (still staggered visually via left/centre/right alignment).
 */
import { computed, ref, watch } from 'vue'
import { useTombolaContexts, type TombolaContext } from '../composables/useTombolaContexts'
import type { InventoryLego } from '../composables/useBrainInventory'

const props = defineProps<{
  /** Course code, e.g. 'ita_for_eng'. Reactive so closing/reopening on a
   *  different course refetches. */
  courseCode: string
  /** The focused LEGO (null = drawer hidden). */
  lego: InventoryLego | null
}>()

const emit = defineEmits<{
  close: []
}>()

const courseCodeRef = computed(() => props.courseCode)
const legoIdRef = computed(() => props.lego?.legoId ?? null)

const { contexts, isLoading } = useTombolaContexts(courseCodeRef, legoIdRef)

const currentIndex = ref(0)
const slideDir = ref<'in' | 'out'>('in')

// Reset to first context whenever the focused LEGO changes.
watch(legoIdRef, () => {
  currentIndex.value = 0
  slideDir.value = 'in'
})

// When new contexts arrive (after fetch), keep on the first one.
watch(contexts, (list) => {
  if (currentIndex.value >= list.length) currentIndex.value = 0
})

const currentContext = computed<TombolaContext | null>(() => {
  return contexts.value[currentIndex.value] || null
})

const hasContexts = computed(() => contexts.value.length > 0)
const canShuffle = computed(() => contexts.value.length > 1)

// ─── Audio ──────────────────────────────────────────────────────────
let audioEl: HTMLAudioElement | null = null
const isPlaying = ref(false)

function ensureAudio() {
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.addEventListener('ended', () => { isPlaying.value = false })
    audioEl.addEventListener('error', () => { isPlaying.value = false })
  }
  return audioEl
}

function playCurrent() {
  const ctx = currentContext.value
  if (!ctx?.audioId) return
  const audio = ensureAudio()
  audio.src = `/api/audio/${ctx.audioId}`
  isPlaying.value = true
  audio.play().catch(() => { isPlaying.value = false })
}

function stopAudio() {
  if (audioEl) {
    audioEl.pause()
    audioEl.currentTime = 0
  }
  isPlaying.value = false
}

// ─── Shuffle ────────────────────────────────────────────────────────
function shuffleToNew() {
  if (contexts.value.length <= 1) return
  const prevIndex = currentIndex.value
  // Pick a random index that's NOT the current one — so the shuffle
  // always feels like it landed somewhere new.
  let nextIndex = prevIndex
  while (nextIndex === prevIndex) {
    nextIndex = Math.floor(Math.random() * contexts.value.length)
  }
  // Brief out → in animation. We rerun the watch on currentContext via
  // toggling the dir ref.
  slideDir.value = 'out'
  setTimeout(() => {
    currentIndex.value = nextIndex
    slideDir.value = 'in'
    playCurrent()
  }, 180)
}

// Auto-play the first context on first reveal (matches "open with first
// USE phrase pre-loaded, ready to hear").
watch(currentContext, (ctx, prev) => {
  if (!ctx) return
  // Only auto-play when LEGO first becomes visible — not when we shuffle
  // (shuffle calls playCurrent itself after the slide animation lands).
  if (!prev) {
    playCurrent()
  }
})

// Clean up audio when the drawer closes (lego becomes null).
watch(() => props.lego, (lego) => {
  if (!lego) stopAudio()
})
</script>

<template>
  <Transition name="drawer">
    <div v-if="lego" class="tombola-backdrop" @click.self="emit('close')">
      <div class="tombola-card" role="dialog" aria-modal="true">
        <button class="tombola-close" type="button" aria-label="Close" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <!-- Header: known text under the LEGO so the learner has the
             anchor's meaning if they tap a word they only half-remember -->
        <header class="tombola-header">
          <div class="tombola-known">{{ lego.knownText }}</div>
        </header>

        <!-- The three slots. Empty slots simply don't render — the
             missing one signals "phrase begins / ends here". -->
        <div class="tombola-slots" :class="`slide-${slideDir}`">
          <div
            v-if="currentContext?.left"
            class="slot slot-left"
            :key="`L-${currentContext?.id}`"
          >
            {{ currentContext.left }}
          </div>

          <div class="slot slot-lego">
            {{ lego.targetText }}
          </div>

          <div
            v-if="currentContext?.right"
            class="slot slot-right"
            :key="`R-${currentContext?.id}`"
          >
            {{ currentContext.right }}
          </div>
        </div>

        <!-- Loading / empty states. Empty = the LEGO has no USE phrases
             with non-trivial left/right context (rare; LEGO appears only
             as a phrase standalone). -->
        <div v-if="isLoading && !hasContexts" class="tombola-state">
          Loading…
        </div>
        <div v-else-if="!hasContexts" class="tombola-state">
          You haven't seen this one with anything else yet.
        </div>

        <!-- Controls -->
        <div class="tombola-controls">
          <button
            class="ctrl-btn play"
            type="button"
            :disabled="!currentContext?.audioId"
            :aria-label="isPlaying ? 'Playing' : 'Play'"
            @click="playCurrent"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          </button>

          <button
            class="ctrl-btn shuffle"
            type="button"
            :disabled="!canShuffle"
            aria-label="Shuffle"
            @click="shuffleToNew"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 3h5v5" />
              <path d="M4 20l17-17" />
              <path d="M21 16v5h-5" />
              <path d="M15 15l6 6" />
              <path d="M4 4l5 5" />
            </svg>
          </button>
        </div>

        <div v-if="hasContexts" class="tombola-count">
          {{ currentIndex + 1 }} / {{ contexts.length }}
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Backdrop sits over the inventory; close on click-outside. */
.tombola-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(44, 38, 34, 0.32);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  z-index: 250;
  font-family: var(--font-body, system-ui);
}

.tombola-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  border-radius: 18px;
  box-shadow:
    0 2px 4px rgba(44, 38, 34, 0.12),
    0 8px 24px rgba(44, 38, 34, 0.10),
    0 20px 48px rgba(44, 38, 34, 0.06);
  padding: 1.75rem 1.25rem 1rem;
  -webkit-font-smoothing: antialiased;
}

.tombola-close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.08);
  color: rgba(44, 38, 34, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;
}

.tombola-close:hover {
  background: rgba(0, 0, 0, 0.08);
}

.tombola-close svg {
  width: 16px;
  height: 16px;
}

.tombola-header {
  text-align: center;
  margin-bottom: 0.75rem;
}

.tombola-known {
  font-size: 0.95rem;
  color: rgba(44, 38, 34, 0.55);
}

/* The staggered vertical layout. Three lines, each aligned to its
   directional anchor (left tile flush left, lego centred, right tile
   flush right). Empty slots are absent from the DOM. */
.tombola-slots {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0 0.75rem;
  min-height: 8rem;
}

.slot {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  display: inline-block;
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  padding: 0.55em 0.95em;
  font-size: clamp(1.05rem, 4.5vw, 1.35rem);
  font-weight: 500;
  color: rgba(44, 38, 34, 0.85);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.06);
  max-width: 85%;
  overflow-wrap: anywhere;
}

.slot-left {
  align-self: flex-start;
  margin-left: 0;
  color: rgba(44, 38, 34, 0.75);
}

.slot-lego {
  align-self: center;
  background: #fffaf2;
  border-color: rgba(0, 0, 0, 0.38);
  font-weight: 600;
  color: rgba(44, 38, 34, 0.98);
  font-size: clamp(1.15rem, 5vw, 1.5rem);
  box-shadow:
    0 2px 4px rgba(44, 38, 34, 0.12),
    0 6px 16px rgba(44, 38, 34, 0.08);
}

.slot-right {
  align-self: flex-end;
  margin-right: 0;
  color: rgba(44, 38, 34, 0.75);
}

/* Shuffle motion. Out: left slides toward left edge, right toward right.
   In: from the opposite direction, opacity rises. Lego stays put. */
.tombola-slots.slide-out .slot-left  { transform: translateX(-20px); opacity: 0; }
.tombola-slots.slide-out .slot-right { transform: translateX( 20px); opacity: 0; }
.tombola-slots .slot-left,
.tombola-slots .slot-right {
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.tombola-slots.slide-in .slot-left  { transform: translateX(0); opacity: 1; }
.tombola-slots.slide-in .slot-right { transform: translateX(0); opacity: 1; }

.tombola-state {
  text-align: center;
  padding: 0.75rem 0;
  font-size: 0.95rem;
  color: rgba(44, 38, 34, 0.5);
}

.tombola-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0 0;
}

.ctrl-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  background: #ffffff;
  color: rgba(44, 38, 34, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.15s ease;
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10);
  -webkit-tap-highlight-color: transparent;
}

.ctrl-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.03);
}

.ctrl-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.ctrl-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ctrl-btn svg {
  width: 22px;
  height: 22px;
}

.ctrl-btn.play svg {
  margin-left: 2px;
}

.tombola-count {
  text-align: center;
  font-size: 0.75rem;
  color: rgba(44, 38, 34, 0.45);
  padding-top: 0.5rem;
  font-variant-numeric: tabular-nums;
}

/* Drawer enter/exit. */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s ease;
}
.drawer-enter-active .tombola-card,
.drawer-leave-active .tombola-card {
  transition: transform 0.28s cubic-bezier(0.34, 1.4, 0.6, 1), opacity 0.25s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .tombola-card,
.drawer-leave-to .tombola-card {
  transform: translateY(16px) scale(0.97);
  opacity: 0;
}
</style>
