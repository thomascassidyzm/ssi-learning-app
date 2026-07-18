<script setup lang="ts">
/**
 * AdminGroupContainer — shell for /admin/groups/:id/* read-views.
 *
 * Mirrors AdminSchoolsContainer but loads group context (govt_admin role)
 * so schools composables take the group-scope query branch. Standalone
 * route — see AdminSchoolsContainer's docstring for why useAdminGate is
 * its own gate (Trinity audit finding #1, docs/trinity/admin.md).
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

if (supabase.value) setSchoolsClient(supabase.value)

const ctx = useSchoolContext()
const isLoading = ref(true)
const loadError = ref<string | null>(null)
// "View as" — wherever an admin is looking at a group (any subpage under
// this container), one-click view-as the group leader(s). See ViewAsButton.vue.
const groupLeaderCandidates = ref<ActAsPersona[]>([])

provide('isAdminView', true)

// Best-effort, and isolated from the main group-context load — a failure
// fetching view-as candidates must never surface as "failed to load group"
// and hide a dashboard that otherwise loaded fine.
async function loadGroupLeaderCandidates(groupId: string): Promise<void> {
  const client = supabase.value
  if (!client || typeof client.from !== 'function') return
  try {
    const { data: rows } = await client.from('govt_admins').select('user_id').eq('group_id', groupId)
    const userIds = (rows || []).map((r: any) => r.user_id)
    if (userIds.length === 0) {
      groupLeaderCandidates.value = []
      return
    }
    const { data: learners } = await client.from('learners').select('user_id, display_name').in('user_id', userIds)
    groupLeaderCandidates.value = (learners || []).map((l: any) => ({
      key: l.user_id,
      userId: l.user_id,
      role: 'govt_admin' as const,
      name: l.display_name,
    }))
  } catch (err) {
    console.warn('[AdminGroupContainer] Failed to load view-as candidates:', err)
    groupLeaderCandidates.value = []
  }
}

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
  void loadGroupLeaderCandidates(id)
}

// Was `onMounted(() => loadContext(...))` + a route-id-only watch — on a
// direct load to /admin/groups/:id, auth.learner.value (the injected useAuth
// instance) is still null at that instant (its DB fetch hasn't resolved), so
// loadContext's own guard silently returned and isLoading stayed true
// forever: dead on cold load, same bug class as the router/data-composable
// races elsewhere in this fix. Watching the learner too re-fires once
// identity actually resolves, not just when the route id changes. Also
// gated on the access check resolving to "allowed" — see
// AdminSchoolsContainer's watch for why.
watch(
  [() => route.params.id, () => auth?.learner?.value, isCheckingAccess, isDenied],
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
    <AdminTopBar />
    <div v-if="!isCheckingAccess && !isDenied && !isLoading && !loadError" class="entity-context-bar">
      <div class="entity-context-identity">
        <span class="entity-context-eyebrow">Viewing group</span>
        <span class="entity-context-name" :title="ctx.currentUser?.value?.organization_name || ctx.currentUser?.value?.group_path || 'Group'">{{ ctx.currentUser?.value?.organization_name || ctx.currentUser?.value?.group_path || 'Group' }}</span>
      </div>
      <ViewAsButton :candidates="groupLeaderCandidates" empty-title="No group leader yet" />
    </div>
    <div v-if="isCheckingAccess || isDenied || isLoading" class="schools-loading">
      <div class="loading-spinner"></div>
      <p>Loading group…</p>
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
/* Identity-first: same treatment as AdminSchoolsContainer — the group name is
   the headline, sticky + truncating so it never loses to the chrome. */
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
