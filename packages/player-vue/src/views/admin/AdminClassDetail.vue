<script setup lang="ts">
/**
 * AdminClassDetail — /admin/classes/:id read-view.
 *
 * Loads the class's parent school, populates useSchoolContext as
 * school_admin scope, then renders the existing ClassDetail view. The
 * view reads the :id from its own route and queries class detail.
 */
import { inject, onMounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TopNav from '@/components/schools/shared/TopNav.vue'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
import ClassDetail from '@/views/schools/ClassDetail.vue'
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

async function loadContext(classId: string | string[]) {
  const id = Array.isArray(classId) ? classId[0] : classId
  if (!id) return
  if (!supabase.value || !auth?.learner?.value) return

  isLoading.value = true
  loadError.value = null
  try {
    // Look up the class's school_id so we can prime the same context
    // shape AdminSchoolsContainer uses.
    const { data: cls } = await supabase.value
      .from('classes')
      .select('school_id')
      .eq('id', id)
      .single()
    if (!cls) throw new Error('Class not found')

    await ctx.loadFromSchoolId(cls.school_id, {
      user_id: auth.learner.value.user_id,
      learner_id: auth.learner.value.id,
      display_name: auth.learner.value.display_name,
      platform_role: auth.learner.value.platform_role ?? null,
    }, supabase.value)
  } catch (err: any) {
    console.error('[AdminClassDetail] Failed to load context:', err)
    loadError.value = err?.message || 'Failed to load class'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => loadContext(route.params.id as string))
watch(() => route.params.id, (id) => { if (id) loadContext(id as string) })
</script>

<template>
  <div class="schools-container schools-surface">
    <div v-if="isLoading" class="schools-loading">
      <div class="loading-spinner"></div>
      <p>Loading class…</p>
    </div>
    <div v-else-if="loadError" class="schools-loading">
      <p>{{ loadError }}</p>
    </div>
    <template v-else>
      <AtmosphereBackdrop />
      <TopNav />
      <main class="main-content">
        <ClassDetail />
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
