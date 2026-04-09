<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useAdminClient } from '@/composables/useAdminClient'
import { useGodMode } from '@/composables/schools/useGodMode'
import Card from '@/components/schools/shared/Card.vue'

interface School {
  id: string
  school_name: string
  region_code: string | null
  group_id: string | null
  teacher_join_code: string
  created_at: string
}

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

const { user, learner } = useAuth()
const { getClient, getAuthToken } = useAdminClient()
const { selectedUser } = useGodMode()

// State
const schools = ref<School[]>([])
const groups = ref<Group[]>([])
const courses = ref<Course[]>([])
const isLoadingSchools = ref(false)
const isLoadingGroups = ref(false)
const isCreatingSchool = ref(false)
const isCreatingGroup = ref(false)
const isSavingGrant = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const copiedCode = ref<string | null>(null)

// Entitlement grant data for badge display
interface EntitlementGrant {
  group_id: string | null
  school_id: string | null
  granted_courses: string[]
}
const allGrants = ref<EntitlementGrant[]>([])

// Inline rename state for groups
const editingGroupId = ref<string | null>(null)
const editingGroupName = ref('')

// Inherited grants display for school entitlement editing
const inheritedGroupName = ref<string | null>(null)
const inheritedCourseCount = ref(0)

// School form state
const newSchoolName = ref('')
const newSchoolGroup = ref('')

// Group form
const newGroupName = ref('')
const newGroupType = ref('region')
const newGroupParent = ref('')

// Grant form
const grantTargetType = ref<'group' | 'school'>('group')
const grantTargetId = ref('')
const grantCourses = ref<string[]>([])
const courseSearch = ref('')

// Group tree helpers
const rootGroups = computed(() => groups.value.filter(g => !g.parent_id))

function getChildGroups(parentId: string): Group[] {
  return groups.value.filter(g => g.parent_id === parentId)
}

function getGroupName(id: string): string {
  return groups.value.find(g => g.id === id)?.name || id
}

// Language name lookup
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

// Distinct hues for language group headers
const GROUP_COLORS: Record<string, string> = {}
const HUES = [0, 210, 140, 32, 270, 180, 340, 55, 100, 300, 195, 240, 15, 160, 70, 320, 120, 350, 220, 45]
let hueIndex = 0

function groupColor(label: string): string {
  if (!GROUP_COLORS[label]) {
    GROUP_COLORS[label] = `${HUES[hueIndex % HUES.length]}`
    hueIndex++
  }
  return GROUP_COLORS[label]
}

// Courses grouped by known language, filtered by search
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

  const groups: Record<string, Course[]> = {}
  for (const c of filtered) {
    const key = `For ${langName(c.known_lang)} speakers`
    if (!groups[key]) groups[key] = []
    groups[key].push(c)
  }

  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
})

function getCurrentUserId(): string | null {
  if (selectedUser.value) return selectedUser.value.user_id
  if (user.value) return user.value.id
  if (learner.value) return learner.value.user_id
  return null
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
    console.error('[SetupView] fetch schools error:', err)
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
      console.error('[SetupView] Failed to create invite code for teacher join code:', inviteError)
    }

    successMessage.value = `School "${data.school_name}" created — join code: ${data.teacher_join_code}`
    newSchoolName.value = ''
    newSchoolGroup.value = ''

    await fetchSchools()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create school'
    console.error('[SetupView] create school error:', err)
  } finally {
    isCreatingSchool.value = false
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
    console.error('[SetupView] fetch groups error:', err)
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
    console.error('[SetupView] fetch courses error:', err)
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
    inheritedGroupName.value = null
    inheritedCourseCount.value = 0

    await fetchGroups()
    await fetchGrants()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save grant'
  } finally {
    isSavingGrant.value = false
  }
}

