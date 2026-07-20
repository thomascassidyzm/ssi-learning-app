<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRouter } from 'vue-router'
import HealthDot from '@/components/schools/shared/HealthDot.vue'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData, type School } from '@/composables/schools/useSchoolData'
import { useGovtAdminActions } from '@/composables/schools/useGovtAdminActions'
import { useSchoolsNav } from '@/composables/schools/useSchoolsNav'

const router = useRouter()
const isAdminView = inject<boolean>('isAdminView', false)
const { schoolsLink } = useSchoolsNav()
const { currentUser } = useSchoolContext()
const {
  schools,
  groupSummary,
  totalStudents,
  totalTeachers,
  totalClasses,
  totalPracticeHours,
  fetchSchools,
  selectSchoolToView,
  isLoading: schoolsLoading,
  error: fetchError,
} = useSchoolData()
const { createSchoolInMyGroup, error: createError } = useGovtAdminActions()

const searchQuery = ref('')
type SortKey = 'hours' | 'students' | 'name'
const sortKey = ref<SortKey>('hours')

// The ONE refresh protocol: register this page's loader; the navbar button and
// pull-to-refresh both drive it, and the initial/reactive loads route through
// the same refresh() so the spinner + "Updated HH:MM" stamp stay honest.
const { isRefreshing, refresh, registerRefresh } = useDashboardRefresh()
registerRefresh(fetchSchools, { immediate: false })

const filteredSchools = computed<School[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const list = q
    ? schools.value.filter((s) => s.school_name.toLowerCase().includes(q))
    : [...schools.value]

  return list.sort((a, b) => {
    if (sortKey.value === 'students') return b.student_count - a.student_count
    if (sortKey.value === 'name') return a.school_name.localeCompare(b.school_name)
    return b.total_practice_hours - a.total_practice_hours
  })
})

const headerEyebrow = computed(() => {
  return (
    currentUser.value?.organization_name ||
    groupSummary.value?.group_name ||
    (currentUser.value?.region_code ? `${currentUser.value.region_code.toUpperCase()} Authority` : 'Programme view')
  )
})

const awaitingCount = computed(() => schools.value.filter((s) => !s.has_admin).length)

const headerLede = computed(() => {
  const n = schools.value.length
  if (!n && schoolsLoading.value) return 'Loading schools…'
  if (!n) return 'No schools registered in this programme yet.'
  const base = `Programme view of every school on SSi. ${n} school${n === 1 ? '' : 's'}.`
  if (!awaitingCount.value) return base
  return `${base} ${awaitingCount.value} awaiting admin.`
})

const hoursThisWeek = computed(() => Math.round(totalPracticeHours.value))

function schoolInitial(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const last = parts[parts.length - 1] || name
  return (last[0] || '?').toUpperCase()
}

function formatJoined(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

function handleSchoolClick(school: School) {
  // Under an admin read-view, drill into THAT school's own admin read-view —
  // never the self-viewing singleton + '/schools', which would eject the
  // admin into their own scope (docs/audits/2026-07-13-bug-class-audit.md #1b).
  if (isAdminView) {
    router.push({ path: schoolsLink('schools-list', { schoolId: school.id }) })
    return
  }
  selectSchoolToView(school)
  router.push('/schools')
}

// ---------- Add school (one primitive — school creation, region-tier-design.md
// §5c-revised 2026-07-13): the school row is created IMMEDIATELY, group-
// attached, with both join codes registered at birth. There is no separate
// "onboard" concept any more — the row itself is the source of the admin
// and teacher share links, shown here and forever after on the row. ----------
const showAddModal = ref(false)
const newSchoolName = ref('')
const isCreatingSchool = ref(false)
const createdSchool = ref<{ id: string; school_name: string; admin_join_code: string; teacher_join_code: string } | null>(null)
const copiedCode = ref<string | null>(null)

function redeemUrl(code: string): string {
  return `${window.location.origin}/redeem/${code}`
}

function openAddModal() {
  newSchoolName.value = ''
  createdSchool.value = null
  copiedCode.value = null
  createError.value = null
  showAddModal.value = true
}

async function closeAddModal() {
  showAddModal.value = false
  if (createdSchool.value) await refresh()
}

async function handleCreateSchool() {
  if (!newSchoolName.value.trim()) return
  isCreatingSchool.value = true
  const result = await createSchoolInMyGroup(newSchoolName.value.trim())
  isCreatingSchool.value = false
  if (result) createdSchool.value = result.school
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(redeemUrl(code))
    copiedCode.value = code
    setTimeout(() => { if (copiedCode.value === code) copiedCode.value = null }, 2000)
  } catch {
    /* ignore */
  }
}

