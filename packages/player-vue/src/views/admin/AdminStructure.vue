<script setup lang="ts">
// Structure — ONE surface for the org tree (2026-07-17 consolidation).
// Dissolves the old Setup tabs: Groups + Schools ARE the tree (creation
// happens AT a node, inline); Staff + Entitlements become facets of the
// selected node; the old raw join-code cells become a display-only
// "ways in" strip that links into /admin/invites (the doors surface).
// Four admin ideas: Structure (tree) · Invites (doors) · Users (people) ·
// Stats/Insights (numbers). Server behaviour unchanged — same endpoints
// as Setup used (/api/groups, /api/admin/create-school, create-staff,
// update-school, /api/entitlement/*).
import { ref, computed, onMounted, nextTick, provide } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import GroupTreeNode from '@/components/admin/GroupTreeNode.vue'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import ViewAsButton from '@/components/admin/ViewAsButton.vue'
import type { ActAsPersona } from '@/composables/useUserRole'

const router = useRouter()

interface School {
  id: string
  school_name: string
  group_id: string | null
  admin_user_id: string | null
  teacher_join_code: string
  admin_join_code: string
  created_at: string
}

interface Group {
  id: string
  name: string
  type: string
  parent_id: string | null
  path?: string
  is_demo?: boolean
  is_test?: boolean
  school_count: number
  granted_courses: string[]
}

interface Course {
  course_code: string
  display_name: string | null
  target_lang: string
  known_lang: string
}

const { getClient, getAuthToken } = useAdminClient()

// ─── Core state ───
const schools = ref<School[]>([])
const groups = ref<Group[]>([])
const courses = ref<Course[]>([])
const isLoadingGroups = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
// The invite link (if any) that belongs WITH the current success confirmation.
const inviteResult = ref<{ url: string; hint: string } | null>(null)
const copiedCode = ref<string | null>(null)

function setSuccess(message: string, invite: { url: string; hint: string } | null = null): void {
  successMessage.value = message
  inviteResult.value = invite
}

// ─── "View as" — read-only impersonation entry points ───
interface StaffMember {
  user_id: string
  display_name: string
  educational_role: string | null
  email: string | null
  school_id: string | null
  school_name: string | null
  role_in_context: string | null
}
const staffMembers = ref<StaffMember[]>([])
const isLoadingStaff = ref(false)

function staffToPersona(staff: StaffMember): ActAsPersona {
  return {
    key: staff.user_id,
    userId: staff.user_id,
    role: staff.role_in_context === 'admin' ? 'school_admin' : 'teacher',
    name: staff.display_name,
  }
}

function schoolAdminCandidates(school: School): ActAsPersona[] {
  return staffMembers.value
    .filter(s => s.school_id === school.id && s.role_in_context === 'admin' && s.user_id)
    .map(staffToPersona)
}

interface GovtAdminRow {
  user_id: string
  group_id: string | null
  display_name: string
}
const govtAdmins = ref<GovtAdminRow[]>([])

function groupLeaderCandidates(group: Group): ActAsPersona[] {
  return govtAdmins.value
    .filter(g => g.group_id === group.id)
    .map(g => ({ key: g.user_id, userId: g.user_id, role: 'govt_admin' as const, name: g.display_name }))
}

async function fetchGovtAdmins(): Promise<void> {
  try {
    const client = getClient()
    const { data: rows } = await client.from('govt_admins').select('user_id, group_id')
    if (!rows || rows.length === 0) {
      govtAdmins.value = []
      return
    }
    const userIds = rows.map((r: any) => r.user_id)
    const { data: learners } = await client
      .from('learners')
      .select('user_id, display_name')
      .in('user_id', userIds)
    const nameByUser = new Map((learners || []).map((l: any) => [l.user_id, l.display_name]))
    govtAdmins.value = rows.map((r: any) => ({
      user_id: r.user_id,
      group_id: r.group_id,
      display_name: nameByUser.get(r.user_id) || 'Group leader',
    }))
  } catch (err) {
    console.error('[Structure] fetch govt admins error:', err)
  }
}

// ─── Fetches (same endpoints Setup used) ───
// Schools claimed via the school_admin_join redemption path — same
// "claimed" signal as school_summary.has_admin, read separately here
// since this view queries `schools` directly.
const adminClaimedSchoolIds = ref<Set<string>>(new Set())

function schoolHasAdmin(school: School): boolean {
  return !!school.admin_user_id || adminClaimedSchoolIds.value.has(school.id)
}

async function fetchAdminClaimedSchoolIds(): Promise<void> {
  try {
    const client = getClient()
    const { data } = await client
      .from('user_tags')
      .select('tag_value')
      .eq('tag_type', 'school')
      .eq('role_in_context', 'admin')
      .is('removed_at', null)
    adminClaimedSchoolIds.value = new Set(
      (data || []).map((t: { tag_value: string }) => t.tag_value.replace('SCHOOL:', ''))
    )
  } catch (err) {
    console.error('[Structure] fetch admin-claimed schools error:', err)
  }
}

async function fetchSchools(): Promise<void> {
  const client = getClient()
  try {
    const { data, error: fetchError } = await client
      .from('schools')
      .select('id, school_name, group_id, admin_user_id, teacher_join_code, admin_join_code, created_at')
      .order('created_at', { ascending: false })
    if (fetchError) throw fetchError
    schools.value = data || []
    await fetchAdminClaimedSchoolIds()
  } catch (err) {
    console.error('[Structure] fetch schools error:', err)
  }
}

async function fetchGroups(): Promise<void> {
  isLoadingGroups.value = true
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const response = await fetch('/api/groups', { headers })
    if (!response.ok) throw new Error('Failed to fetch groups')
    const data = await response.json()
    groups.value = data.groups || []
  } catch (err) {
    console.error('[Structure] fetch groups error:', err)
  } finally {
    isLoadingGroups.value = false
  }
}

