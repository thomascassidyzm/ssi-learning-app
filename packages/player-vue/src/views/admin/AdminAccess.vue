<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useUserRole } from '@/composables/useUserRole'
import { useAdminClient } from '@/composables/useAdminClient'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

type Mode = 'invite' | 'direct'

interface Group {
  id: string
  name: string
  type: string
  parent_id: string | null
}

interface InviteCode {
  id: string
  code: string
  code_type: string
  grants_region: string | null
  grants_group_id: string | null
  grants_school_id: string | null
  grants_class_id: string | null
  metadata: { organization_name?: string } | null
  created_at: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  is_active: boolean
}

interface EntitlementCode {
  id: string
  code: string
  access_type: 'full' | 'courses'
  granted_courses: string[] | null
  duration_type: 'lifetime' | 'time_limited'
  duration_days: number | null
  label: string
  max_uses: number | null
  use_count: number
  expires_at: string | null
  is_active: boolean
  created_at: string
}

interface CourseOption {
  course_code: string
  display_name: string | null
  known_lang: string
  target_lang: string
}

type Row =
  | { kind: 'invite'; row: InviteCode; createdAt: string }
  | { kind: 'direct'; row: EntitlementCode; createdAt: string }

const { user, learner } = useAuth()
const { isSsiAdmin, isGovtAdmin } = useUserRole()
const { getClient, getAuthToken } = useAdminClient()

// ─── Data ──────────────────────────────────────────────────────────────────
const groups = ref<Group[]>([])
const inviteCodes = ref<InviteCode[]>([])
const entitlementCodes = ref<EntitlementCode[]>([])
const allCourses = ref<CourseOption[]>([])

const isLoading = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const copiedCode = ref<string | null>(null)

// ─── Form: shared ──────────────────────────────────────────────────────────
const mode = ref<Mode>('invite')
const formExpiresAt = ref('')
const formMaxUses = ref<number | ''>('')

// ─── Form: invite-mode ─────────────────────────────────────────────────────
const inviteCodeType = ref<'ssi_admin' | 'govt_admin' | 'school_admin' | 'tester'>('govt_admin')
const inviteGroup = ref('')
const inviteOrgName = ref('')

// ─── Form: direct-mode ─────────────────────────────────────────────────────
const directLabel = ref('')
const directAccessType = ref<'full' | 'courses'>('full')
const directDurationType = ref<'lifetime' | 'time_limited'>('lifetime')
const directDurationDays = ref<number | ''>('')
const directSelectedCourses = ref<Set<string>>(new Set())
const courseSearch = ref('')
const coursePickerOpen = ref(false)

const filteredCourses = computed(() => {
  const q = courseSearch.value.toLowerCase().trim()
  if (!q) return allCourses.value
  return allCourses.value.filter(c =>
    c.course_code.toLowerCase().includes(q) ||
    (c.display_name || '').toLowerCase().includes(q) ||
    c.known_lang.toLowerCase().includes(q) ||
    c.target_lang.toLowerCase().includes(q)
  )
})

function toggleCourse(code: string) {
  const s = new Set(directSelectedCourses.value)
  if (s.has(code)) s.delete(code)
  else s.add(code)
  directSelectedCourses.value = s
}

function courseLabel(c: CourseOption): string {
  return c.display_name || `${c.target_lang} for ${c.known_lang}`
}

// ─── Combined view ─────────────────────────────────────────────────────────
const allRows = computed<Row[]>(() => {
  const invites = inviteCodes.value.map(r => ({ kind: 'invite' as const, row: r, createdAt: r.created_at }))
  const directs = entitlementCodes.value.map(r => ({ kind: 'direct' as const, row: r, createdAt: r.created_at }))
  return [...invites, ...directs].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
})

const totalCount = computed(() => allRows.value.length)
const activeCount = computed(() =>
  inviteCodes.value.filter(c => c.is_active).length +
  entitlementCodes.value.filter(c => c.is_active).length
)

// ─── Fetch ─────────────────────────────────────────────────────────────────
function getCurrentUserId(): string | null {
  if (user.value) return user.value.id
  if (learner.value) return learner.value.user_id
  return null
}

