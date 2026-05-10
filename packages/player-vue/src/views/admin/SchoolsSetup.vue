<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useAdminClient } from '@/composables/useAdminClient'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

const router = useRouter()

interface School {
  id: string
  school_name: string
  region_code: string | null
  group_id: string | null
  teacher_join_code: string
  admin_join_code: string
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
const newGroupType = ref('group')
const newGroupParent = ref('')

// Add Staff form
const newStaffName = ref('')
const newStaffEmail = ref('')
const newStaffSchool = ref('')
const newStaffRole = ref<'teacher' | 'admin'>('teacher')
const isCreatingStaff = ref(false)

// Add Govt Admin form
const newGovtName = ref('')
const newGovtEmail = ref('')
const newGovtGroup = ref('')
const newGovtOrg = ref('')
const isCreatingGovt = ref(false)
const regions = ref<Array<{ code: string; name: string }>>([])
const govtAdminCode = ref<string | null>(null)

// Staff list
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

// Grant form
const grantTargetType = ref<'group' | 'school'>('group')
const grantTargetId = ref('')
const grantCourses = ref<string[]>([])

// Tabbed layout: only one section's content is visible at a time.
type SetupTab = 'groups' | 'schools' | 'staff' | 'entitlements'
const activeTab = ref<SetupTab>('schools')
const courseSearch = ref('')

const tabs: { id: SetupTab; label: string }[] = [
  { id: 'groups', label: 'Groups' },
  { id: 'schools', label: 'Schools' },
  { id: 'staff', label: 'Staff' },
  { id: 'entitlements', label: 'Entitlements' },
]

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

  const buckets: Record<string, Course[]> = {}
  for (const c of filtered) {
    const key = `For ${langName(c.known_lang)} speakers`
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(c)
  }

  return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b))
})

