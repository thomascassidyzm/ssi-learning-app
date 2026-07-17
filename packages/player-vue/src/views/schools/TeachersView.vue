<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useTeachersData } from '@/composables/schools/useTeachersData'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'

type TeacherStatus = 'active' | 'invited'

const isAdminView = inject<boolean>('isAdminView', false)
const { currentUser: selectedUser, isSchoolAdmin } = useSchoolContext()
const { teachers: teachersData, isLoading: teachersLoading, error: teachersError, fetchTeachers, removeTeacher } = useTeachersData()
const { currentSchool, fetchSchools } = useSchoolData()

// Staff-management controls (invite, bulk import, remove) are admin-only —
// a plain teacher could see and use them even though the endpoints they hit
// are admin-gated (finding, 2026-07-16 teacher-loop audit). Hidden, not
// disabled, matching how isAdminView already hides them for ssi_admin's
// read-only browse view.
const canManageStaff = computed(() => isSchoolAdmin.value && !isAdminView)
const removeError = ref('')

const searchQuery = ref('')

const teacherJoinCode = computed(() => currentSchool.value?.teacher_join_code || 'N/A')
// Same /redeem/:code door as every other invite in the app (group leader,
// school admin, class join — see ClassDetail.vue's classJoinLink).
const teacherJoinLink = computed(() => {
  if (teacherJoinCode.value === 'N/A') return ''
  return `${window.location.origin}/redeem/${teacherJoinCode.value}`
})

