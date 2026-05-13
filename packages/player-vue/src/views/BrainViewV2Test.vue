<script setup lang="ts">
/**
 * /test/brain-view-v2 — temporary dev route for the v2 brain timelapse.
 *
 * Mounts BrainView (v2) against the hand-built brainNetworkFixture so
 * the live force-sim + scrubber can be exercised without any session /
 * Supabase wiring.
 *
 * Agent C will delete this view + route when real integration lands.
 */
import BrainView from '../components/BrainView.vue'
import { brainNetworkFixture } from '../fixtures/brainNetworkFixture'
import { useRouter } from 'vue-router'

const router = useRouter()

function handleClose() {
  router.push('/')
}

function handleNodeTap(legoId: string) {
  // Dev-only: log the tap so we can verify hit-testing without a side panel.
  // eslint-disable-next-line no-console
  console.log('[brain-view-v2] nodeTap', legoId)
}
</script>

<template>
  <div class="brain-view-v2-test">
    <BrainView
      :data="brainNetworkFixture"
      @close="handleClose"
      @node-tap="handleNodeTap"
    />
  </div>
</template>

<style scoped>
.brain-view-v2-test {
  position: fixed;
  inset: 0;
  background: #0a0a0f;
}
</style>
