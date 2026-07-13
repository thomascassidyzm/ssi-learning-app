<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Greeting from '@/components/schools/shared/Greeting.vue'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import HealthDot from '@/components/schools/shared/HealthDot.vue'
import Bench from '@/components/schools/shared/Bench.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { useClassesData, type ClassInfo, type ClassReport } from '@/composables/schools/useClassesData'
import { useSchoolsDensity } from '@/composables/schools/useSchoolsDensity'
import { useGovtAdminActions } from '@/composables/schools/useGovtAdminActions'
import { getLanguageName } from '@/composables/useI18n'

const router = useRouter()
const { currentUser, isTeacher, isSchoolAdmin, isGovtAdmin } = useSchoolContext()
const { density } = useSchoolsDensity()

const {
  schools,
  currentSchool,
  groupSummary,
  viewingSchool,
  isViewingSchool,
  totalStudents,
  totalTeachers,
  totalClasses,
  totalPracticeHours,
  fetchSchools,
  selectSchoolToView,
  clearViewingSchool,
} = useSchoolData()

const {
  classes: teacherClasses,
  fetchClasses,
  getClassReport,
} = useClassesData()

const {
  links: schoolLinks,
  fetchSchoolLinks,
  mintSchoolLink,
  createSchoolInMyGroup,
  renameGroup,
} = useGovtAdminActions()

// ---------- Govt admin: "name your group" first-run card ----------
const groupNameDraft = ref('')
const isSavingGroupName = ref(false)
const groupNameError = ref<string | null>(null)
const showNameGroupCard = computed(() =>
  isGovtAdmin.value && !isViewingSchool.value && groupSummary.value?.name_confirmed === false
)

async function saveGroupName() {
  const name = groupNameDraft.value.trim()
  const groupId = groupSummary.value?.group_id
  if (!name || !groupId) return
  isSavingGroupName.value = true
  groupNameError.value = null
  const ok = await renameGroup(groupId, name)
  isSavingGroupName.value = false
  if (ok) {
    await fetchSchools()
  } else {
    groupNameError.value = 'Could not save — try again.'
  }
}

// ---------- Govt admin: mint school links + create school directly ----------
const isMintingLink = ref(false)
const isCreatingSchool = ref(false)
const newSchoolLabel = ref('')
const mintedCode = ref<string | null>(null)
const copiedLinkId = ref<string | null>(null)

function schoolInviteUrl(code: string): string {
  return `${window.location.origin}/redeem/${code}`
}

async function copyLink(id: string, code: string) {
  try {
    await navigator.clipboard.writeText(schoolInviteUrl(code))
    copiedLinkId.value = id
    setTimeout(() => { if (copiedLinkId.value === id) copiedLinkId.value = null }, 2000)
  } catch {
    /* ignore */
  }
}

async function handleMintLink() {
  isMintingLink.value = true
  mintedCode.value = null
  const result = await mintSchoolLink(newSchoolLabel.value.trim())
  isMintingLink.value = false
  if (result) {
    mintedCode.value = result.code
    newSchoolLabel.value = ''
    await fetchSchoolLinks()
  }
}

async function handleCreateSchool() {
  const name = newSchoolLabel.value.trim()
  if (!name) return
  isCreatingSchool.value = true
  const result = await createSchoolInMyGroup(name)
  isCreatingSchool.value = false
  if (result) {
    newSchoolLabel.value = ''
    await Promise.all([fetchSchools(), fetchSchoolLinks()])
  }
}

// Per-class benchmark reports, fetched lazily.
const classReports = reactive(new Map<string, ClassReport>())

async function fetchReports() {
  for (const c of teacherClasses.value) {
    if (classReports.has(c.id)) continue
    try {
      const r = await getClassReport(c.id)
      if (r) classReports.set(c.id, r)
    } catch {
      /* benchmark is optional — skip silently */
    }
  }
}

watch(currentUser, (user) => {
  if (!user) return
  fetchSchools()
  if (isTeacher.value || isSchoolAdmin.value) {
    fetchClasses().then(fetchReports)
  }
  if (isGovtAdmin.value) {
    fetchSchoolLinks()
  }
}, { immediate: true })

