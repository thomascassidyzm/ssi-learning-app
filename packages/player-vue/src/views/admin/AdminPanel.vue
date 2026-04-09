<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useAdminClient } from '@/composables/useAdminClient'
import { useGodMode } from '@/composables/schools/useGodMode'
import Card from '@/components/schools/shared/Card.vue'

interface Region {
  code: string
  name: string
}

interface InviteCode {
  id: string
  code: string
  code_type: string
  region_code: string | null
  organization_name: string | null
  created_at: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  is_active: boolean
}

const { user, learner } = useAuth()
const { getClient, getAuthToken } = useAdminClient()
const { selectedUser } = useGodMode()

// Determine current user's platform_role
const isSsiAdmin = ref(false)
const isGovtAdmin = ref(false)

interface School {
  id: string
  school_name: string
  region_code: string | null
  group_id: string | null
  teacher_join_code: string
  created_at: string
}

// State
const regions = ref<Region[]>([])
const codes = ref<InviteCode[]>([])
const schools = ref<School[]>([])
const isLoadingCodes = ref(false)
const isLoadingSchools = ref(false)
const isCreating = ref(false)
const isCreatingSchool = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const copiedCode = ref<string | null>(null)

// Form state
const selectedRegion = ref('')
const organizationName = ref('')
const expiresAt = ref('')
const maxUses = ref<number | ''>('')
const codeType = ref<'ssi_admin' | 'govt_admin' | 'school_admin'>('govt_admin')

// School form state
const newSchoolName = ref('')
const newSchoolRegion = ref('')
const newSchoolGroup = ref('')

// Groups & entitlements
interface Group {
  id: string
  name: string
  type: string
  parent_id: string | null
  school_count: number
  granted_courses: string[]
}

interface Course {
  course_code: string
  display_name: string | null
  target_lang: string
  known_lang: string
}

const groups = ref<Group[]>([])
const courses = ref<Course[]>([])
const isLoadingGroups = ref(false)
const isCreatingGroup = ref(false)
const isSavingGrant = ref(false)

// Group form
const newGroupName = ref('')
const newGroupType = ref('region')
const newGroupParent = ref('')

// Grant form
const grantTargetType = ref<'group' | 'school'>('group')
const grantTargetId = ref('')
const grantCourses = ref<string[]>([])

// Group tree helpers
const rootGroups = computed(() => groups.value.filter(g => !g.parent_id))

function getChildGroups(parentId: string): Group[] {
  return groups.value.filter(g => g.parent_id === parentId)
}

function getGroupName(id: string): string {
  return groups.value.find(g => g.id === id)?.name || id
}

function getCurrentUserId(): string | null {
  if (selectedUser.value) return selectedUser.value.user_id
  if (user.value) return user.value.id
  if (learner.value) return learner.value.user_id
  return null
}

async function fetchRegionsAndCodes(): Promise<void> {
  const client = getClient()
  const userId = getCurrentUserId()
  if (!userId) return

  isLoadingCodes.value = true
  error.value = null

  try {
    // Fetch regions
    const { data: regionData, error: regionError } = await client
      .from('regions')
      .select('code, name')
      .order('name')

    if (regionError) throw regionError
    regions.value = regionData || []

    // Determine admin role
    const { data: learnerData } = await client
      .from('learners')
      .select('platform_role, educational_role')
      .eq('user_id', userId)
      .single()

    if (learnerData) {
      isSsiAdmin.value = learnerData.platform_role === 'ssi_admin' || learnerData.educational_role === 'god'
      isGovtAdmin.value = learnerData.educational_role === 'govt_admin'
    } else if (selectedUser.value) {
      isSsiAdmin.value = selectedUser.value.platform_role === 'ssi_admin'
      isGovtAdmin.value = selectedUser.value.educational_role === 'govt_admin'
    }

    // Set default code type based on role
    if (!isSsiAdmin.value && isGovtAdmin.value) {
      codeType.value = 'school_admin'
    }

    // Fetch invite codes created by this user
    const { data: codesData, error: codesError } = await client
      .from('invite_codes')
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false })

    if (codesError) throw codesError
    codes.value = codesData || []
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load data'
    console.error('[AdminPanel] fetch error:', err)
  } finally {
    isLoadingCodes.value = false
  }
}

