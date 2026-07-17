<script setup lang="ts">
// Self-serve "Create demo organisation" tool (owner: Nick, Head of Partnerships).
// Provisions a full showcase ORGANISATION for a prospect — real accounts,
// real classes, realistic seeded activity — without engineering help, then
// lets the org's tree grow (sub-groups, more schools at any node) to match
// the prospect's real shape. Founder org model (CLAUDE.md): an organisation
// is just the root of the groups tree (`groups.parent_id`/`path`), `is_demo`
// cascading to every group/school built under it — no separate org table.
// Server logic: api/admin/demo-schools.ts + api/_utils/demoSchoolGen.ts for
// the seeded showcase; api/groups + api/admin/create-school for growing the
// tree afterwards (same endpoints the full org-management surface uses).
import { ref, computed, onMounted, nextTick, provide } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import DemoOrgResultCard, { type DemoStaffRow } from '@/components/admin/DemoOrgResultCard.vue'
import GroupTreeNode from '@/components/admin/GroupTreeNode.vue'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import type { ActAsPersona } from '@/composables/useUserRole'

const router = useRouter()

type OrgShape = 'single_school' | 'group' | 'government_region'

interface CourseOption {
  course_code: string
  display_name: string
}

interface DemoOrgRow {
  id: string
  created_at: string
  created_by: string
  prospect_name: string
  org_shape: OrgShape
  course_code: string
  group_id: string | null
  expires_at: string
  status: 'active' | 'expired'
  expired_at: string | null
  metadata: { orgName: string; staff: DemoStaffRow[]; counts: { schools: number; teachers: number; classes: number; learners: number }; lastActivityThrough?: string }
}

// Org-tree types — same shape GroupTreeNode.vue / SchoolsSetup.vue's
// orgTreeApi already use (see CLAUDE.md founder org model: an organisation
// is the root of the groups tree, arbitrary depth, is_demo cascading).
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
interface TreeSchool {
  id: string
  school_name: string
  group_id: string | null
  admin_user_id: string | null
}

const { getClient, getAuthToken } = useAdminClient()

const courses = ref<CourseOption[]>([])
const orgs = ref<DemoOrgRow[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)
const showAdvanced = ref(false)
const expandedId = ref<string | null>(null)
const busyAction = ref<string | null>(null)
const showExpired = ref(false)
const treeGroups = ref<TreeGroup[]>([])
const treeSchools = ref<TreeSchool[]>([])

const visibleOrgs = computed(() => showExpired.value ? orgs.value : orgs.value.filter((o) => o.status !== 'expired'))
const expiredCount = computed(() => orgs.value.filter((o) => o.status === 'expired').length)

// ─── Create form ─────────────────────────────────────────────────────────
const prospectName = ref('')
const orgShape = ref<OrgShape>('single_school')
const courseCode = ref('')
const numSchools = ref<number | ''>('')
const teachersPerSchool = ref<number | ''>('')
const classesPerSchool = ref<number | ''>('')
const learnersPerSchool = ref<number | ''>('')

const freshResult = ref<{
  orgName: string; orgShape: OrgShape; courseCode: string; expiresAt: string
  counts: { schools: number; teachers: number; classes: number; learners: number }
  staff: DemoStaffRow[]
} | null>(null)

const canSubmit = computed(() => !!prospectName.value.trim() && !!courseCode.value && !isCreating.value)

async function fetchCourses(): Promise<void> {
  try {
    const client = getClient()
    const { data, error: err } = await client
      .from('courses')
      .select('course_code, display_name')
      .eq('new_app_status', 'live')
      .order('display_name')
    if (err) throw err
    courses.value = (data || []).map((c: any) => ({ course_code: c.course_code, display_name: c.display_name || c.course_code }))
  } catch (err) {
    console.warn('[AdminDemoSchools] course fetch failed:', err)
  }
}

// ─── Org tree (GroupTreeNode reuse — see CLAUDE.md founder org model) ─────
async function fetchTreeGroups(): Promise<void> {
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/groups', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)
    treeGroups.value = data.groups || []
  } catch (err) {
    console.warn('[AdminDemoSchools] groups fetch failed:', err)
  }
}

async function fetchTreeSchools(): Promise<void> {
  try {
    const client = getClient()
    const { data, error: err } = await client
      .from('schools')
      .select('id, school_name, group_id, admin_user_id')
    if (err) throw err
    treeSchools.value = data || []
  } catch (err) {
    console.warn('[AdminDemoSchools] schools fetch failed:', err)
  }
}

function orgRootGroup(org: DemoOrgRow): TreeGroup | null {
  return treeGroups.value.find((g) => g.id === org.group_id) || null
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
      throw new Error(data.error || 'Failed to rename group')
    }
    await fetchTreeGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to rename group'
  }
}