// ---------- CSV export ----------
function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function handleExport() {
  const header = ['School', 'City', 'Students', 'Teachers', 'Classes', 'Hours', 'Joined', 'Health']
  const rows = filteredSchools.value.map((s) => [
    s.school_name,
    '—',
    s.student_count,
    s.teacher_count,
    s.class_count,
    Math.round(s.total_practice_hours),
    formatJoined(s.created_at),
    s.health?.replace('-', ' ') || '',
  ])
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'schools.csv'
  link.click()
  URL.revokeObjectURL(url)
}

// Founder ruling (2026-07-19): NO auto-refresh — the old visibility/focus
// refetch is gone. Data loads on navigation (and when the user arrives) and
// then HOLDS STILL until a deliberate refresh. Both loads route through the
// shared refresh() so they show the spinner and stamp "Updated HH:MM".
onMounted(() => {
  if (currentUser.value) void refresh()
})

watch(currentUser, (u) => {
  if (u) void refresh()
})
</script>

<template>
  <main class="schools-list-screen">
    <div class="hero">
      <div class="hero-text">
        <div class="hero-eyebrow">{{ headerEyebrow }}</div>
        <h1 class="arsenal hero-title">All schools</h1>
        <p class="hero-lede schools-subtle">{{ headerLede }}</p>
      </div>
      <div class="hero-actions">
        <button type="button" class="btn-ghost" :disabled="!filteredSchools.length" @click="handleExport">
          Export
        </button>
        <button v-if="!isAdminView" type="button" class="btn-play" @click="openAddModal">+ Add school</button>
      </div>
    </div>

    <!-- A failed refresh must never look like "up to date" — a silently
         swallowed fetch error was exactly how a stale claim/count could sit
         on screen indefinitely with no visible sign anything was wrong. -->
    <div v-if="fetchError" class="schools-card fetch-error-banner">
      <span>Couldn't refresh this list — showing the last data loaded. {{ fetchError }}</span>
      <button type="button" class="btn-ghost" :disabled="isRefreshing" @click="refresh">Retry</button>
    </div>

    <div class="stats-updated-row">
      <UpdatedStamp />
    </div>

    <div class="kpi-grid">
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ schools.length }}</span>
        <span class="kpi-label">Schools</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ totalStudents.toLocaleString() }}</span>
        <span class="kpi-label">Students</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ totalTeachers }}</span>
        <span class="kpi-label">Teachers</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ totalClasses }}</span>
        <span class="kpi-label">Classes</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ hoursThisWeek }}h</span>
        <span class="kpi-label">Practice hours</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">—</span>
        <span class="kpi-label">Active in 7d</span>
      </div>
    </div>

    <div class="schools-card list-card">
      <div class="list-header">
        <h3 class="arsenal list-title">{{ schools.length }} school{{ schools.length === 1 ? '' : 's' }}</h3>
        <div class="list-controls">
          <input
            v-model="searchQuery"
            class="list-search"
            type="text"
            placeholder="Search…"
            aria-label="Search schools"
          />
          <select v-model="sortKey" class="list-sort" aria-label="Sort schools">
            <option value="hours">Sort by hours</option>
            <option value="students">Sort by students</option>
            <option value="name">Sort by name</option>
          </select>
        </div>
      </div>

      <table class="ssi-table">
        <thead>
          <tr>
            <th>School</th>
            <th>City</th>
            <th>Students</th>
            <th>Teachers</th>
            <th>Classes</th>
            <th>Hours</th>
            <th>Joined</th>
            <th>Status</th>
            <th>Links</th>
            <th aria-label="actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="school in filteredSchools"
            :key="school.id"
            class="school-row"
            @click="handleSchoolClick(school)"
          >
            <td>
              <div class="school-cell">
                <div class="school-mark">{{ schoolInitial(school.school_name) }}</div>
                <div class="school-name">{{ school.school_name }}</div>
              </div>
            </td>
            <td class="schools-subtle">—</td>
            <td>{{ school.student_count }}</td>
            <td>{{ school.teacher_count }}</td>
            <td>{{ school.class_count }}</td>
            <td>{{ Math.round(school.total_practice_hours) }}h</td>
            <td class="schools-subtle">{{ formatJoined(school.created_at) }}</td>
            <td>
              <span v-if="!school.has_admin" class="awaiting-pill">Awaiting admin</span>
              <span v-else class="health-cell">
                <HealthDot :health="school.health" />
                <span class="schools-subtle">{{ school.health.replace('-', ' ') }}</span>
              </span>
            </td>
            <td class="links-cell" @click.stop>
              <button
                type="button"
                class="link-chip"
                :class="{ 'is-copied': copiedCode === school.admin_join_code }"
                :disabled="!school.admin_join_code"
                :title="school.admin_join_code ? 'Copy admin link' : 'No admin code yet'"
                @click="copyCode(school.admin_join_code)"
              >
                {{ copiedCode === school.admin_join_code ? 'Copied!' : 'Admin' }}
              </button>
              <button
                type="button"
                class="link-chip"
                :class="{ 'is-copied': copiedCode === school.teacher_join_code }"
                :disabled="!school.teacher_join_code"
                :title="school.teacher_join_code ? 'Copy teacher link' : 'No teacher code yet'"
                @click="copyCode(school.teacher_join_code)"
              >
                {{ copiedCode === school.teacher_join_code ? 'Copied!' : 'Teacher' }}
              </button>
            </td>
            <td class="row-action">
              <span class="row-link">Open →</span>
            </td>
          </tr>
          <tr v-if="!filteredSchools.length && searchQuery">
            <td colspan="10" class="empty-row schools-subtle">No schools match "{{ searchQuery }}".</td>
          </tr>
          <tr v-else-if="!filteredSchools.length && schoolsLoading">
            <td colspan="10" class="empty-row schools-subtle">Loading schools…</td>
          </tr>
          <tr v-else-if="!filteredSchools.length">
            <td colspan="10" class="empty-row schools-subtle">No schools to show.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showAddModal" class="invite-modal-backdrop" @click.self="closeAddModal">
      <div class="schools-card invite-modal">
        <h3 class="arsenal invite-modal-title">Add school</h3>
        <p class="schools-subtle invite-modal-lede">
          Creates the school in your programme immediately, with an admin link and a teacher link ready to share.
        </p>
        <input
          v-if="!createdSchool"
          v-model="newSchoolName"
          type="text"
          class="invite-modal-input"
          placeholder="School name"
          :disabled="isCreatingSchool"
          @keyup.enter="handleCreateSchool"
        />
        <p v-if="createError" class="invite-modal-error">{{ createError }}</p>
        <template v-if="createdSchool">
          <InviteLinkField label="Admin" :url="redeemUrl(createdSchool.admin_join_code)" />
          <InviteLinkField label="Teacher" :url="redeemUrl(createdSchool.teacher_join_code)" />
          <p class="schools-subtle invite-modal-hint">
            Send the school admin the Admin link — clicking it takes them straight to sign-in. These links also
            live on the school's row any time you need them again.
          </p>
        </template>
        <div class="invite-modal-actions">
          <button type="button" class="btn-ghost" @click="closeAddModal">
            {{ createdSchool ? 'Done' : 'Cancel' }}
          </button>
          <button
            v-if="!createdSchool"
            type="button"
            class="btn-play"
            :disabled="isCreatingSchool || !newSchoolName.trim()"
            @click="handleCreateSchool"
          >
            {{ isCreatingSchool ? 'Creating…' : 'Create school' }}
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.schools-list-screen {
  padding: 24px 32px 32px;
  max-width: 1280px;
  margin: 0 auto;
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

.hero-text {
  max-width: 620px;
}

.hero-eyebrow {
  font-size: 11px;
  color: var(--schools-red);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 6px;
}

.hero-title {
  font-size: 36px;
  line-height: 1.05;
  margin: 0;
}

.hero-lede {
  font-size: 14px;
  margin-top: 6px;
  line-height: 1.5;
  max-width: 560px;
}

.hero-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.stats-updated-row {
  display: flex;
  justify-content: flex-end;
  min-height: 16px;
  margin-bottom: 6px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px;
}

.kpi-value {
  font-size: 26px;
  line-height: 1;
}

.kpi-label {
  font-size: 11.5px;
  color: var(--schools-fg-2);
}

.list-card {
  overflow: hidden;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--schools-border);
  gap: 12px;
  flex-wrap: wrap;
}