async function fetchAll(): Promise<void> {
  const client = getClient()
  const userId = getCurrentUserId()
  if (!userId) return

  isLoading.value = true
  error.value = null

  // Default invite-mode role for govt admins
  if (!isSsiAdmin.value && isGovtAdmin.value) {
    inviteCodeType.value = 'school_admin'
  }

  try {
    const token = await getAuthToken()
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {}

    // Groups: server-side endpoint (uses service role, bypasses RLS)
    const groupsP = fetch('/api/groups', { headers: authHeader })

    let invitesQ = client.from('invite_codes').select('*').order('created_at', { ascending: false })
    if (!isSsiAdmin.value) invitesQ = invitesQ.eq('created_by', userId)

    const coursesP = client
      .from('courses')
      .select('course_code, display_name, known_lang, target_lang')
      .order('display_name')

    const entitlementsP = fetch('/api/entitlement/list', { headers: authHeader })

    const [groupsR, invitesR, coursesR, entitlementsR] = await Promise.all([
      groupsP, invitesQ, coursesP, entitlementsP,
    ])

    if (!groupsR.ok) {
      const body = await groupsR.json().catch(() => ({}))
      console.warn('[AdminAccess] groups load failed:', body)
      groups.value = []
    } else {
      const gJson = await groupsR.json()
      groups.value = gJson.groups || []
    }

    if (invitesR.error) throw invitesR.error
    inviteCodes.value = invitesR.data || []

    if (coursesR.error) {
      console.warn('[AdminAccess] courses load failed:', coursesR.error)
      allCourses.value = []
    } else {
      allCourses.value = coursesR.data || []
    }

    if (!entitlementsR.ok) {
      const body = await entitlementsR.json().catch(() => ({}))
      throw new Error(body.error || `Entitlement list failed: ${entitlementsR.status}`)
    }
    const entJson = await entitlementsR.json()
    entitlementCodes.value = entJson.codes || []
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load codes'
    console.error('[AdminAccess] fetch error:', err)
  } finally {
    isLoading.value = false
  }
}

// ─── Create ────────────────────────────────────────────────────────────────
async function createCode(): Promise<void> {
  if (mode.value === 'invite') return createInviteCode()
  return createDirectCode()
}

async function createInviteCode(): Promise<void> {
  if (!inviteOrgName.value.trim()) {
    error.value = 'Organisation name is required'
    return
  }

  isCreating.value = true
  error.value = null
  successMessage.value = null

  try {
    const token = await getAuthToken()

    const body: Record<string, unknown> = {
      code_type: inviteCodeType.value,
      metadata: { organization_name: inviteOrgName.value.trim() },
    }
    if (inviteGroup.value) body.grants_group_id = inviteGroup.value
    if (formExpiresAt.value) body.expires_at = new Date(formExpiresAt.value).toISOString()
    if (formMaxUses.value !== '') body.max_uses = Number(formMaxUses.value)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch('/api/invite/create', {
      method: 'POST', headers, body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }

    const result = await response.json()
    successMessage.value = `Code created: ${result.code}`

    inviteOrgName.value = ''
    inviteGroup.value = ''
    formExpiresAt.value = ''
    formMaxUses.value = ''

    await fetchAll()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create code'
    console.error('[AdminAccess] invite create error:', err)
  } finally {
    isCreating.value = false
  }
}

async function createDirectCode(): Promise<void> {
  if (!directLabel.value.trim()) {
    error.value = 'Label is required'
    return
  }
  if (directAccessType.value === 'courses' && directSelectedCourses.value.size === 0) {
    error.value = 'Select at least one course'
    return
  }
  if (directDurationType.value === 'time_limited' && (!directDurationDays.value || Number(directDurationDays.value) < 1)) {
    error.value = 'Duration days must be at least 1'
    return
  }

  isCreating.value = true
  error.value = null
  successMessage.value = null

  try {
    const token = await getAuthToken()
    if (!token) {
      error.value = 'Not authenticated'
      return
    }

    const body: Record<string, unknown> = {
      access_type: directAccessType.value,
      duration_type: directDurationType.value,
      label: directLabel.value.trim(),
    }
    if (directAccessType.value === 'courses') body.granted_courses = [...directSelectedCourses.value]
    if (directDurationType.value === 'time_limited') body.duration_days = Number(directDurationDays.value)
    if (formMaxUses.value !== '') body.max_uses = Number(formMaxUses.value)
    if (formExpiresAt.value) body.expires_at = new Date(formExpiresAt.value).toISOString()

    const response = await fetch('/api/entitlement/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }

    const result = await response.json()
    successMessage.value = `Code created: ${result.code}`

    directLabel.value = ''
    directSelectedCourses.value = new Set()
    courseSearch.value = ''
    coursePickerOpen.value = false
    directDurationDays.value = ''
    directAccessType.value = 'full'
    directDurationType.value = 'lifetime'
    formExpiresAt.value = ''
    formMaxUses.value = ''

    await fetchAll()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create code'
    console.error('[AdminAccess] direct create error:', err)
  } finally {
    isCreating.value = false
  }
}

// ─── Toggle / copy ─────────────────────────────────────────────────────────
async function toggleActive(row: Row): Promise<void> {
  const client = getClient()
  const table = row.kind === 'invite' ? 'invite_codes' : 'entitlement_codes'
  error.value = null
  try {
    const next = !row.row.is_active
    const { error: updateError } = await client
      .from(table)
      .update({ is_active: next })
      .eq('id', row.row.id)
    if (updateError) throw updateError
    row.row.is_active = next
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update code'
  }
}

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
  } catch {
    const el = document.createElement('textarea')
    el.value = code
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
  copiedCode.value = code
  setTimeout(() => {
    if (copiedCode.value === code) copiedCode.value = null
  }, 1800)
}

// ─── Formatters ────────────────────────────────────────────────────────────
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: '2-digit',
  })
}

