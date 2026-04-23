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
    <div v-if="isLoading" class="schools-loading">
      <div class="loading-spinner"></div>
      <p>Loading learner…</p>
    </div>
    <div v-else-if="loadError" class="schools-loading">
      <p>{{ loadError }}</p>
    </div>
    <template v-else>
      <AtmosphereBackdrop />
      <TopNav />
      <main class="main-content">
        <StudentProgressView />
      </main>
    </template>
  </div>
</template>

<style scoped>
.schools-container { min-height: 100vh; display: flex; flex-direction: column; }
.schools-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 60vh; gap: 16px; color: var(--color-text-muted, #888);
}
.loading-spinner {
  width: 32px; height: 32px; border: 3px solid var(--color-border, #2a2a4a);
  border-top-color: var(--color-accent, #4a90d9); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.main-content { flex: 1; }
</style>