.list-title {
  font-size: 18px;
  margin: 0;
}

.list-controls {
  display: flex;
  gap: 8px;
}

.list-search {
  padding: 5px 10px;
  font-size: 12px;
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fafaf6;
  font-family: var(--font-body);
  width: 200px;
  color: var(--schools-fg);
}

.list-search:focus {
  outline: none;
  border-color: var(--schools-red);
  background: #fff;
}

.list-sort {
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fff;
  font-family: var(--font-body);
  color: var(--schools-fg);
  cursor: pointer;
}

.school-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.school-mark {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: var(--schools-red);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 14px;
  flex: none;
}

.school-name {
  font-weight: 600;
}

.health-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.awaiting-pill {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--schools-red-deep, var(--schools-red));
  background: rgba(194, 58, 58, 0.1);
  border-radius: 999px;
  padding: 3px 9px;
  white-space: nowrap;
}

.links-cell {
  display: flex;
  gap: 6px;
  cursor: default;
}

.link-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--schools-border);
  background: #fafaf6;
  color: var(--schools-fg-2);
  cursor: pointer;
  white-space: nowrap;
}

.link-chip:hover:not(:disabled) {
  border-color: var(--schools-red);
  color: var(--schools-red);
}

.link-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.link-chip.is-copied {
  color: #1a7f37;
  border-color: #1a7f37;
}