function formatRoleType(type: string): string {
  if (type === 'ssi_admin') return 'SSi Admin'
  if (type === 'govt_admin') return 'Govt Admin'
  if (type === 'school_admin') return 'School Admin'
  if (type === 'tester') return 'Tester'
  if (type === 'teacher') return 'Teacher'
  if (type === 'student') return 'Student'
  return type
}

function roleTone(type: string): string {
  if (type === 'ssi_admin') return 'gold'
  if (type === 'govt_admin') return 'blue'
  if (type === 'school_admin') return 'green'
  if (type === 'teacher') return 'green'
  if (type === 'tester') return 'red'
  return 'blue'
}

function formatDirectAccess(c: EntitlementCode): string {
  if (c.access_type === 'full') return 'Full access'
  if (c.granted_courses?.length) {
    return c.granted_courses.map(gc => {
      const course = allCourses.value.find(ac => ac.course_code === gc)
      return course?.display_name || gc
    }).join(', ')
  }
  return 'Specific courses'
}

function formatDuration(c: EntitlementCode): string {
  if (c.duration_type === 'lifetime') return 'Lifetime'
  if (c.duration_days) return `${c.duration_days} days`
  return '—'
}

function formatUses(c: { use_count: number; max_uses: number | null }): string {
  if (c.max_uses === null) return `${c.use_count} / ∞`
  return `${c.use_count} / ${c.max_uses}`
}

function groupName(id: string | null): string {
  if (!id) return '—'
  const g = groups.value.find(r => r.id === id)
  return g?.name || '—'
}

function inviteOrgLabel(c: InviteCode): string {
  return c.metadata?.organization_name || '—'
}

onMounted(() => {
  fetchAll()
})
</script>

