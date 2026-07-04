<script setup lang="ts">
import { ref, computed, onMounted, watch, reactive, inject } from 'vue'
import { useRouter } from 'vue-router'
import CreateClassModal from '@/components/schools/CreateClassModal.vue'
import ClassCreatedModal from '@/components/schools/ClassCreatedModal.vue'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import Sparkline from '@/components/schools/shared/Sparkline.vue'
import HealthDot from '@/components/schools/shared/HealthDot.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData, type ClassReport } from '@/composables/schools/useClassesData'
import { getLanguageName } from '@/composables/useI18n'
import { deriveBelt, type Belt } from '@/composables/schools/belts'

type Health = 'excellent' | 'good' | 'needs-attention' | 'inactive'
type SortKey = 'name' | 'students' | 'hours' | 'journey'

const router = useRouter()

const isAdminView = inject<boolean>('isAdminView', false)
const { currentUser: selectedUser, isTeacher, isSchoolAdmin } = useSchoolContext()
const { classes: classesData, fetchClasses, createClass, getClassReport } = useClassesData()

const isCreateModalOpen = ref(false)
const createdClass = ref<any>(null)
const isCreatedModalOpen = ref(false)
const createClassError = ref<string | null>(null)
const isCreatingClass = ref(false)

// School platform-trial state — on a free TRIAL a school can only run classes in
// the ONE language it signed up for (schools.trial_course_code). Subscribing
// (platform_status === 'active') unlocks the full catalogue. Fails open: if we
// can't read it, we don't lock anyone out.
const supabase = inject('supabase', ref(null)) as any
const schoolPlatformStatus = ref<string | null>(null)
const schoolTrialCourse = ref<string | null>(null)