async function fetchCourses(): Promise<void> {
  try {
    const client = getClient()
    const { data } = await client
      .from('courses')
      .select('course_code, display_name, target_lang, known_lang')
      .order('display_name')
    courses.value = data || []
  } catch (err) {
    console.error('[Structure] fetch courses error:', err)
  }
}

async function fetchStaff(): Promise<void> {
  isLoadingStaff.value = true
  try {
    const client = getClient()
    const { data: rpcData, error: rpcError } = await client.rpc('get_staff_with_emails')
    const learners = rpcError ? [] : (rpcData || [])
    if (rpcError) {
      console.warn('[Structure] get_staff_with_emails RPC not available, falling back:', rpcError.message)
      const { data: fallback } = await client
        .from('learners')
        .select('user_id, display_name, educational_role')
        .in('educational_role', ['teacher', 'school_admin'])
        .order('display_name')
      if (fallback) learners.push(...fallback.map((l: any) => ({ ...l, email: null })))
    }
    if (learners.length === 0) {
      staffMembers.value = []
      return
    }
    const userIds = learners.map((l: any) => l.user_id)
    const { data: tags } = await client
      .from('user_tags')
      .select('user_id, tag_value, role_in_context')
      .eq('tag_type', 'school')
      .in('user_id', userIds)
      .is('removed_at', null)
    const tagMap = new Map<string, { school_id: string; role_in_context: string }>()
    tags?.forEach(t => {
      const schoolId = t.tag_value.replace('SCHOOL:', '')
      tagMap.set(t.user_id, { school_id: schoolId, role_in_context: t.role_in_context })
    })
    const schoolNameMap = new Map<string, string>()
    schools.value.forEach(s => schoolNameMap.set(s.id, s.school_name))
    staffMembers.value = learners.map((l: any) => {
      const tag = tagMap.get(l.user_id)
      return {
        user_id: l.user_id,
        display_name: l.display_name,
        educational_role: l.educational_role,
        email: l.email || null,
        school_id: tag?.school_id || null,
        school_name: tag ? (schoolNameMap.get(tag.school_id) || tag.school_id) : null,
        role_in_context: tag?.role_in_context || null,
      }
    })
  } catch (err) {
    console.error('[Structure] fetch staff error:', err)
  } finally {
    isLoadingStaff.value = false
  }
}

// ─── Entitlement grants (badge display + facet editing) ───
interface EntitlementGrant {
  group_id: string | null
  school_id: string | null
  granted_courses: string[]
}
const allGrants = ref<EntitlementGrant[]>([])

async function fetchGrants(): Promise<void> {
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const response = await fetch('/api/entitlement/grants', { headers })
    if (response.ok) {
      const data = await response.json()
      allGrants.value = data.grants || []
    }
  } catch (err) {
    console.error('[Structure] fetch grants error:', err)
  }
}

// ─── Tree helpers + search (filters the tree, schools included) ───
const rootGroups = computed(() => groups.value.filter(g => !g.parent_id))
const treeSearch = ref('')

function getChildGroups(parentId: string): Group[] {
  return groups.value.filter(g => g.parent_id === parentId)
}

function getGroupName(id: string): string {
  return groups.value.find(g => g.id === id)?.name || id
}

function textMatches(name: string): boolean {
  const q = treeSearch.value.trim().toLowerCase()
  return !q || name.toLowerCase().includes(q)
}
// A group stays visible if it, any descendant group, or any school in its
// subtree matches — school search still works, it just lands IN the tree.
function subtreeMatches(g: Group): boolean {
  if (textMatches(g.name)) return true
  if (schools.value.some(s => s.group_id === g.id && textMatches(s.school_name))) return true
  return getChildGroups(g.id).some(subtreeMatches)
}
const filteredRootGroups = computed(() => rootGroups.value.filter(subtreeMatches))

const ungroupedSchools = computed(() =>
  schools.value.filter(s => !s.group_id).filter(s => textMatches(s.school_name))
)

// ─── Selection — the node detail panel ───
type NodeKind = 'group' | 'school'
const selectedKind = ref<NodeKind | null>(null)
const selectedId = ref<string | null>(null)

const selectedGroup = computed(() =>
  selectedKind.value === 'group' ? groups.value.find(g => g.id === selectedId.value) || null : null
)
const selectedSchool = computed(() =>
  selectedKind.value === 'school' ? schools.value.find(s => s.id === selectedId.value) || null : null
)

function selectNode(kind: NodeKind, id: string): void {
  selectedKind.value = kind
  selectedId.value = id
  if (kind === 'group') {
    const g = groups.value.find(x => x.id === id)
    primeGrantEditor('group', id, g?.granted_courses || [])
  } else {
    primeSchoolGrantEditor(id)
  }
}

function clearSelection(): void {
  selectedKind.value = null
  selectedId.value = null
}

// Descendant group ids of a group (inclusive) — for the group staff facet.
function subtreeGroupIds(groupId: string): Set<string> {
  const ids = new Set<string>([groupId])
  const walk = (id: string) => {
    for (const child of getChildGroups(id)) {
      ids.add(child.id)
      walk(child.id)
    }
  }
  walk(groupId)
  return ids
}

const selectedGroupSchools = computed(() => {
  if (!selectedGroup.value) return []
  const ids = subtreeGroupIds(selectedGroup.value.id)
  return schools.value.filter(s => s.group_id && ids.has(s.group_id))
})

// Staff facet, scoped to the selection (school → that school; group → subtree).
const selectedStaff = computed(() => {
  if (selectedSchool.value) {
    const id = selectedSchool.value.id
    return staffMembers.value.filter(s => s.school_id === id)
  }
  if (selectedGroup.value) {
    const schoolIds = new Set(selectedGroupSchools.value.map(s => s.id))
    return staffMembers.value.filter(s => s.school_id && schoolIds.has(s.school_id))
  }
  return []
})

