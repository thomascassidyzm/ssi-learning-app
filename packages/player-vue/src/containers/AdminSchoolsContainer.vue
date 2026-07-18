<script setup lang="ts">
/**
 * AdminSchoolsContainer — shell for /admin/schools/:id/* read-views.
 *
 * Populates useSchoolContext.currentUser from the :id route param so the
 * existing schools composables/views scope their queries to that school.
 * Queries still run under the real admin's Supabase session; the context
 * just tells the composables what scope to look at.
 *
 * Provides `isAdminView = true` so child views can hide write controls.
 * Standalone route (sibling of AdminContainer's children, not nested in
 * it) — useAdminGate is its OWN reactive access gate; the org tables this
 * reads (schools/…) are RLS-off by design, so this gate is the enforcement,
 * not a redundant check on top of the router guard (Trinity audit finding
 * #1, docs/trinity/admin.md).
 */
import { inject, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AdminTopBar from '@/components/admin/AdminTopBar.vue'
import ViewAsButton from '@/components/admin/ViewAsButton.vue'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useAdminGate } from '@/composables/useAdminGate'
import type { ActAsPersona } from '@/composables/useUserRole'
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'

const route = useRoute()
const supabase = inject<any>('supabase', ref(null))
const auth = inject<any>('auth', null)
const { isCheckingAccess, isDenied } = useAdminGate()

// Prime the schools-client bridge as soon as the supabase instance is
// available, and reload context whenever the :id changes.
if (supabase.value) setSchoolsClient(supabase.value)

const ctx = useSchoolContext()
const isLoading = ref(true)
const loadError = ref<string | null>(null)
// "View as" — so wherever an admin is LOOKING at a school (any subpage
// under this container, not just the schools list), a one-click view-as
// this school's admin(s) is available. See ViewAsButton.vue.
const schoolAdminCandidates = ref<ActAsPersona[]>([])

provide('isAdminView', true)

// Best-effort, and isolated from the main school-context load — a failure
// fetching view-as candidates (network blip, missing column, a test mock
// without .from()) must never surface as "failed to load school" and hide
// a dashboard that otherwise loaded fine.
async function loadSchoolAdminCandidates(schoolId: string): Promise<void> {
  const client = supabase.value
  if (!client || typeof client.from !== 'function') return
  try {
    const { data: tags } = await client
      .from('user_tags')
      .select('user_id')
      .eq('tag_type', 'school')
      .eq('tag_value', `SCHOOL:${schoolId}`)
      .eq('role_in_context', 'admin')
      .is('removed_at', null)
    const userIds = (tags || []).map((t: any) => t.user_id)
    if (userIds.length === 0) {
      schoolAdminCandidates.value = []
      return
    }
    const { data: learners } = await client.from('learners').select('user_id, display_name').in('user_id', userIds)
    schoolAdminCandidates.value = (learners || []).map((l: any) => ({
      key: l.user_id,
      userId: l.user_id,
      role: 'school_admin' as const,
      name: l.display_name,
    }))
  } catch (err) {
    console.warn('[AdminSchoolsContainer] Failed to load view-as candidates:', err)
    schoolAdminCandidates.value = []
  }
}

async function loadContext(schoolId: string | string[]) {
  const id = Array.isArray(schoolId) ? schoolId[0] : schoolId
  if (!id) return
  if (!supabase.value || !auth?.learner?.value) return

  isLoading.value = true
  loadError.value = null
  try {
    await ctx.loadFromSchoolId(id, {
      user_id: auth.learner.value.user_id,
      learner_id: auth.learner.value.id,
      display_name: auth.learner.value.display_name,
      platform_role: auth.learner.value.platform_role ?? null,
    }, supabase.value)
  } catch (err: any) {
    console.error('[AdminSchoolsContainer] Failed to load school context:', err)
    loadError.value = err?.message || 'Failed to load school'
  } finally {
    isLoading.value = false
  }
  void loadSchoolAdminCandidates(id)
}

// Was `onMounted(() => loadContext(...))` + a route-id-only watch — on a
// direct load to /admin/schools/:id, auth.learner.value (the injected useAuth
// instance) is still null at that instant (its DB fetch hasn't resolved), so
// loadContext's own guard silently returned and isLoading stayed true
// forever: dead on cold load, same bug class as the router/data-composable
// races elsewhere in this fix. Watching the learner too re-fires once
// identity actually resolves, not just when the route id changes. Also
// gated on the access check resolving to "allowed" — this query must never
// fire while checking OR for a denied caller (the cross-tenant leak this
// fix closes: org tables are RLS-off, so this gate IS the enforcement).
watch(
  [() => route.params.id, () => auth?.learner?.value, isCheckingAccess, isDenied],
  ([id, learner, checking, denied]) => {
    if (id && learner && !checking && !denied) loadContext(id as string)
  },
  { immediate: true },
)
// Deterministic teardown: leaving this read-view must never let its scope
// leak into whatever mounts next (e.g. the admin's own /schools) — see
// finding #1a, 2026-07-13 audit.
onUnmounted(() => ctx.clear())
</script>

<template>
  <div class="schools-container schools-surface">
    <AdminTopBar />
    <div v-if="!isCheckingAccess && !isDenied && !isLoading && !loadError" class="entity-context-bar">
      <div class="entity-context-identity">
        <span class="entity-context-eyebrow">Viewing school</span>
        <span class="entity-context-name" :title="ctx.currentUser?.value?.school_name || 'School'">{{ ctx.currentUser?.value?.school_name || 'School' }}</span>
      </div>
      <ViewAsButton :candidates="schoolAdminCandidates" empty-title="No school admin claimed yet" />
    </div>
    <div v-if="isCheckingAccess || isDenied || isLoading" class="schools-loading">
      <div class="loading-spinner"></div>
      <p>Loading school…</p>
    </div>
    <div v-else-if="loadError" class="schools-loading">
      <p>{{ loadError }}</p>
    </div>
    <main v-else class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
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
/* Identity-first: the school name is the headline of this surface — it must
   stay visible (sticky, truncating) at every width instead of losing to the
   admin chrome above it. */
.entity-context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 32px;
  background: #fff;
  border-bottom: 1px solid var(--schools-border, rgba(15,18,18,.10));
  position: sticky;
  top: calc(54px + env(safe-area-inset-top, 0px));
  z-index: 50;
}
.entity-context-identity {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.entity-context-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.entity-context-name {
  font-weight: 700;
  font-size: 16px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 640px) {
  .entity-context-bar { padding: 8px 16px; }
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
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 1024px) {
  .main-content { padding: 24px 20px; }
}
@media (max-width: 768px) {
  .main-content { padding: 20px 16px; }
}
</style>