function cancelGroupRename(): void {
  editingGroupId.value = null
}

function openGroupDashboard(groupId: string): void {
  router.push(`/admin/groups/${groupId}`)
}
function openSchoolDashboard(schoolId: string): void {
  router.push(`/admin/schools/${schoolId}`)
}

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

async function createSchoolAt(groupId: string, name: string): Promise<void> {
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch('/api/admin/create-school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ school_name: name, group_id: groupId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    await fetchTreeSchools()
    await fetchTreeGroups()
    await fetchOrgs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create school'
  }
}

// "View as" candidates — this tool doesn't track leader/staff learner ids
// the way SchoolsSetup's full org-management surface does (that data is
// already in the DemoOrgResultCard staff list below, with its own
// mint-sign-in-link action); the tree here is for building structure.
function groupLeaderCandidates(): ActAsPersona[] { return [] }
function schoolAdminCandidates(): ActAsPersona[] { return [] }

type DeleteTargetKind = 'group' | 'school'
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

const deleteModalTitle = computed(() =>
  deleteModalTarget.value?.kind === 'school' ? 'Delete school' : 'Delete group'
)
const deleteModalImpactLines = computed(() => {
  const impact = deleteModalImpact.value
  if (!impact) return []
  const lines: string[] = []
  if (impact.schoolCount !== undefined) lines.push(`${impact.schoolCount} school(s)`)
  if (impact.classCount !== undefined) lines.push(`${impact.classCount} class(es)`)
  lines.push(`${impact.sessionCount} session(s) recorded`)
  lines.push(`${impact.learnerCount} learner(s)`)
  lines.push(`${impact.teacherCount} teacher(s)`)
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
    const url = target.kind === 'group'
      ? `/api/groups/${target.id}`
      : `/api/admin/update-school?school_id=${encodeURIComponent(target.id)}`
    const resp = await fetch(url, { method: 'GET', headers })
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
function requestDeleteSchool(school: TreeSchool): void {
  void openDeleteModal({ kind: 'school', id: school.id, name: school.school_name })
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
    if (target.kind === 'group') {
      const params = typedName ? `?confirm_name=${encodeURIComponent(typedName)}` : ''
      const resp = await fetch(`/api/groups/${target.id}${params}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || 'Failed to delete group')
      await fetchTreeGroups()
      await fetchTreeSchools()
    } else {
      const params = new URLSearchParams({ school_id: target.id })
      if (typedName) params.set('confirm_name', typedName)
      const resp = await fetch(`/api/admin/update-school?${params.toString()}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || 'Failed to delete school')
      await fetchTreeSchools()
      await fetchTreeGroups()
    }
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
  requestDeleteSchool,
  createSubgroup,
  createSchoolAt,
  groupLeaderCandidates,
  schoolAdminCandidates,
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
    console.warn('[AdminDemoSchools] org list fetch failed:', err)
  } finally {
    isLoading.value = false
  }
}

async function createOrg(): Promise<void> {
  error.value = null
  freshResult.value = null
  isCreating.value = true
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')

    const body: Record<string, unknown> = {
      action: 'create',
      prospectName: prospectName.value.trim(),
      orgShape: orgShape.value,
      courseCode: courseCode.value,
    }
    if (numSchools.value !== '') body.numSchools = Number(numSchools.value)
    if (teachersPerSchool.value !== '') body.teachersPerSchool = Number(teachersPerSchool.value)
    if (classesPerSchool.value !== '') body.classesPerSchool = Number(classesPerSchool.value)
    if (learnersPerSchool.value !== '') body.learnersPerSchool = Number(learnersPerSchool.value)

    const resp = await fetch('/api/admin/demo-schools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)

    freshResult.value = data.org
    prospectName.value = ''
    numSchools.value = ''
    teachersPerSchool.value = ''
    classesPerSchool.value = ''
    learnersPerSchool.value = ''
    await fetchOrgs()
    await fetchTreeGroups()
    await fetchTreeSchools()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create demo school'
  } finally {
    isCreating.value = false
  }
}

async function runAction(id: string, action: 'expire' | 'extend' | 'refresh' | 'purge'): Promise<void> {
  if (action === 'purge' && !confirm('Purge permanently deletes this demo org — schools, classes, learners, and staff accounts. This cannot be undone. Continue?')) return
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
    if (action === 'purge') {
      await fetchTreeGroups()
      await fetchTreeSchools()
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : `Failed to ${action} demo org`
  } finally {
    busyAction.value = null
  }
}

function toggleExpanded(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}

function shapeLabel(shape: OrgShape): string {
  if (shape === 'single_school') return 'Single school'
  if (shape === 'group') return 'Group of schools'
  return 'Government region'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isOverdue(org: DemoOrgRow): boolean {
  return org.status === 'active' && new Date(org.expires_at).getTime() < Date.now()
}

// Falls back to created_at for orgs that predate this field (or have never
// been refreshed) — still a true "activity through" date, just the original one.
function activityThroughLabel(org: DemoOrgRow): string {
  return formatDate(org.metadata?.lastActivityThrough || org.created_at)
}

function isActivityStale(org: DemoOrgRow): boolean {
  const through = org.metadata?.lastActivityThrough || org.created_at
  return Date.now() - new Date(through).getTime() > 7 * 86400000
}

onMounted(() => {
  fetchCourses()
  fetchOrgs()
  fetchTreeGroups()
  fetchTreeSchools()
})
</script>

<template>
  <div class="admin-demo-schools">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Sales showcase</span>
        <h1 class="arsenal">Demo Organisations</h1>
        <p class="subtitle">
          Provision a full showcase organisation for a prospect — real accounts, real classes,
          realistic activity — in one click, then grow its tree (sub-groups, more schools) to
          match the prospect's shape. No engineering help needed.
        </p>
      </div>
    </header>

    <Transition name="fade">
      <div v-if="error" class="banner banner-error">{{ error }}</div>
    </Transition>

    <!-- Create form -->
    <div class="schools-card create-panel">
      <div class="panel-head">
        <span class="schools-kicker">Create demo organisation</span>
      </div>
      <form class="create-form" @submit.prevent="createOrg">
        <div class="field field-wide">
          <label class="schools-kicker">Prospect / org name <span class="required">*</span></label>
          <input v-model="prospectName" type="text" class="frost-input" placeholder="e.g. Riverside Learning Trust" />
        </div>

        <div class="field">
          <label class="schools-kicker">Org shape</label>
          <select v-model="orgShape" class="frost-select">
            <option value="single_school">Single school</option>
            <option value="group">Group of schools</option>
            <option value="government_region">Government region</option>
          </select>
        </div>

        <div class="field">
          <label class="schools-kicker">Language pair <span class="required">*</span></label>
          <select v-model="courseCode" class="frost-select">
            <option value="" disabled>Select a course…</option>
            <option v-for="c in courses" :key="c.course_code" :value="c.course_code">{{ c.display_name }}</option>
          </select>
        </div>

        <div class="field-actions field-actions-left">
          <button type="button" class="btn-ghost btn-small" @click="showAdvanced = !showAdvanced">
            {{ showAdvanced ? 'Hide' : 'Show' }} advanced options
          </button>
        </div>

        <template v-if="showAdvanced">
          <div v-if="orgShape !== 'single_school'" class="field">
            <label class="schools-kicker">Number of schools</label>
            <input v-model="numSchools" type="number" min="1" class="frost-input" placeholder="2" />
          </div>
          <div class="field">
            <label class="schools-kicker">Teachers per school</label>
            <input v-model="teachersPerSchool" type="number" min="1" class="frost-input" placeholder="2" />
          </div>
          <div class="field">
            <label class="schools-kicker">Classes per school</label>
            <input v-model="classesPerSchool" type="number" min="1" class="frost-input" placeholder="3" />
          </div>
          <div class="field">
            <label class="schools-kicker">Learners per school</label>
            <input v-model="learnersPerSchool" type="number" min="1" class="frost-input" placeholder="20-60" />
          </div>
        </template>

        <div class="field-actions">
          <button type="submit" class="btn-primary" :disabled="!canSubmit">
            {{ isCreating ? 'Creating…' : 'Create demo organisation' }}
          </button>
        </div>
      </form>
    </div>

    <!-- Fresh result -->
    <div v-if="freshResult" class="schools-card result-panel">
      <div class="panel-head">
        <span class="schools-kicker">Ready to share</span>
      </div>
      <DemoOrgResultCard
        :org-name="freshResult.orgName"
        :org-shape="freshResult.orgShape"
        :course-code="freshResult.courseCode"
        :expires-at="freshResult.expiresAt"
        :counts="freshResult.counts"
        :staff="freshResult.staff"
      />
    </div>

    <!-- List -->
    <div class="schools-card list-panel">
      <div class="panel-head panel-head-row">
        <span class="schools-kicker">Existing demo organisations</span>
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
              <th>Shape</th>
              <th>Course</th>
              <th>Created</th>
              <th>Activity through</th>
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
                @click="toggleExpanded(org.id)"
                @keydown.enter="toggleExpanded(org.id)"
                @keydown.space.prevent="toggleExpanded(org.id)"
              >
                <td class="cell-org">{{ org.prospect_name }}</td>
                <td class="cell-muted">{{ shapeLabel(org.org_shape) }}</td>
                <td class="cell-muted">{{ org.course_code }}</td>
                <td class="cell-muted mono-nums">{{ formatDate(org.created_at) }}</td>
                <td class="cell-muted mono-nums" :class="{ 'cell-overdue': isActivityStale(org) }">
                  {{ activityThroughLabel(org) }}
                </td>
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
                    class="row-action-text"
                    :disabled="busyAction === `refresh:${org.id}`"
                    @click.stop="runAction(org.id, 'refresh')"
                  >{{ busyAction === `refresh:${org.id}` ? 'Refreshing…' : 'Refresh activity' }}</button>
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
                <td colspan="8">
                  <DemoOrgResultCard
                    :org-name="org.metadata.orgName"
                    :org-shape="org.org_shape"
                    :course-code="org.course_code"
                    :expires-at="org.expires_at"
                    :counts="org.metadata.counts"
                    :staff="org.metadata.staff"
                  />
                  <div v-if="orgRootGroup(org)" class="org-tree-panel">
                    <div class="panel-head">
                      <span class="schools-kicker">Organisation tree</span>
                      <span class="panel-hint">Add sub-groups or more schools to match the prospect's real shape — hover a row for actions.</span>
                    </div>
                    <div class="groups-tree">
                      <GroupTreeNode
                        :group="orgRootGroup(org)!"
                        :all-groups="treeGroups"
                        :all-schools="treeSchools"
                        :depth="0"
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
          <strong>{{ orgs.length ? 'No active demo organisations' : 'No demo organisations yet' }}</strong>
          <p v-if="orgs.length">Toggle "Show expired" above to see the {{ expiredCount }} expired org{{ expiredCount === 1 ? '' : 's' }}.</p>
          <p v-else>Create one above to get a full showcase organisation ready to share.</p>
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
.admin-demo-schools {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.mono-nums { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

.page-header { margin-bottom: 22px; }

.title-block .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}

.title-block h1 {
  font-family: var(--font-display);
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 400;
  line-height: 1.04;
  letter-spacing: -0.015em;
  color: var(--ink-primary, #2C2622);
  margin: 8px 0 10px;
}

.subtitle {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  max-width: 64ch;
  margin: 0;
}

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

.create-panel, .result-panel, .list-panel { padding: 0; overflow: hidden; }

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

.create-form {
  padding: var(--space-5) var(--space-6) var(--space-6);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field-wide { grid-column: 1 / -1; }
.field-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; margin-top: var(--space-2); }
.field-actions-left { justify-content: flex-start; margin-top: 0; }

.required { color: rgb(var(--tone-red)); font-weight: var(--font-bold); }

.frost-input, .frost-select {
  font: inherit;
  font-size: var(--text-base);
  padding: 10px 14px;
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
}

.frost-select {
  appearance: none;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8078' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

.btn-primary {
  padding: 10px 18px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: var(--schools-red);
  color: #fff;
  cursor: pointer;
}

.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

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

/* Whole-row-clickable (founder ruling 2026-07-16): the row itself opens the
   detail expansion; action buttons opt out via @click.stop. */
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

/* Org tree (GroupTreeNode reuse — matches SchoolsSetup.vue's Groups tab styling) */
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

.group-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  color: var(--schools-fg-2);
}

.group-row:hover { background: rgba(255, 255, 255, 0.48); }

.group-name-editable {
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
  color: var(--schools-fg);
  font-weight: var(--font-semibold);
}

.group-name-editable:hover {
  background: rgba(44, 38, 34, 0.06);
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

.group-meta {
  margin-left: auto;
  color: var(--schools-fg-3);
  font-size: var(--text-xs);
}

.group-courses {
  font-size: var(--text-xs);
  color: rgb(var(--tone-green-ink));
  font-weight: var(--font-medium);
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transform: translateX(4px);
  transition: all var(--transition-fast);
}

.group-row:hover .row-actions,
.group-row:focus-within .row-actions {
  opacity: 1;
  transform: translateX(0);
}

.row-action {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--schools-fg-3);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.row-action:hover {
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(44, 38, 34, 0.10);
}

.row-action.is-danger:hover {
  color: rgb(var(--tone-red));
  background: rgba(var(--tone-red), 0.08);
  border-color: rgba(var(--tone-red), 0.30);
}

.empty { padding: var(--space-8); text-align: center; }
.empty-copy strong { display: block; font-family: var(--font-display); font-size: var(--text-lg); color: var(--schools-fg); margin-bottom: 4px; }
.empty-copy p { margin: 0; color: var(--schools-fg-3); font-size: var(--text-sm); }

.fade-enter-active, .fade-leave-active { transition: opacity var(--transition-base); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 768px) {
  .create-form { grid-template-columns: 1fr; }
}
</style>