// ─── Inline creation (AT a node — same server paths as before) ───
async function createSubgroup(parentId: string, name: string): Promise<void> {
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ name, type: 'group', parent_id: parentId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    setSuccess(`Group "${name}" created`)
    await fetchGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create sub-group'
  }
}

async function createSchoolAt(groupId: string | null, name: string): Promise<void> {
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch('/api/admin/create-school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ school_name: name, group_id: groupId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    setSuccess(
      `School "${name}" created`,
      data.school?.admin_join_code
        ? {
            url: `${window.location.origin}/redeem/${data.school.admin_join_code}`,
            hint: 'Share this with the school admin — clicking it takes them straight to sign-in.',
          }
        : null,
    )
    await fetchSchools()
    await fetchGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create school'
  }
}

// Root "+ Add organisation" — inline, at the top of the tree.
const showAddOrg = ref(false)
const newOrgName = ref('')
const newOrgIsDemo = ref(false)
const isCreatingOrg = ref(false)

async function createOrganisation(): Promise<void> {
  if (!newOrgName.value.trim() || isCreatingOrg.value) return
  isCreatingOrg.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const body: Record<string, unknown> = { name: newOrgName.value.trim(), type: 'organisation' }
    if (newOrgIsDemo.value) body.is_demo = true
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    setSuccess(`Organisation "${data.group?.name || newOrgName.value.trim()}" created`)
    newOrgName.value = ''
    newOrgIsDemo.value = false
    showAddOrg.value = false
    await fetchGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create organisation'
  } finally {
    isCreatingOrg.value = false
  }
}

// ─── Rename (inline, via the tree's pencil action) ───
const editingGroupId = ref<string | null>(null)
const editingGroupName = ref('')

function startGroupRename(group: Group): void {
  editingGroupId.value = group.id
  editingGroupName.value = group.name
  nextTick(() => {
    const input = document.querySelector('.group-rename-input') as HTMLInputElement
    input?.focus()
    input?.select()
  })
}

async function saveGroupRename(group: Group): Promise<void> {
  const newName = editingGroupName.value.trim()
  editingGroupId.value = null
  if (!newName || newName === group.name) return
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const response = await fetch(`/api/groups/${group.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: newName }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to rename group')
    }
    setSuccess(`Group renamed to "${newName}"`)
    await fetchGroups()
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

// ─── Unified delete modal (unchanged wiring from Setup) ───
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

function requestDeleteGroup(group: Group): void {
  void openDeleteModal({ kind: 'group', id: group.id, name: group.name })
}
function requestDeleteSchool(school: School): void {
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
      setSuccess(`Group "${target.name}" deleted`)
    } else {
      const params = new URLSearchParams({ school_id: target.id })
      if (typedName) params.set('confirm_name', typedName)
      const resp = await fetch(`/api/admin/update-school?${params.toString()}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || 'Failed to delete school')
      setSuccess(`School "${target.name}" deleted`)
    }
    if (selectedId.value === target.id) clearSelection()
    deleteModalOpen.value = false
    deleteModalTarget.value = null
    await fetchGroups()
    await fetchSchools()
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
  createSchoolAt: (groupId: string, name: string) => createSchoolAt(groupId, name),
  groupLeaderCandidates,
  schoolAdminCandidates,
  selectNode,
  selectedNodeKey: computed(() =>
    selectedKind.value && selectedId.value ? `${selectedKind.value}:${selectedId.value}` : null
  ),
})

// ─── School facet: move between groups (same PATCH as Setup's dropdown) ───
async function updateSchoolGroup(school: School, groupId: string): Promise<void> {
  const previousGroupId = school.group_id
  const previousGroupName = previousGroupId ? getGroupName(previousGroupId) : null
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch('/api/admin/update-school', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ school_id: school.id, group_id: groupId || null }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    school.group_id = groupId || null
    if (groupId && previousGroupName) {
      setSuccess(`Moved "${school.school_name}" from ${previousGroupName} to ${getGroupName(groupId)} — entitlements may have changed.`)
    } else if (groupId) {
      setSuccess(`Assigned "${school.school_name}" to ${getGroupName(groupId)} — entitlements may have changed.`)
    } else {
      setSuccess(`Removed "${school.school_name}" from ${previousGroupName || 'group'}`)
    }
    await fetchGrants()
    await fetchGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update school group'
  }
}

// ─── Staff facet: add staff AT the selected school ───
const newStaffName = ref('')
const newStaffEmail = ref('')
const newStaffRole = ref<'teacher' | 'admin'>('teacher')
const isCreatingStaff = ref(false)
const showAddStaff = ref(false)

async function createStaff(): Promise<void> {
  const school = selectedSchool.value
  if (!school) return
  if (!newStaffName.value.trim() || !newStaffEmail.value.trim()) {
    error.value = 'Name and email are required'
    return
  }
  isCreatingStaff.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch('/api/admin/create-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        display_name: newStaffName.value.trim(),
        email: newStaffEmail.value.trim().toLowerCase(),
        school_id: school.id,
        role: newStaffRole.value,
      }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    const roleLabel = newStaffRole.value === 'admin' ? 'School Admin' : 'Teacher'
    setSuccess(`${roleLabel} "${newStaffName.value.trim()}" added to ${school.school_name}`)
    newStaffName.value = ''
    newStaffEmail.value = ''
    newStaffRole.value = 'teacher'
    showAddStaff.value = false
    await fetchStaff()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create staff member'
  } finally {
    isCreatingStaff.value = false
  }
}

// ─── Entitlements facet (scoped to the selected node) ───
const grantCourses = ref<string[]>([])
const isSavingGrant = ref(false)
const courseSearch = ref('')
const inheritedGroupName = ref<string | null>(null)
const inheritedCourseCount = ref(0)

