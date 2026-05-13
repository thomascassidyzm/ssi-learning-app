<script setup lang="ts">
/**
 * BrainScreen — v2 wrapper for the brain view.
 *
 * Swaps the v1 side panel for a floating chip and the v1 static
 * data composable for Agent A's timelapse composable. Owns:
 *
 *   - focused-node state (legoId + screen coordinates from BrainView)
 *   - loading / empty states
 *   - back navigation
 *
 * Layout is full-bleed canvas. No side panel slide-in. The brain
 * dominates the screen; the chip is the only overlay surface.
 *
 * Boundary contracts:
 *   - useBrainTimelapseData (Agent A) returns { data, isLoading, error }
 *     with data shape `BrainTimelapseData` (extends BrainViewData with
 *     fire_count edges + per-node mastery tier + scrubbable timeline).
 *   - BrainView (Agent B) accepts `data: BrainTimelapseData`, emits
 *     `nodeTap: [legoId, screenX, screenY]` with viewport coordinates.
 *     `close` bubbles out of BrainView so the user can dismiss from
 *     the canvas as well.
 *
 * These contracts haven't landed on staging yet — this file references
 * them by their projected paths so a merge of A + B + C on staging
 * resolves cleanly.
 */
import { computed, defineAsyncComponent, ref, toRef } from 'vue'
import BrainNodeChip from './BrainNodeChip.vue'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — Agent A's composable lands on staging; placeholder until merge.
import { useBrainTimelapseData } from '../composables/useBrainTimelapseData'
import type { NetworkNode } from '../types/brainNetwork'

// Async-loaded so the PIXI renderer chunk (pixi.js + pixi-viewport, ~200kb)
// doesn't get pulled into the main player bundle — the brain screen is
// rarely the first thing a learner opens.
const BrainView = defineAsyncComponent(() => import('./BrainView.vue'))

const props = defineProps<{
  courseCode: string
  /** Display name for fallback empty-state copy, e.g. "Italian". */
  languageName: string
  /** Internal learner id (learners.id, not auth uid). */
  learnerId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

// ---- Data composable ---------------------------------------------------------

const courseCodeRef = toRef(props, 'courseCode')
const learnerIdRef = toRef(props, 'learnerId')
const timelapse = useBrainTimelapseData(courseCodeRef, learnerIdRef)
const brainData = computed(() => timelapse.data.value)
const isLoading = computed(() => timelapse.isLoading.value)
const error = computed(() => timelapse.error?.value ?? null)

const revealedCount = computed(() => {
  const d = brainData.value
  if (!d) return 0
  let n = 0
  for (const node of d.nodes) if (node.isRevealed) n++
  return n
})

const isEmpty = computed(() => !isLoading.value && revealedCount.value === 0)

// Compat stub for v1 BrainView's `stats` prop. Agent B's v2 BrainView drops
// this prop entirely. Drop this computed when BrainView.vue's contract no
// longer asks for it.
const brainViewStatsCompat = computed(() => ({
  revealedCount: revealedCount.value,
  totalCount: brainData.value?.nodes.length ?? 0,
  currentBelt: { name: 'white', color: '#ffffff', index: 0 },
}))

// ---- Focused node + screen coordinates ---------------------------------------

const selectedNode = ref<NetworkNode | null>(null)
const chipScreenX = ref(0)
const chipScreenY = ref(0)

const handleNodeTap = (legoId: string, screenX?: number, screenY?: number) => {
  const node = brainData.value?.nodes.find((n: NetworkNode) => n.legoId === legoId) ?? null
  selectedNode.value = node
  // Fallback when BrainView hasn't migrated to emitting screen coords yet:
  // anchor the chip near the centre of the viewport so it's always visible.
  if (typeof screenX === 'number' && typeof screenY === 'number') {
    chipScreenX.value = screenX
    chipScreenY.value = screenY
  } else if (typeof window !== 'undefined') {
    chipScreenX.value = window.innerWidth / 2
    chipScreenY.value = window.innerHeight / 2
  }
}

const handleChipClose = () => {
  selectedNode.value = null
}
</script>

<template>
  <div class="brain-screen">
    <!-- Back button (lightweight; the brain owns the rest of the chrome) -->
    <button
      class="brain-screen-back"
      type="button"
      aria-label="Back"
      @click="emit('close')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>

    <!-- Loading state -->
    <div v-if="isLoading && !brainData" class="brain-screen-state">
      <div class="brain-screen-spinner" aria-hidden="true" />
      <p class="brain-screen-state-text">Building your brain…</p>
    </div>

    <!-- Error state (data fetch blew up — rare; we still let the learner back out) -->
    <div v-else-if="error && !brainData" class="brain-screen-state">
      <p class="brain-screen-state-text">Couldn't load your brain right now.</p>
    </div>

    <!-- Empty state: no LEGOs introduced yet -->
    <div v-else-if="isEmpty" class="brain-screen-state">
      <p class="brain-screen-state-text">
        Your {{ languageName }} brain is empty.<br>
        Start a session to grow it.
      </p>
      <button
        class="brain-screen-cta"
        type="button"
        @click="emit('close')"
      >
        Back to player
      </button>
    </div>

    <!-- The brain itself.
         `stats` is a v1 BrainView prop that Agent B is dropping in v2 — passed
         here so this file typechecks while the parallel rewrites land. Safe to
         remove once BrainView.vue's prop list drops `stats`. -->
    <BrainView
      v-else-if="brainData"
      class="brain-screen-canvas"
      :data="brainData"
      :stats="brainViewStatsCompat"
      @node-tap="handleNodeTap"
      @close="emit('close')"
    />

    <!-- Floating chip on focused node -->
    <BrainNodeChip
      :node="selectedNode"
      :screen-x="chipScreenX"
      :screen-y="chipScreenY"
      :course-code="courseCode"
      @close="handleChipClose"
    />
  </div>
</template>

<style scoped>
.brain-screen {
  position: relative;
  width: 100%;
  height: 100dvh;
  background: #0a0a0f;
  overflow: hidden;
}

.brain-screen-back {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 12px);
  left: 12px;
  z-index: 10;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(20, 20, 28, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e8e4df;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}

.brain-screen-back:hover {
  background: rgba(40, 40, 52, 0.85);
}

.brain-screen-back svg {
  width: 18px;
  height: 18px;
}

.brain-screen-canvas {
  position: absolute;
  inset: 0;
}

.brain-screen-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 0 1.5rem;
  color: rgba(232, 228, 223, 0.7);
  text-align: center;
}

.brain-screen-state-text {
  margin: 0;
  font-size: 1rem;
  line-height: 1.5;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  max-width: 24ch;
}

.brain-screen-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba(232, 228, 223, 0.15);
  border-top-color: rgba(232, 228, 223, 0.6);
  border-radius: 50%;
  animation: brain-spinner 0.8s linear infinite;
}

@keyframes brain-spinner {
  to { transform: rotate(360deg); }
}

.brain-screen-cta {
  margin-top: 0.25rem;
  padding: 0.55rem 1.1rem;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  color: #e8e4df;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.brain-screen-cta:hover {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.20);
}

@media (prefers-reduced-motion: reduce) {
  .brain-screen-spinner {
    animation: none;
  }
}
</style>