async function updateSchoolGroup(school: School, groupId: string): Promise<void> {
  const previousGroupId = school.group_id
  const previousGroupName = previousGroupId ? getGroupName(previousGroupId) : null

  try {
    const client = getClient()
    const { error: updateError } = await client
      .from('schools')
      .update({ group_id: groupId || null })
      .eq('id', school.id)

    if (updateError) throw updateError
    school.group_id = groupId || null

    if (groupId && previousGroupName) {
      successMessage.value = `Moved "${school.school_name}" from ${previousGroupName} to ${getGroupName(groupId)} \u2014 entitlements may have changed.`
    } else if (groupId) {
      successMessage.value = `Assigned "${school.school_name}" to ${getGroupName(groupId)} \u2014 entitlements may have changed.`
    } else {
      successMessage.value = `Removed "${school.school_name}" from ${previousGroupName || 'group'}`
    }

    // Refresh grants since inherited entitlements may have changed
    await fetchGrants()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update school group'
  }
}

function editSchoolEntitlements(school: School): void {
  grantTargetType.value = 'school'
  grantTargetId.value = school.id
  grantCourses.value = []

  // Compute inherited entitlements from group
  inheritedGroupName.value = null
  inheritedCourseCount.value = 0
  if (school.group_id) {
    const groupGrant = allGrants.value.find(g => g.group_id === school.group_id && !g.school_id)
    if (groupGrant && groupGrant.granted_courses.length > 0) {
      inheritedGroupName.value = getGroupName(school.group_id)
      inheritedCourseCount.value = groupGrant.granted_courses.length
    }
  }

  // Load existing grant for this school
  const token = getAuthToken()
  token.then(async (t) => {
    try {
      const headers: Record<string, string> = {}
      if (t) headers['Authorization'] = `Bearer ${t}`
      const response = await fetch(`/api/entitlement/grants?school_id=${school.id}`, { headers })
      if (response.ok) {
        const data = await response.json()
        if (data.grants?.length > 0) {
          grantCourses.value = data.grants[0].granted_courses || []
        }
      }
    } catch { /* non-fatal */ }
  })

  // Scroll to the entitlements section
  setTimeout(() => {
    document.querySelector('.course-picker')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, 100)
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

// Effective entitlements per school: direct grants + inherited from group
const schoolEntitlements = computed(() => {
  const map = new Map<string, { count: number; source: string }>()

  for (const school of schools.value) {
    // Check for direct school grant
    const directGrant = allGrants.value.find(g => g.school_id === school.id)
    // Check for group-level grant (inherited)
    const groupGrant = school.group_id
      ? allGrants.value.find(g => g.group_id === school.group_id && !g.school_id)
      : null

    if (directGrant && directGrant.granted_courses.length > 0) {
      map.set(school.id, {
        count: directGrant.granted_courses.length,
        source: 'direct',
      })
    } else if (groupGrant && groupGrant.granted_courses.length > 0) {
      const gName = getGroupName(school.group_id!)
      map.set(school.id, {
        count: groupGrant.granted_courses.length,
        source: `via ${gName}`,
      })
    }
  }

  return map
})

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
    console.error('[SetupView] fetch grants error:', err)
  }
}

// Filtered courses for Select All (matches current search filter)
const filteredCoursesList = computed(() => {
  return groupedCourses.value.flatMap(([, groupCourses]) => groupCourses)
})

function selectAllCourses(): void {
  const codes = filteredCoursesList.value.map(c => c.course_code)
  for (const code of codes) {
    if (!grantCourses.value.includes(code)) {
      grantCourses.value.push(code)
    }
  }
}

function clearCourseSelection(): void {
  grantCourses.value = []
}

// Group delete
async function deleteGroup(group: Group): Promise<void> {
  if (!confirm(`Delete group "${group.name}"? Schools in this group will become ungrouped.`)) return

  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch(`/api/groups/${group.id}`, {
      method: 'DELETE',
      headers,
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to delete group')
    }

    successMessage.value = `Group "${group.name}" deleted`
    await fetchGroups()
    await fetchSchools()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete group'
  }
}

// Group rename (inline edit)
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

    successMessage.value = `Group renamed to "${newName}"`
    await fetchGroups()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to rename group'
  }
}