function primeGrantEditor(_kind: 'group', _id: string, granted: string[]): void {
  grantCourses.value = [...granted]
  inheritedGroupName.value = null
  inheritedCourseCount.value = 0
}

function primeSchoolGrantEditor(schoolId: string): void {
  grantCourses.value = []
  inheritedGroupName.value = null
  inheritedCourseCount.value = 0
  const school = schools.value.find(s => s.id === schoolId)
  if (school?.group_id) {
    const groupGrant = allGrants.value.find(g => g.group_id === school.group_id && !g.school_id)
    if (groupGrant && groupGrant.granted_courses.length > 0) {
      inheritedGroupName.value = getGroupName(school.group_id)
      inheritedCourseCount.value = groupGrant.granted_courses.length
    }
  }
  // Load the school's existing direct grant.
  getAuthToken().then(async (t) => {
    try {
      const headers: Record<string, string> = {}
      if (t) headers['Authorization'] = `Bearer ${t}`
      const response = await fetch(`/api/entitlement/grants?school_id=${schoolId}`, { headers })
      if (response.ok) {
        const data = await response.json()
        if (data.grants?.length > 0 && selectedId.value === schoolId) {
          grantCourses.value = data.grants[0].granted_courses || []
        }
      }
    } catch { /* non-fatal */ }
  })
}

async function saveGrant(): Promise<void> {
  if (!selectedId.value || grantCourses.value.length === 0) {
    error.value = 'Select at least one course'
    return
  }
  isSavingGrant.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const body: Record<string, unknown> = { granted_courses: grantCourses.value }
    if (selectedKind.value === 'group') body.group_id = selectedId.value
    else body.school_id = selectedId.value
    const response = await fetch('/api/entitlement/grant', { method: 'POST', headers, body: JSON.stringify(body) })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to save grant')
    }
    const result = await response.json()
    const action = result.updated ? 'Updated' : 'Created'
    const targetName = selectedGroup.value?.name || selectedSchool.value?.school_name || ''
    setSuccess(`${action} entitlement for "${targetName}" — ${grantCourses.value.length} courses`)
    await fetchGroups()
    await fetchGrants()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save grant'
  } finally {
    isSavingGrant.value = false
  }
}

function toggleCourseGrant(courseCode: string): void {
  const idx = grantCourses.value.indexOf(courseCode)
  if (idx >= 0) grantCourses.value.splice(idx, 1)
  else grantCourses.value.push(courseCode)
}

// Language name lookup for the course picker grouping.
const LANG_NAMES: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian',
  por: 'Portuguese', zho: 'Chinese', jpn: 'Japanese', ara: 'Arabic', kor: 'Korean',
  cym: 'Welsh', gle: 'Irish', gla: 'Scottish Gaelic', bre: 'Breton', eus: 'Basque',
  cat: 'Catalan', cor: 'Cornish', glv: 'Manx', nld: 'Dutch', swe: 'Swedish',
  nor: 'Norwegian', fin: 'Finnish', pol: 'Polish', tur: 'Turkish', hin: 'Hindi',
  tha: 'Thai', vie: 'Vietnamese', ukr: 'Ukrainian', ron: 'Romanian', bul: 'Bulgarian',
  hrv: 'Croatian', ces: 'Czech', ell: 'Greek', heb: 'Hebrew', hun: 'Hungarian',
  ind: 'Indonesian', lav: 'Latvian', lit: 'Lithuanian', mkd: 'Macedonian', slk: 'Slovak',
  slv: 'Slovenian', srp: 'Serbian', tam: 'Tamil', sin: 'Sinhala', aze: 'Azerbaijani',
  isl: 'Icelandic', swa: 'Swahili', nep: 'Nepali',
}

function langName(code: string): string {
  return LANG_NAMES[code] || code
}

const groupedCourses = computed(() => {
  const q = courseSearch.value.toLowerCase().trim()
  const filtered = q
    ? courses.value.filter(c =>
        (c.display_name || c.course_code).toLowerCase().includes(q) ||
        c.course_code.toLowerCase().includes(q) ||
        langName(c.known_lang).toLowerCase().includes(q) ||
        langName(c.target_lang).toLowerCase().includes(q)
      )
    : courses.value
  const buckets: Record<string, Course[]> = {}
  for (const c of filtered) {
    const key = `For ${langName(c.known_lang)} speakers`
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(c)
  }
  return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b))
})

const filteredCoursesList = computed(() =>
  groupedCourses.value.flatMap(([, groupCourses]) => groupCourses)
)

function selectAllCourses(): void {
  for (const c of filteredCoursesList.value) {
    if (!grantCourses.value.includes(c.course_code)) grantCourses.value.push(c.course_code)
  }
}

function clearCourseSelection(): void {
  grantCourses.value = []
}

function formatCourseName(c: Course): string {
  return c.display_name || c.course_code
}

// Effective entitlements per school (direct beats inherited) — for the facet summary.
const schoolEntitlements = computed(() => {
  const map = new Map<string, { count: number; source: string }>()
  for (const school of schools.value) {
    const directGrant = allGrants.value.find(g => g.school_id === school.id)
    const groupGrant = school.group_id
      ? allGrants.value.find(g => g.group_id === school.group_id && !g.school_id)
      : null
    if (directGrant && directGrant.granted_courses.length > 0) {
      map.set(school.id, { count: directGrant.granted_courses.length, source: 'direct' })
    } else if (groupGrant && groupGrant.granted_courses.length > 0) {
      map.set(school.id, { count: groupGrant.granted_courses.length, source: `via ${getGroupName(school.group_id!)}` })
    }
  }
  return map
})

// ─── Ways in (display-only; management lives in /admin/invites) ───
const selectedWaysIn = computed(() => {
  const school = selectedSchool.value
  if (!school) return []
  return [
    { label: 'Teacher join', code: school.teacher_join_code },
    { label: 'School admin join', code: school.admin_join_code },
  ]
})

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
    copiedCode.value = code
    setTimeout(() => {
      if (copiedCode.value === code) copiedCode.value = null
    }, 2000)
  } catch {
    copiedCode.value = null
  }
}

