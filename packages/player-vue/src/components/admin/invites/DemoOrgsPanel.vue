<script setup lang="ts">
// Existing-demos management — lifted from AdminDemoSchools.vue (owner: Nick,
// Head of Partnerships) essentially verbatim: org list, expand-to-tree via
// GroupTreeNode entityMode="leaf", get-join-code, extend/expire/purge. Only
// the create form left this component — that's now DemoOrgCreateForm.vue,
// shown inside InviteCreateCard's "New demo org" mode; this panel is the
// lifecycle half of the same tool. No teachers/classes/students anywhere in
// this UI or flow — a leaf is just a join code for learners (an invisible
// school+class behind it, api/_utils/demoLeaf.ts — never named or shown).
import { ref, computed, onMounted, nextTick, provide } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import GroupTreeNode from '@/components/admin/GroupTreeNode.vue'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'

interface DemoOrgRow {
  id: string
  created_at: string
  created_by: string
  prospect_name: string
  course_code: string
  group_id: string | null
  expires_at: string
  status: 'active' | 'expired'
  expired_at: string | null
  metadata: { orgName: string; lastActivityThrough?: string }
}

interface TreeGroup {
  id: string
  name: string
  type: string
  parent_id: string | null
  is_demo?: boolean
  is_test?: boolean
  school_count: number
  granted_courses: string[]
}
interface DemoLeaf {
  group_id: string
  class_id: string
  student_join_code: string
}

const { getAuthToken } = useAdminClient()

const orgs = ref<DemoOrgRow[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const expandedId = ref<string | null>(null)
const busyAction = ref<string | null>(null)
const showExpired = ref(false)
const treeGroups = ref<TreeGroup[]>([])
const leavesByOrg = ref<Record<string, DemoLeaf[]>>({})

const visibleOrgs = computed(() => showExpired.value ? orgs.value : orgs.value.filter((o) => o.status !== 'expired'))
const expiredCount = computed(() => orgs.value.filter((o) => o.status === 'expired').length)

async function fetchTreeGroups(): Promise<void> {
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/groups', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)
    treeGroups.value = data.groups || []
  } catch (err) {
    console.warn('[DemoOrgsPanel] groups fetch failed:', err)
  }
}

async function fetchLeaves(orgGroupId: string): Promise<void> {
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/admin/demo-leaf?org_group_id=${encodeURIComponent(orgGroupId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)
    leavesByOrg.value = { ...leavesByOrg.value, [orgGroupId]: data.leaves || [] }
  } catch (err) {
    console.warn('[DemoOrgsPanel] leaves fetch failed:', err)
  }
}

function orgRootGroup(org: DemoOrgRow): TreeGroup | null {
  return treeGroups.value.find((g) => g.id === org.group_id) || null
}

function leafJoinCode(groupId: string): string | null {
  for (const leaves of Object.values(leavesByOrg.value)) {
    const found = leaves.find((l) => l.group_id === groupId)
    if (found) return found.student_join_code
  }
  return null
}

async function ensureLeaf(groupId: string): Promise<void> {
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch('/api/admin/demo-leaf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ group_id: groupId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    await Promise.all(Object.keys(leavesByOrg.value).map((orgGroupId) => fetchLeaves(orgGroupId)))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to get join code'
  }
}

const editingGroupId = ref<string | null>(null)
const editingGroupName = ref('')

function startGroupRename(group: TreeGroup): void {
  editingGroupId.value = group.id
  editingGroupName.value = group.name
  nextTick(() => {
    const input = document.querySelector('.group-rename-input') as HTMLInputElement
    input?.focus()
    input?.select()
  })
}

