<script setup lang="ts">
/**
 * AdminGroupContainer — shell for /admin/groups/:id/* read-views.
 *
 * Mirrors AdminSchoolsContainer but loads group context (govt_admin role)
 * so schools composables take the group-scope query branch.
 */
import { inject, onMounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TopNav from '@/components/schools/shared/TopNav.vue'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
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

async function loadContext(groupId: string | string[]) {
  const id = Array.isArray(groupId) ? groupId[0] : groupId
  if (!id) return
  if (!supabase.value || !auth?.learner?.value) return

  isLoading.value = true
  loadError.value = null
  try {
    await ctx.loadFromGroupId(id, {
      user_id: auth.learner.value.user_id,
      learner_id: auth.learner.value.id,
      display_name: auth.learner.value.display_name,
      platform_role: auth.learner.value.platform_role ?? null,
    }, supabase.value)
  } catch (err: any) {
    console.error('[AdminGroupContainer] Failed to load group context:', err)
    loadError.value = err?.message || 'Failed to load group'
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
      <p>Loading group…</p>
    </div>
    <div v-else-if="loadError" class="schools-loading">
      <p>{{ loadError }}</p>
    </div>
    <template v-else>
      <AtmosphereBackdrop />
      <TopNav />
      <main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </template>
  </div>
</template>

<style scoped>
.schools-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.schools-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: 16px;
  color: var(--color-text-muted, #888);
}
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border, #2a2a4a);
  border-top-color: var(--color-accent, #4a90d9);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.main-content { flex: 1; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