onMounted(() => {
  fetchSchools().then(fetchStaff)
  fetchGroups()
  fetchCourses()
  fetchGrants()
  fetchGovtAdmins()
})
</script>

<template>
  <div class="admin-structure">
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Schools admin</span>
        <h1 class="arsenal">Structure</h1>
        <p class="subtitle">The whole org tree — create, rename and manage groups and schools at the node they belong to.</p>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ groups.length }}</span>
            groups
          </span>
          <span class="metric-sep">·</span>
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ schools.length }}</span>
            schools
          </span>
          <span class="metric-sep">·</span>
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ staffMembers.length }}</span>
            staff
          </span>
        </div>
      </div>
    </header>

    <!-- Banners -->
    <Transition name="fade">
      <div v-if="successMessage" class="banner banner-success" :class="{ 'banner-success--invite': inviteResult }">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div class="banner-body">
          <span>{{ successMessage }}</span>
          <div v-if="inviteResult" class="invite-result">
            <span class="schools-kicker">Invite link</span>
            <button
              type="button"
              class="code-chip is-large"
              :class="{ 'is-copied': copiedCode === inviteResult.url }"
              @click="copyCode(inviteResult.url)"
            >
              <span class="code-value frost-mono-nums">{{ inviteResult.url }}</span>
            </button>
            <span class="invite-hint">{{ inviteResult.hint }}</span>
          </div>
        </div>
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="error" class="banner banner-error">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span>{{ error }}</span>
      </div>
    </Transition>

    <!-- Search — filters the tree; schools included -->
    <div class="filter-bar">
      <svg class="filter-bar-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input v-model="treeSearch" class="filter-bar-input" type="text" placeholder="Search groups and schools…" />
    </div>

    <div class="structure-layout">
      <!-- ───── The tree IS the page ───── -->
      <div class="schools-card tree-panel">
        <div class="panel-head">
          <span class="schools-kicker">Organisations</span>
          <span class="panel-hint">Click a node to see its detail — hover a row for add, rename, dashboard and delete.</span>
        </div>

        <!-- Create at the root: a new organisation -->
        <div class="tree-root-actions">
          <button type="button" class="btn-ghost-sm" @click="showAddOrg = !showAddOrg">
            + Add organisation
          </button>
          <router-link class="invite-leader-link" to="/admin/invites">
            Invite a group leader → Invites
          </router-link>
        </div>
        <div v-if="showAddOrg" class="tree-inline-form root-inline-form">
          <input
            v-model="newOrgName"
            type="text"
            class="frost-input"
            placeholder="Organisation name"
            autofocus
            @keyup.enter="createOrganisation"
            @keyup.escape="showAddOrg = false"
          />
          <label class="checkbox-field">
            <input v-model="newOrgIsDemo" type="checkbox" />
            <span>Demo</span>
          </label>
          <button class="btn-ghost-sm" :disabled="isCreatingOrg || !newOrgName.trim()" @click="createOrganisation">
            {{ isCreatingOrg ? 'Adding…' : 'Add' }}
          </button>
        </div>

        <div class="groups-tree">
          <GroupTreeNode
            v-for="group in filteredRootGroups"
            :key="group.id"
            :group="group"
            :all-groups="groups"
            :all-schools="schools"
            :depth="0"
            :search="treeSearch"
          />

          <!-- Schools not yet in any group — still part of the structure -->
          <template v-if="ungroupedSchools.length > 0">
            <div class="ungrouped-head schools-kicker">Ungrouped schools</div>
            <div
              v-for="school in ungroupedSchools"
              :key="school.id"
              class="entity-row"
              :class="{ 'is-selected': selectedKind === 'school' && selectedId === school.id }"
              @click="selectNode('school', school.id)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="entity-icon">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span class="entity-name">{{ school.school_name }}</span>
              <span v-if="!schoolHasAdmin(school)" class="status-pill tone-red"><span class="status-dot"></span>Awaiting admin</span>
            </div>
          </template>
        </div>

        <div v-if="rootGroups.length === 0 && ungroupedSchools.length === 0 && !isLoadingGroups" class="tree-empty">
          <strong>No organisations yet</strong>
          <p>Add one above — or invite a group leader from Invites and let them build their own tree.</p>
        </div>
        <div v-else-if="treeSearch && filteredRootGroups.length === 0 && ungroupedSchools.length === 0" class="tree-empty">
          <strong>Nothing matches "{{ treeSearch }}"</strong>
          <p>Try a different search.</p>
        </div>
      </div>

      <!-- ───── Node detail — facets of the selection ───── -->
      <div class="schools-card detail-panel">
        <!-- Empty state -->
        <div v-if="!selectedGroup && !selectedSchool" class="detail-empty">
          <div class="empty-ghost">node</div>
          <div class="empty-copy">
            <strong>Select a node</strong>
            <p>Click a group or school in the tree to see its staff, entitlements and ways in.</p>
          </div>
        </div>

        <!-- GROUP detail -->
        <template v-else-if="selectedGroup">
          <div class="panel-head detail-head">
            <div class="detail-title">
              <span class="schools-kicker">Group</span>
              <h2>{{ selectedGroup.name }}</h2>
              <span v-if="selectedGroup.is_demo" class="org-badge is-demo">Demo</span>
            </div>
            <div class="detail-actions">
              <button class="btn-ghost-sm" @click="openGroupDashboard(selectedGroup.id)">Dashboard</button>
              <ViewAsButton :candidates="groupLeaderCandidates(selectedGroup)" empty-title="No group leader yet" />
              <button class="btn-ghost-sm" @click="clearSelection">✕</button>
            </div>
          </div>

          <div class="detail-meta">
            <span>{{ selectedGroupSchools.length }} school{{ selectedGroupSchools.length === 1 ? '' : 's' }} in this subtree</span>
            <span v-if="groupLeaderCandidates(selectedGroup).length > 0">
              · leader: {{ groupLeaderCandidates(selectedGroup).map(l => l.name).join(', ') }}
            </span>
          </div>

          <!-- Ways in — display only; management lives in Invites -->
          <div class="facet">
            <div class="facet-head">
              <span class="schools-kicker">Ways in</span>
              <router-link class="facet-link" :to="`/admin/invites?q=${encodeURIComponent(selectedGroup.name)}`">
                Manage in Invites →
              </router-link>
            </div>
            <p class="facet-hint">Leader invites and every code that lands under this group live on the Invites page.</p>
          </div>

          <!-- Staff across the subtree -->
          <div class="facet">
            <div class="facet-head">
              <span class="schools-kicker">Staff</span>
              <span class="facet-count frost-mono-nums">{{ selectedStaff.length }}</span>
            </div>
            <div v-if="selectedStaff.length > 0" class="staff-list">
              <div v-for="staff in selectedStaff" :key="staff.user_id" class="staff-row">
                <span class="staff-name">{{ staff.display_name }}</span>
                <span class="staff-email">{{ staff.email || '—' }}</span>
                <span class="status-pill" :class="staff.role_in_context === 'admin' ? 'tone-red' : 'tone-green'">
                  <span class="status-dot"></span>{{ staff.role_in_context === 'admin' ? 'Admin' : 'Teacher' }}
                </span>
                <span class="staff-school">{{ staff.school_name || '—' }}</span>
                <ViewAsButton :candidates="[staffToPersona(staff)]" />
              </div>
            </div>
            <p v-else class="facet-hint">No staff in this subtree yet — select a school to add some.</p>
          </div>

          <!-- Entitlements at the group -->
          <div class="facet">
            <div class="facet-head">
              <span class="schools-kicker">Entitlements</span>
              <span class="facet-count frost-mono-nums">{{ grantCourses.length }} selected</span>
            </div>
            <p class="facet-hint">Courses granted here cascade to every school under this group.</p>
            <div class="picker-actions">
              <button type="button" class="link-btn" @click="selectAllCourses">Select all</button>
              <button type="button" class="link-btn" @click="clearCourseSelection">Clear</button>
              <input v-model="courseSearch" type="text" class="frost-input picker-search" placeholder="Search courses…" />
            </div>
            <div v-for="[groupLabel, groupCourses] in groupedCourses" :key="groupLabel" class="course-group">
              <div class="course-group-header">{{ groupLabel }}</div>
              <div class="course-grid">
                <button
                  v-for="c in groupCourses"
                  :key="c.course_code"
                  type="button"
                  class="course-chip"
                  :class="{ 'is-selected': grantCourses.includes(c.course_code) }"
                  @click="toggleCourseGrant(c.course_code)"
                >
                  {{ formatCourseName(c) }}
                </button>
              </div>
            </div>
            <div class="facet-actions">
              <button type="button" class="btn-primary" :disabled="isSavingGrant || grantCourses.length === 0" @click="saveGrant">
                <span v-if="isSavingGrant" class="spinner"></span>
                {{ isSavingGrant ? 'Saving…' : 'Save entitlement' }}
              </button>
            </div>
          </div>
        </template>

        <!-- SCHOOL detail -->
        <template v-else-if="selectedSchool">
          <div class="panel-head detail-head">
            <div class="detail-title">
              <span class="schools-kicker">School</span>
              <h2>{{ selectedSchool.school_name }}</h2>
              <span v-if="!schoolHasAdmin(selectedSchool)" class="status-pill tone-red"><span class="status-dot"></span>Awaiting admin</span>
              <span v-else class="status-pill tone-green"><span class="status-dot"></span>Claimed</span>
            </div>
            <div class="detail-actions">
              <button class="btn-ghost-sm" @click="openSchoolDashboard(selectedSchool.id)">Dashboard</button>
              <ViewAsButton :candidates="schoolAdminCandidates(selectedSchool)" empty-title="No school admin claimed yet" />
              <button class="btn-ghost-sm" title="Delete school" @click="requestDeleteSchool(selectedSchool)">Delete</button>
              <button class="btn-ghost-sm" @click="clearSelection">✕</button>
            </div>
          </div>

          <div class="detail-meta">
            <label class="schools-kicker">Group</label>
            <select
              class="inline-select"
              :value="selectedSchool.group_id || ''"
              @change="updateSchoolGroup(selectedSchool, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">— None —</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
            <span v-if="schoolEntitlements.get(selectedSchool.id)" class="entitlement-badge">
              <span class="entitlement-count frost-mono-nums">{{ schoolEntitlements.get(selectedSchool.id)!.count }}</span>
              <span class="entitlement-label">courses {{ schoolEntitlements.get(selectedSchool.id)!.source }}</span>
            </span>
          </div>

          <!-- Ways in — display only, linking into Invites filtered to this node -->
          <div class="facet">
            <div class="facet-head">
              <span class="schools-kicker">Ways in</span>
            </div>
            <div class="waysin-strip">
              <router-link
                v-for="way in selectedWaysIn"
                :key="way.code"
                class="waysin-item"
                :to="`/admin/invites?q=${encodeURIComponent(way.code)}`"
              >
                <span class="waysin-label">{{ way.label }}</span>
                <span class="waysin-manage">manage in Invites →</span>
              </router-link>
            </div>
          </div>

          <!-- Staff at this school -->
          <div class="facet">
            <div class="facet-head">
              <span class="schools-kicker">Staff</span>
              <span class="facet-count frost-mono-nums">{{ selectedStaff.length }}</span>
              <button type="button" class="link-btn" @click="showAddStaff = !showAddStaff">
                {{ showAddStaff ? 'Cancel' : '+ Add staff' }}
              </button>
            </div>
            <form v-if="showAddStaff" class="staff-add-form" @submit.prevent="createStaff">
              <input v-model="newStaffName" type="text" class="frost-input" placeholder="Name" />
              <input v-model="newStaffEmail" type="email" class="frost-input" placeholder="Email" />
              <select v-model="newStaffRole" class="frost-select">
                <option value="teacher">Teacher</option>
                <option value="admin">School Admin</option>
              </select>
              <button
                type="submit"
                class="btn-primary"
                :disabled="isCreatingStaff || !newStaffName.trim() || !newStaffEmail.trim()"
              >
                <span v-if="isCreatingStaff" class="spinner"></span>
                {{ isCreatingStaff ? 'Adding…' : 'Add' }}
              </button>
            </form>
            <div v-if="selectedStaff.length > 0" class="staff-list">
              <div v-for="staff in selectedStaff" :key="staff.user_id" class="staff-row">
                <span class="staff-name">{{ staff.display_name }}</span>
                <span class="staff-email">{{ staff.email || '—' }}</span>
                <span class="status-pill" :class="staff.role_in_context === 'admin' ? 'tone-red' : 'tone-green'">
                  <span class="status-dot"></span>{{ staff.role_in_context === 'admin' ? 'Admin' : 'Teacher' }}
                </span>
                <ViewAsButton :candidates="[staffToPersona(staff)]" />
              </div>
            </div>
            <p v-else-if="!isLoadingStaff" class="facet-hint">No staff at this school yet.</p>
          </div>

          <!-- Entitlements at the school -->
          <div class="facet">
            <div class="facet-head">
              <span class="schools-kicker">Entitlements</span>
              <span class="facet-count frost-mono-nums">{{ grantCourses.length }} selected</span>
            </div>
            <div v-if="inheritedGroupName" class="inherited-notice">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              Inherited from {{ inheritedGroupName }}: {{ inheritedCourseCount }} courses
            </div>
            <div class="picker-actions">
              <button type="button" class="link-btn" @click="selectAllCourses">Select all</button>
              <button type="button" class="link-btn" @click="clearCourseSelection">Clear</button>
              <input v-model="courseSearch" type="text" class="frost-input picker-search" placeholder="Search courses…" />
            </div>
            <div v-for="[groupLabel, groupCourses] in groupedCourses" :key="groupLabel" class="course-group">
              <div class="course-group-header">{{ groupLabel }}</div>
              <div class="course-grid">
                <button
                  v-for="c in groupCourses"
                  :key="c.course_code"
                  type="button"
                  class="course-chip"
                  :class="{ 'is-selected': grantCourses.includes(c.course_code) }"
                  @click="toggleCourseGrant(c.course_code)"
                >
                  {{ formatCourseName(c) }}
                </button>
              </div>
            </div>
            <div class="facet-actions">
              <button type="button" class="btn-primary" :disabled="isSavingGrant || grantCourses.length === 0" @click="saveGrant">
                <span v-if="isSavingGrant" class="spinner"></span>
                {{ isSavingGrant ? 'Saving…' : 'Save entitlement' }}
              </button>
            </div>
          </div>
        </template>
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
.admin-structure {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Page header — Stats/Methodology tokens, verbatim */
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
  margin: 0 0 14px;
}