// Govt admin drills into a school → load that school's classes (the classes
// composable scopes to the viewed school via activeSchoolId). Without this the
// detail view has no class data, since govt admins don't fetch classes at the
// group level.
watch(viewingSchool, (school) => {
  if (school && isGovtAdmin.value) {
    fetchClasses().then(fetchReports)
  }
})

onMounted(() => {
  if (currentUser.value) {
    fetchSchools()
    if (isTeacher.value || isSchoolAdmin.value) {
      fetchClasses().then(fetchReports)
    }
  }
})

// ---------- Display helpers ----------
const firstName = computed(() => {
  const name = currentUser.value?.display_name || ''
  return name.split(/\s+/).filter(Boolean)[0] || 'there'
})

const greetingName = computed(() => `Welcome back, ${firstName.value}.`)

const todayLabel = computed(() => {
  const parts = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).split(' ')
  if (parts.length >= 3) return `${parts[0]} · ${parts[1]} ${parts[2]}`
  return parts.join(' ')
})

const schoolName = computed(() => {
  if (isViewingSchool.value && viewingSchool.value) return viewingSchool.value.school_name
  if (isGovtAdmin.value && groupSummary.value) return groupSummary.value.group_name
  return currentSchool.value?.school_name || currentUser.value?.school_name || 'Your School'
})

function courseDisplayName(code: string): string {
  const m = code?.match(/^([a-z_]+?)_for_/)
  return m ? getLanguageName(m[1]) : code
}

