<script setup lang="ts">
/**
 * AdminUserProgress — /admin/users/:learnerId/progress read-view.
 *
 * Loads the target learner into useSchoolContext with educational_role
 * 'student' so StudentProgressView reads learner_id and queries that
 * learner's course enrollments. Real admin's user_id is kept on the
 * context for any action that writes attribution.
 */
import { inject, onMounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TopNav from '@/components/schools/shared/TopNav.vue'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import StudentProgressView from '@/views/schools/StudentProgressView.vue'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import '@/styles/schools-tokens.css'

const route = useRoute()
const supabase = inject<any>('supabase', ref(null))
const auth = inject<any>('auth', null)

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

onMounted(() => loadContext(route.params.learnerId as string))
watch(() => route.params.learnerId, (id) => { if (id) loadContext(id as string) })
</script>

<template>
  <div class="schools-container schools-surface">
    <AtmosphereBackdrop />
    <TopNav />
    <main class="main-content">
      <template v-if="isLoading">
        <header class="page-header">
          <div class="title-block">
            <span class="frost-eyebrow">Learner progress</span>
            <h1 class="frost-display">Loading learner…</h1>
          </div>
        </header>
        <FrostCard variant="panel" class="status-panel">
          <div class="status-inner">
            <span class="loading-spinner" aria-hidden="true"></span>
            <span class="status-copy">Resolving learner context…</span>
          </div>
        </FrostCard>
      </template>

      <template v-else-if="loadError">
        <header class="page-header">
          <div class="title-block">
            <span class="frost-eyebrow">Learner progress</span>
            <h1 class="frost-display">Couldn't load this learner</h1>
          </div>
        </header>
        <FrostCard variant="panel" class="status-panel">
          <div class="banner banner-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {{ loadError }}
          </div>
        </FrostCard>
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

.title-block .frost-display {
  font-size: var(--text-3xl);
  letter-spacing: -0.015em;
  margin: 0;
  color: var(--ink-primary);
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
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.status-copy {
  color: var(--ink-secondary);
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