.metrics {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--ink-muted, #8A8078);
  font-size: var(--text-sm);
}

.metric-value {
  color: var(--ink-primary, #2C2622);
  font-weight: var(--font-semibold);
  margin-right: 4px;
}

.metric-sep { color: var(--ink-muted, #8A8078); }

/* Banners */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-success {
  background: rgba(var(--tone-green), 0.10);
  border: 1px solid rgba(var(--tone-green), 0.28);
  color: rgb(var(--tone-green-ink));
}

.banner-success--invite { align-items: flex-start; }

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

.banner-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.invite-result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-top: 6px;
}

.invite-hint {
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
  margin-top: 4px;
}

.code-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-md);
  font: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--schools-fg-2);
}

.code-chip:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.16);
}

.code-chip.is-copied {
  background: rgba(var(--tone-green), 0.16);
  border-color: rgba(var(--tone-green), 0.45);
  color: rgb(var(--tone-green-ink));
}

.code-chip.is-large { padding: 10px 16px; font-size: var(--text-base); }
.code-chip.is-large .code-value { font-size: var(--text-sm); letter-spacing: 0.03em; word-break: break-all; text-align: left; }

/* ───── Layout: tree + detail side by side on wide screens ───── */
.structure-layout {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 4fr);
  gap: var(--space-5);
  align-items: start;
}