// School delete
async function deleteSchool(school: School): Promise<void> {
  if (!confirm(`Delete school "${school.school_name}"? This cannot be undone.`)) return

  try {
    const client = getClient()
    const { error: deleteError } = await client
      .from('schools')
      .delete()
      .eq('id', school.id)

    if (deleteError) throw deleteError

    successMessage.value = `School "${school.school_name}" deleted`
    await fetchSchools()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete school'
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

onMounted(() => {
  fetchSchools()
  fetchGroups()
  fetchCourses()
  fetchGrants()
})
</script>

<template>
  <div class="setup-page">
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
                <th>Entitlements</th>
                <th>Teacher Join Code</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="school in schools" :key="school.id">
                <td>{{ school.school_name }}</td>
                <td>
                  <select
                    class="inline-select"
                    :value="school.group_id || ''"
                    @change="updateSchoolGroup(school, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">- None -</option>
                    <option v-for="g in groups" :key="g.id" :value="g.id">
                      {{ g.name }}
                    </option>
                  </select>
                </td>
                <td>
                  <span v-if="schoolEntitlements.get(school.id)" class="entitlement-badge" :title="schoolEntitlements.get(school.id)!.source">
                    {{ schoolEntitlements.get(school.id)!.count }} courses
                    <span class="entitlement-source">{{ schoolEntitlements.get(school.id)!.source }}</span>
                  </span>
                  <span v-else class="entitlement-none">&mdash;</span>
                </td>
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
                <td class="actions-cell">
                  <button class="action-btn" @click="editSchoolEntitlements(school)" title="Edit course entitlements">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    Courses
                  </button>
                  <button class="action-btn action-btn--danger" @click="deleteSchool(school)" title="Delete school">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </td>
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
              <template v-if="editingGroupId === group.id">
                <input
                  class="group-rename-input"
                  v-model="editingGroupName"
                  @blur="saveGroupRename(group)"
                  @keyup.enter="saveGroupRename(group)"
                  @keyup.escape="editingGroupId = null"
                />
              </template>
              <strong v-else class="group-name-editable" @click="startGroupRename(group)" title="Click to rename">{{ group.name }}</strong>
              <span class="group-meta">{{ group.school_count }} schools</span>
              <span v-if="group.granted_courses.length > 0" class="group-courses">
                {{ group.granted_courses.length }} courses
              </span>
              <button class="group-delete-btn" @click="deleteGroup(group)" title="Delete group">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div v-for="child in getChildGroups(group.id)" :key="child.id" class="group-row group-row--child">
              <span class="group-type-badge">{{ child.type }}</span>
              <template v-if="editingGroupId === child.id">
                <input
                  class="group-rename-input"
                  v-model="editingGroupName"
                  @blur="saveGroupRename(child)"
                  @keyup.enter="saveGroupRename(child)"
                  @keyup.escape="editingGroupId = null"
                />
              </template>
              <span v-else class="group-name-editable" @click="startGroupRename(child)" title="Click to rename">{{ child.name }}</span>
              <span class="group-meta">{{ child.school_count }} schools</span>
              <span v-if="child.granted_courses.length > 0" class="group-courses">
                {{ child.granted_courses.length }} courses
              </span>
              <button class="group-delete-btn" @click="deleteGroup(child)" title="Delete group">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
              <template v-for="grandchild in getChildGroups(child.id)" :key="grandchild.id">
                <div class="group-row group-row--grandchild">
                  <span class="group-type-badge">{{ grandchild.type }}</span>
                  <template v-if="editingGroupId === grandchild.id">
                    <input
                      class="group-rename-input"
                      v-model="editingGroupName"
                      @blur="saveGroupRename(grandchild)"
                      @keyup.enter="saveGroupRename(grandchild)"
                      @keyup.escape="editingGroupId = null"
                    />
                  </template>
                  <span v-else class="group-name-editable" @click="startGroupRename(grandchild)" title="Click to rename">{{ grandchild.name }}</span>
                  <span class="group-meta">{{ grandchild.school_count }} schools</span>
                  <button class="group-delete-btn" @click="deleteGroup(grandchild)" title="Delete group">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
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
          <!-- Inherited grants notice for school targets -->
          <div v-if="grantTargetType === 'school' && inheritedGroupName" class="inherited-notice">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            Inherited from {{ inheritedGroupName }}: {{ inheritedCourseCount }} courses
          </div>

          <div class="course-picker-header">
            <span class="course-picker-label">
              Select Courses ({{ grantCourses.length }} selected)
            </span>
            <div class="course-picker-actions">
              <button class="text-btn" @click="selectAllCourses">Select All</button>
              <button class="text-btn" @click="clearCourseSelection">Clear</button>
            </div>
            <input
              v-model="courseSearch"
              type="text"
              class="course-search"
              placeholder="Search courses..."
            />
          </div>
          <div v-for="[groupLabel, groupCourses] in groupedCourses" :key="groupLabel" class="course-group" :style="{ '--group-hue': groupColor(groupLabel) }">
            <div class="course-group-header">{{ groupLabel }}</div>
            <div class="course-grid">
              <button
                v-for="c in groupCourses"
                :key="c.course_code"
                class="course-chip"
                :class="{ selected: grantCourses.includes(c.course_code) }"
                @click="toggleCourseGrant(c.course_code)"
              >
                {{ formatCourseName(c) }}
              </button>
            </div>
          </div>
          <div v-if="groupedCourses.length === 0" class="course-no-results">
            No courses match "{{ courseSearch }}"
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
  </div>
</template>

<style scoped>
.setup-page {
  padding: 0;
  max-width: 1200px;
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

/* Inline select in tables */
.inline-select {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-family: var(--font-body);
  cursor: pointer;
  max-width: 160px;
}

.inline-select:focus {
  outline: none;
  border-color: var(--ssi-red);
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
.course-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 12px;
}

.course-picker-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: var(--font-medium);
  white-space: nowrap;
}

.course-search {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 6px 12px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  max-width: 240px;
  width: 100%;
}

.course-search:focus {
  outline: none;
  border-color: var(--ssi-gold);
}

.course-search::placeholder {
  color: var(--text-muted);
}

.course-group {
  margin-bottom: 12px;
}

.course-group-header {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: hsl(var(--group-hue, 0) 45% 40%);
  margin-bottom: 6px;
  padding: 3px 8px;
  border-left: 3px solid hsl(var(--group-hue, 0) 55% 55%);
  background: hsl(var(--group-hue, 0) 40% 96%);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.course-no-results {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.course-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.course-chip {
  padding: 4px 10px;
  border-radius: 16px;
  border: 1px solid hsl(var(--group-hue, 0) 30% 85%);
  background: hsl(var(--group-hue, 0) 30% 97%);
  color: hsl(var(--group-hue, 0) 30% 35%);
  font-size: var(--text-xs);
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.15s ease;
}

.course-chip:hover {
  border-color: hsl(var(--group-hue, 0) 50% 55%);
  background: hsl(var(--group-hue, 0) 35% 93%);
}

.course-chip.selected {
  background: hsl(var(--group-hue, 0) 50% 88%);
  border-color: hsl(var(--group-hue, 0) 55% 50%);
  color: var(--text-primary);
  font-weight: var(--font-medium);
}

/* Entitlement badges in schools table */
.entitlement-badge {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--success);
}

.entitlement-source {
  font-size: 10px;
  font-weight: normal;
  color: var(--text-muted);
}

.entitlement-none {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* Actions cell with multiple buttons */
.actions-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* Danger action button */
.action-btn--danger {
  opacity: 0.4;
  transition: all var(--transition-fast);
}

.action-btn--danger:hover {
  opacity: 1;
  color: var(--error) !important;
  border-color: var(--error) !important;
}

/* Group delete button */
.group-delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.group-row:hover .group-delete-btn {
  opacity: 0.5;
}

.group-delete-btn:hover {
  opacity: 1 !important;
  color: var(--error);
  border-color: var(--error);
  background: color-mix(in srgb, var(--error) 8%, transparent);
}

/* Group inline rename */
.group-name-editable {
  cursor: pointer;
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.group-name-editable:hover {
  background: var(--bg-input);
}

.group-rename-input {
  background: var(--bg-input);
  border: 1px solid var(--ssi-red);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  font-weight: var(--font-medium);
  width: 180px;
}

.group-rename-input:focus {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ssi-red) 15%, transparent);
}

/* Inherited grants notice */
.inherited-notice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: color-mix(in srgb, var(--info) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--info) 20%, transparent);
  border-radius: var(--radius-md);
  color: var(--info);
  font-size: var(--text-xs);
  margin-bottom: var(--space-3);
}

/* Course picker action buttons */
.course-picker-actions {
  display: flex;
  gap: var(--space-2);
}

.text-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-family: var(--font-body);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.text-btn:hover {
  color: var(--text-primary);
}
</style>
