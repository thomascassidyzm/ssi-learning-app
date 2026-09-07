<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRouter } from 'vue-router'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import HealthDot from '@/components/schools/shared/HealthDot.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useStudentsData } from '@/composables/schools/useStudentsData'
import { useSchoolsNav } from '@/composables/schools/useSchoolsNav'
import { deriveBelt, type Belt } from '@/composables/schools/belts'
import { useI18n } from '@/composables/useI18n'

type Health = 'excellent' | 'good' | 'needs-attention' | 'inactive'

const router = useRouter()
const { t } = useI18n()
const isAdminView = inject<boolean>('isAdminView', false)
const { schoolsLink } = useSchoolsNav()
const { currentUser: selectedUser } = useSchoolContext()
const { students: studentsData, isLoading: studentsLoading, error: studentsError, fetchStudents } = useStudentsData()

const searchQuery = ref('')
const classFilter = ref<string>('all')
const beltFilter = ref<string>('all')
const healthFilter = ref<string>('all')

function getInitials(name: string): string {
  return name.split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

function deriveHealth(seeds: number, lastActiveAt: string | null, classAvg: number): Health {
  if (!lastActiveAt) return 'inactive'
  const diffDays = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 86400000)
  if (diffDays > 14) return 'needs-attention'
  if (classAvg > 0 && seeds < classAvg * 0.5) return 'needs-attention'
  if (classAvg > 0 && seeds >= classAvg * 1.25 && diffDays <= 2) return 'excellent'
  return 'good'
}

function formatLastActive(dateStr: string | null): string {
  if (!dateStr) return t('schools.students.lastActiveNever', 'Never')
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return t('schools.students.lastActiveNow', 'now')
  if (diffHours < 24) return t('schools.students.lastActiveHoursAgo', '{n}h ago').replace('{n}', String(diffHours))
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return t('schools.students.lastActiveYesterday', 'Yesterday')
  if (diffDays < 7) return t('schools.students.lastActiveDaysAgo', '{n}d ago').replace('{n}', String(diffDays))
  if (diffDays < 30) return t('schools.students.lastActiveWeeksAgo', '{n}w ago').replace('{n}', String(Math.floor(diffDays / 7)))
  return t('schools.students.lastActiveMonthsAgo', '{n}mo ago').replace('{n}', String(Math.floor(diffDays / 30)))
}

const classAvgByClass = computed(() => {
  const map = new Map<string, { sum: number; count: number }>()
  for (const s of studentsData.value) {
    const cur = map.get(s.class_id) || { sum: 0, count: 0 }
    cur.sum += s.seeds_completed
    cur.count += 1
    map.set(s.class_id, cur)
  }
  const result = new Map<string, number>()
  for (const [k, v] of map) result.set(k, v.count > 0 ? v.sum / v.count : 0)
  return result
})

const enrichedStudents = computed(() => {
  return studentsData.value.map(s => {
    const belt = deriveBelt(s.seeds_completed)
    const avg = classAvgByClass.value.get(s.class_id) || 0
    return {
      user_id: s.user_id,
      learner_id: s.learner_id,
      name: s.display_name,
      initials: getInitials(s.display_name),
      class_id: s.class_id,
      class_name: s.class_name,
      course_code: s.course_code,
      belt,
      seeds_completed: s.seeds_completed,
      legos_mastered: s.legos_mastered,
      hours7d: Math.round((s.total_practice_minutes / 60) * 10) / 10,
      legoTotal: 60,
      health: deriveHealth(s.seeds_completed, s.last_active_at, avg),
      last_active_display: formatLastActive(s.last_active_at),
      last_active_at: s.last_active_at,
    }
  })
})

const classOptions = computed(() => {
  const map = new Map<string, string>()
  for (const s of enrichedStudents.value) map.set(s.class_id, s.class_name)
  return Array.from(map, ([value, label]) => ({ value, label }))
})

const filtered = computed(() => {
  return enrichedStudents.value.filter(s => {
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      if (!s.name.toLowerCase().includes(q)) return false
    }
    if (classFilter.value !== 'all' && s.class_id !== classFilter.value) return false
    if (beltFilter.value !== 'all' && s.belt !== beltFilter.value) return false
    if (healthFilter.value !== 'all' && s.health !== healthFilter.value) return false
    return true
  })
})

const totalCount = computed(() => filtered.value.length)
const activeThisWeek = computed(() => {
  const wk = Date.now() - 7 * 86400000
  return filtered.value.filter(s => s.last_active_at && new Date(s.last_active_at).getTime() >= wk).length
})
const needsAttention = computed(() =>
  filtered.value.filter(s => s.health === 'needs-attention').length,
)

