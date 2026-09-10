<script setup lang="ts">
/**
 * IntelContainer — the shell the ten questions live in.
 *
 * Shares the org dashboard's stylesheet, tokens and access gate outright
 * (Tom's ruling: "I think so. Yes share."). What it does NOT share is the dark
 * admin top bar, which the design retires — see IntelTopBar.
 *
 * Same gate as AdminContainer: useAdminGate is deny-not-defer and re-validates
 * periodically, so a mid-session downgrade revokes access live.
 */
import { ref, onMounted } from 'vue'
import IntelTopBar from '@/intel/IntelTopBar.vue'
import { useAdminGate } from '@/composables/useAdminGate'
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'

const { isCheckingAccess, isDenied } = useAdminGate()
const mounted = ref(false)
onMounted(() => { requestAnimationFrame(() => { mounted.value = true }) })
</script>

<template>
  <div class="intel-container schools-surface" :class="{ 'is-mounted': mounted }">
    <div v-if="isCheckingAccess || isDenied" class="intel-loading">
      <p>Loading…</p>
    </div>
    <template v-else>
      <IntelTopBar />
      <main class="intel-main">
        <!-- Drilling swaps content in place; the bar and the rail stay mounted
             (the 2026-07-30 stability ruling), so no page transition here. -->
        <router-view />
      </main>
    </template>
  </div>
</template>

<style scoped>
.intel-container {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--schools-page-backdrop, #e8e5dd);
}
.intel-main { flex: 1; min-height: 0; }
.intel-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--schools-fg-3);
}
</style>