@media (max-width: 1100px) {
  .structure-layout { grid-template-columns: 1fr; }
}

/* Panels */
.tree-panel,
.detail-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
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

/* Root actions row */
.tree-root-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4) 0;
  flex-wrap: wrap;
}

.invite-leader-link {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--schools-fg-3);
  text-decoration: none;
}
.invite-leader-link:hover { color: var(--schools-red); text-decoration: underline; }

.root-inline-form { padding-top: var(--space-2); }

.checkbox-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--schools-fg-2);
  cursor: pointer;
  white-space: nowrap;
}
.checkbox-field input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: rgb(var(--tone-red));
  cursor: pointer;
}

/* Groups tree */
.groups-tree {
  padding: var(--space-3) var(--space-2) var(--space-3);
}

.tree-inline-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1, 4px) var(--space-4) var(--space-2);
}
.tree-inline-form .frost-input { max-width: 260px; }

.tree-empty {
  padding: var(--space-6);
  color: var(--schools-fg-3);
  font-size: var(--text-sm);
}
.tree-empty strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--schools-fg);
  margin-bottom: 4px;
}
.tree-empty p { margin: 0; }

.ungrouped-head {
  padding: var(--space-3) var(--space-4) var(--space-1);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
}

.entity-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1, 4px) var(--space-4);
  font-size: var(--text-sm);
  color: var(--schools-fg-2);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.entity-row:hover { background: rgba(255, 255, 255, 0.4); }