<template>
  <div class="admin-access">
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Access Codes</h1>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ totalCount }}</span>
            codes
          </span>
          <template v-if="totalCount > 0">
            <span class="metric-sep">·</span>
            <span class="metric metric-active">
              <span class="metric-value frost-mono-nums">{{ activeCount }}</span>
              active
            </span>
          </template>
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

    <!-- Create form — FrostCard panel -->
    <FrostCard variant="panel" class="create-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Create new code</span>
        <div class="mode-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ 'is-active': mode === 'invite' }"
            :aria-selected="mode === 'invite'"
            @click="mode = 'invite'"
          >
            Invite to org
          </button>
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ 'is-active': mode === 'direct' }"
            :aria-selected="mode === 'direct'"
            @click="mode = 'direct'"
          >
            Direct access
          </button>
        </div>
      </div>

      <form class="create-form" @submit.prevent="createCode">
        <!-- ───── INVITE MODE ───── -->
        <template v-if="mode === 'invite'">
          <div class="field">
            <label class="frost-eyebrow">Role</label>
            <select v-model="inviteCodeType" class="frost-select">
              <option v-if="isSsiAdmin" value="ssi_admin">SSi Admin</option>
              <option v-if="isSsiAdmin" value="govt_admin">Govt Admin</option>
              <option v-if="isSsiAdmin" value="tester">Tester</option>
              <option value="school_admin">School Admin</option>
            </select>
          </div>

          <div class="field">
            <label class="frost-eyebrow">Group <span class="optional">(optional)</span></label>
            <select v-model="inviteGroup" class="frost-select">
              <option value="">— No group —</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>

          <div class="field field-wide">
            <label class="frost-eyebrow">Organisation name <span class="required">*</span></label>
            <input
              v-model="inviteOrgName"
              type="text"
              class="frost-input"
              placeholder="e.g. Welsh Government"
            />
          </div>
        </template>

        <!-- ───── DIRECT MODE ───── -->
        <template v-else>
          <div class="field field-wide">
            <label class="frost-eyebrow">Label <span class="required">*</span></label>
            <input
              v-model="directLabel"
              type="text"
              class="frost-input"
              placeholder="e.g. Welsh Govt 2026, Press Pass…"
            />
          </div>

          <div class="field">
            <label class="frost-eyebrow">Access</label>
            <select v-model="directAccessType" class="frost-select">
              <option value="full">Full access (all courses)</option>
              <option value="courses">Specific courses</option>
            </select>
          </div>

          <div class="field">
            <label class="frost-eyebrow">Duration</label>
            <select v-model="directDurationType" class="frost-select">
              <option value="lifetime">Lifetime</option>
              <option value="time_limited">Time-limited</option>
            </select>
          </div>

          <div v-if="directDurationType === 'time_limited'" class="field">
            <label class="frost-eyebrow">Duration (days)</label>
            <input
              v-model="directDurationDays"
              type="number" min="1"
              class="frost-input"
              placeholder="30"
            />
          </div>

          <div v-if="directAccessType === 'courses'" class="field field-wide">
            <label class="frost-eyebrow">Courses</label>
            <div class="course-picker">
              <div v-if="directSelectedCourses.size > 0" class="selected-tags">
                <span
                  v-for="code in directSelectedCourses"
                  :key="code"
                  class="course-tag"
                  @click="toggleCourse(code)"
                >
                  {{ code }}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </span>
              </div>
              <input
                v-model="courseSearch"
                type="text"
                class="frost-input"
                placeholder="Search courses…"
                @focus="coursePickerOpen = true"
              />
              <div v-if="coursePickerOpen" class="course-dropdown">
                <div class="course-dropdown-list">
                  <div
                    v-for="c in filteredCourses"
                    :key="c.course_code"
                    class="course-option"
                    :class="{ 'is-selected': directSelectedCourses.has(c.course_code) }"
                    @click="toggleCourse(c.course_code)"
                  >
                    <div class="course-option-check">
                      <svg v-if="directSelectedCourses.has(c.course_code)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <div class="course-option-info">
                      <span class="course-option-name">{{ courseLabel(c) }}</span>
                      <span class="course-option-code">{{ c.course_code }}</span>
                    </div>
                  </div>
                  <div v-if="filteredCourses.length === 0" class="course-option-empty">
                    No courses match "{{ courseSearch }}"
                  </div>
                </div>
                <button
                  type="button"
                  class="picker-done-btn"
                  @click="coursePickerOpen = false; courseSearch = ''"
                >Done</button>
              </div>
            </div>
          </div>
        </template>

        <!-- ───── SHARED FIELDS ───── -->
        <div class="field">
          <label class="frost-eyebrow">Expires <span class="optional">(optional)</span></label>
          <input v-model="formExpiresAt" type="date" class="frost-input" />
        </div>

        <div class="field">
          <label class="frost-eyebrow">Max uses <span class="optional">(blank = unlimited)</span></label>
          <input
            v-model="formMaxUses"
            type="number" min="1"
            class="frost-input"
            placeholder="Unlimited"
          />
        </div>

        <div class="field-actions">
          <button
            type="submit"
            class="btn-primary"
            :disabled="isCreating || (mode === 'invite' ? !inviteOrgName.trim() : !directLabel.trim())"
          >
            <svg v-if="!isCreating" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span v-else class="spinner"></span>
            {{ isCreating ? 'Creating…' : 'Create code' }}
          </button>
        </div>
      </form>
    </FrostCard>

    <!-- Codes list — table inside panel canon §5.3 -->
    <FrostCard
      v-if="allRows.length > 0"
      variant="panel"
      class="codes-panel"
    >
      <table class="codes-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Kind</th>
            <th>Detail</th>
            <th>Label</th>
            <th>Group</th>
            <th>Uses</th>
            <th>Expires</th>
            <th>Status</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in allRows"
            :key="`${r.kind}-${r.row.id}`"
            :class="{ 'is-inactive': !r.row.is_active }"
          >
            <td class="cell-code">
              <button
                class="code-chip"
                :class="{ 'is-copied': copiedCode === r.row.code }"
                :title="copiedCode === r.row.code ? 'Copied!' : 'Click to copy'"
                @click="copyCode(r.row.code)"
              >
                <span class="code-value frost-mono-nums">{{ r.row.code }}</span>
                <svg v-if="copiedCode !== r.row.code" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </td>
            <td>
              <span class="kind-pill" :class="`kind-${r.kind}`">
                {{ r.kind === 'invite' ? 'Invite' : 'Direct' }}
              </span>
            </td>
            <td>
              <template v-if="r.kind === 'invite'">
                <span class="type-pill" :class="`tone-${roleTone(r.row.code_type)}`">
                  {{ formatRoleType(r.row.code_type) }}
                </span>
              </template>
              <template v-else>
                <span class="cell-detail">
                  {{ formatDirectAccess(r.row) }}
                  <span class="cell-detail-sep">·</span>
                  <span class="cell-muted">{{ formatDuration(r.row) }}</span>
                </span>
              </template>
            </td>
            <td class="cell-org">
              {{ r.kind === 'invite' ? inviteOrgLabel(r.row) : (r.row.label || '—') }}
            </td>
            <td class="cell-muted">
              {{ r.kind === 'invite' ? groupName(r.row.grants_group_id) : '—' }}
            </td>
            <td class="cell-muted frost-mono-nums">{{ formatUses(r.row) }}</td>
            <td class="cell-muted frost-mono-nums">{{ formatDate(r.row.expires_at) }}</td>
            <td>
              <button
                class="status-pill"
                :class="r.row.is_active ? 'is-active' : 'is-disabled'"
                @click="toggleActive(r)"
              >
                <span class="status-dot"></span>
                {{ r.row.is_active ? 'Active' : 'Disabled' }}
              </button>
            </td>
            <td class="cell-actions">
              <button
                class="row-action"
                :title="copiedCode === r.row.code ? 'Copied!' : 'Copy code'"
                @click.stop="copyCode(r.row.code)"
              >
                <svg v-if="copiedCode !== r.row.code" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </FrostCard>

    <!-- Empty state -->
    <FrostCard
      v-else-if="!isLoading"
      variant="tile"
      class="empty"
    >
      <div class="empty-ghost">codes</div>
      <div class="empty-copy">
        <strong>No access codes yet</strong>
        <p>Create one above and share it to invite admins, teachers, or grant direct access.</p>
      </div>
    </FrostCard>

    <!-- Loading -->
    <div v-if="isLoading && allRows.length === 0" class="loading">
      Loading codes…
    </div>
  </div>