const headlineSubtitle = computed(() => {
  const studentWord = totalCount.value === 1
    ? t('schools.students.studentSingular', 'student')
    : t('schools.students.studentsPlural', 'students')
  return t('schools.students.headlineSubtitle', '{count} {studentWord} · {active} active this week · {needs} need attention')
    .replace('{count}', String(totalCount.value))
    .replace('{studentWord}', studentWord)
    .replace('{active}', String(activeThisWeek.value))
    .replace('{needs}', String(needsAttention.value))
})

function healthLabel(health: Health): string {
  switch (health) {
    case 'excellent': return t('schools.students.healthExcellent', 'excellent')
    case 'good': return t('schools.students.healthGood', 'good')
    case 'needs-attention': return t('schools.students.healthNeedsAttention', 'needs attention')
    case 'inactive': return t('schools.students.healthInactive', 'inactive')
  }
}

function viewStudent(s: { learner_id: string; name?: string }) {
  // Open the teacher Rate-compare insight pre-scoped to THIS learner, IN-SHELL
  // (the embedded /schools/analytics route — SchoolsTopBar stays around it).
  // The learner identity rides along as query params so the insight opens in
  // learner view for this student. (Live per-learner rate data is still the
  // deferred wiring — the view renders a seeded preview until then.)
  router.push({
    path: schoolsLink('analytics'),
    query: { scope: 'learner', learner: s.learner_id, name: s.name },
  }).catch(() => {})
}

