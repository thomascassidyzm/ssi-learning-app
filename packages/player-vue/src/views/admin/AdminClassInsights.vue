<script setup lang="ts">
/**
 * AdminClassInsights — /admin/classes/:id/insights, THE LENS at class level.
 * The same thin shell as AdminClassHome (admin gate + AdminTopBar) around
 * NodeInsightsView, so the "See insights" verb on a class node home opens the
 * one engine scoped to that class — school average as the default mirror.
 */
import AdminTopBar from '@/components/admin/AdminTopBar.vue'
import NodeInsightsView from '@/views/admin/NodeInsightsView.vue'
import { useAdminGate } from '@/composables/useAdminGate'
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'

const { isCheckingAccess, isDenied } = useAdminGate()
</script>

<template>
  <div class="schools-container schools-surface">
    <AdminTopBar />
    <div v-if="isCheckingAccess || isDenied" class="schools-loading">
      <div class="loading-spinner"></div>
      <p>Loading insights…</p>
    </div>
    <main v-else class="main-content">
      <NodeInsightsView />
    </main>
  </div>
</template>

<style scoped>
.schools-container {
  /* Owns its scroll: body carries overflow:hidden app-wide (Android bounce
     fix in style.css) — same pattern as AdminContainer (founder pass A). */
  height: 100vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--schools-bg, #f6f5f1);
  color: var(--schools-fg, #0F1212);
}
.schools-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: 16px;
  color: var(--schools-fg-2, #555);
}
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--schools-border, rgba(15,18,18,.10));
  border-top-color: var(--schools-red, #DB1E17);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.main-content {
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 32px 64px;
}
@media (max-width: 900px) {
  .main-content { padding: 24px 20px; }
}
</style>
