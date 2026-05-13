<script setup lang="ts">
/**
 * Brain screen wrapper. Owns the side panel + node-focus state and
 * delegates the actual 2D rendering to BrainView (Agent B) and the
 * data shape to useBrainNetwork (Agent A).
 *
 * Lives in agent-c's deliverable set so the container doesn't have to
 * import the renderer composable / view directly — keeps the brittle
 * boundary (until A and B's branches land on staging) contained to one
 * file. PlayerContainer only sees BrainScreen.
 */
import { computed, defineAsyncComponent, ref, toRef } from 'vue'
import BrainSidePanel from './BrainSidePanel.vue'
import { useBrainNetwork } from '../composables/useBrainNetwork'
import { BELTS } from '../composables/useBeltProgress'
import type { NetworkNode, BrainViewStats } from '../types/brainNetwork'

// Async-loaded so the PIXI renderer chunk (pixi.js + pixi-viewport, ~200kb)
// doesn't get pulled into the main player bundle — the brain screen is
// rarely the first thing a learner opens.
const BrainView = defineAsyncComponent(() => import('./BrainView.vue'))

const props = defineProps<{
  courseCode: string
  /** Display name for the header — "Italian", "Spanish", etc. */
  languageName: string
  /** Internal learner id (learners.id, not auth uid). */
  learnerId: string | null
  /** Current belt for the stats header accent. */
  currentBelt: { name: string; color: string; index: number }
}>()

const emit = defineEmits<{
  close: []
}>()

// Agent A's composable takes Refs and returns `{ data, isLoading, error }`.
// We compute stats locally — the composable doesn't track them.
const courseCodeRef = toRef(props, 'courseCode')
const learnerIdRef = toRef(props, 'learnerId')
const network = useBrainNetwork(courseCodeRef, learnerIdRef)
const brainData = computed(() => network.data.value)
const isLoading = computed(() => network.isLoading.value)

const brainStats = computed<BrainViewStats | null>(() => {
  const d = brainData.value
  if (!d) return null
  let revealed = 0
  for (const n of d.nodes) if (n.isRevealed) revealed++
  return {
    revealedCount: revealed,
    totalCount: d.nodes.length,
    currentBelt: props.currentBelt,
  }
})

// Focused node + neighbour resolution.
const selectedNode = ref<NetworkNode | null>(null)

const handleNodeTap = (legoId: string) => {
  const node = brainData.value?.nodes.find(n => n.legoId === legoId) ?? null
  selectedNode.value = node
}

const handlePanelClose = () => {
  selectedNode.value = null
}

const handleChipFocus = (legoId: string) => {
  // Re-focus the network on the chip's word. Same code-path as a tap
  // on the node itself, just from a different UI surface.
  handleNodeTap(legoId)
}

// Translate beltIndex → BELTS[i].name for the side-panel "First learned
// at" line. Falls back to "white" if the index is out of range.
const selectedNodeBeltName = computed(() => {
  if (!selectedNode.value) return 'white'
  const idx = Math.max(0, Math.min(selectedNode.value.beltIndex, BELTS.length - 1))
  return BELTS[idx]?.name ?? 'white'
})

// Neighbours: walk the edges, pull the other end of any edge where
// this node is either source or target, then look up the node text.
const connectedLegos = computed(() => {
  if (!selectedNode.value || !brainData.value) return []
  const me = selectedNode.value.legoId
  const neighbourIds = new Set<string>()
  for (const edge of brainData.value.edges) {
    if (edge.source === me) neighbourIds.add(edge.target)
    else if (edge.target === me) neighbourIds.add(edge.source)
  }
  const out: Array<{ legoId: string; text: string }> = []
  for (const id of neighbourIds) {
    const node = brainData.value.nodes.find(n => n.legoId === id)
    if (node && node.isRevealed) {
      out.push({ legoId: node.legoId, text: node.text })
    }
  }
  // Cap chip count so a hub node doesn't blow the panel layout. The
  // contract is "feel" — top connections by recency is Agent A's job;
  // for now first 12 is a reasonable visual cap.
  return out.slice(0, 12)
})

const headerTitle = computed(() => `Your brain on ${props.languageName}`)

const subline = computed(() => {
  const s = brainStats.value
  if (!s) return ''
  return `${s.revealedCount} of ${s.totalCount} words and phrases`
})
</script>

<template>
  <div class="brain-screen">
    <header class="brain-screen-header">
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
      <div class="brain-screen-titles">
        <h1 class="brain-screen-title">{{ headerTitle }}</h1>
        <p v-if="subline" class="brain-screen-subline">{{ subline }}</p>
      </div>
    </header>

    <div v-if="isLoading && !brainData" class="brain-screen-loading">
      …
    </div>

    <!-- @vue-expect-error v1 BrainViewData → v2 BrainTimelapseData mismatch.
         Agent C will rewrite this whole screen against the v2 data composable. -->
    <BrainView
      v-else-if="brainData"
      class="brain-screen-canvas"
      :data="brainData"
      :stats="brainStats"
      :focused-lego-id="selectedNode?.legoId ?? null"
      @node-tap="handleNodeTap"
      @close="emit('close')"
    />

    <BrainSidePanel
      :node="selectedNode"
      :belt-name="selectedNodeBeltName"
      :connected-legos="connectedLegos"
      :course-code="courseCode"
      @close="handlePanelClose"
      @node-focus="handleChipFocus"
    />
  </div>
</template>

<style scoped>
.brain-screen {
  position: relative;
  width: 100%;
  height: 100dvh;
  background: var(--bg-primary, #f4f0eb);
  overflow: hidden;
}

.brain-screen-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));

  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0));
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.brain-screen-back {
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
  flex-shrink: 0;
  transition: all 0.18s ease;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.06);
}

.brain-screen-back:hover {
  color: #2c2622;
  border-color: rgba(0, 0, 0, 0.35);
}

.brain-screen-back svg {
  width: 18px;
  height: 18px;
}

.brain-screen-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.brain-screen-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #2c2622;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brain-screen-subline {
  margin: 0;
  font-size: 0.8125rem;
  color: rgba(44, 38, 34, 0.5);
}

.brain-screen-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: rgba(44, 38, 34, 0.5);
}

.brain-screen-canvas {
  position: absolute;
  inset: 0;
}
</style>