function exportCsv() {
  const header = ['Name', 'Class', 'Belt', 'Seeds', 'LEGOs', 'Hours/wk', 'Health', 'Last active']
  const rows = filtered.value.map(s => [
    s.name, s.class_name, s.belt, s.seeds_completed, s.legos_mastered, s.hours7d, s.health, s.last_active_display,
  ].join(','))
  const csv = [header.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `students-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// "+ Invite students" used to print "Open a class to share it" and stop —
// a button whose whole answer is the name of somewhere else, with no way
// there (production walk, 2026-08-31: a new teacher with no class read it as
// "you're doing this wrong" and had nowhere to go). Every class row on the
// classes page carries its own Copy-link button, and a teacher with no
// classes is told so there, so send them to the place that can actually
// finish the job.
function handleInvite() {
  router.push(schoolsLink('classes'))
}

onMounted(() => {
  if (selectedUser.value) fetchStudents()
})

watch(selectedUser, (newUser) => {
  if (newUser) fetchStudents()
})
</script>

<template>
  <main class="students">
    <div class="page-head">
      <div class="page-head-text">
        <h1 class="arsenal page-title">{{ t('schools.students.pageTitle', 'Students') }}</h1>
        <p class="page-subtitle schools-subtle">{{ headlineSubtitle }}</p>
      </div>
      <div class="page-head-actions">
        <!-- data-walk sits BEFORE v-if here on purpose: the walkthrough
             compiler scans the opening tag with a no-'>' regex, and the
             "> 0" inside this condition would hide the anchor from it. -->
        <!-- HANDBOOK Take your lists away as a spreadsheet
             section: seeing-progress
             roles: admin, school_admin, teacher
             place: students
             keywords: export, csv, spreadsheet, download, report
             What it's for. A CSV of whoever is currently on screen, for a report, a
             governors' meeting, or your own sums in a spreadsheet.
             Where it is. The **Students** page and the **Teachers** page, **Export
             CSV** along the top.
             How you do it.
             1. Filter or search the list down to whoever you want.
             2. Tap **Export CSV**.
             3. The file downloads with today's date in its name.
             4. Open it in whatever spreadsheet you use.
             Worth knowing. The export follows your filters, not the whole school — so
             a filtered list gives you a filtered file. Clear the filters first if you
             want everybody.
             checked: 4c2a8130.3f2fd968
        -->
        <button data-walk="students-export" v-if="enrichedStudents.length > 0" type="button" class="btn-ghost" @click="exportCsv">
          {{ t('schools.students.exportCsv', 'Export CSV') }}
        </button>
        <button v-if="!isAdminView" type="button" class="btn-play" @click="handleInvite">
          + {{ t('schools.students.inviteStudents', 'Invite students') }}
        </button>
      </div>
    </div>

    <div v-if="studentsError" class="fetch-error-banner">
      <span>{{ t('schools.students.refreshError', "Couldn't refresh this list — showing the last data loaded. {error}").replace('{error}', studentsError) }}</span>
      <button type="button" class="btn-ghost" @click="fetchStudents()">{{ t('schools.students.retryLabel', 'Retry') }}</button>
    </div>

    <div class="filters-bar schools-card">
      <input
        v-model="searchQuery"
        type="search"
        class="filters-search"
        :placeholder="t('schools.students.searchByNamePlaceholder', 'Search by name...')"
      />
      <label class="filter">
        <span class="filter-label">{{ t('schools.students.classFilterLabel', 'Class') }}</span>
        <select v-model="classFilter" class="filter-select">
          <option value="all">{{ t('schools.students.allClassesOption', 'All classes') }}</option>
          <option v-for="opt in classOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </label>
      <label class="filter">
        <span class="filter-label">{{ t('schools.students.beltFilterLabel', 'Belt') }}</span>
        <select v-model="beltFilter" class="filter-select">
          <option value="all">{{ t('schools.students.allOption', 'All') }}</option>
          <option value="white">{{ t('schools.students.beltWhite', 'White') }}</option>
          <option value="yellow">{{ t('schools.students.beltYellow', 'Yellow') }}</option>
          <option value="orange">{{ t('schools.students.beltOrange', 'Orange') }}</option>
          <option value="green">{{ t('schools.students.beltGreen', 'Green') }}</option>
          <option value="blue">{{ t('schools.students.beltBlue', 'Blue') }}</option>
          <option value="black">{{ t('schools.students.beltBlack', 'Black') }}</option>
        </select>
      </label>
      <label class="filter">
        <span class="filter-label">{{ t('schools.students.healthFilterLabel', 'Health') }}</span>
        <select v-model="healthFilter" class="filter-select">
          <option value="all">{{ t('schools.students.allOption', 'All') }}</option>
          <option value="excellent">{{ t('schools.students.healthExcellentOption', 'Excellent') }}</option>
          <option value="good">{{ t('schools.students.healthGoodOption', 'Good') }}</option>
          <option value="needs-attention">{{ t('schools.students.healthNeedsAttentionOption', 'Needs attention') }}</option>
          <option value="inactive">{{ t('schools.students.healthInactiveOption', 'Inactive') }}</option>
        </select>
      </label>
    </div>

    <div v-if="filtered.length > 0" class="schools-card table-card">
      <table class="ssi-table">
        <thead>
          <tr>
            <th>{{ t('schools.students.studentColumn', 'Student') }}</th>
            <th>{{ t('schools.students.classFilterLabel', 'Class') }}</th>
            <th>{{ t('schools.students.beltFilterLabel', 'Belt') }}</th>
            <th>{{ t('schools.students.legosColumn', 'LEGOs') }}</th>
            <th>{{ t('schools.students.hoursPerWeekColumn', 'Hours/wk') }}</th>
            <th>{{ t('schools.students.healthFilterLabel', 'Health') }}</th>
            <th>{{ t('schools.students.lastActiveColumn', 'Last active') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.learner_id">
            <td>
              <div class="student-cell">
                <div class="avatar">{{ s.initials }}</div>
                <div class="student-info">
                  <div class="student-name">{{ s.name }}</div>
                  <div class="student-sub schools-subtle">{{ t('schools.students.legosMasteredLabel', '{n} LEGOs mastered').replace('{n}', String(s.legos_mastered)) }}</div>
                </div>
              </div>
            </td>
            <td><span class="schools-subtle">{{ s.class_name }}</span></td>
            <td>
              <span class="belt-cell">
                <BeltDot :belt="s.belt" :size="14" />
                <span class="belt-name">{{ s.belt }}</span>
              </span>
            </td>
            <td>
              <div class="seeds-cell">
                <div class="seeds-bar">
                  <div
                    class="seeds-fill"
                    :style="{ width: `${Math.min(100, (s.legos_mastered / s.legoTotal) * 100)}%` }"
                  />
                </div>
                <span class="seeds-text">{{ s.legos_mastered }}/{{ s.legoTotal }}</span>
              </div>
            </td>
            <td>{{ s.hours7d }}h</td>
            <td>
              <span class="health-cell">
                <HealthDot :health="s.health" />
                <span class="health-label">{{ healthLabel(s.health) }}</span>
              </span>
            </td>
            <td><span class="schools-subtle">{{ s.last_active_display }}</span></td>
            <td class="cell-action">
              <!-- HANDBOOK Look up one student
                   section: seeing-progress
                   roles: admin, school_admin, teacher
                   place: students
                   keywords: student, search, filter, find, progress, belt
                   What it's for. Finding one learner among all of them and
                   opening what they have actually done. The list carries their
                   belt, their hours this week, and when they were last here, so
                   you can often answer the question without opening anything.
                   Where it is. The **Students** page, the search box and filters
                   above the list, then **View** on their row.
                   How you do it.
                   1. Open **Students**.
                   2. Type part of their name in the search box, or narrow the
                      list by class, belt or health.
                   3. Read their row for belt, hours and last active.
                   4. Tap **View** to open their own progress.
                   Worth knowing. Health is worked out from their last visit and
                   how they sit against their own class, so a learner marked as
                   needing attention is one who has gone quiet or fallen behind
                   the people beside them.
                   checked: 7abab547.47acab15
              -->
              <a href="#" class="cell-link" data-walk="student-view-link" @click.prevent="viewStudent(s)">{{ t('schools.students.viewLabel', 'View') }} &rarr;</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="enrichedStudents.length > 0" class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.students.noFilterMatchTitle', 'No students match those filters') }}</h3>
      <p class="empty-text schools-subtle">{{ t('schools.students.noFilterMatchHint', 'Try widening the class, belt or health filter.') }}</p>
      <button
        type="button"
        class="btn-ghost"
        @click="() => { searchQuery = ''; classFilter = 'all'; beltFilter = 'all'; healthFilter = 'all' }"
      >
        {{ t('schools.students.resetFiltersLabel', 'Reset filters') }}
      </button>
    </div>

    <div v-else-if="studentsLoading" class="empty-state schools-card schools-card-pad">
      <p class="schools-subtle">{{ t('schools.students.loadingStudents', 'Loading students…') }}</p>
    </div>

    <div v-else-if="studentsError" class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.students.loadStudentsError', "Couldn't load students") }}</h3>
      <p class="empty-text schools-subtle">{{ studentsError }}</p>
    </div>

    <div v-else class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.students.noStudentsYetTitle', 'No students yet') }}</h3>
      <p class="empty-text schools-subtle">
        {{ t('schools.students.noStudentsYetHint', "Once students join your classes via their invite link, they'll appear here.") }}
      </p>
    </div>
  </main>
</template>

<style scoped>
.students {
  padding: 20px 24px 32px;
  max-width: 1320px;
  margin: 0 auto;
}

.fetch-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--schools-red);
  border: 1px solid rgba(var(--tone-red, 194, 58, 58), 0.28);
  background: rgba(var(--tone-red, 194, 58, 58), 0.06);
  border-radius: 8px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.page-head-text { min-width: 280px; flex: 1; }

.page-title {
  font-size: 30px;
  line-height: 1.1;
}

.page-subtitle {
  font-size: 13px;
  margin-top: 2px;
}

.page-head-actions {
  display: flex;
  gap: 8px;
}


.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.filters-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.filters-search {
  flex: 1;
  min-width: 220px;
  padding: 7px 10px;
  font-size: 13px;
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fafaf6;
  font-family: var(--font-body);
  color: var(--schools-fg);
}

.filters-search:focus {
  outline: none;
  border-color: var(--schools-red);
  background: #fff;
}

.filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--schools-fg-2);
}

.filter-label { font-size: 12px; }

.filter-select {
  padding: 5px 8px;
  font-size: 12.5px;
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fff;
  font-family: var(--font-body);
  color: var(--schools-fg);
  cursor: pointer;
}

.filter-select:focus {
  outline: none;
  border-color: var(--schools-red);
}

.table-card {
  overflow: hidden;
}

.student-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #eee;
  color: #555;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.student-info { min-width: 0; line-height: 1.3; }

.student-name {
  font-weight: 600;
  font-size: 13.5px;
}

.student-sub {
  font-size: 11px;
  margin-top: 2px;
}

.belt-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.belt-name { text-transform: capitalize; }

.seeds-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.seeds-bar {
  width: 80px;
  height: 5px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 2.5px;
  overflow: hidden;
}

.seeds-fill {
  height: 100%;
  background: var(--schools-red);
}

.seeds-text {
  font-size: 12px;
  color: var(--schools-fg-2);
  min-width: 42px;
}

.health-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--schools-fg-2);
}

.health-label {
  text-transform: capitalize;
}

.cell-action {
  text-align: right;
}

.cell-link {
  font-size: 12px;
  color: var(--schools-red);
  text-decoration: none;
  font-weight: 600;
  white-space: nowrap;
}

.cell-link:hover { color: var(--schools-red-deep); }

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

@media (max-width: 960px) {
  .students { padding: 16px; }
  .filters-bar { padding: 10px; }
  .table-card { overflow-x: auto; }
  .ssi-table { min-width: 820px; }
}
</style>
