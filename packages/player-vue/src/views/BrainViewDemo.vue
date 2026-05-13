<script setup lang="ts">
/**
 * Temporary demo host for BrainView — exposed at /test/brain-view.
 *
 * Renders BrainView against the hand-built fixture so the component can be
 * exercised end-to-end (pan/zoom, tour, taps) in `pnpm --filter player-vue
 * dev` without needing Agent A's composable wired up.
 *
 * Once Agent C wires BrainView into PlayerContainer this route can go away.
 */

import { ref } from 'vue'
import BrainView from '../components/BrainView.vue'
import {
  brainNetworkFixture,
  brainNetworkFixtureStats,
} from '../fixtures/brainNetworkFixture'

const lastTappedLegoId = ref<string | null>(null)
const lastTappedText = ref<string>('')

function onNodeTap(legoId: string) {
  lastTappedLegoId.value = legoId
  const node = brainNetworkFixture.nodes.find((n) => n.legoId === legoId)
  lastTappedText.value = node ? `${node.text} — ${node.knownText}` : ''
}

function onClose() {
  // No-op for the demo route. In production, PlayerContainer will pop the view.
  // Log so the keyboard-accessibility / wiring is at least observable.
  console.log('[BrainViewDemo] close pressed')
}
</script>

<template>
  <div class="brain-demo-host">
    <BrainView
      :data="brainNetworkFixture"
      :stats="brainNetworkFixtureStats"
      @node-tap="onNodeTap"
      @close="onClose"
    />
    <div v-if="lastTappedLegoId" class="tap-readout">
      Last tap: <strong>{{ lastTappedText }}</strong>
    </div>
  </div>
</template>

<style scoped>
.brain-demo-host {
  position: fixed;
  inset: 0;
  background: #0a0a0f;
}
.tap-readout {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  font-size: 0.8rem;
  color: rgba(232, 228, 223, 0.7);
  background: rgba(20, 20, 28, 0.7);
  padding: 6px 12px;
  border-radius: 999px;
  pointer-events: none;
}
</style>