function getCurrentUserId(): string | null {
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
      .select('id, school_name, region_code, group_id, teacher_join_code, admin_join_code, created_at')
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
      .select('id, school_name, teacher_join_code, admin_join_code')
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

    // Create invite_codes row so admins can redeem the admin join code
    const { error: adminInviteError } = await client
      .from('invite_codes')
      .insert({
        code: data.admin_join_code,
        code_type: 'school_admin_join',
        grants_school_id: data.id,
        created_by: userId,
        is_active: true,
      })

    if (adminInviteError) {
      console.error('[SetupView] Failed to create invite code for admin join code:', adminInviteError)
    }

    successMessage.value = `School "${data.school_name}" created`
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

async function createStaff(): Promise<void> {
  if (!newStaffName.value.trim()) {
    error.value = 'Name is required'
    return
  }
  if (!newStaffEmail.value.trim()) {
    error.value = 'Email is required'
    return
  }
  if (!newStaffSchool.value) {
    error.value = 'Please select a school'
    return
  }

  isCreatingStaff.value = true
  error.value = null
  successMessage.value = null

  try {
    const client = getClient()
    const userId = `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const educationalRole = newStaffRole.value === 'admin' ? 'school_admin' : 'teacher'
    const roleInContext = newStaffRole.value === 'admin' ? 'admin' : 'teacher'

    // Create learner record (with email in verified_emails so auth linking works)
    const emailStr = newStaffEmail.value.trim().toLowerCase()
    const insertData: Record<string, unknown> = {
      user_id: userId,
      display_name: newStaffName.value.trim(),
      educational_role: educationalRole,
    }
    if (emailStr) {
      insertData.verified_emails = [emailStr]
    }

    const { error: learnerError } = await client
      .from('learners')
      .insert(insertData)

    if (learnerError) throw learnerError

    // Link to school via user_tag
    const addedBy = getCurrentUserId() || userId
    const { error: tagError } = await client
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'school',
        tag_value: `SCHOOL:${newStaffSchool.value}`,
        role_in_context: roleInContext,
        added_by: addedBy,
      })

    if (tagError) throw tagError

    const schoolName = schools.value.find(s => s.id === newStaffSchool.value)?.school_name || ''
    const roleLabel = newStaffRole.value === 'admin' ? 'School Admin' : 'Teacher'
    successMessage.value = `${roleLabel} "${newStaffName.value.trim()}" added to ${schoolName}`

    newStaffName.value = ''
    newStaffEmail.value = ''
    newStaffSchool.value = ''
    newStaffRole.value = 'teacher'

    await fetchStaff()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create staff member'
    console.error('[SetupView] create staff error:', err)
  } finally {
    isCreatingStaff.value = false
  }
}

async function fetchRegions(): Promise<void> {
  try {
    const client = getClient()
    const { data } = await client
      .from('regions')
      .select('code, name')
      .order('name')
    regions.value = data || []
  } catch (err) {
    console.error('[SetupView] fetch regions error:', err)
  }
}

async function createGovtAdmin(): Promise<void> {
  if (!newGovtName.value.trim()) { error.value = 'Name is required'; return }
  if (!newGovtEmail.value.trim()) { error.value = 'Email is required'; return }
  if (!newGovtGroup.value) { error.value = 'Please select a group'; return }
  if (!newGovtOrg.value.trim()) { error.value = 'Organization name is required'; return }

  isCreatingGovt.value = true
  error.value = null
  successMessage.value = null
  govtAdminCode.value = null

  try {
    const client = getClient()
    const userId = `govt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const emailStr = newGovtEmail.value.trim().toLowerCase()

    // 1. Create learner record
    const insertData: Record<string, unknown> = {
      user_id: userId,
      display_name: newGovtName.value.trim(),
      educational_role: 'govt_admin',
    }
    if (emailStr) {
      insertData.verified_emails = [emailStr]
    }
    const { error: learnerError } = await client.from('learners').insert(insertData)
    if (learnerError) throw learnerError

    // 2. Look up the region_code for the selected group (for backward compat)
    const createdBy = getCurrentUserId() || userId
    const selectedGroup = groups.value.find(g => g.id === newGovtGroup.value)
    let regionCode: string | null = null
    if (selectedGroup) {
      // Try to find a matching region by group name
      const matchingRegion = regions.value.find(r =>
        r.name.toLowerCase() === selectedGroup.name.toLowerCase()
      )
      if (matchingRegion) regionCode = matchingRegion.code
    }

    // 3. Create govt_admins record (group_id + region_code for backward compat)
    const govtInsert: Record<string, unknown> = {
      user_id: userId,
      group_id: newGovtGroup.value,
      organization_name: newGovtOrg.value.trim(),
      created_by: createdBy,
    }
    if (regionCode) govtInsert.region_code = regionCode
    const { error: govtError } = await client.from('govt_admins').insert(govtInsert)
    if (govtError) throw govtError

    // 4. Generate an invite code they can use to sign in
    const code = [
      Math.random().toString(36).substr(2, 3).toUpperCase(),
      Math.random().toString(36).substr(2, 3).toUpperCase(),
    ].join('-')

    const { error: codeError } = await client.from('invite_codes').insert({
      code,
      code_type: 'govt_admin',
      created_by: createdBy,
      grants_group_id: newGovtGroup.value,
      grants_region: regionCode,
      max_uses: 1,
      metadata: {
        organization_name: newGovtOrg.value.trim(),
        recipient_email: emailStr,
        recipient_name: newGovtName.value.trim(),
      },
    })
    if (codeError) console.warn('[SetupView] invite code creation failed:', codeError)
    else govtAdminCode.value = code

    const groupName = groups.value.find(g => g.id === newGovtGroup.value)?.name || 'group'
    successMessage.value = `Govt Admin "${newGovtName.value.trim()}" created for ${groupName}`

    newGovtName.value = ''
    newGovtEmail.value = ''
    newGovtGroup.value = ''
    newGovtOrg.value = ''

    await fetchStaff()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create govt admin'
    console.error('[SetupView] create govt admin error:', err)
  } finally {
    isCreatingGovt.value = false
  }
}

async function fetchStaff(): Promise<void> {
  isLoadingStaff.value = true
  try {
    const client = getClient()

    // Use RPC to get staff with emails (bypasses column-level REVOKE)
    const { data: rpcData, error: rpcError } = await client
      .rpc('get_staff_with_emails')

    const learners = rpcError ? [] : (rpcData || [])

    // Fallback: if RPC doesn't exist yet, query directly (without emails)
    if (rpcError) {
      console.warn('[SetupView] get_staff_with_emails RPC not available, falling back:', rpcError.message)
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

    // Get school tags for these users
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
    console.error('[SetupView] fetch staff error:', err)
  } finally {
    isLoadingStaff.value = false
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
    const client = getClient()
    const insertData: Record<string, unknown> = {
      name: newGroupName.value.trim(),
      type: newGroupType.value,
    }
    if (newGroupParent.value) insertData.parent_id = newGroupParent.value

    const { data, error: insertError } = await client
      .from('groups')
      .insert(insertData)
      .select()
      .single()

    if (insertError) throw insertError

    successMessage.value = `Group "${data.name}" created`
    newGroupName.value = ''
    newGroupType.value = 'group'
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
      successMessage.value = `Moved "${school.school_name}" from ${previousGroupName} to ${getGroupName(groupId)} — entitlements may have changed.`
    } else if (groupId) {
      successMessage.value = `Assigned "${school.school_name}" to ${getGroupName(groupId)} — entitlements may have changed.`
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

  // Switch to the Entitlements tab so the primed form is visible — no
  // scrolling, no expanding, just a tab change.
  activeTab.value = 'entitlements'
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
  if (!dateStr) return '—'
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
  fetchStaff()
  fetchRegions()
})
</script>

<template>
  <div class="schools-setup">
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Setup</h1>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ schools.length }}</span>
            schools
          </span>
          <span class="metric-sep">·</span>
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ groups.length }}</span>
            groups
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
      <div v-if="successMessage" class="banner banner-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span>{{ successMessage }}</span>
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

    <!-- Tab nav as segmented control — canon §5.2 (own row) -->
    <div class="filters-bar">
      <span class="frost-eyebrow">Section</span>
      <div class="tab-toggle" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab-btn"
          :class="{ 'is-active': activeTab === tab.id }"
          :aria-selected="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- ───── GROUPS TAB ───── -->
    <template v-if="activeTab === 'groups'">
      <!-- Create group form panel -->
      <FrostCard variant="panel" class="form-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">Create group</span>
          <span class="panel-hint">A bucket for schools that share entitlements.</span>
        </div>
        <form class="form-grid" @submit.prevent="createGroup">
          <div class="field field-wide">
            <label class="frost-eyebrow">Group name <span class="required">*</span></label>
            <input
              v-model="newGroupName"
              type="text"
              class="frost-input"
              placeholder="e.g. United Kingdom, Wales, Pilot 2026"
              @keyup.enter="createGroup"
            />
          </div>

          <div class="field">
            <label class="frost-eyebrow">Type</label>
            <select v-model="newGroupType" class="frost-select">
              <option value="nation">Nation</option>
              <option value="group">Group</option>
              <option value="district">District</option>
              <option value="programme">Programme</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div class="field">
            <label class="frost-eyebrow">Parent group <span class="optional">(optional)</span></label>
            <select v-model="newGroupParent" class="frost-select">
              <option value="">— None (top level) —</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">
                {{ g.name }}
              </option>
            </select>
          </div>

          <div class="field-actions">
            <button
              type="submit"
              class="btn-primary"
              :disabled="isCreatingGroup || !newGroupName.trim()"
            >
              <svg v-if="!isCreatingGroup" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span v-else class="spinner"></span>
              {{ isCreatingGroup ? 'Creating…' : 'Add group' }}
            </button>
          </div>
        </form>
      </FrostCard>

      <!-- Groups tree panel -->
      <FrostCard v-if="groups.length > 0" variant="panel" class="tree-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">All groups</span>
          <span class="panel-hint">Click a name to rename — hover for actions.</span>
        </div>
        <div class="groups-tree">
          <template v-for="group in rootGroups" :key="group.id">
            <div class="group-row group-row--root">
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
              <div class="row-actions">
                <button class="row-action" @click="router.push(`/admin/groups/${group.id}`)" title="Open cross-schools dashboard">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <button class="row-action is-danger" @click="deleteGroup(group)" title="Delete group">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
            <div v-for="child in getChildGroups(group.id)" :key="child.id" class="group-row group-row--child">
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
              <div class="row-actions">
                <button class="row-action" @click="router.push(`/admin/groups/${child.id}`)" title="Open cross-schools dashboard">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <button class="row-action is-danger" @click="deleteGroup(child)" title="Delete group">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
            <template v-for="child in getChildGroups(group.id)" :key="`gc-${child.id}`">
              <div v-for="grandchild in getChildGroups(child.id)" :key="grandchild.id" class="group-row group-row--grandchild">
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
                <div class="row-actions">
                  <button class="row-action" @click="router.push(`/admin/groups/${grandchild.id}`)" title="Open cross-schools dashboard">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <button class="row-action is-danger" @click="deleteGroup(grandchild)" title="Delete group">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            </template>
          </template>
        </div>
      </FrostCard>

      <!-- Empty state for groups -->
      <FrostCard v-else-if="!isLoadingGroups" variant="tile" class="empty">
        <div class="empty-ghost">groups</div>
        <div class="empty-copy">
          <strong>No groups yet</strong>
          <p>Create one above to organise schools that share entitlements.</p>
        </div>
      </FrostCard>

      <!-- Add Govt Admin -->
      <FrostCard variant="panel" class="form-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">Add govt admin</span>
          <span class="panel-hint">Invite someone to oversee all schools within a group.</span>
        </div>
        <form class="form-grid" @submit.prevent="createGovtAdmin">
          <div class="field">
            <label class="frost-eyebrow">Name <span class="required">*</span></label>
            <input v-model="newGovtName" type="text" class="frost-input" placeholder="e.g. Gwilym Thomas" />
          </div>
          <div class="field">
            <label class="frost-eyebrow">Email <span class="required">*</span></label>
            <input v-model="newGovtEmail" type="email" class="frost-input" placeholder="e.g. gwilym@gov.wales" />
          </div>
          <div class="field">
            <label class="frost-eyebrow">Group <span class="required">*</span></label>
            <select v-model="newGovtGroup" class="frost-select">
              <option value="">— Select group —</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">
                {{ g.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="frost-eyebrow">Organisation <span class="required">*</span></label>
            <input v-model="newGovtOrg" type="text" class="frost-input" placeholder="e.g. Welsh Government Language Office" />
          </div>

          <div v-if="govtAdminCode" class="field field-wide invite-result">
            <span class="frost-eyebrow">Invite code</span>
            <button
              type="button"
              class="code-chip is-large"
              :class="{ 'is-copied': copiedCode === govtAdminCode }"
              @click="copyCode(govtAdminCode!)"
            >
              <span class="code-value frost-mono-nums">{{ govtAdminCode }}</span>
              <svg v-if="copiedCode !== govtAdminCode" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
            <span class="invite-hint">Share this code — they enter it in Settings to gain access.</span>
          </div>

          <div class="field-actions">
            <button
              type="submit"
              class="btn-primary"
              :disabled="isCreatingGovt || !newGovtName.trim() || !newGovtEmail.trim() || !newGovtGroup || !newGovtOrg.trim()"
            >
              <svg v-if="!isCreatingGovt" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span v-else class="spinner"></span>
              {{ isCreatingGovt ? 'Creating…' : 'Create govt admin' }}
            </button>
          </div>
        </form>
      </FrostCard>
    </template>

    <!-- ───── SCHOOLS TAB ───── -->
    <template v-if="activeTab === 'schools'">
      <!-- Add School form panel -->
      <FrostCard variant="panel" class="form-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">Add school</span>
          <span class="panel-hint">Create a new school — optionally assign it to a group.</span>
        </div>
        <form class="form-grid" @submit.prevent="createSchool">
          <div class="field field-wide">
            <label class="frost-eyebrow">School name <span class="required">*</span></label>
            <input
              v-model="newSchoolName"
              type="text"
              class="frost-input"
              placeholder="e.g. Ysgol Gymraeg Bro Morgannwg"
              @keyup.enter="createSchool"
            />
          </div>
          <div class="field field-wide">
            <label class="frost-eyebrow">Group <span class="optional">(optional)</span></label>
            <select v-model="newSchoolGroup" class="frost-select">
              <option value="">— None —</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">
                {{ g.name }}
              </option>
            </select>
          </div>

          <div class="field-actions">
            <button
              type="submit"
              class="btn-primary"
              :disabled="isCreatingSchool || !newSchoolName.trim()"
            >
              <svg v-if="!isCreatingSchool" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span v-else class="spinner"></span>
              {{ isCreatingSchool ? 'Creating…' : 'Add school' }}
            </button>
          </div>
        </form>
      </FrostCard>

      <!-- Schools list panel -->
      <FrostCard v-if="schools.length > 0" variant="panel" class="list-panel">
        <table class="list-table">
          <thead>
            <tr>
              <th>School</th>
              <th>Group</th>
              <th>Entitlements</th>
              <th>Teacher code</th>
              <th>Admin code</th>
              <th>Created</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="school in schools" :key="school.id">
              <td class="cell-name">{{ school.school_name }}</td>
              <td>
                <select
                  class="inline-select"
                  :value="school.group_id || ''"
                  @change="updateSchoolGroup(school, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">— None —</option>
                  <option v-for="g in groups" :key="g.id" :value="g.id">
                    {{ g.name }}
                  </option>
                </select>
              </td>
              <td>
                <span
                  v-if="schoolEntitlements.get(school.id)"
                  class="entitlement-badge"
                  :title="schoolEntitlements.get(school.id)!.source"
                >
                  <span class="entitlement-count frost-mono-nums">{{ schoolEntitlements.get(school.id)!.count }}</span>
                  <span class="entitlement-label">{{ schoolEntitlements.get(school.id)!.source }}</span>
                </span>
                <span v-else class="cell-muted">—</span>
              </td>
              <td>
                <button
                  class="code-chip"
                  :class="{ 'is-copied': copiedCode === school.teacher_join_code }"
                  :title="copiedCode === school.teacher_join_code ? 'Copied!' : 'Click to copy'"
                  @click="copyCode(school.teacher_join_code)"
                >
                  <span class="code-value frost-mono-nums">{{ school.teacher_join_code }}</span>
                  <svg v-if="copiedCode !== school.teacher_join_code" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
              </td>
              <td>
                <button
                  class="code-chip"
                  :class="{ 'is-copied': copiedCode === school.admin_join_code }"
                  :title="copiedCode === school.admin_join_code ? 'Copied!' : 'Click to copy'"
                  @click="copyCode(school.admin_join_code)"
                >
                  <span class="code-value frost-mono-nums">{{ school.admin_join_code }}</span>
                  <svg v-if="copiedCode !== school.admin_join_code" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
              </td>
              <td class="cell-muted frost-mono-nums">{{ formatDate(school.created_at) }}</td>
              <td class="cell-actions">
                <div class="row-actions">
                  <button class="row-action" @click="router.push(`/admin/schools/${school.id}`)" title="Open dashboard for this school">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <button class="row-action" @click="editSchoolEntitlements(school)" title="Edit course entitlements">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  </button>
                  <button class="row-action is-danger" @click="deleteSchool(school)" title="Delete school">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </FrostCard>

      <FrostCard v-else-if="!isLoadingSchools" variant="tile" class="empty">
        <div class="empty-ghost">schools</div>
        <div class="empty-copy">
          <strong>No schools yet</strong>
          <p>Add one above — they'll appear here with their join codes.</p>
        </div>
      </FrostCard>
    </template>

    <!-- ───── STAFF TAB ───── -->
    <template v-if="activeTab === 'staff'">
      <!-- Add Staff -->
      <FrostCard variant="panel" class="form-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">Add staff</span>
          <span class="panel-hint">Invite a teacher or school admin to a specific school.</span>
        </div>

        <div v-if="schools.length === 0" class="form-empty">
          <p>Add a school first — staff are linked to schools.</p>
          <button type="button" class="btn-ghost" @click="activeTab = 'schools'">Go to schools</button>
        </div>

        <form v-else class="form-grid" @submit.prevent="createStaff">
          <div class="field">
            <label class="frost-eyebrow">Name <span class="required">*</span></label>
            <input v-model="newStaffName" type="text" class="frost-input" placeholder="e.g. Rhian Griffiths" />
          </div>
          <div class="field">
            <label class="frost-eyebrow">Email <span class="required">*</span></label>
            <input v-model="newStaffEmail" type="email" class="frost-input" placeholder="e.g. rhian@school.edu" />
          </div>
          <div class="field">
            <label class="frost-eyebrow">School <span class="required">*</span></label>
            <select v-model="newStaffSchool" class="frost-select">
              <option value="">— Select school —</option>
              <option v-for="s in schools" :key="s.id" :value="s.id">
                {{ s.school_name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="frost-eyebrow">Role</label>
            <select v-model="newStaffRole" class="frost-select">
              <option value="teacher">Teacher</option>
              <option value="admin">School Admin</option>
            </select>
          </div>

          <div class="field-actions">
            <button
              type="submit"
              class="btn-primary"
              :disabled="isCreatingStaff || !newStaffName.trim() || !newStaffEmail.trim() || !newStaffSchool"
            >
              <svg v-if="!isCreatingStaff" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span v-else class="spinner"></span>
              {{ isCreatingStaff ? 'Adding…' : 'Add staff' }}
            </button>
          </div>
        </form>
      </FrostCard>

      <!-- Staff list panel -->
      <FrostCard v-if="staffMembers.length > 0" variant="panel" class="list-panel">
        <table class="list-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>School</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="staff in staffMembers" :key="staff.user_id">
              <td class="cell-name">{{ staff.display_name }}</td>
              <td class="cell-muted">{{ staff.email || '—' }}</td>
              <td>
                <span
                  class="type-pill"
                  :class="staff.role_in_context === 'admin' ? 'tone-red' : 'tone-green'"
                >
                  {{ staff.role_in_context === 'admin' ? 'Admin' : 'Teacher' }}
                </span>
              </td>
              <td>{{ staff.school_name || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </FrostCard>

      <FrostCard v-else-if="!isLoadingStaff" variant="tile" class="empty">
        <div class="empty-ghost">staff</div>
        <div class="empty-copy">
          <strong>No staff yet</strong>
          <p>Add teachers and school admins above — they'll show up here once invited.</p>
        </div>
      </FrostCard>
    </template>

    <!-- ───── ENTITLEMENTS TAB ───── -->
    <template v-if="activeTab === 'entitlements'">
      <FrostCard variant="panel" class="form-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">Course entitlements</span>
          <span class="panel-hint">Grant courses directly to a school. Groups cascade to their schools automatically.</span>
        </div>

        <div class="form-grid">
          <div class="field">
            <label class="frost-eyebrow">Grant to</label>
            <select v-model="grantTargetType" class="frost-select">
              <option value="group">Group</option>
              <option value="school">School</option>
            </select>
          </div>

          <div class="field">
            <label class="frost-eyebrow">
              {{ grantTargetType === 'group' ? 'Select group' : 'Select school' }}
              <span class="required">*</span>
            </label>
            <select v-model="grantTargetId" class="frost-select">
              <option value="">— Select —</option>
              <template v-if="grantTargetType === 'group'">
                <option v-for="g in groups" :key="g.id" :value="g.id">
                  {{ g.name }}
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

          <div class="picker-header">
            <span class="frost-eyebrow">
              Courses
              <span class="picker-count">({{ grantCourses.length }} selected)</span>
            </span>
            <div class="picker-actions">
              <button type="button" class="link-btn" @click="selectAllCourses">Select all</button>
              <button type="button" class="link-btn" @click="clearCourseSelection">Clear</button>
              <input
                v-model="courseSearch"
                type="text"
                class="frost-input picker-search"
                placeholder="Search courses…"
              />
            </div>
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

          <div v-if="groupedCourses.length === 0" class="course-no-results">
            No courses match "{{ courseSearch }}"
          </div>
        </div>

        <div class="form-grid">
          <div class="field-actions">
            <button
              type="button"
              class="btn-primary"
              :disabled="isSavingGrant || !grantTargetId || grantCourses.length === 0"
              @click="saveGrant"
            >
              <span v-if="isSavingGrant" class="spinner"></span>
              {{ isSavingGrant ? 'Saving…' : 'Save entitlement' }}
            </button>
          </div>
        </div>
      </FrostCard>
    </template>
  </div>
</template>

<style scoped>
.schools-setup {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Page header — canon §5.1 */
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-6);
}

.title-block h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 0 0 var(--space-2);
}

.metrics {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.metric-value {
  color: var(--ink-primary);
  font-weight: var(--font-semibold);
  margin-right: 4px;
}

.metric-sep { color: var(--ink-faint); }

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
  color: rgb(var(--tone-green));
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

/* Filters bar / tab toggle — canon §5.2 (own row) */
.filters-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.tab-toggle {
  display: inline-flex;
  background: rgba(44, 38, 34, 0.05);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
}

.tab-btn {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 6px 14px;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  color: var(--ink-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.tab-btn:hover { color: var(--ink-primary); }

.tab-btn.is-active {
  background: var(--ssi-red);
  color: #fff;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.10), 0 4px 12px rgba(194, 58, 58, 0.20);
}

/* Form panel + section heads */
.form-panel,
.tree-panel,
.list-panel {
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
  color: var(--ink-muted);
}

/* Form grid (frost) */
.form-grid {
  padding: var(--space-5) var(--space-6) var(--space-6);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.form-empty {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.form-empty p { margin: 0; }

@media (max-width: 768px) {
  .form-grid { grid-template-columns: 1fr; }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-wide { grid-column: 1 / -1; }

.field-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.field label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.required {
  color: rgb(var(--tone-red));
  font-weight: var(--font-bold);
  font-family: var(--font-mono);
}

.optional {
  color: var(--ink-faint);
  font-weight: var(--font-normal);
  text-transform: none;
  letter-spacing: 0;
}

.frost-input,
.frost-select {
  font: inherit;
  font-size: var(--text-base);
  padding: 10px 14px;
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder { color: var(--ink-faint); }

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

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px 18px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: var(--ssi-red);
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-base);
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.08), 0 4px 14px rgba(194, 58, 58, 0.22);
}

.btn-primary:hover:not(:disabled) {
  background: var(--ssi-red-light);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.10), 0 8px 22px rgba(194, 58, 58, 0.28);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  padding: 8px 14px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(255, 255, 255, 0.55);
  color: var(--ink-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.20);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Invite-code result inside a form */
.invite-result {
  align-items: flex-start;
}

.invite-hint {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  margin-top: 4px;
}

/* Code chip — borrowed from AdminAccess pattern */
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
  color: var(--ink-secondary);
}

.code-chip:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.16);
  color: var(--ink-primary);
}

.code-chip.is-copied {
  background: rgba(var(--tone-green), 0.16);
  border-color: rgba(var(--tone-green), 0.45);
  color: rgb(var(--tone-green));
}

.code-chip.is-large {
  padding: 10px 16px;
  font-size: var(--text-base);
}

.code-chip.is-large .code-value {
  font-size: var(--text-lg);
  letter-spacing: 0.08em;
}

.code-value {
  font-size: var(--text-sm);
  letter-spacing: 0.05em;
}

/* Lists / tables — canon §5.3 */
.list-table {
  width: 100%;
  border-collapse: collapse;
}

.list-table thead th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-muted);
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  background: rgba(255, 255, 255, 0.35);
}

.list-table thead th:last-child { width: 56px; }

.list-table tbody tr {
  transition: background var(--transition-base);
}

.list-table tbody tr:hover { background: rgba(255, 255, 255, 0.48); }

.list-table td {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.list-table tbody tr:last-child td { border-bottom: none; }

.cell-name {
  color: var(--ink-primary);
  font-weight: var(--font-medium);
}

.cell-muted {
  color: var(--ink-muted);
  white-space: nowrap;
}

/* Inline select for the schools group column */
.inline-select {
  font: inherit;
  font-size: var(--text-xs);
  padding: 4px 26px 4px 10px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-md);
  color: var(--ink-primary);
  cursor: pointer;
  appearance: none;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238A8078' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  max-width: 180px;
}

.inline-select:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.45);
  box-shadow: 0 0 0 2px rgba(var(--tone-red), 0.12);
}

/* Entitlement badge in schools row */
.entitlement-badge {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--text-xs);
  color: rgb(var(--tone-green));
  font-weight: var(--font-medium);
}