function getInitials(name: string): string {
  return name.split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

const teachers = computed(() => {
  return teachersData.value.map(t => ({
    id: t.learner_id,
    user_id: t.user_id,
    name: t.display_name,
    initials: getInitials(t.display_name),
    classes: t.class_count,
    students: t.student_count,
    hours7d: t.total_practice_hours,
    role: 'Teacher' as 'Teacher' | 'Admin',
    status: 'active' as TeacherStatus,
    joined_at: t.joined_at,
  }))
})

const filtered = computed(() => {
  if (!searchQuery.value.trim()) return teachers.value
  const q = searchQuery.value.toLowerCase()
  return teachers.value.filter(t => t.name.toLowerCase().includes(q))
})

const activeCount = computed(() => teachers.value.filter(t => t.status === 'active').length)
const pendingCount = computed(() => teachers.value.filter(t => t.status === 'invited').length)

const subtitle = computed(() => {
  const count = teachers.value.length
  const parts = [
    `${count} ${count === 1 ? 'teacher' : 'staff'}`,
    `${activeCount.value} active`,
  ]
  if (pendingCount.value > 0) {
    parts.push(`${pendingCount.value} pending invite${pendingCount.value === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
})

const codeCopyState = ref(false)
const showCode = ref(false)
async function copyJoinCode() {
  if (teacherJoinCode.value === 'N/A') return
  try {
    await navigator.clipboard.writeText(teacherJoinCode.value)
    codeCopyState.value = true
    setTimeout(() => { codeCopyState.value = false }, 2000)
  } catch {
    /* ignore */
  }
}

const showImportHint = ref(false)
function handleBulkImport() {
  showImportHint.value = true
  setTimeout(() => { showImportHint.value = false }, 5000)
}

const showInviteHint = ref(false)
function handleInvite() {
  showInviteHint.value = true
  setTimeout(() => { showInviteHint.value = false }, 5000)
}

async function handleRemoveTeacher(userId: string, name: string) {
  if (!confirm(`Remove ${name} from this school?`)) return
  removeError.value = ''
  const result = await removeTeacher(userId)
  if (result.ok) {
    fetchTeachers()
  } else {
    removeError.value = `Could not remove ${name}: ${result.error}`
    console.error(`[TeachersView] remove-staff failed for ${name}:`, result.error)
  }
}

function exportCsv() {
  const header = ['Name', 'Classes', 'Students', 'Hours/wk', 'Role', 'Status', 'Joined']
  const rows = filtered.value.map(t => [
    t.name, t.classes, t.students, t.hours7d, t.role, t.status, t.joined_at,
  ].join(','))
  const csv = [header.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `teachers-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  if (selectedUser.value) {
    fetchTeachers()
    fetchSchools()
  }
})

watch(selectedUser, (newUser) => {
  if (newUser) {
    fetchTeachers()
    fetchSchools()
  }
})
</script>

<template>
  <main class="teachers">
    <div class="page-head">
      <div class="page-head-text">
        <h1 class="arsenal page-title">Teachers</h1>
        <p class="page-subtitle schools-subtle">{{ subtitle }}</p>
      </div>
      <div class="page-head-actions">
        <button v-if="teachers.length > 0" type="button" class="btn-ghost" @click="exportCsv">
          Export CSV
        </button>
        <button v-if="canManageStaff" type="button" class="btn-ghost" @click="handleBulkImport">
          Bulk import CSV
        </button>
        <button v-if="canManageStaff" type="button" class="btn-play" @click="handleInvite">
          + Invite teacher
        </button>
      </div>
    </div>

    <Transition name="fade">
      <div v-if="showImportHint" class="invite-hint schools-card schools-card-pad">
        Bulk CSV import is coming soon. For now, share the teacher invite link below — teachers click it, sign in once, and land in your school.
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="showInviteHint" class="invite-hint schools-card schools-card-pad">
        Copy the teacher invite link below and share it however you reach your staff — Teams, WhatsApp, in person. Clicking it signs them straight in.
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="removeError" class="invite-hint remove-error schools-card schools-card-pad" role="alert">
        {{ removeError }}
      </div>
    </Transition>

    <div v-if="teachers.length > 0" class="schools-card table-card">
      <table class="ssi-table">
        <thead>
          <tr>
            <th>Teacher</th>
            <th>Role</th>
            <th>Classes</th>
            <th>Students</th>
            <th>Hours/wk</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in filtered" :key="t.user_id">
            <td>
              <div class="teacher-cell">
                <div class="avatar">{{ t.initials }}</div>
                <div class="teacher-info">
                  <div class="teacher-name">{{ t.name }}</div>
                  <div class="teacher-sub schools-subtle">Joined {{ t.joined_at ? new Date(t.joined_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'recently' }}</div>
                </div>
              </div>
            </td>
            <td>
              <span class="role-pill" :class="{ admin: t.role === 'Admin' }">{{ t.role }}</span>
            </td>
            <td>{{ t.classes }}</td>
            <td>{{ t.students }}</td>
            <td>{{ t.hours7d }}h</td>
            <td>
              <span class="status-cell" :class="t.status">
                <span class="status-dot" />
                {{ t.status === 'active' ? 'Active' : 'Pending invite' }}
              </span>
            </td>
            <td class="cell-action">
              <button
                v-if="canManageStaff"
                type="button"
                class="btn-ghost btn-small remove-btn"
                @click="handleRemoveTeacher(t.user_id, t.name)"
              >
                Remove
              </button>
            </td>
          </tr>
          <tr v-if="filtered.length === 0">
            <td colspan="7" class="empty-row">
              No teachers match "{{ searchQuery }}".
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="teachersLoading" class="empty-state schools-card schools-card-pad">
      <p class="schools-subtle">Loading teachers…</p>
    </div>

    <div v-else-if="teachersError" class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">Couldn't load teachers</h3>
      <p class="empty-text schools-subtle">{{ teachersError }}</p>
    </div>

    <div v-else class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">No teachers yet</h3>
      <p class="empty-text schools-subtle">
        Share the invite link below to add teachers to your school.
      </p>
    </div>

    <!-- Tip cards + join link panel -->
    <div class="tip-grid">
      <div class="schools-card schools-card-pad tip-card">
        <div class="schools-kicker">Tip &mdash; invite links</div>
        <p class="tip-body">
          Anyone who clicks your teacher invite link appears here as a teacher once they sign in — so share it only with your staff. You can remove a teacher from their row at any time.
        </p>
      </div>
      <div class="schools-card schools-card-pad tip-card">
        <div class="schools-kicker">Tip &mdash; roles</div>
        <p class="tip-body">
          Admins manage staff, classes and settings. Teachers see only their own classes. Switch role any time from a teacher's row.
        </p>
      </div>
      <div v-if="canManageStaff" class="schools-card schools-card-pad join-card">
        <div class="schools-kicker join-kicker">Invite teachers</div>
        <p class="join-body">
          Share this link however you reach your staff — Teams, WhatsApp, in person. Clicking it signs them straight in.
        </p>
        <InviteLinkField :url="teacherJoinLink" />

        <button
          v-if="!showCode"
          type="button"
          class="btn-text join-show-code"
          @click="showCode = true"
        >
          Show code instead
        </button>
        <template v-else>
          <div class="join-code">{{ teacherJoinCode }}</div>
          <p class="join-body join-body-small">
            For writing on a whiteboard — teachers enter it at
            <strong>saysomethingin.com/redeem</strong>.
          </p>
          <button
            type="button"
            class="btn-ghost btn-small join-copy"
            :class="{ copied: codeCopyState }"
            :disabled="teacherJoinCode === 'N/A'"
            @click="copyJoinCode"
          >
            {{ codeCopyState ? 'Copied' : 'Copy code' }}
          </button>
        </template>
      </div>
    </div>
  </main>
</template>

<style scoped>
.teachers {
  padding: 22px 28px 32px;
  max-width: 1320px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.page-head-text { min-width: 280px; flex: 1; }

.page-title {
  font-size: 32px;
  line-height: 1.05;
}

.page-subtitle {
  font-size: 13px;
  margin-top: 4px;
}

.page-head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.invite-hint {
  margin-bottom: 12px;
  background: #fdf6df;
  border-color: #f0d97a;
  color: #5a3e10;
  font-size: 13px;
}

.remove-error {
  background: #fdeceb;
  border-color: var(--schools-red, #db1e17);
  color: var(--schools-red-deep, #a3130d);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.table-card { overflow: hidden; }

.teacher-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--schools-role-teacher);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.teacher-info { line-height: 1.3; min-width: 0; }
.teacher-name {
  font-weight: 600;
  font-size: 13.5px;
}
.teacher-sub {
  font-size: 11.5px;
  margin-top: 2px;
}

.role-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
  background: #f0f4ff;
  color: #1c3666;
}

.role-pill.admin {
  background: #fff5e5;
  color: #7a5418;
}

.status-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.status-cell .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.status-cell.active { color: var(--schools-success); }
.status-cell.invited { color: var(--schools-health-needs-attention); }

.cell-action {
  text-align: right;
}

.remove-btn:hover {
  color: var(--schools-red-deep);
  border-color: var(--schools-red-deep);
}

.empty-row {
  text-align: center;
  padding: 32px 16px;
  color: var(--schools-fg-2);
}

.empty-state {
  text-align: center;
  padding: 56px 32px;
  max-width: 520px;
  margin: 24px auto;
}

.empty-title {
  font-size: 22px;
  margin-bottom: 8px;
}

.empty-text {
  font-size: 14px;
  margin-bottom: 18px;
  line-height: 1.5;
}

.tip-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 14px;
}

.tip-card,
.join-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tip-body {
  font-size: 13px;
  color: var(--schools-fg-2);
  line-height: 1.5;
}

.join-card {
  background: #fdf6df;
  border-color: #f0d97a;
}

.join-kicker { color: #7a5418; }

.join-code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 22px;
  letter-spacing: 0.1em;
  color: var(--schools-fg);
  margin-top: 4px;
}

.join-body {
  font-size: 12px;
  color: #5a3e10;
  margin-top: 4px;
  line-height: 1.5;
}

.join-copy {
  align-self: flex-start;
  margin-top: 8px;
}

.join-copy.copied {
  background: var(--schools-success);
  border-color: var(--schools-success);
  color: #fff;
}

.join-copy:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.join-show-code {
  align-self: flex-start;
  margin-top: 8px;
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: #7a5418;
  text-decoration: underline;
  cursor: pointer;
}

.join-body-small {
  margin-top: 4px;
}

@media (max-width: 1100px) {
  .tip-grid { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 768px) {
  .teachers { padding: 18px 16px 28px; }
  .tip-grid { grid-template-columns: 1fr; }
  .table-card { overflow-x: auto; }
  .ssi-table { min-width: 760px; }
}
</style>
