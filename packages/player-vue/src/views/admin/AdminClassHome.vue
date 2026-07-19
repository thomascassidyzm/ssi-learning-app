<script setup lang="ts">
/**
 * AdminClassHome — /admin/classes/:id, THE VIEW at class level
 * (docs/THE-VIEW.md §3). A thin shell: admin gate + AdminTopBar around the
 * one recursive NodeHomeView, which fetches /api/groups/:id/home with the
 * class id and renders the same grammar as every other level — map rail up
 * to the school, identity with the teachers list (read-only, co-teacher
 * model), students as children. Replaces the old ClassDetail-reuse shell
 * (three-designs era); the rich class tools remain at
 * /admin/schools/:schoolId/classes/:classId.
 */
import AdminTopBar from '@/components/admin/AdminTopBar.vue'
import NodeHomeView from '@/views/admin/NodeHomeView.vue'
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
      <p>Loading class…</p>
    </div>
    <main v-else class="main-content">
      <NodeHomeView />
    </main>
  </div>
</template>

<style scoped>
.schools-container {
  min-height: 100vh;
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
  padding: 28px 32px 40px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}
@media (max-width: 768px) {
  .main-content { padding: 20px 16px; }
}
</style>