async function fetchSchools(): Promise<void> {
  const client = getClient()
  isLoadingSchools.value = true

  try {
    const { data, error: fetchError } = await client
      .from('schools')
      .select('id, school_name, region_code, group_id, teacher_join_code, created_at')
      .order('created_at', { ascending: false })

    if (fetchError) throw fetchError
    schools.value = data || []
  } catch (err) {
    console.error('[AdminPanel] fetch schools error:', err)
  } finally {
    isLoadingSchools.value = false
  }
}

async function createSchool(): Promise<void> {
  if (!newSchoolName.value.trim()) {
    error.value = 'School name is required'
    return
  }

  isCreatingSchool.value = true
  error.value = null
  successMessage.value = null

  try {
    const client = getClient()

    // Get user ID from Supabase session (must match auth.uid() for RLS)
    const { data: { session } } = await client.auth.getSession()
    const userId = session?.user?.id || getCurrentUserId()
    if (!userId) throw new Error('No user ID — are you logged in?')

    const row: Record<string, unknown> = {
      school_name: newSchoolName.value.trim(),
      admin_user_id: userId,
    }
    if (newSchoolRegion.value) row.region_code = newSchoolRegion.value
    if (newSchoolGroup.value) row.group_id = newSchoolGroup.value

    const { data, error: insertError } = await client
      .from('schools')
      .insert(row)
      .select('id, school_name, teacher_join_code')
      .single()

    if (insertError) throw insertError

    // Create invite_codes row so teachers can redeem the join code
    const { error: inviteError } = await client
      .from('invite_codes')
      .insert({
        code: data.teacher_join_code,
        code_type: 'teacher',
        grants_school_id: data.id,
        created_by: userId,
        is_active: true,
      })

    if (inviteError) {
      console.error('[AdminPanel] Failed to create invite code for teacher join code:', inviteError)
    }

    successMessage.value = `School "${data.school_name}" created — join code: ${data.teacher_join_code}`
    newSchoolName.value = ''
    newSchoolRegion.value = ''
    newSchoolGroup.value = ''

    await fetchSchools()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create school'
    console.error('[AdminPanel] create school error:', err)
  } finally {
    isCreatingSchool.value = false
  }
}

async function createCode(): Promise<void> {
  if (!organizationName.value.trim()) {
    error.value = 'Organization name is required'
    return
  }

  isCreating.value = true
  error.value = null
  successMessage.value = null

  try {
    const token = await getAuthToken()

    const body: Record<string, unknown> = {
      code_type: codeType.value,
      organization_name: organizationName.value.trim(),
    }

    if (selectedRegion.value) body.region_code = selectedRegion.value
    if (expiresAt.value) body.expires_at = new Date(expiresAt.value).toISOString()
    if (maxUses.value !== '') body.max_uses = Number(maxUses.value)

    // If god mode, include created_by
    if (selectedUser.value) {
      body.created_by = selectedUser.value.user_id
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch('/api/invite/create', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }

    const result = await response.json()
    successMessage.value = `Code created: ${result.code}`

    // Reset form
    organizationName.value = ''
    selectedRegion.value = ''
    expiresAt.value = ''
    maxUses.value = ''

    // Refresh codes list
    await fetchRegionsAndCodes()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create code'
    console.error('[AdminPanel] create error:', err)
  } finally {
    isCreating.value = false
  }
}

async function toggleCodeActive(code: InviteCode): Promise<void> {
  const client = getClient()
  error.value = null

  try {
    const { error: updateError } = await client
      .from('invite_codes')
      .update({ is_active: !code.is_active })
      .eq('id', code.id)

    if (updateError) throw updateError

    code.is_active = !code.is_active
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update code'
  }
}

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
    copiedCode.value = code
    setTimeout(() => {
      if (copiedCode.value === code) copiedCode.value = null
    }, 2000)
  } catch {
    const el = document.createElement('textarea')
    el.value = code
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    copiedCode.value = code
    setTimeout(() => {
      if (copiedCode.value === code) copiedCode.value = null
    }, 2000)
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatCodeType(type: string): string {
  if (type === 'ssi_admin') return 'SSi Admin'
  if (type === 'govt_admin') return 'Govt Admin'
  if (type === 'school_admin') return 'School Admin'
  if (type === 'tester') return 'Beta Tester'
  return type
}

function formatUses(code: InviteCode): string {
  if (code.max_uses === null) return `${code.use_count} / unlimited`
  return `${code.use_count} / ${code.max_uses}`
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
    console.error('[AdminPanel] fetch groups error:', err)
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
    console.error('[AdminPanel] fetch courses error:', err)
  }
}

