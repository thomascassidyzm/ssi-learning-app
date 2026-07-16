<script setup lang="ts">
// Self-serve "Create demo school" tool (owner: Nick, Head of Partnerships).
// Provisions a full showcase org for a prospect — real accounts, real
// classes, realistic seeded activity — without engineering help.
// Server logic: api/admin/demo-schools.ts + api/_utils/demoSchoolGen.ts.
import { ref, computed, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import DemoOrgResultCard, { type DemoStaffRow } from '@/components/admin/DemoOrgResultCard.vue'

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
  expires_at: string
  status: 'active' | 'expired'
  expired_at: string | null
  metadata: { orgName: string; staff: DemoStaffRow[]; counts: { schools: number; teachers: number; classes: number; learners: number } }
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
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create demo school'
  } finally {
    isCreating.value = false
  }
}

async function runAction(id: string, action: 'expire' | 'extend'): Promise<void> {
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

onMounted(() => {
  fetchCourses()
  fetchOrgs()
})
</script>

<template>
  <div class="admin-demo-schools">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Sales showcase</span>
        <h1 class="arsenal">Demo Schools</h1>
        <p class="subtitle">
          Provision a full showcase org for a prospect — real accounts, real classes, realistic
          activity — in one click. No engineering help needed.
        </p>
      </div>
    </header>

    <Transition name="fade">
      <div v-if="error" class="banner banner-error">{{ error }}</div>
    </Transition>

    <!-- Create form -->
    <div class="schools-card create-panel">
      <div class="panel-head">
        <span class="schools-kicker">Create demo school</span>
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
            {{ isCreating ? 'Creating…' : 'Create demo school' }}
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
      <div class="panel-head">
        <span class="schools-kicker">Existing demo orgs</span>
      </div>

      <div v-if="orgs.length" class="orgs-table-wrap">
        <table class="codes-table">
          <thead>
            <tr>
              <th>Prospect</th>
              <th>Shape</th>
              <th>Course</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Status</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="org in orgs" :key="org.id">
              <tr :class="{ 'is-inactive': org.status === 'expired' }">
                <td class="cell-org">{{ org.prospect_name }}</td>
                <td class="cell-muted">{{ shapeLabel(org.org_shape) }}</td>
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
                  <button class="row-action-text" @click="toggleExpanded(org.id)">
                    {{ expandedId === org.id ? 'Hide' : 'View' }}
                  </button>
                  <button
                    class="row-action-text"
                    :disabled="busyAction === `extend:${org.id}`"
                    @click="runAction(org.id, 'extend')"
                  >Extend 30d</button>
                  <button
                    v-if="org.status === 'active'"
                    class="row-action-text row-action-danger"
                    :disabled="busyAction === `expire:${org.id}`"
                    @click="runAction(org.id, 'expire')"
                  >Expire now</button>
                </td>
              </tr>
              <tr v-if="expandedId === org.id" class="detail-row">
                <td colspan="7">
                  <DemoOrgResultCard
                    :org-name="org.metadata.orgName"
                    :org-shape="org.org_shape"
                    :course-code="org.course_code"
                    :expires-at="org.expires_at"
                    :counts="org.metadata.counts"
                    :staff="org.metadata.staff"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-else-if="!isLoading" class="schools-card empty">
        <div class="empty-copy">
          <strong>No demo schools yet</strong>
          <p>Create one above to get a full showcase org ready to share.</p>
        </div>
      </div>
    </div>
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

.empty { padding: var(--space-8); text-align: center; }
.empty-copy strong { display: block; font-family: var(--font-display); font-size: var(--text-lg); color: var(--schools-fg); margin-bottom: 4px; }
.empty-copy p { margin: 0; color: var(--schools-fg-3); font-size: var(--text-sm); }

.fade-enter-active, .fade-leave-active { transition: opacity var(--transition-base); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 768px) {
  .create-form { grid-template-columns: 1fr; }
}
</style>
