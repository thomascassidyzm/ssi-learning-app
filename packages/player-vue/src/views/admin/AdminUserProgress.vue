<script setup lang="ts">
/**
 * AdminUserProgress — /admin/users/:learnerId/progress read-view.
 *
 * Loads the target learner into useSchoolContext with educational_role
 * 'student' so StudentProgressView reads learner_id and queries that
 * learner's course enrollments. Real admin's user_id is kept on the
 * context for any action that writes attribution. Standalone route — see
 * AdminSchoolsContainer's docstring for why useAdminGate is its own gate
 * (Trinity audit finding #1, docs/trinity/admin.md).
 */
import { inject, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TopNav from '@/components/schools/shared/TopNav.vue'
import StudentProgressView from '@/views/schools/StudentProgressView.vue'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useAdminGate } from '@/composables/useAdminGate'
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'

const route = useRoute()
const supabase = inject<any>('supabase', ref(null))
const auth = inject<any>('auth', null)
const { isCheckingAccess, isDenied } = useAdminGate()

if (supabase.value) setSchoolsClient(supabase.value)

const ctx = useSchoolContext()
const isLoading = ref(true)
const loadError = ref<string | null>(null)

provide('isAdminView', true)

async function loadContext(learnerId: string | string[]) {
  const id = Array.isArray(learnerId) ? learnerId[0] : learnerId
  if (!id) return
  if (!supabase.value || !auth?.learner?.value) return

  isLoading.value = true
  loadError.value = null
  try {
    await ctx.loadFromLearnerId(id, {
      user_id: auth.learner.value.user_id,
      platform_role: auth.learner.value.platform_role ?? null,
    }, supabase.value)
  } catch (err: any) {
    console.error('[AdminUserProgress] Failed to load learner context:', err)
    loadError.value = err?.message || 'Failed to load learner'
  } finally {
    isLoading.value = false
  }
}

// Was `onMounted(() => loadContext(...))` + a route-id-only watch — on a
// direct load to /admin/users/:learnerId/progress, auth.learner.value (the
// injected useAuth instance) is still null at that instant, so loadContext's
// own guard silently returned and isLoading stayed true forever: dead on
// cold load, same bug class as the router/data-composable races elsewhere in
// this fix. Watching the learner too re-fires once identity resolves. Also
// gated on the access check resolving to "allowed" — see
// AdminSchoolsContainer's watch for why.
watch(
  [() => route.params.learnerId, () => auth?.learner?.value, isCheckingAccess, isDenied],
  ([id, learner, checking, denied]) => {
    if (id && learner && !checking && !denied) loadContext(id as string)
  },
  { immediate: true },
)
// Deterministic teardown — see finding #1a, 2026-07-13 audit.
onUnmounted(() => ctx.clear())
</script>

<template>
  <div class="schools-container schools-surface">
    
    <TopNav />
    <main class="main-content">
      <template v-if="isCheckingAccess || isDenied || isLoading">
        <header class="page-header">
          <div class="title-block">
            <span class="schools-kicker">Learner progress</span>
            <h1 class="arsenal">Loading learner…</h1>
          </div>
        </header>
        <div class="schools-card status-panel">
          <div class="status-inner">
            <span class="loading-spinner" aria-hidden="true"></span>
            <span class="status-copy">Resolving learner context…</span>
          </div>
        </div>
      </template>

      <template v-else-if="loadError">
        <header class="page-header">
          <div class="title-block">
            <span class="schools-kicker">Learner progress</span>
            <h1 class="arsenal">Couldn't load this learner</h1>
          </div>
        </header>
        <div class="schools-card status-panel">
          <div class="banner banner-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {{ loadError }}
          </div>
        </div>
      </template>

      <StudentProgressView v-else />
    </main>
  </div>
</template>

<style scoped>
.schools-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* ---------- Page header (canon §5.1) ---------- */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--space-4);
}

.title-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

/* ---------- Status panels (loading / error) ---------- */
.status-panel {
  padding: var(--space-8) var(--space-6);
}

.status-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 160px;
  color: var(--schools-fg-3);
  font-size: var(--text-sm);
}

.status-copy {
  color: var(--schools-fg-2);
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(44, 38, 34, 0.12);
  border-top-color: rgb(var(--tone-blue));
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ---------- Banner (canon §banner — mirrors AdminUserDetail) ---------- */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}
</style>