async function createGroup(): Promise<void> {
  if (!newGroupName.value.trim()) {
    error.value = 'Group name is required'
    return
  }

  isCreatingGroup.value = true
  error.value = null
  successMessage.value = null

  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const body: Record<string, unknown> = {
      name: newGroupName.value.trim(),
      type: newGroupType.value,
    }
    if (newGroupParent.value) body.parent_id = newGroupParent.value

    const response = await fetch('/api/groups', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to create group')
    }

    const result = await response.json()
    successMessage.value = `Group "${result.group.name}" created`
    newGroupName.value = ''
    newGroupType.value = 'region'
    newGroupParent.value = ''

    await fetchGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create group'
  } finally {
    isCreatingGroup.value = false
  }
}

async function saveGrant(): Promise<void> {
  if (!grantTargetId.value || grantCourses.value.length === 0) {
    error.value = 'Select a target and at least one course'
    return
  }

  isSavingGrant.value = true
  error.value = null
  successMessage.value = null

  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const body: Record<string, unknown> = {
      granted_courses: grantCourses.value,
    }
    if (grantTargetType.value === 'group') body.group_id = grantTargetId.value
    else body.school_id = grantTargetId.value

    const response = await fetch('/api/entitlement/grant', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to save grant')
    }

    const result = await response.json()
    const action = result.updated ? 'Updated' : 'Created'
    const targetName = grantTargetType.value === 'group'
      ? getGroupName(grantTargetId.value)
      : schools.value.find(s => s.id === grantTargetId.value)?.school_name || grantTargetId.value
    successMessage.value = `${action} entitlement for "${targetName}" — ${grantCourses.value.length} courses`

    grantTargetId.value = ''
    grantCourses.value = []

    await fetchGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save grant'
  } finally {
    isSavingGrant.value = false
  }
}

function toggleCourseGrant(courseCode: string): void {
  const idx = grantCourses.value.indexOf(courseCode)
  if (idx >= 0) {
    grantCourses.value.splice(idx, 1)
  } else {
    grantCourses.value.push(courseCode)
  }
}

function formatCourseName(c: Course): string {
  if (c.display_name) return c.display_name
  return c.course_code
}

onMounted(() => {
  fetchRegionsAndCodes()
  fetchSchools()
  fetchGroups()
  fetchCourses()
})
</script>