</template>

<style scoped>
.admin-access {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Page header */
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
.metric-active .metric-value { color: rgb(var(--tone-green)); }

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

/* Create panel */
.create-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

/* Mode toggle — segmented control */
.mode-toggle {
  display: inline-flex;
  background: rgba(44, 38, 34, 0.05);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
}

.mode-btn {
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
}

.mode-btn:hover { color: var(--ink-primary); }

.mode-btn.is-active {
  background: var(--ssi-red);
  color: #fff;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.10), 0 4px 12px rgba(194, 58, 58, 0.20);
}

/* Form */
.create-form {
  padding: var(--space-5) var(--space-6) var(--space-6);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
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

/* Course picker */
.course-picker {
  position: relative;
}

.selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.course-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(var(--tone-blue), 0.12);
  border: 1px solid rgba(var(--tone-blue), 0.30);
  color: rgb(var(--tone-blue));
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.course-tag:hover {
  background: rgba(var(--tone-red), 0.10);
  border-color: rgba(var(--tone-red), 0.30);
  color: rgb(var(--tone-red));
}

.course-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: rgba(252, 248, 242, 0.97);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 32px rgba(44, 38, 34, 0.16);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 50;
  max-height: 320px;
  display: flex;
  flex-direction: column;
}

.course-dropdown-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.course-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.course-option:hover { background: rgba(44, 38, 34, 0.04); }

.course-option.is-selected {
  background: rgba(var(--tone-blue), 0.08);
}

.course-option-check {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid rgba(44, 38, 34, 0.20);
  color: rgb(var(--tone-blue));
}

.course-option.is-selected .course-option-check {
  background: rgba(var(--tone-blue), 0.16);
  border-color: rgba(var(--tone-blue), 0.45);
}

.course-option-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.course-option-name {
  color: var(--ink-primary);
  font-size: var(--text-sm);
}

.course-option-code {
  color: var(--ink-faint);
  font-family: var(--font-mono);
  font-size: 11px;
}

.course-option-empty {
  padding: 16px;
  text-align: center;
  color: var(--ink-faint);
  font-size: var(--text-sm);
}

.picker-done-btn {
  margin: 6px;
  padding: 8px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  background: rgba(44, 38, 34, 0.06);
  border: 1px solid rgba(44, 38, 34, 0.10);
  color: var(--ink-primary);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.picker-done-btn:hover { background: rgba(44, 38, 34, 0.10); }

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

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Codes table */
.codes-panel {
  padding: 0;
  overflow: hidden;
}

.codes-table {
  width: 100%;
  border-collapse: collapse;
}

.codes-table thead th {
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

.codes-table thead th:last-child { width: 56px; }

.codes-table tbody tr {
  transition: background var(--transition-base);
}

.codes-table tbody tr:hover { background: rgba(255, 255, 255, 0.48); }
.codes-table tbody tr.is-inactive { opacity: 0.5; }

.codes-table td {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.codes-table tbody tr:last-child td { border-bottom: none; }

.cell-org {
  color: var(--ink-primary);
  font-weight: var(--font-medium);
}

.cell-muted {
  color: var(--ink-muted);
  white-space: nowrap;
}

.cell-detail {
  color: var(--ink-primary);
  font-size: var(--text-sm);
}

.cell-detail-sep {
  margin: 0 6px;
  color: var(--ink-faint);
}

/* Code chip */
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

.code-value {
  font-size: var(--text-sm);
  letter-spacing: 0.05em;
}

/* Kind pill */
.kind-pill {
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

.kind-pill.kind-invite {
  background: rgba(var(--tone-gold), 0.16);
  border-color: rgba(var(--tone-gold), 0.40);
  color: rgb(var(--tone-gold));
}

.kind-pill.kind-direct {
  background: rgba(var(--tone-blue), 0.12);
  border-color: rgba(var(--tone-blue), 0.32);
  color: rgb(var(--tone-blue));
}

/* Type/role pill */
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

/* Status pill */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-pill.is-active {
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.10);
  border-color: rgba(var(--tone-green), 0.30);
}

.status-pill.is-active:hover {
  background: rgba(var(--tone-green), 0.18);
}

.status-pill.is-disabled {
  color: var(--ink-faint);
  background: rgba(44, 38, 34, 0.04);
  border-color: rgba(44, 38, 34, 0.10);
}

.status-pill.is-disabled:hover {
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.08);
  border-color: rgba(var(--tone-green), 0.25);
}

/* Hover-reveal action */
.cell-actions {
  text-align: right;
  padding-right: 12px;
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
  opacity: 0;
  transform: translateX(4px);
  transition: all var(--transition-fast);
}

.codes-table tbody tr:hover .row-action,
.codes-table tbody tr:focus-within .row-action {
  opacity: 1;
  transform: translateX(0);
}

.row-action:hover {
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(44, 38, 34, 0.1);
}

/* Empty state */
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

.loading {
  text-align: center;
  padding: var(--space-12);
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

@media (max-width: 768px) {
  .create-form { grid-template-columns: 1fr; }
  /* Hide Group + Expires on mobile */
  .codes-table thead th:nth-child(5),
  .codes-table tbody td:nth-child(5),
  .codes-table thead th:nth-child(7),
  .codes-table tbody td:nth-child(7) {
    display: none;
  }
}
</style>