.entity-row.is-selected { background: rgba(var(--tone-gold), 0.14); }
.entity-icon { color: var(--schools-fg-3); flex-shrink: 0; }
.entity-name { font-weight: var(--font-medium); }

/* ───── Detail panel ───── */
.detail-empty {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-6);
  align-items: center;
  padding: var(--space-10) var(--space-8);
  min-height: 180px;
}

.empty-ghost {
  font-family: var(--font-display);
  font-size: 88px;
  font-weight: var(--font-bold);
  letter-spacing: -0.03em;
  color: var(--schools-fg-3);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--schools-fg);
  margin-bottom: 4px;
}

.empty-copy p {
  margin: 0;
  color: var(--schools-fg-3);
  font-size: var(--text-sm);
}

.detail-head { align-items: center; }

.detail-title {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  min-width: 0;
}

.detail-title h2 {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 400;
  color: var(--schools-fg);
  margin: 0;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  font-size: var(--text-sm);
  color: var(--schools-fg-3);
  flex-wrap: wrap;
}

.org-badge {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 2px 8px;
  border-radius: var(--radius-full, 999px);
  background: rgba(44, 38, 34, 0.06);
  color: var(--schools-fg-3);
}
.org-badge.is-demo {
  background: rgba(var(--tone-amber, 194 132 58), 0.12);
  color: rgb(var(--tone-amber-ink, 154 96 24));
}

/* Facets */
.facet {
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid rgba(44, 38, 34, 0.06);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.facet-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.facet-count {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}

.facet-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}

.facet-link {
  margin-left: auto;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--schools-fg-2);
  text-decoration: none;
}
.facet-link:hover { color: var(--schools-red); text-decoration: underline; }

.facet-actions {
  display: flex;
  justify-content: flex-end;
}

/* Ways in strip */
.waysin-strip {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.waysin-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.45);
  text-decoration: none;
  transition: all var(--transition-fast);
}

.waysin-item:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(44, 38, 34, 0.16);
}

.waysin-label {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--schools-fg);
}

.waysin-manage {
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}
.waysin-item:hover .waysin-manage { color: var(--schools-red); }

/* Staff facet */
.staff-list {
  display: flex;
  flex-direction: column;
}

.staff-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  font-size: var(--text-sm);
}
.staff-row:last-child { border-bottom: none; }

.staff-name {
  color: var(--schools-fg);
  font-weight: var(--font-medium);
  min-width: 0;
}

.staff-email {
  color: var(--schools-fg-3);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.staff-school {
  color: var(--schools-fg-3);
  font-size: var(--text-xs);
}

.staff-add-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.staff-add-form .frost-input,
.staff-add-form .frost-select { min-width: 0; }

/* Inputs */
.frost-input,
.frost-select {
  font: inherit;
  font-size: var(--text-sm);
  padding: 8px 12px;
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder { color: var(--schools-fg-3); }

.frost-input:focus,
.frost-select:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}

.frost-select {
  appearance: none;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8078' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

.inline-select {
  font: inherit;
  font-size: var(--text-xs);
  padding: 4px 26px 4px 10px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-md);
  color: var(--schools-fg);
  cursor: pointer;
  appearance: none;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238A8078' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  max-width: 220px;
}

.inline-select:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.45);
  box-shadow: 0 0 0 2px rgba(var(--tone-red), 0.12);
}

.entitlement-badge {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--text-xs);
  color: rgb(var(--tone-green-ink));
  font-weight: var(--font-medium);
}

.entitlement-count {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

.entitlement-label {
  color: var(--schools-fg-3);
  font-weight: var(--font-normal);
}

.inherited-notice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: rgba(var(--tone-blue), 0.08);
  border: 1px solid rgba(var(--tone-blue), 0.28);
  border-radius: var(--radius-md);
  color: rgb(var(--tone-blue-ink));
  font-size: var(--text-xs);
}

/* Course picker */
.picker-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.picker-search {
  max-width: 220px;
  padding: 6px 10px;
  font-size: var(--text-xs);
}

.link-btn {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  background: none;
  border: none;
  color: var(--schools-fg-3);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast);
}

.link-btn:hover { color: var(--schools-fg); }

.course-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.course-group-header {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
  padding: 4px 0 2px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
}

.course-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
}

.course-chip {
  font: inherit;
  font-size: var(--text-xs);
  padding: 5px 12px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(255, 255, 255, 0.55);
  color: var(--schools-fg-2);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.course-chip:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.20);
  color: var(--schools-fg);
}

.course-chip.is-selected {
  background: rgba(var(--tone-gold), 0.18);
  border-color: rgba(var(--tone-gold), 0.45);
  color: rgb(var(--tone-gold-ink));
  font-weight: var(--font-medium);
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 16px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: var(--schools-red);
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-base);
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.08), 0 4px 14px rgba(194, 58, 58, 0.22);
}

.btn-primary:hover:not(:disabled) {
  background: var(--schools-red-deep);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-ghost-sm {
  padding: 6px 12px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  border-radius: var(--radius-md);
  border: 1px solid rgba(44, 38, 34, 0.14);
  background: rgba(255, 255, 255, 0.6);
  color: var(--schools-fg-2);
  cursor: pointer;
  white-space: nowrap;
}
.btn-ghost-sm:hover:not(:disabled) { background: rgba(255, 255, 255, 0.9); }
.btn-ghost-sm:disabled { opacity: 0.5; cursor: not-allowed; }

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Transitions */
.fade-enter-active, .fade-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Mobile */
@media (max-width: 768px) {
  .staff-add-form { grid-template-columns: 1fr; }
  .detail-head { flex-direction: column; align-items: flex-start; }
}
</style>