.row-action {
  text-align: right;
}

.row-link {
  font-size: 12px;
  font-weight: 600;
  color: var(--schools-red);
  font-family: var(--font-body);
}

.school-row {
  cursor: pointer;
}

.school-row:hover {
  background: #fafaf6;
}

.school-row:hover .row-link {
  color: var(--schools-red-deep);
}

.btn-icon {
  font-size: 15px;
  line-height: 1;
  padding: 6px 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-icon.is-spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.empty-row {
  text-align: center;
  padding: 32px 12px;
  font-size: 13px;
}

@media (max-width: 1200px) {
  .kpi-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.invite-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 18, 16, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}

.invite-modal {
  width: 100%;
  max-width: 420px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.invite-modal-title {
  font-size: 20px;
  margin: 0;
}

.invite-modal-lede {
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}

.invite-modal-input {
  padding: 8px 10px;
  font-size: 13px;
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fafaf6;
  font-family: var(--font-body);
  color: var(--schools-fg);
  width: 100%;
}

.invite-modal-input:focus {
  outline: none;
  border-color: var(--schools-red);
  background: #fff;
}

.invite-modal-error {
  font-size: 12px;
  color: var(--schools-red);
  margin: 0;
}

.fetch-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  font-size: 13px;
  color: var(--schools-red);
  border: 1px solid rgba(var(--tone-red, 194, 58, 58), 0.28);
  background: rgba(var(--tone-red, 194, 58, 58), 0.06);
}

.invite-modal-hint {
  font-size: 12px;
  margin: -4px 0 0;
}

.invite-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

@media (max-width: 960px) {
  .schools-list-screen {
    padding: 20px 16px 28px;
  }

  .hero {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .list-header {
    flex-direction: column;
    align-items: stretch;
  }

  .list-controls {
    flex-wrap: wrap;
  }

  .list-search {
    flex: 1;
    min-width: 160px;
  }
}
</style>