function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`
}

// Aggregates across the teacher's classes (all-time, from class reports).
const teacherStats = computed(() => {
  const reports = Array.from(classReports.values())
  const totalStudentsAcross = teacherClasses.value.reduce((sum, c) => sum + (c.student_count || 0), 0)
  const totalCycles = reports.reduce((sum, r) => sum + r.class.total_cycles, 0)
  const totalSessions = reports.reduce((sum, r) => sum + r.class.total_sessions, 0)
  const totalSeconds = reports.reduce((sum, r) => sum + r.class.total_practice_seconds, 0)
  return {
    students: totalStudentsAcross,
    hours: (totalSeconds / 3600).toFixed(1),
    sessions: totalSessions,
    cycles: totalCycles,
    classes: teacherClasses.value.length,
  }
})

const greetingLines = computed(() => {
  const n = teacherClasses.value.length
  if (!n) return 'No classes yet — create one to get your students playing.'
  if (n === 1) return `One class on the go, ${teacherStats.value.students} students across it.`
  return `${n} classes on the go, ${teacherStats.value.students} students total.`
})

const adminGreetingLines = computed(() => {
  return `${totalStudents.value} students across ${totalClasses.value} classes — ${Math.round(totalPracticeHours.value)}h practised all-time.`
})

const breadcrumb = computed(() => {
  if (!isViewingSchool.value) return null
  return {
    group: groupSummary.value?.group_name || 'Group',
    school: viewingSchool.value?.school_name || 'School',
  }
})

// ---------- Bench data per class ----------
function benchFor(report: ClassReport | undefined) {
  if (!report) return null
  return {
    class:  Math.round(report.class.total_cycles),
    school: Math.round(report.schoolAvg?.avg_total_cycles ?? 0),
    course: Math.round(report.courseAvg?.avg_total_cycles ?? 0),
  }
}

// ---------- Actions ----------
function handlePlayClass(cls: ClassInfo) {
  // Launch the player inside the schools surface so the SchoolsTopBar stays
  // above it (teacher keeps classroom context while running a session).
  // The /schools/play route renders PlayerContainer as a child of
  // SchoolsContainer.
  localStorage.setItem('ssi-last-course', cls.course_code)
  localStorage.setItem('ssi-active-class', JSON.stringify({
    id: cls.id,
    name: cls.class_name,
    course_code: cls.course_code,
    current_seed: cls.current_seed,
    last_lego_id: cls.last_lego_id,
    teacherUserId: currentUser.value?.user_id,
    timestamp: new Date().toISOString(),
  }))
  router.push({ path: '/schools/play', query: { class: cls.id } })
}
</script>

<template>
  <div class="dashboard-view">
    <!-- Govt drill-down breadcrumb -->
    <nav v-if="breadcrumb" class="dashboard-breadcrumb">
      <button class="breadcrumb-back" @click="clearViewingSchool">
        <span aria-hidden="true">←</span>
        <span>{{ breadcrumb.group }}</span>
      </button>
      <span class="breadcrumb-sep">·</span>
      <span class="breadcrumb-current">{{ breadcrumb.school }}</span>
    </nav>

    <!-- ============================================================
         TEACHER
         ============================================================ -->
    <template v-if="isTeacher">
      <Greeting
        :name="greetingName"
        :lines="greetingLines"
        :date="todayLabel"
        :dense="density === 'compact'"
      >
        <template #action>
          <router-link to="/schools/classes" class="btn-ghost">+ Create class</router-link>
        </template>
      </Greeting>

      <div class="stat-strip">
        <div class="stat-card">
          <span class="arsenal stat-value">{{ teacherStats.students }}</span>
          <span class="stat-label">Students</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ teacherStats.hours }}h</span>
          <span class="stat-label">Hours practised</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ teacherStats.sessions }}</span>
          <span class="stat-label">Sessions</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ teacherStats.classes }}</span>
          <span class="stat-label">Classes</span>
        </div>
      </div>

      <!-- Compact: dense table -->
      <div v-if="density === 'compact'" class="schools-card teacher-compact">
        <div class="teacher-compact-head">
          <div>Class</div>
          <div>Course</div>
          <div>Benchmarks (cycles vs school · global)</div>
          <div>Code</div>
          <div></div>
        </div>
        <div
          v-for="(cls, i) in teacherClasses"
          :key="cls.id"
          :class="['teacher-compact-row', { last: i === teacherClasses.length - 1 }]"
        >
          <router-link :to="`/schools/classes/${cls.id}`" class="class-link">
            <BeltDot belt="white" :size="28" ring />
            <div class="class-link-text">
              <div class="class-name">{{ cls.class_name }}</div>
              <div class="class-meta">{{ cls.student_count }} students</div>
            </div>
          </router-link>
          <div class="schools-subtle">{{ courseDisplayName(cls.course_code) }}</div>
          <div>
            <Bench v-if="benchFor(classReports.get(cls.id))" :data="benchFor(classReports.get(cls.id))!" unit="c" />
            <span v-else class="schools-subtle">—</span>
          </div>
          <div class="join-code">{{ cls.student_join_code }}</div>
          <div class="row-cta">
            <button class="btn-play" @click="handlePlayClass(cls)">▶ Play</button>
          </div>
        </div>

        <div v-if="!teacherClasses.length" class="empty-state">
          <p>No classes yet.</p>
          <router-link to="/schools/classes" class="btn-play">Create your first class</router-link>
        </div>
      </div>

      <!-- Detailed: card grid -->
      <div v-else class="class-grid">
        <article
          v-for="cls in teacherClasses"
          :key="cls.id"
          class="schools-card class-panel"
        >
          <div class="panel-head">
            <div class="course-eyebrow">{{ courseDisplayName(cls.course_code) }}</div>
            <router-link :to="`/schools/classes/${cls.id}`" class="panel-title-link">
              <h2 class="arsenal panel-title">{{ cls.class_name }}</h2>
            </router-link>
            <div class="panel-meta">
              <BeltDot belt="white" :size="14" ring />
              <span>{{ cls.student_count }} students</span>
              <span class="dot-sep">·</span>
              <span>{{ Math.round(cls.avg_practice_minutes || 0) }}m avg practice</span>
            </div>
          </div>

          <div v-if="benchFor(classReports.get(cls.id))" class="panel-bench">
            <div class="schools-kicker bench-kicker">Cycles · class vs school vs global</div>
            <Bench :data="benchFor(classReports.get(cls.id))!" unit="c" />
          </div>

          <div class="panel-footer">
            <span class="join-code">{{ cls.student_join_code }}</span>
            <button class="btn-play" @click="handlePlayClass(cls)">▶ Play as class</button>
          </div>
        </article>

        <div v-if="!teacherClasses.length" class="empty-state full">
          <p>No classes yet — create one to get your students playing.</p>
          <router-link to="/schools/classes" class="btn-play">Create your first class</router-link>
        </div>
      </div>
    </template>

    <!-- ============================================================
         SCHOOL ADMIN
         ============================================================ -->
    <template v-else-if="isSchoolAdmin">
      <Greeting
        :name="`Welcome back, ${firstName}.`"
        :lines="adminGreetingLines"
        :date="todayLabel"
        :dense="density === 'compact'"
      >
        <template #action>
          <div class="action-row">
            <router-link to="/schools/teachers" class="btn-ghost">+ Invite teacher</router-link>
            <router-link to="/schools/settings" class="btn-play">School settings</router-link>
          </div>
        </template>
      </Greeting>

      <!-- First-run: the school is empty → offer the guided setup wizard.
           /schools/setup has no nav tab, so this banner is its entry point.
           Gated on currentSchool so it can't flash while stats are loading. -->
      <router-link
        v-if="currentSchool && !totalClasses && !totalStudents"
        to="/schools/setup"
        class="schools-card schools-card-pad setup-banner"
      >
        <div>
          <div class="schools-kicker">Get started</div>
          <p class="setup-banner-text">
            Set up your school in four quick steps — name it, invite your
            teachers, and create your first class.
          </p>
        </div>
        <span class="btn-play setup-banner-cta">Start setup →</span>
      </router-link>

      <div class="stat-strip stat-strip--5">
        <div class="stat-card">
          <span class="arsenal stat-value">{{ totalStudents }}</span>
          <span class="stat-label">Students</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ totalTeachers }}</span>
          <span class="stat-label">Teachers</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ totalClasses }}</span>
          <span class="stat-label">Classes</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ Math.round(totalPracticeHours) }}h</span>
          <span class="stat-label">Hours practised</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ teacherClasses.length }}</span>
          <span class="stat-label">Your classes</span>
        </div>
      </div>

      <div class="admin-grid">
        <div class="schools-card">
          <header class="card-header-row">
            <h3 class="arsenal card-header-title">Classes</h3>
            <router-link
              v-if="teacherClasses.length"
              to="/schools/classes?create=1"
              class="card-header-link"
            >+ Create class</router-link>
            <router-link to="/schools/classes" class="card-header-link">View all →</router-link>
          </header>
          <table class="ssi-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Course</th>
                <th>Students</th>
                <th>Avg practice</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cls in teacherClasses" :key="cls.id">
                <td>
                  <div class="class-cell">
                    <BeltDot belt="white" :size="20" ring />
                    <div>
                      <div class="class-name">{{ cls.class_name }}</div>
                      <div class="schools-subtle class-meta">{{ courseDisplayName(cls.course_code) }}</div>
                    </div>
                  </div>
                </td>
                <td class="schools-subtle">{{ courseDisplayName(cls.course_code) }}</td>
                <td>{{ cls.student_count }}</td>
                <td>{{ Math.round(cls.avg_practice_minutes || 0) }}m</td>
              </tr>
              <tr v-if="!teacherClasses.length">
                <td colspan="4" class="empty-row">
                  <p class="empty-row-text">No classes yet — create one to get your students playing.</p>
                  <router-link to="/schools/classes?create=1" class="btn-play empty-row-cta">
                    + Create your first class
                  </router-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside class="schools-card schools-card-pad attention-panel">
          <h3 class="arsenal attention-title">Quick links</h3>
          <div class="attention-list">
            <router-link to="/schools/students" class="attention-row">
              <div class="attention-tag">Students</div>
              <div class="attention-body">View and manage all student progress</div>
              <span class="attention-cta">Open →</span>
            </router-link>
            <router-link to="/schools/teachers" class="attention-row">
              <div class="attention-tag">Teachers</div>
              <div class="attention-body">Invite or manage teaching staff</div>
              <span class="attention-cta">Open →</span>
            </router-link>
            <router-link to="/schools/analytics" class="attention-row">
              <div class="attention-tag">Analytics</div>
              <div class="attention-body">Weekly activity and per-class breakdown</div>
              <span class="attention-cta">Open →</span>
            </router-link>
          </div>
        </aside>
      </div>
    </template>

    <!-- ============================================================
         GOVT ADMIN — schools tile grid (drill-down)
         ============================================================ -->
    <template v-else-if="isGovtAdmin">
      <Greeting
        :name="`${schoolName}`"
        :lines="isViewingSchool
          ? `${totalClasses} classes · ${totalStudents} students · ${Math.round(totalPracticeHours)}h practised`
          : `${schools.length} schools · ${totalStudents} students · ${Math.round(totalPracticeHours)}h practised`"
        :date="todayLabel"
        :dense="density === 'compact'"
      >
        <template #action>
          <router-link to="/schools/all" class="btn-ghost">Full schools list →</router-link>
        </template>
      </Greeting>

      <!-- First-run: name your group (design §1d) -->
      <div v-if="showNameGroupCard" class="schools-card schools-card-pad name-group-card">
        <h3 class="arsenal card-header-title">Name your group</h3>
        <p class="schools-subtle">This is what schools will see when they join.</p>
        <div class="name-group-row">
          <input
            v-model="groupNameDraft"
            type="text"
            class="field-input"
            placeholder="e.g. Gwynedd Education Authority"
            :disabled="isSavingGroupName"
            @keyup.enter="saveGroupName"
          />
          <button
            class="btn-play"
            :disabled="isSavingGroupName || !groupNameDraft.trim()"
            @click="saveGroupName"
          >
            {{ isSavingGroupName ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <p v-if="groupNameError" class="name-group-error">{{ groupNameError }}</p>
      </div>

      <!-- Add schools / Create school (design §1e, §5c revised) -->
      <div v-if="!isViewingSchool" class="schools-card schools-card-pad add-schools-card">
        <header class="card-header-row">
          <h3 class="arsenal card-header-title">Schools in your group</h3>
        </header>
        <div class="add-schools-row">
          <input
            v-model="newSchoolLabel"
            type="text"
            class="field-input field-input-flex"
            placeholder="School name (optional label)"
          />
          <button class="btn-ghost" :disabled="isMintingLink" @click="handleMintLink">
            {{ isMintingLink ? 'Creating…' : 'Invite a school' }}
          </button>
          <button class="btn-play" :disabled="isCreatingSchool || !newSchoolLabel.trim()" @click="handleCreateSchool">
            {{ isCreatingSchool ? 'Creating…' : 'Create school' }}
          </button>
        </div>
        <p v-if="mintedCode" class="schools-subtle">
          Link created: <code>{{ schoolInviteUrl(mintedCode) }}</code>
        </p>

        <table v-if="schoolLinks.length" class="ssi-table">
          <thead>
            <tr>
              <th>Link</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="link in schoolLinks" :key="link.id">
              <td>{{ link.label || link.code }}</td>
              <td class="schools-subtle">
                <span v-if="link.redeemed">Redeemed — {{ link.school?.school_name }}</span>
                <span v-else-if="!link.is_active">Deactivated</span>
                <span v-else>Pending</span>
              </td>
              <td>
                <button v-if="!link.redeemed" class="btn-ghost" @click="copyLink(link.id, link.code)">
                  {{ copiedLinkId === link.id ? 'Copied!' : 'Copy link' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-row">No schools invited yet.</p>
      </div>

      <div v-if="!isViewingSchool" class="govt-schools-grid">
        <button
          v-for="school in schools"
          :key="school.id"
          class="schools-card govt-tile"
          @click="selectSchoolToView(school)"
        >
          <div class="govt-tile-head">
            <div class="govt-tile-avatar">{{ school.school_name.slice(0, 2).toUpperCase() }}</div>
            <div class="govt-tile-info">
              <h4>{{ school.school_name }}</h4>
              <span class="schools-subtle">
                {{ school.teacher_count }} teachers · {{ school.class_count }} classes
              </span>
            </div>
            <HealthDot :health="school.health" />
          </div>
          <div class="govt-tile-stats">
            <div>
              <div class="arsenal govt-tile-stat">{{ school.student_count }}</div>
              <div class="schools-subtle">Students</div>
            </div>
            <div>
              <div class="arsenal govt-tile-stat">{{ Math.round(school.total_practice_hours) }}h</div>
              <div class="schools-subtle">Hours</div>
            </div>
          </div>
        </button>
      </div>

      <!-- Drill-down: one school's detail (classes + stats) -->
      <template v-else>
        <div class="stat-strip">
          <div class="stat-card">
            <span class="arsenal stat-value">{{ totalStudents }}</span>
            <span class="stat-label">Students</span>
          </div>
          <div class="stat-card">
            <span class="arsenal stat-value">{{ totalTeachers }}</span>
            <span class="stat-label">Teachers</span>
          </div>
          <div class="stat-card">
            <span class="arsenal stat-value">{{ totalClasses }}</span>
            <span class="stat-label">Classes</span>
          </div>
          <div class="stat-card">
            <span class="arsenal stat-value">{{ Math.round(totalPracticeHours) }}h</span>
            <span class="stat-label">Hours practised</span>
          </div>
        </div>

        <div class="schools-card">
          <header class="card-header-row">
            <h3 class="arsenal card-header-title">Classes</h3>
          </header>
          <table class="ssi-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Course</th>
                <th>Students</th>
                <th>Avg practice</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cls in teacherClasses" :key="cls.id">
                <td>
                  <router-link :to="`/schools/classes/${cls.id}`" class="class-cell class-cell-link">
                    <BeltDot belt="white" :size="20" ring />
                    <div>
                      <div class="class-name">{{ cls.class_name }}</div>
                      <div class="schools-subtle class-meta">{{ courseDisplayName(cls.course_code) }}</div>
                    </div>
                  </router-link>
                </td>
                <td class="schools-subtle">{{ courseDisplayName(cls.course_code) }}</td>
                <td>{{ cls.student_count }}</td>
                <td>{{ Math.round(cls.avg_practice_minutes || 0) }}m</td>
              </tr>
              <tr v-if="!teacherClasses.length">
                <td colspan="4" class="empty-row">No classes in this school yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.dashboard-view {
  padding-bottom: 32px;
}

/* ---------- Breadcrumb ---------- */
.dashboard-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--schools-fg-2);
}
.breadcrumb-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--schools-red);
  cursor: pointer;
  font: inherit;
  padding: 4px 8px;
  border-radius: 6px;
}
.breadcrumb-back:hover { background: rgba(219, 30, 23, 0.06); }
.breadcrumb-sep { color: var(--schools-fg-3); }
.breadcrumb-current { color: var(--schools-fg); font-weight: 500; }

/* Govt drill-down: clickable class row */
.class-cell-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}
.class-cell-link:hover .class-name {
  color: var(--schools-red);
}

/* ---------- First-run setup banner ---------- */
.setup-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  text-decoration: none;
  color: inherit;
}
.setup-banner-text {
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--schools-fg-2, #5a534c);
}
.setup-banner-cta { white-space: nowrap; }

/* ---------- Stat strip ---------- */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.stat-strip--5 { grid-template-columns: repeat(5, 1fr); }

.stat-card {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.stat-value {
  font-size: 24px;
  line-height: 1;
  color: var(--schools-fg);
}
.stat-label {
  font-size: 12px;
  color: var(--schools-fg-2);
}

/* ---------- Teacher: compact table ---------- */
.teacher-compact {
  overflow: hidden;
}
.teacher-compact-head,
.teacher-compact-row {
  display: grid;
  grid-template-columns: 1.6fr 1.2fr 1.6fr 0.9fr 110px;
  gap: 14px;
  align-items: center;
  padding: 14px 18px;
}
.teacher-compact-head {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
  border-bottom: 1px solid var(--schools-border);
  background: #fafafa;
  padding: 10px 18px;
}
.teacher-compact-row {
  border-bottom: 1px solid var(--schools-border);
}
.teacher-compact-row.last { border-bottom: none; }

.class-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}
.class-link-text { min-width: 0; }
.class-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--schools-fg);
}
.class-meta {
  font-size: 11.5px;
  color: var(--schools-fg-2);
  margin-top: 1px;
}
.join-code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--schools-fg-2);
  letter-spacing: 0.04em;
}
.row-cta { text-align: right; }

/* ---------- Teacher: detailed cards ---------- */
.class-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.class-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 22px 22px;
}
.panel-head { display: flex; flex-direction: column; gap: 6px; }
.course-eyebrow {
  font-size: 11.5px;
  color: var(--schools-red);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 600;
}
.panel-title-link { text-decoration: none; color: inherit; }
.panel-title {
  font-size: 26px;
  line-height: 1.1;
  margin: 2px 0 6px;
}
.panel-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--schools-fg-2);
}
.dot-sep { color: var(--schools-fg-3); opacity: 0.6; }
.panel-bench {
  padding-top: 8px;
  border-top: 1px dashed var(--schools-border);
}
.bench-kicker { margin-bottom: 6px; }
.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 10px;
}

/* ---------- Empty state ---------- */
.empty-state {
  padding: 32px 24px;
  text-align: center;
  color: var(--schools-fg-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.empty-state.full { grid-column: 1 / -1; }

/* ---------- Admin ---------- */
.action-row { display: flex; gap: 8px; }

.admin-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 14px;
}
.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--schools-border);
}
.card-header-title { font-size: 18px; margin: 0; }
.card-header-link {
  font-size: 12px;
  color: var(--schools-fg-2);
  text-decoration: none;
}
.card-header-link:hover { color: var(--schools-fg); }

.name-group-card, .add-schools-card { margin-bottom: 20px; }
.name-group-row, .add-schools-row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  flex-wrap: wrap;
}
.name-group-error { color: var(--schools-danger, #c0392b); font-size: 13px; margin-top: 8px; }

.class-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.empty-row {
  text-align: center;
  padding: 32px 24px;
  color: var(--schools-fg-2);
}
.empty-row-text {
  margin: 0 0 16px;
}
.empty-row-cta {
  display: inline-block;
  font-size: 1.05rem;
  padding: 14px 28px;
}

.attention-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.attention-title { font-size: 18px; margin: 0; }
.attention-list { display: flex; flex-direction: column; gap: 10px; }
.attention-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff5e5;
  border: 1px solid #f4d28a;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
}
.attention-row:hover { background: #fef0d8; }
.attention-tag {
  font-size: 11px;
  font-weight: 600;
  color: #7a5418;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 8px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
}
.attention-body { font-size: 13px; color: #5a3e10; }
.attention-cta {
  font-size: 12px;
  font-weight: 600;
  color: #7a5418;
}

/* ---------- Govt ---------- */
.govt-schools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.govt-tile {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 18px 18px;
  text-align: left;
  cursor: pointer;
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: 12px;
  font: inherit;
  color: inherit;
  transition: border-color 160ms ease-out, transform 160ms ease-out;
}
.govt-tile:hover {
  border-color: var(--schools-red);
  transform: translateY(-1px);
}
.govt-tile-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.govt-tile-avatar {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--schools-red), var(--schools-red-deep));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0.02em;
  flex: none;
}
.govt-tile-info { flex: 1; min-width: 0; }
.govt-tile-info h4 {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 400;
  margin: 0 0 2px;
  color: var(--schools-fg);
}
.govt-tile-stats {
  display: flex;
  gap: 24px;
  padding-top: 14px;
  border-top: 1px solid var(--schools-border);
}
.govt-tile-stat {
  font-size: 22px;
  line-height: 1;
  color: var(--schools-fg);
}

/* ---------- Responsive ---------- */
@media (max-width: 1024px) {
  .class-grid { grid-template-columns: repeat(2, 1fr); }
  .admin-grid { grid-template-columns: 1fr; }
  .stat-strip { grid-template-columns: repeat(2, 1fr); }
  .stat-strip--5 { grid-template-columns: repeat(3, 1fr); }
  .teacher-compact-head,
  .teacher-compact-row {
    grid-template-columns: 1.4fr 1fr 1.4fr 0.8fr 90px;
  }
}

@media (max-width: 640px) {
  .class-grid { grid-template-columns: 1fr; }
  .stat-strip,
  .stat-strip--5 { grid-template-columns: 1fr 1fr; }
  .teacher-compact-head { display: none; }
  .teacher-compact-row {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 12px;
  }
}
</style>