<template>
  <div class="admin-invite-codes">
    <!-- Quick Links -->
    <nav class="quick-links animate-in">
      <a href="/schools" class="quick-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span>Schools Dashboard</span>
      </a>
      <a href="/demo" class="quick-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>Schools Demo</span>
      </a>
    </nav>

    <!-- Add School Section -->
    <section class="create-section animate-in delay-1">
      <Card title="Add School" accent="green">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </template>
        <div class="form-grid">
          <div class="form-group form-group--wide">
            <label>School Name <span class="required">*</span></label>
            <input
              v-model="newSchoolName"
              type="text"
              placeholder="e.g. Ysgol Gymraeg Bro Morgannwg"
              @keyup.enter="createSchool"
            />
          </div>

          <div class="form-group">
            <label>Group (optional)</label>
            <select v-model="newSchoolGroup">
              <option value="">- None -</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">
                {{ g.name }} ({{ g.type }})
              </option>
            </select>
          </div>
        </div>

        <template #footer>
          <div class="form-actions">
            <button class="btn-create" :disabled="isCreatingSchool || !newSchoolName.trim()" @click="createSchool">
              <svg v-if="!isCreatingSchool" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span v-if="isCreatingSchool" class="spinner"></span>
              {{ isCreatingSchool ? 'Creating...' : 'Add School' }}
            </button>
          </div>
        </template>
      </Card>
    </section>

    <!-- Schools List -->
    <section v-if="schools.length > 0" class="codes-section animate-in delay-2">
      <Card title="Schools" accent="gradient" :loading="isLoadingSchools">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </template>

        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Group</th>
                <th>Teacher Join Code</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="school in schools" :key="school.id">
                <td>{{ school.school_name }}</td>
                <td>{{ school.group_id ? getGroupName(school.group_id) : '-' }}</td>
                <td class="code-cell">
                  <code>{{ school.teacher_join_code }}</code>
                  <button
                    class="action-btn"
                    @click="copyCode(school.teacher_join_code)"
                    :title="copiedCode === school.teacher_join_code ? 'Copied!' : 'Copy code'"
                  >
                    <svg v-if="copiedCode !== school.teacher_join_code" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {{ copiedCode === school.teacher_join_code ? 'Copied' : 'Copy' }}
                  </button>
                </td>
                <td>{{ formatDate(school.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </section>

    <!-- Groups Section -->
    <section class="create-section animate-in delay-1">
      <Card title="Groups" accent="blue">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </template>

        <!-- Create group form -->
        <div class="form-grid" style="margin-bottom: 16px;">
          <div class="form-group">
            <label>Group Name <span class="required">*</span></label>
            <input
              v-model="newGroupName"
              type="text"
              placeholder="e.g. United Kingdom, Wales, Pilot 2026"
              @keyup.enter="createGroup"
            />
          </div>

          <div class="form-group">
            <label>Type</label>
            <select v-model="newGroupType">
              <option value="nation">Nation</option>
              <option value="region">Region</option>
              <option value="district">District</option>
              <option value="programme">Programme</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div class="form-group">
            <label>Parent Group (optional)</label>
            <select v-model="newGroupParent">
              <option value="">- None (top level) -</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">
                {{ g.name }} ({{ g.type }})
              </option>
            </select>
          </div>

          <div class="form-group" style="justify-content: flex-end;">
            <label>&nbsp;</label>
            <button class="btn-create" :disabled="isCreatingGroup || !newGroupName.trim()" @click="createGroup">
              <svg v-if="!isCreatingGroup" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span v-if="isCreatingGroup" class="spinner"></span>
              {{ isCreatingGroup ? 'Creating...' : 'Add Group' }}
            </button>
          </div>
        </div>

        <!-- Groups tree -->
        <div v-if="groups.length > 0" class="groups-tree">
          <template v-for="group in rootGroups" :key="group.id">
            <div class="group-row group-row--root">
              <span class="group-type-badge">{{ group.type }}</span>
              <strong>{{ group.name }}</strong>
              <span class="group-meta">{{ group.school_count }} schools</span>
              <span v-if="group.granted_courses.length > 0" class="group-courses">
                {{ group.granted_courses.length }} courses
              </span>
            </div>
            <div v-for="child in getChildGroups(group.id)" :key="child.id" class="group-row group-row--child">
              <span class="group-type-badge">{{ child.type }}</span>
              <span>{{ child.name }}</span>
              <span class="group-meta">{{ child.school_count }} schools</span>
              <span v-if="child.granted_courses.length > 0" class="group-courses">
                {{ child.granted_courses.length }} courses
              </span>
              <template v-for="grandchild in getChildGroups(child.id)" :key="grandchild.id">
                <div class="group-row group-row--grandchild">
                  <span class="group-type-badge">{{ grandchild.type }}</span>
                  <span>{{ grandchild.name }}</span>
                  <span class="group-meta">{{ grandchild.school_count }} schools</span>
                </div>
              </template>
            </div>
          </template>
        </div>
        <div v-else-if="!isLoadingGroups" class="empty-state" style="padding: 24px;">
          <p>No groups yet</p>
          <span>Create one above to organise schools</span>
        </div>
      </Card>
    </section>

    <!-- Course Entitlements Section -->
    <section class="create-section animate-in delay-2">
      <Card title="Course Entitlements" accent="gold">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </template>

        <div class="form-grid" style="margin-bottom: 16px;">
          <div class="form-group">
            <label>Grant To</label>
            <select v-model="grantTargetType">
              <option value="group">Group</option>
              <option value="school">School</option>
            </select>
          </div>

          <div class="form-group">
            <label>{{ grantTargetType === 'group' ? 'Select Group' : 'Select School' }} <span class="required">*</span></label>
            <select v-model="grantTargetId">
              <option value="">- Select -</option>
              <template v-if="grantTargetType === 'group'">
                <option v-for="g in groups" :key="g.id" :value="g.id">
                  {{ g.name }} ({{ g.type }})
                </option>
              </template>
              <template v-else>
                <option v-for="s in schools" :key="s.id" :value="s.id">
                  {{ s.school_name }}
                </option>
              </template>
            </select>
          </div>
        </div>

        <!-- Course picker -->
        <div v-if="grantTargetId" class="course-picker">
          <label class="form-group" style="margin-bottom: 8px;">
            <span style="font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: var(--font-medium);">
              Select Courses ({{ grantCourses.length }} selected)
            </span>
          </label>
          <div class="course-grid">
            <button
              v-for="c in courses"
              :key="c.course_code"
              class="course-chip"
              :class="{ selected: grantCourses.includes(c.course_code) }"
              @click="toggleCourseGrant(c.course_code)"
            >
              {{ formatCourseName(c) }}
            </button>
          </div>
        </div>

        <template #footer>
          <div class="form-actions">
            <button
              class="btn-create"
              :disabled="isSavingGrant || !grantTargetId || grantCourses.length === 0"
              @click="saveGrant"
            >
              <span v-if="isSavingGrant" class="spinner"></span>
              {{ isSavingGrant ? 'Saving...' : 'Save Entitlement' }}
            </button>
          </div>
        </template>
      </Card>
    </section>

    <!-- Page Header -->
    <header class="page-header animate-in">
      <h1 class="page-title">Invite Codes</h1>
      <p class="page-subtitle">Create role-based invite codes for organizations and schools</p>
    </header>

    <!-- Success Message -->
    <div v-if="successMessage" class="message-banner success-banner animate-in">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <span>{{ successMessage }}</span>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="message-banner error-banner animate-in">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <span>{{ error }}</span>
    </div>

    <!-- Create Form -->
    <section class="create-section animate-in delay-1">
      <Card title="Create New Code" accent="red">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </template>
        <div class="form-grid">
          <div class="form-group">
            <label>Code Type</label>
            <select v-model="codeType">
              <option v-if="isSsiAdmin" value="ssi_admin">SSi Admin</option>
              <option v-if="isSsiAdmin" value="govt_admin">Govt Admin</option>
              <option v-if="isSsiAdmin" value="tester">Tester</option>
              <option value="school_admin">School Admin</option>
            </select>
          </div>

          <div class="form-group">
            <label>Region</label>
            <select v-model="selectedRegion">
              <option value="">- No region -</option>
              <option v-for="r in regions" :key="r.code" :value="r.code">
                {{ r.name }} ({{ r.code }})
              </option>
            </select>
          </div>

          <div class="form-group form-group--wide">
            <label>Organization Name <span class="required">*</span></label>
            <input
              v-model="organizationName"
              type="text"
              placeholder="e.g. Welsh Government, Ysgol Gymraeg Bro Morgannwg"
            />
          </div>

          <div class="form-group">
            <label>Expires (optional)</label>
            <input v-model="expiresAt" type="date" />
          </div>

          <div class="form-group">
            <label>Max Uses (blank = unlimited)</label>
            <input v-model="maxUses" type="number" min="1" placeholder="Unlimited" />
          </div>
        </div>

        <template #footer>
          <div class="form-actions">
            <button class="btn-create" :disabled="isCreating || !organizationName.trim()" @click="createCode">
              <svg v-if="!isCreating" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span v-if="isCreating" class="spinner"></span>
              {{ isCreating ? 'Creating...' : 'Create Code' }}
            </button>
          </div>
        </template>
      </Card>
    </section>

    <!-- Codes Table -->
    <section class="codes-section animate-in delay-2">
      <Card title="Your Codes" accent="gradient" :loading="isLoadingCodes">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </template>

        <div v-if="codes.length > 0" class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Type</th>
                <th>Organization</th>
                <th>Region</th>
                <th>Uses</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="code in codes" :key="code.id" :class="{ inactive: !code.is_active }">
                <td class="code-cell">
                  <code>{{ code.code }}</code>
                  <button
                    class="action-btn"
                    @click="copyCode(code.code)"
                    :title="copiedCode === code.code ? 'Copied!' : 'Copy code'"
                  >
                    <svg v-if="copiedCode !== code.code" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {{ copiedCode === code.code ? 'Copied' : 'Copy' }}
                  </button>
                </td>
                <td>
                  <span class="type-badge" :class="`type-${code.code_type}`">
                    {{ formatCodeType(code.code_type) }}
                  </span>
                </td>
                <td>{{ code.organization_name || '-' }}</td>
                <td>{{ code.region_code || '-' }}</td>
                <td>{{ formatUses(code) }}</td>
                <td>{{ formatDate(code.expires_at) }}</td>
                <td>
                  <button
                    class="status-toggle"
                    :class="code.is_active ? 'status-active' : 'status-inactive'"
                    @click="toggleCodeActive(code)"
                  >
                    {{ code.is_active ? 'Active' : 'Inactive' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else-if="!isLoadingCodes" class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p>No invite codes yet</p>
          <span>Create one above to get started</span>
        </div>
      </Card>
    </section>
  </div>
</template>

<style scoped>
.quick-links {
  display: flex;
  gap: 12px;
  margin-bottom: 28px;
}

.quick-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-subtle, rgba(0,0,0,0.06));
  border-radius: 12px;
  color: var(--text-primary, #2C2622);
  text-decoration: none;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.quick-link:hover {
  border-color: var(--ssi-red, #c23a3a);
  color: var(--ssi-red, #c23a3a);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.quick-link svg {
  opacity: 0.6;
  flex-shrink: 0;
}

.quick-link:hover svg {
  opacity: 1;
}

@media (max-width: 480px) {
  .quick-links {
    flex-direction: column;
  }
}

.admin-invite-codes {
  padding: 0;
  max-width: 1200px;
}

/* Page Header */
.page-header {
  margin-bottom: var(--space-8);
}

.page-title {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0 0 var(--space-1);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

/* Message Banners */
.message-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  margin-bottom: var(--space-4);
}

.success-banner {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
  color: var(--success);
}

.error-banner {
  background: color-mix(in srgb, var(--error) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
  color: var(--error);
}

/* Sections */
.create-section {
  margin-bottom: var(--space-8);
}

.codes-section {
  margin-bottom: var(--space-8);
}

/* Form Grid */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-group--wide {
    grid-column: 1;
  }
}

.form-group--wide {
  grid-column: 1 / -1;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-group label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: var(--font-medium);
}

.required {
  color: var(--ssi-red);
}

.form-group input,
.form-group select {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  transition: border-color var(--transition-fast);
}

.form-group input::placeholder {
  color: var(--text-muted);
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ssi-red) 15%, transparent);
}

/* Form Actions */
.form-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-create {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  background: var(--ssi-gold);
  color: #000;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-create:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-top-color: #000;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Table */
.table-wrapper {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

thead th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  color: var(--text-muted);
  font-weight: var(--font-medium);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-medium);
}

tbody td {
  padding: var(--space-3) var(--space-4);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}

tbody tr {
  transition: background var(--transition-fast);
}

tbody tr:hover {
  background: var(--bg-secondary);
}

.inactive {
  opacity: 0.5;
}

.code-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.code-cell code {
  font-family: var(--font-mono);
  background: var(--bg-input);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--ssi-gold);
  border: 1px solid var(--border-subtle);
}

/* Type Badges */
.type-badge {
  display: inline-block;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.type-ssi_admin {
  background: color-mix(in srgb, var(--ssi-gold) 12%, transparent);
  color: var(--ssi-gold);
}

.type-govt_admin {
  background: color-mix(in srgb, var(--info) 12%, transparent);
  color: var(--info);
}

.type-school_admin {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}

/* Status Toggle */
.status-toggle {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  font-family: var(--font-body);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--transition-fast);
}

.status-active {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: color-mix(in srgb, var(--success) 25%, transparent);
  color: var(--success);
}

.status-active:hover {
  background: color-mix(in srgb, var(--success) 20%, transparent);
}

.status-inactive {
  background: var(--bg-secondary);
  border-color: var(--border-subtle);
  color: var(--text-muted);
}

.status-inactive:hover {
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
  color: var(--text-secondary);
}

/* Action Buttons */
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: var(--font-body);
  transition: all var(--transition-fast);
}

.action-btn:hover {
  color: var(--text-primary);
  border-color: var(--ssi-red);
  background: var(--bg-elevated);
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-12) var(--space-6);
  text-align: center;
}

.empty-state svg {
  color: var(--text-muted);
  opacity: 0.4;
  margin-bottom: var(--space-2);
}

.empty-state p {
  color: var(--text-secondary);
  font-weight: var(--font-medium);
  font-size: var(--text-base);
  margin: 0;
}

.empty-state span {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* Groups tree */
.groups-tree {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-3);
}

.group-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
}

.group-row:hover {
  background: var(--bg-secondary);
}

.group-row--child {
  padding-left: var(--space-8);
}

.group-row--grandchild {
  padding-left: calc(var(--space-8) * 2);
}

.group-type-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: var(--font-medium);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: color-mix(in srgb, var(--info) 12%, transparent);
  color: var(--info);
  flex-shrink: 0;
}

.group-meta {
  color: var(--text-muted);
  font-size: var(--text-xs);
  margin-left: auto;
}

.group-courses {
  font-size: var(--text-xs);
  color: var(--success);
  font-weight: var(--font-medium);
}

/* Course picker */
.course-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.course-chip {
  padding: 4px 10px;
  border-radius: 16px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.15s ease;
}

.course-chip:hover {
  border-color: var(--ssi-gold);
  color: var(--text-primary);
}

.course-chip.selected {
  background: color-mix(in srgb, var(--ssi-gold) 15%, transparent);
  border-color: var(--ssi-gold);
  color: var(--text-primary);
  font-weight: var(--font-medium);
}
</style>