async function loadSchoolTrial(): Promise<void> {
  if (!supabase.value) return
  try {
    const { data: { session } } = await supabase.value.auth.getSession()
    const token = session?.access_token
    if (!token) return
    const res = await fetch('/api/school/subscription', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const data = await res.json()
    schoolPlatformStatus.value = data?.school?.platform_status ?? null
    schoolTrialCourse.value = data?.school?.trial_course_code ?? null
  } catch {
    /* non-fatal — no lock applied */
  }
}

// null = use the modal's default catalogue (subscribed, or unknown). Otherwise
// the single trial language the school is entitled to.
const schoolAvailableCourses = computed(() => {
  if (schoolPlatformStatus.value === 'active') return null
  if (!schoolTrialCourse.value) return null
  return [{ code: schoolTrialCourse.value, name: courseShortName(schoolTrialCourse.value), flag: '' }]
})

const courseFilter = ref<string>('all')
const sortKey = ref<SortKey>('name')
const healthFilter = ref<'all' | Health>('all')

const classReports = reactive(new Map<string, ClassReport>())

// Real 7-day practice seconds per class, from /api/school/class-practice-7d
// (player_events rollup, scoped server-side). Empty until loaded → hoursWk = 0.
const practice7dSeconds = ref<Record<string, number>>({})

async function loadPractice7d() {
  if (!supabase.value) return
  const classIds = classesData.value.map(c => c.id)
  if (classIds.length === 0) { practice7dSeconds.value = {}; return }
  try {
    const { data: { session } } = await supabase.value.auth.getSession()
    const token = session?.access_token
    if (!token) return
    const res = await fetch(`/api/school/class-practice-7d?class_ids=${classIds.join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = await res.json()
    practice7dSeconds.value = (data?.practiceByClass as Record<string, number>) || {}
  } catch {
    /* non-fatal — hoursWk falls back to 0 */
  }
}

async function fetchReportsForClasses() {
  for (const cls of classesData.value) {
    try {
      const report = await getClassReport(cls.id)
      if (report) classReports.set(cls.id, report)
    } catch {
      // benchmark optional
    }
  }
}


function deriveHealth(report: ClassReport | undefined, studentCount: number): Health {
  if (studentCount === 0) return 'inactive'
  if (!report) return 'good'
  const activeDays = report.class.active_days_last_7
  if (activeDays >= 5) return 'excellent'
  if (activeDays >= 2) return 'good'
  return 'needs-attention'
}

function courseShortName(code: string): string {
  const match = code?.match(/^([a-z_]+?)_for_/)
  return match ? getLanguageName(match[1]) : code
}

const enrichedClasses = computed(() => {
  return classesData.value.map(c => {
    const report = classReports.get(c.id)
    // Real 7-day practice hours for the class, from /api/school/class-practice-7d
    // (player_events / learner_speaking_opportunities rollup, scoped server-side).
    // Falls back to 0 until the async load resolves.
    const hoursWk = Math.round(((practice7dSeconds.value[c.id] ?? 0) / 3600) * 10) / 10
    return {
      id: c.id,
      class_name: c.class_name,
      course_code: c.course_code,
      course_label: courseShortName(c.course_code),
      teacher_user_id: c.teacher_user_id,
      student_count: c.student_count,
      join_code: c.student_join_code,
      class_belt: deriveBelt(c.avg_seeds_completed),
      current_seed: c.current_seed,
      avg_seeds_completed: c.avg_seeds_completed,
      hoursWk,
      sessions: report?.class.total_sessions ?? 0,
      active_days: report?.class.active_days_last_7 ?? 0,
      activity: c.activity_last_7 ?? [0, 0, 0, 0, 0, 0, 0],
      health: deriveHealth(report, c.student_count),
    }
  })
})

const courses = computed(() => {
  const set = new Set(enrichedClasses.value.map(c => c.course_label))
  return Array.from(set).sort()
})

const filtered = computed(() => {
  let rows = enrichedClasses.value.slice()
  if (courseFilter.value !== 'all') {
    rows = rows.filter(r => r.course_label === courseFilter.value)
  }
  if (healthFilter.value !== 'all') {
    rows = rows.filter(r => r.health === healthFilter.value)
  }
  rows.sort((a, b) => {
    if (sortKey.value === 'name') return a.class_name.localeCompare(b.class_name)
    if (sortKey.value === 'students') return b.student_count - a.student_count
    if (sortKey.value === 'hours') return b.hoursWk - a.hoursWk
    if (sortKey.value === 'journey') return b.avg_seeds_completed - a.avg_seeds_completed
    return 0
  })
  return rows
})

const totalStudents = computed(() =>
  filtered.value.reduce((sum, c) => sum + c.student_count, 0),
)

const totalHours = computed(() => {
  const h = filtered.value.reduce((sum, c) => sum + c.hoursWk, 0)
  return Math.round(h * 10) / 10
})

const healthCounts = computed(() => {
  const acc: Record<string, number> = {}
  for (const c of filtered.value) acc[c.health] = (acc[c.health] || 0) + 1
  return acc
})

const headlineTitle = computed(() => {
  if (isSchoolAdmin.value) return 'Classes'
  if (isTeacher.value) return 'My Classes'
  return 'Classes'
})

const headlineSubtitle = computed(() => {
  const schoolBit = selectedUser.value?.school_name
    ? ` across ${selectedUser.value.school_name}`
    : ''
  return `${enrichedClasses.value.length} ${enrichedClasses.value.length === 1 ? 'class' : 'classes'}${schoolBit} · ${totalStudents.value} students · ${totalHours.value}h this week`
})

onMounted(async () => {
  if (selectedUser.value) {
    await fetchClasses()
    fetchReportsForClasses()
    loadPractice7d()
  }
  if (isSchoolAdmin.value && !isAdminView) loadSchoolTrial()
  // Deep-linked from the dashboard's "Create class" CTA → open the form straight away.
  if (!isAdminView && router.currentRoute.value.query.create) openCreateModal()
})

watch(selectedUser, async (newUser) => {
  if (newUser) {
    classReports.clear()
    practice7dSeconds.value = {}
    await fetchClasses()
    fetchReportsForClasses()
    loadPractice7d()
  }
})

watch(classesData, () => {
  fetchReportsForClasses()
  loadPractice7d()
})

function openCreateModal() {
  isCreateModalOpen.value = true
}

function closeCreateModal() {
  isCreateModalOpen.value = false
}

async function handleCreateClass(params: { class_name: string; course_code: string }) {
  if (isCreatingClass.value) return
  createClassError.value = null
  const schoolId = selectedUser.value?.school_id
  if (!schoolId) {
    createClassError.value = 'No school found for your account. Please contact an administrator.'
    return
  }
  isCreatingClass.value = true
  try {
    const newClass = await createClass({
      class_name: params.class_name,
      course_code: params.course_code,
      school_id: schoolId,
    })
    if (newClass) {
      closeCreateModal()
      createdClass.value = newClass
      isCreatedModalOpen.value = true
    } else {
      createClassError.value = 'Failed to create class. Please try again.'
    }
  } finally {
    isCreatingClass.value = false
  }
}

function handleGoToCreatedClass() {
  if (createdClass.value) {
    isCreatedModalOpen.value = false
    sessionStorage.setItem('ssi-class-detail', JSON.stringify(createdClass.value))
    router.push({ name: 'class-detail', params: { id: createdClass.value.id } })
  }
}

function closeCreatedModal() {
  isCreatedModalOpen.value = false
  createdClass.value = null
}

function openClass(cls: { id: string; class_name: string; course_code: string; current_seed: number; join_code: string }) {
  const stored = {
    id: cls.id,
    class_name: cls.class_name,
    course_code: cls.course_code,
    current_seed: cls.current_seed,
    student_join_code: cls.join_code,
  }
  sessionStorage.setItem('ssi-class-detail', JSON.stringify(stored))
  router.push({ name: 'class-detail', params: { id: cls.id } })
}

// Play-as-class straight from the row's right-hand action (mirrors ClassDetail /
// DashboardView): launch the player inside the schools shell for this class.
function handlePlayClass(cls: { id: string; class_name: string; course_code: string; current_seed: number; join_code: string }) {
  localStorage.setItem('ssi-last-course', cls.course_code)
  localStorage.setItem('ssi-active-class', JSON.stringify({
    id: cls.id,
    name: cls.class_name,
    course_code: cls.course_code,
    current_seed: cls.current_seed,
    timestamp: new Date().toISOString(),
  }))
  router.push({ path: '/schools/play', query: { class: cls.id } })
}

// Per-class share link + one-click copy (mirrors the tutor dashboard so the
// school lane gets the same "create class → copy link → fill roster" flow).
const origin = typeof window !== 'undefined' ? window.location.origin : ''
const copiedClassId = ref<string | null>(null)
function shareUrlFor(cls: { join_code: string }): string {
  return `${origin}/with/${cls.join_code}`
}
async function copyShareLink(cls: { id: string; join_code: string }) {
  try {
    await navigator.clipboard.writeText(shareUrlFor(cls))
    copiedClassId.value = cls.id
    setTimeout(() => { if (copiedClassId.value === cls.id) copiedClassId.value = null }, 2000)
  } catch {
    /* clipboard blocked — the input is still selectable as a fallback */
  }
}

function exportCsv() {
  const header = ['Class', 'Course', 'Students', 'Belt', 'Avg seeds', 'Hours/wk', 'Sessions', 'Health', 'Join code']
  const rows = filtered.value.map(c => [
    c.class_name,
    c.course_label,
    c.student_count,
    c.class_belt,
    c.avg_seeds_completed,
    c.hoursWk,
    c.sessions,
    c.health,
    c.join_code,
  ].join(','))
  const csv = [header.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `classes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <main class="dashboard">
    <div class="page-head">
      <div class="page-head-text">
        <h1 class="arsenal page-title">{{ headlineTitle }}</h1>
        <p class="page-subtitle schools-subtle">{{ headlineSubtitle }}</p>
      </div>
      <div class="page-head-actions">
        <button v-if="enrichedClasses.length > 0" type="button" class="btn-ghost" @click="exportCsv">
          Export CSV
        </button>
        <button v-if="!isAdminView" type="button" class="btn-play" @click="openCreateModal">
          + New class
        </button>
      </div>
    </div>

    <!-- Summary strip -->
    <div v-if="enrichedClasses.length > 0" class="summary-strip">
      <div class="summary-card schools-card">
        <span class="summary-dot" style="background: var(--schools-success)" />
        <div>
          <div class="arsenal summary-number">{{ healthCounts['excellent'] || 0 }}</div>
          <div class="summary-label">Excellent</div>
        </div>
      </div>
      <div class="summary-card schools-card">
        <span class="summary-dot" style="background: #8a8479" />
        <div>
          <div class="arsenal summary-number">{{ healthCounts['good'] || 0 }}</div>
          <div class="summary-label">Good</div>
        </div>
      </div>
      <div class="summary-card schools-card">
        <span class="summary-dot" style="background: var(--schools-red)" />
        <div>
          <div class="arsenal summary-number">{{ healthCounts['needs-attention'] || 0 }}</div>
          <div class="summary-label">Needs eyes</div>
        </div>
      </div>
      <div class="summary-card schools-card">
        <span class="summary-dot" style="background: var(--schools-fg)" />
        <div>
          <div class="arsenal summary-number">{{ courses.length }} {{ courses.length === 1 ? 'course' : 'courses' }}</div>
          <div class="summary-label">Across</div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div v-if="enrichedClasses.length > 0" class="filters-bar schools-card">
      <label class="filter">
        <span class="filter-label">Course</span>
        <select v-model="courseFilter" class="filter-select">
          <option value="all">All courses</option>
          <option v-for="c in courses" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>

      <label class="filter">
        <span class="filter-label">Health</span>
        <select v-model="healthFilter" class="filter-select">
          <option value="all">All</option>
          <option value="excellent">Excellent</option>
          <option value="good">Good</option>
          <option value="needs-attention">Needs attention</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>

      <div class="filter filter-sort">
        <span class="filter-label">Sort</span>
        <select v-model="sortKey" class="filter-select">
          <option value="name">Name</option>
          <option value="students">Students</option>
          <option value="hours">Hours/wk</option>
          <option value="journey">Avg seeds</option>
        </select>
      </div>
    </div>

    <!-- Table -->
    <div v-if="filtered.length > 0" class="schools-card table-card">
      <table class="ssi-table">
        <thead>
          <tr>
            <th>Class</th>
            <th>Course</th>
            <th>Students</th>
            <th>Belt</th>
            <th>Avg seeds</th>
            <th>Hours/wk</th>
            <th>Activity</th>
            <th>Health</th>
            <th>Share</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="cls in filtered"
            :key="cls.id"
            class="row-clickable"
            tabindex="0"
            role="button"
            :aria-label="`Open ${cls.class_name}`"
            @click="openClass(cls)"
            @keyup.enter="openClass(cls)"
          >
            <td>
              <div class="cell-name">{{ cls.class_name }}</div>
              <div class="cell-code">{{ cls.join_code }}</div>
            </td>
            <td><span class="schools-subtle">{{ cls.course_label }}</span></td>
            <td>{{ cls.student_count }}</td>
            <td>
              <div class="cell-belt">
                <BeltDot :belt="cls.class_belt" :size="16" ring />
                <span class="belt-name">{{ cls.class_belt }}</span>
              </div>
            </td>
            <td>{{ cls.avg_seeds_completed }}</td>
            <td>{{ cls.hoursWk }}h</td>
            <td><Sparkline :data="cls.activity" :width="80" :height="20" /></td>
            <td>
              <span class="cell-health">
                <HealthDot :health="cls.health" />
                <span class="health-label">{{ cls.health.replace('-', ' ') }}</span>
              </span>
            </td>
            <td class="cell-share">
              <button type="button" class="share-btn" @click.stop="copyShareLink(cls)" :title="shareUrlFor(cls)">
                {{ copiedClassId === cls.id ? 'Copied ✓' : 'Copy link' }}
              </button>
            </td>
            <td class="cell-action">
              <button type="button" class="row-play-btn" @click.stop="handlePlayClass(cls)">▶ Play as class</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Filtered-empty state (classes exist but filters hide them) -->
    <div v-else-if="enrichedClasses.length > 0" class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">No classes match those filters</h3>
      <p class="empty-text schools-subtle">Try widening the course or health filter.</p>
      <button
        type="button"
        class="btn-ghost"
        @click="() => { courseFilter = 'all'; healthFilter = 'all' }"
      >
        Reset filters
      </button>
    </div>

    <!-- No classes at all -->
    <div v-else class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">No classes yet</h3>
      <p class="empty-text schools-subtle">
        Create your first class to start teaching with SSi. Students join with a unique code.
      </p>
      <button v-if="!isAdminView" type="button" class="btn-play" @click="openCreateModal">
        + Create your first class
      </button>
    </div>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="createClassError" class="error-toast" @click="createClassError = null">
          {{ createClassError }}
        </div>
      </Transition>
    </Teleport>

    <CreateClassModal
      :isOpen="isCreateModalOpen"
      :submitting="isCreatingClass"
      :availableCourses="schoolAvailableCourses"
      lockedNote="Subscribe to teach more languages"
      @close="closeCreateModal"
      @create="handleCreateClass"
    />

    <ClassCreatedModal
      :isOpen="isCreatedModalOpen"
      :classData="createdClass"
      @close="closeCreatedModal"
      @goToClass="handleGoToCreatedClass"
    />
  </main>
</template>

<style scoped>
.dashboard {
  padding: 22px 28px 32px;
  max-width: 1320px;
  margin: 0 auto;
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
  font-size: 32px;
  line-height: 1.05;
}

.page-subtitle {
  font-size: 13.5px;
  margin-top: 4px;
}

.page-head-actions {
  display: flex;
  gap: 8px;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
}

.summary-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}

.summary-number {
  font-size: 24px;
  line-height: 1;
}

.summary-label {
  font-size: 11.5px;
  color: var(--schools-fg-2);
  margin-top: 2px;
}

.filters-bar {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 18px;
  margin-bottom: 12px;
}

.filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.filter-sort {
  margin-left: auto;
}

.filter-label {
  font-size: 12px;
  color: var(--schools-fg-2);
}

.filter-select {
  padding: 7px 10px;
  font-size: 12.5px;
  border: 1px solid var(--schools-border-strong);
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

.cell-name {
  font-weight: 600;
  color: var(--schools-fg);
}

.cell-code {
  font-size: 11px;
  color: var(--schools-fg-3);
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  margin-top: 2px;
}

.cell-belt {
  display: flex;
  align-items: center;
  gap: 8px;
}

.belt-name {
  text-transform: capitalize;
}

.cell-health {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.health-label {
  text-transform: capitalize;
  font-size: 12px;
  color: var(--schools-fg-2);
}

/* The whole class row opens the class page; the Share/Play buttons stop
   propagation so they act on their own. */
.row-clickable { cursor: pointer; }
.row-clickable:hover { background: #f6f5f1; }
.row-clickable:focus-visible { outline: 2px solid var(--schools-red); outline-offset: -2px; }

.cell-action {
  text-align: right;
}

.row-play-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: var(--schools-red);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}
.row-play-btn:hover { background: var(--schools-red-deep); }

.cell-link {
  font-size: 12px;
  color: var(--schools-red);
  text-decoration: none;
  font-weight: 600;
  white-space: nowrap;
}

.cell-link:hover {
  color: var(--schools-red-deep);
}

.cell-share {
  white-space: nowrap;
}

.share-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--schools-border, #d8d4cd);
  background: var(--schools-card, #fff);
  color: var(--schools-fg, #2a2a2a);
  cursor: pointer;
  white-space: nowrap;
}

.share-btn:hover {
  border-color: var(--schools-red);
  color: var(--schools-red);
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

.error-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--schools-red);
  color: #fff;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 0.875rem;
  cursor: pointer;
  z-index: 10000;
  box-shadow: var(--schools-shadow-md);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 1100px) {
  .summary-strip { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 960px) {
  .dashboard { padding: 18px 16px 28px; }
  .filter-sort { margin-left: 0; }
  .table-card { overflow-x: auto; }
  .table-card .ssi-table { min-width: 760px; }
}
</style>