async function saveGroupRename(group: TreeGroup): Promise<void> {
  const newName = editingGroupName.value.trim()
  editingGroupId.value = null
  if (!newName || newName === group.name) return
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const resp = await fetch(`/api/groups/${group.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: newName }) })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to rename')
    }
    await fetchTreeGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to rename'
  }
}

function cancelGroupRename(): void {
  editingGroupId.value = null
}

function openGroupDashboard(): void {}
function openSchoolDashboard(): void {}
async function createSchoolAt(): Promise<void> {}

async function createSubgroup(parentId: string, name: string): Promise<void> {
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, type: 'group', parent_id: parentId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    await fetchTreeGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create sub-group'
  }
}

type DeleteTargetKind = 'group'
interface DeleteTarget { kind: DeleteTargetKind; id: string; name: string }
interface DeleteImpact {
  classCount?: number
  schoolCount?: number
  sessionCount: number
  learnerCount: number
  teacherCount: number
  hasRealActivity: boolean
}
const deleteModalOpen = ref(false)
const deleteModalTarget = ref<DeleteTarget | null>(null)
const deleteModalImpact = ref<DeleteImpact | null>(null)
const deleteModalSubmitting = ref(false)
const deleteModalError = ref('')

const deleteModalTitle = computed(() => 'Delete group')
const deleteModalImpactLines = computed(() => {
  const impact = deleteModalImpact.value
  if (!impact) return []
  const lines: string[] = []
  lines.push(`${impact.sessionCount} session(s) recorded`)
  lines.push(`${impact.learnerCount} learner(s)`)
  return lines
})

async function openDeleteModal(target: DeleteTarget): Promise<void> {
  deleteModalTarget.value = target
  deleteModalImpact.value = null
  deleteModalError.value = ''
  deleteModalOpen.value = true
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const resp = await fetch(`/api/groups/${target.id}`, { method: 'GET', headers })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to load deletion impact')
    deleteModalImpact.value = data.impact
  } catch (err) {
    deleteModalError.value = err instanceof Error ? err.message : 'Failed to load deletion impact'
  }
}

function requestDeleteGroup(group: TreeGroup): void {
  void openDeleteModal({ kind: 'group', id: group.id, name: group.name })
}
function closeDeleteModal(): void {
  if (deleteModalSubmitting.value) return
  deleteModalOpen.value = false
  deleteModalTarget.value = null
  deleteModalImpact.value = null
  deleteModalError.value = ''
}

async function confirmDelete(typedName: string): Promise<void> {
  const target = deleteModalTarget.value
  if (!target) return
  deleteModalSubmitting.value = true
  deleteModalError.value = ''
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    const params = typedName ? `?confirm_name=${encodeURIComponent(typedName)}` : ''
    const resp = await fetch(`/api/groups/${target.id}${params}`, { method: 'DELETE', headers })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to delete group')
    await fetchTreeGroups()
    await fetchOrgs()
    deleteModalOpen.value = false
    deleteModalTarget.value = null
  } catch (err) {
    deleteModalError.value = err instanceof Error ? err.message : 'Failed to delete'
  } finally {
    deleteModalSubmitting.value = false
  }
}

provide('orgTreeApi', {
  editingGroupId,
  editingGroupName,
  startGroupRename,
  saveGroupRename,
  cancelGroupRename,
  openGroupDashboard,
  openSchoolDashboard,
  requestDeleteGroup,
  requestDeleteSchool: () => {},
  createSubgroup,
  createSchoolAt,
  leafJoinCode,
  ensureLeaf,
})

async function fetchOrgs(): Promise<void> {
  isLoading.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/admin/demo-schools', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)
    orgs.value = data.orgs || []
  } catch (err) {
    console.warn('[DemoOrgsPanel] org list fetch failed:', err)
  } finally {
    isLoading.value = false
  }
}

async function refresh(): Promise<void> {
  await Promise.all([fetchOrgs(), fetchTreeGroups()])
}

defineExpose({ refresh })

async function runAction(id: string, action: 'expire' | 'extend' | 'purge'): Promise<void> {
  if (action === 'purge' && !confirm('Purge permanently deletes this demo — its group tree, learners, and progress data. This cannot be undone. Continue?')) return
  error.value = null
  busyAction.value = `${action}:${id}`
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/admin/demo-schools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, id }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)
    await fetchOrgs()
    if (action === 'purge') await fetchTreeGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : `Failed to ${action} demo`
  } finally {
    busyAction.value = null
  }
}

async function toggleExpanded(org: DemoOrgRow): Promise<void> {
  if (expandedId.value === org.id) {
    expandedId.value = null
    return
  }
  expandedId.value = org.id
  if (org.group_id && !leavesByOrg.value[org.group_id]) {
    await fetchLeaves(org.group_id)
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isOverdue(org: DemoOrgRow): boolean {
  return org.status === 'active' && new Date(org.expires_at).getTime() < Date.now()
}

onMounted(() => {
  fetchOrgs()
  fetchTreeGroups()
})
</script>

<template>
  <div class="demo-orgs-panel">
    <Transition name="fade">
      <div v-if="error" class="banner banner-error">{{ error }}</div>
    </Transition>

    <div class="schools-card list-panel">
      <div class="panel-head panel-head-row">
        <span class="schools-kicker">Existing demos</span>
        <label class="show-expired-toggle">
          <input v-model="showExpired" type="checkbox" />
          Show expired{{ expiredCount ? ` (${expiredCount})` : '' }}
        </label>
      </div>

      <div v-if="visibleOrgs.length" class="orgs-table-wrap">
        <table class="codes-table">
          <thead>
            <tr>
              <th>Prospect</th>
              <th>Course</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Status</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="org in visibleOrgs" :key="org.id">
              <tr
                class="org-row"
                :class="{ 'is-inactive': org.status === 'expired' }"
                tabindex="0"
                role="button"
                :aria-expanded="expandedId === org.id"
                :aria-label="`${expandedId === org.id ? 'Hide' : 'View'} details for ${org.prospect_name}`"
                @click="toggleExpanded(org)"
                @keydown.enter="toggleExpanded(org)"
                @keydown.space.prevent="toggleExpanded(org)"
              >
                <td class="cell-org">{{ org.prospect_name }}</td>
                <td class="cell-muted">{{ org.course_code }}</td>
                <td class="cell-muted mono-nums">{{ formatDate(org.created_at) }}</td>
                <td class="cell-muted mono-nums" :class="{ 'cell-overdue': isOverdue(org) }">
                  {{ formatDate(org.expires_at) }}
                </td>
                <td>
                  <span class="status-pill" :class="org.status === 'active' ? 'tone-green' : 'tone-muted'">
                    <span class="status-dot"></span>
                    {{ org.status === 'active' ? (isOverdue(org) ? 'Overdue' : 'Active') : 'Expired' }}
                  </span>
                </td>
                <td class="cell-actions">
                  <button
                    class="row-action-text"
                    :disabled="busyAction === `extend:${org.id}`"
                    @click.stop="runAction(org.id, 'extend')"
                  >Extend 30d</button>
                  <button
                    v-if="org.status === 'active'"
                    class="row-action-text row-action-danger"
                    :disabled="busyAction === `expire:${org.id}`"
                    @click.stop="runAction(org.id, 'expire')"
                  >Expire now</button>
                  <button
                    v-if="org.status === 'expired'"
                    class="row-action-text row-action-danger"
                    :disabled="busyAction === `purge:${org.id}`"
                    @click.stop="runAction(org.id, 'purge')"
                  >Purge</button>
                </td>
              </tr>
              <tr v-if="expandedId === org.id" class="detail-row">
                <td colspan="6">
                  <div v-if="orgRootGroup(org)" class="org-tree-panel">
                    <div class="panel-head">
                      <span class="schools-kicker">Organisation tree</span>
                      <span class="panel-hint">Add sub-groups to match the prospect's shape — "Get join code" on any group for learners to join there.</span>
                    </div>
                    <div class="groups-tree">
                      <GroupTreeNode
                        :group="orgRootGroup(org)!"
                        :all-groups="treeGroups"
                        :all-schools="[]"
                        :depth="0"
                        entity-mode="leaf"
                      />
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-else-if="!isLoading" class="schools-card empty">
        <div class="empty-copy">
          <strong>{{ orgs.length ? 'No active demos' : 'No demos yet' }}</strong>
          <p v-if="orgs.length">Toggle "Show expired" above to see the {{ expiredCount }} expired demo{{ expiredCount === 1 ? '' : 's' }}.</p>
          <p v-else>Create one above to get a join code ready to share.</p>
        </div>
      </div>
    </div>

    <ConfirmDeleteModal
      :is-open="deleteModalOpen"
      :title="deleteModalTitle"
      :target-name="deleteModalTarget?.name || ''"
      :impact-lines="deleteModalImpactLines"
      :require-typed-confirm="!!deleteModalImpact?.hasRealActivity"
      :submitting="deleteModalSubmitting"
      :error="deleteModalError"
      @close="closeDeleteModal"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.demo-orgs-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.mono-nums { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

.banner {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

.list-panel { padding: 0; overflow: hidden; }

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.panel-head-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }

.show-expired-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--schools-fg-3);
  cursor: pointer;
  user-select: none;
}

.show-expired-toggle input { cursor: pointer; }

.orgs-table-wrap { overflow-x: auto; }

.codes-table { width: 100%; border-collapse: collapse; }

.codes-table thead th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: left;
  color: var(--schools-fg-3);
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  background: #fafafa;
}

.codes-table td {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--schools-fg-2);
  font-size: var(--text-sm);
}

.codes-table tbody tr.is-inactive { opacity: 0.55; }

.org-row { cursor: pointer; }
.org-row:hover { background: rgba(44, 38, 34, 0.03); }
.org-row:focus-visible { outline: 2px solid var(--schools-accent, currentColor); outline-offset: -2px; }

.cell-org { color: var(--schools-fg); font-weight: var(--font-medium); }
.cell-muted { color: var(--schools-fg-3); white-space: nowrap; }
.cell-overdue { color: rgb(var(--tone-red)); font-weight: var(--font-semibold); }

.cell-actions { display: flex; gap: 10px; white-space: nowrap; }

.row-action-text {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--schools-fg-2);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
}

.row-action-text:hover { color: var(--schools-fg); text-decoration: underline; }
.row-action-danger { color: rgb(var(--tone-red)); }
.row-action-text:disabled { opacity: 0.4; cursor: not-allowed; }

.detail-row td { padding: 0 18px 18px; background: rgba(255, 255, 255, 0.4); }

.org-tree-panel {
  margin-top: var(--space-4);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.org-tree-panel .panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.panel-hint {
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}

.groups-tree {
  padding: var(--space-3) var(--space-2) var(--space-3);
}

.group-rename-input {
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(var(--tone-red), 0.55);
  border-radius: var(--radius-sm);
  color: var(--schools-fg);
  width: 220px;
}

.group-rename-input:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}

.empty { padding: var(--space-8); text-align: center; }
.empty-copy strong { display: block; font-family: var(--font-display); font-size: var(--text-lg); color: var(--schools-fg); margin-bottom: 4px; }
.empty-copy p { margin: 0; color: var(--schools-fg-3); font-size: var(--text-sm); }

.fade-enter-active, .fade-leave-active { transition: opacity var(--transition-base); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