.entitlement-count {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

.entitlement-label {
  color: var(--ink-muted);
  font-weight: var(--font-normal);
}

/* Type pills (role badges + group type) */
.type-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.type-pill.tone-blue {
  background: rgba(var(--tone-blue), 0.14);
  border-color: rgba(var(--tone-blue), 0.32);
  color: rgb(var(--tone-blue));
}

.type-pill.tone-gold {
  background: rgba(var(--tone-gold), 0.18);
  border-color: rgba(var(--tone-gold), 0.42);
  color: rgb(var(--tone-gold));
}

.type-pill.tone-green {
  background: rgba(var(--tone-green), 0.14);
  border-color: rgba(var(--tone-green), 0.36);
  color: rgb(var(--tone-green));
}

.type-pill.tone-red {
  background: rgba(var(--tone-red), 0.12);
  border-color: rgba(var(--tone-red), 0.32);
  color: rgb(var(--tone-red));
}

/* Hover-reveal row actions — canon §5.3 */
.cell-actions {
  text-align: right;
  padding-right: 12px;
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transform: translateX(4px);
  transition: all var(--transition-fast);
}

.list-table tbody tr:hover .row-actions,
.list-table tbody tr:focus-within .row-actions,
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
  color: var(--ink-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.row-action:hover {
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(44, 38, 34, 0.10);
}

.row-action.is-danger:hover {
  color: rgb(var(--tone-red));
  background: rgba(var(--tone-red), 0.08);
  border-color: rgba(var(--tone-red), 0.30);
}

/* Groups tree */
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
  color: var(--ink-secondary);
}

.group-row:hover { background: rgba(255, 255, 255, 0.48); }

.group-row--child { padding-left: calc(var(--space-4) + var(--space-6)); }
.group-row--grandchild { padding-left: calc(var(--space-4) + var(--space-12)); }

.group-name-editable {
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
  color: var(--ink-primary);
  font-weight: var(--font-semibold);
}

.group-row--child .group-name-editable,
.group-row--grandchild .group-name-editable {
  font-weight: var(--font-medium);
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
  color: var(--ink-primary);
  width: 220px;
}

.group-rename-input:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}

.group-meta {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.group-courses {
  font-size: var(--text-xs);
  color: rgb(var(--tone-green));
  font-weight: var(--font-medium);
}

/* Course picker (entitlements tab) */
.course-picker {
  padding: 0 var(--space-6) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.inherited-notice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: rgba(var(--tone-blue), 0.08);
  border: 1px solid rgba(var(--tone-blue), 0.28);
  border-radius: var(--radius-md);
  color: rgb(var(--tone-blue));
  font-size: var(--text-xs);
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.picker-count {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--ink-faint);
  text-transform: none;
  margin-left: 4px;
}

.picker-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.picker-search {
  max-width: 240px;
  padding: 8px 12px;
  font-size: var(--text-sm);
}

.link-btn {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  background: none;
  border: none;
  color: var(--ink-muted);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast);
}

.link-btn:hover { color: var(--ink-primary); }

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
  color: var(--ink-muted);
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
  color: var(--ink-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.course-chip:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.20);
  color: var(--ink-primary);
}

.course-chip.is-selected {
  background: rgba(var(--tone-gold), 0.18);
  border-color: rgba(var(--tone-gold), 0.45);
  color: rgb(var(--tone-gold));
  font-weight: var(--font-medium);
}

.course-no-results {
  padding: 16px;
  text-align: center;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Empty states — canon §5.5 */
.empty {
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
  color: var(--ink-faint);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--ink-primary);
  margin-bottom: 4px;
}

.empty-copy p {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Transitions */
.fade-enter-active, .fade-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Mobile niceties */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .picker-search { max-width: 100%; }

  /* Hide created-at column on mobile to keep schools table readable */
  .list-table thead th:nth-child(6),
  .list-table tbody td:nth-child(6) {
    display: none;
  }
}
</style>
