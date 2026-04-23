<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import Card from '@/components/schools/shared/Card.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { useClassesData } from '@/composables/schools/useClassesData'
import { useCourseAccess } from '@/composables/schools/useCourseAccess'
import { useAnalyticsData, type GroupReport } from '@/composables/schools/useAnalyticsData'
import { getSchoolsClient } from '@/composables/schools/client'
import { isDemoMode } from '@/composables/demo/demoMode'
import { getLanguageName } from '@/composables/useI18n'

const router = useRouter()
const { currentUser: selectedUser, isGovtAdmin, isTeacher } = useSchoolContext()
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
  isLoading,
  error
} = useSchoolData()

// Teacher quick-launch: fetch classes for simple list
const { classes: teacherClasses, fetchClasses: fetchTeacherClasses, isLoading: isTeacherLoading } = useClassesData()

// Course access: what courses the school is entitled to
const { courseGrants, isLoading: isCourseAccessLoading, fetchCourseAccess } = useCourseAccess()

// Derive display name from course_code via i18n (no hardcoded map needed)
function courseDisplayName(code: string): string {
  const match = code?.match(/^([a-z_]+?)_for_/)
  if (match) return getLanguageName(match[1])
  return code
}

const handlePlayClass = (cls: any) => {
  const activeClass = {
    id: cls.id,
    name: cls.class_name,
    course_code: cls.course_code,
    current_seed: cls.current_seed,
    last_lego_id: cls.last_lego_id,
    teacherUserId: selectedUser.value?.user_id,
    timestamp: new Date().toISOString()
  }
  localStorage.setItem('ssi-active-class', JSON.stringify(activeClass))
  router.push({ path: '/', query: { class: cls.id } })
}

// Display values
const schoolName = computed(() => {
  // If govt admin is viewing a specific school (drilled down)
  if (isViewingSchool.value && viewingSchool.value) return viewingSchool.value.school_name
  // If govt admin at group level
  if (isGovtAdmin.value && groupSummary.value) return groupSummary.value.group_name
  return currentSchool.value?.school_name || selectedUser.value?.school_name || 'Your School'
})

const schoolInitials = computed(() =>
  schoolName.value.split(' ').filter(Boolean).map((w: string) => w[0]).join('').substring(0, 2).toUpperCase() || 'SS'
)

// Eyebrow label for the hero card
const heroEyebrow = computed(() => {
  if (isViewingSchool.value) return 'School'
  if (isGovtAdmin.value) return 'Group'
  if (isTeacher.value) return 'Teacher'
  return 'School'
})

// Breadcrumb for drill-down navigation
const breadcrumb = computed(() => {
  if (!isViewingSchool.value) return null
  return {
    group: groupSummary.value?.group_name || 'Group',
    school: viewingSchool.value?.school_name || 'School'
  }
})

const practiceHoursDisplay = computed(() => Math.round(totalPracticeHours.value))

// Group report and contribution counter
const { getGroupReport } = useAnalyticsData()
const groupReport = ref<GroupReport | null>(null)

interface DailyContribution {
  phrases_count: number
  minutes_practiced: number
  unique_speakers: number
  target_language: string
}
const todayContributions = ref<DailyContribution | null>(null)

const languageNames: Record<string, string> = {
  cym: 'Welsh', gla: 'Scottish Gaelic', gle: 'Irish', cor: 'Cornish',
  glv: 'Manx', bre: 'Breton', eus: 'Basque', cat: 'Catalan',
  spa: 'Spanish', fra: 'French', deu: 'German', nld: 'Dutch',
}

async function loadGroupData() {
  if (!isGovtAdmin.value) return
  const groupId = selectedUser.value?.group_id
  const regionCode = selectedUser.value?.region_code
  if (!groupId && !regionCode) return
  // getGroupReport accepts region_code for now — will migrate to group_id
  groupReport.value = await getGroupReport(regionCode || groupId || '')
}

async function loadContributions() {
  if (isDemoMode.value) return
  if (!isGovtAdmin.value) return
  const client = getSchoolsClient()
  const today = new Date().toISOString().split('T')[0]
  const { data } = await client
    .from('daily_contributions')
    .select('phrases_count, minutes_practiced, unique_speakers, target_language')
    .eq('contribution_date', today)
    .limit(1)
    .single()
  todayContributions.value = data
}

// Debug info for testing
const debugInfo = computed(() => ({
  hasUser: !!selectedUser.value,
  userName: selectedUser.value?.display_name,
  role: selectedUser.value?.educational_role,
  groupId: selectedUser.value?.group_id,
  isGovtAdmin: isGovtAdmin.value,
  hasGroupSummary: !!groupSummary.value,
  error: error.value,
}))

// Load course access for the current school
async function loadCourseAccess() {
  const schoolId = selectedUser.value?.school_id
  if (schoolId) {
    await fetchCourseAccess(schoolId)
  }
}

// Fetch data when user changes
watch(selectedUser, (user) => {
  if (user) {
    fetchSchools()
    loadGroupData()
    loadContributions()
    loadCourseAccess()
    if (isTeacher.value) fetchTeacherClasses()
  }
}, { immediate: true })

onMounted(() => {
  if (selectedUser.value) {
    fetchSchools()
    loadGroupData()
    loadContributions()
    loadCourseAccess()
    if (isTeacher.value) fetchTeacherClasses()
  }
})
</script>

<template>
  <div class="dashboard-view">
    <!-- Breadcrumb (when drilled down) -->
    <nav v-if="breadcrumb" class="breadcrumb animate-in">
      <button class="breadcrumb-link" @click="clearViewingSchool">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        <span>{{ breadcrumb.group }}</span>
      </button>
      <span class="breadcrumb-separator">·</span>
      <span class="breadcrumb-current">{{ breadcrumb.school }}</span>
    </nav>

    <!-- Hero identity card -->
    <header class="hero animate-in">
      <div class="hero-text">
        <span class="hero-eyebrow">{{ heroEyebrow }}</span>
        <h1 class="hero-title">
          {{ isTeacher ? 'My Classes' : schoolName }}
        </h1>
        <p class="hero-subtitle">
          <template v-if="selectedUser">
            <template v-if="isTeacher">
              Choose a class to start a session
            </template>
            <template v-else-if="isViewingSchool">
              Viewing {{ schoolName }}
            </template>
            <template v-else-if="isGovtAdmin">
              Group overview
            </template>
            <template v-else>
              Welcome back
            </template>
          </template>
          <template v-else>
            Loading your school data&hellip;
          </template>
        </p>
      </div>

      <div class="hero-seal" aria-hidden="true">
        <svg class="hero-seal-ring" viewBox="0 0 120 120" width="120" height="120">
          <defs>
            <radialGradient id="sealGlow" cx="30%" cy="25%" r="90%">
              <stop offset="0%" stop-color="rgba(255,255,255,0.9)"/>
              <stop offset="55%" stop-color="rgba(255,255,255,0.15)"/>
              <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
            </radialGradient>
            <linearGradient id="sealFill" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#d94545"/>
              <stop offset="100%" stop-color="#a83232"/>
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="56" fill="url(#sealFill)"/>
          <circle cx="60" cy="60" r="56" fill="url(#sealGlow)"/>
          <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
          <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.5"/>
        </svg>
        <span class="hero-seal-initials">{{ schoolInitials }}</span>
      </div>
    </header>

    <!-- Teacher Quick Launch -->
    <section v-if="isTeacher" class="teacher-classes animate-in delay-1">
      <div v-if="isTeacherLoading" class="empty-panel">
        <p>Loading your classes&hellip;</p>
      </div>
      <div v-else-if="teacherClasses.length === 0" class="empty-panel">
        <p>No classes yet.</p>
        <router-link to="/schools/classes" class="empty-panel-cta">Create your first class</router-link>
      </div>
      <div v-else class="teacher-class-list">
        <button
          v-for="cls in teacherClasses"
          :key="cls.id"
          class="teacher-class-row"
          @click="handlePlayClass(cls)"
        >
          <div class="teacher-class-mark">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <polygon points="6 3 20 12 6 21 6 3"/>
            </svg>
          </div>
          <div class="teacher-class-info">
            <span class="teacher-class-name">{{ cls.class_name }}</span>
            <span class="teacher-class-course">{{ courseDisplayName(cls.course_code) }}</span>
          </div>
          <div class="teacher-class-meta">
            <span class="teacher-class-students">
              <span class="mono">{{ cls.student_count }}</span>
              {{ cls.student_count === 1 ? 'student' : 'students' }}
            </span>
          </div>
          <div class="teacher-play-btn">
            <span>Play as class</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </div>
        </button>
      </div>
      <div class="teacher-manage-link">
        <router-link to="/schools/classes">Manage classes</router-link>
      </div>
    </section>

    <!-- Loading State (admin) -->
    <div v-if="!isTeacher && isLoading" class="empty-panel animate-in delay-1">
      <p>Loading dashboard data&hellip;</p>
    </div>

    <!-- Stats stones (admin) -->
    <div v-else-if="!isTeacher" class="stones animate-in delay-1">
      <router-link to="/schools/students" class="stone" data-tone="blue">
        <div class="stone-head">
          <span class="stone-label">{{ isGovtAdmin ? 'Total Students' : 'Active Students' }}</span>
          <svg class="stone-glyph" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3.2"/>
            <circle cx="16" cy="9" r="2.4" opacity="0.7"/>
            <path d="M3.5 19c0-3 2.6-5 5.5-5s5.5 2 5.5 5"/>
            <path d="M14.5 18c.4-2.2 2-3.6 4-3.6 1.2 0 2.2.4 3 1" opacity="0.7"/>
          </svg>
        </div>
        <div class="stone-value mono-tabular">{{ totalStudents.toLocaleString() }}</div>
      </router-link>

      <router-link to="/schools/analytics" class="stone" data-tone="gold">
        <div class="stone-head">
          <span class="stone-label">Hours Practiced</span>
          <svg class="stone-glyph" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5"/>
            <path d="M12 7v5l3 2.5"/>
            <path d="M12 3.5v1M12 19.5v1M3.5 12h1M19.5 12h1" opacity="0.5"/>
          </svg>
        </div>
        <div class="stone-value mono-tabular">{{ practiceHoursDisplay.toLocaleString() }}</div>
      </router-link>

      <router-link to="/schools/classes" class="stone" data-tone="red">
        <div class="stone-head">
          <span class="stone-label">{{ isGovtAdmin ? 'Total Classes' : 'Active Classes' }}</span>
          <svg class="stone-glyph" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3.5" y="5.5" width="13" height="10" rx="1.5"/>
            <rect x="6" y="8" width="13" height="10" rx="1.5" opacity="0.55"/>
            <path d="M8.5 8.5h6M8.5 11h6M8.5 13h3" opacity="0.5"/>
          </svg>
        </div>
        <div class="stone-value mono-tabular">{{ totalClasses.toLocaleString() }}</div>
      </router-link>

      <router-link to="/schools/teachers" class="stone" data-tone="green">
        <div class="stone-head">
          <span class="stone-label">Teachers</span>
          <svg class="stone-glyph" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="3.2"/>
            <path d="M5.5 20c.4-3.5 3.1-6 6.5-6s6.1 2.5 6.5 6"/>
            <path d="M8 5.5l4-2 4 2" opacity="0.55"/>
          </svg>
        </div>
        <div class="stone-value mono-tabular">{{ totalTeachers.toLocaleString() }}</div>
      </router-link>
    </div>

    <!-- Course Access (school admin / teacher) -->
    <section v-if="!isGovtAdmin && selectedUser?.school_id" class="panel animate-in delay-2">
      <Card title="Available Courses" :loading="isCourseAccessLoading">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </template>
        <div v-if="courseGrants.length > 0" class="course-list">
          <div
            v-for="grant in courseGrants"
            :key="grant.course_code"
            class="course-row"
          >
            <div class="course-info">
              <span class="course-name">{{ grant.display_name }}</span>
              <span v-if="grant.source === 'group' && grant.source_name" class="course-source">
                via {{ grant.source_name }}
              </span>
            </div>
            <span class="course-code mono">{{ grant.course_code }}</span>
          </div>
        </div>
        <div v-else-if="!isCourseAccessLoading" class="course-empty">
          <p>No courses assigned yet — contact your administrator.</p>
        </div>
      </Card>
    </section>

    <!-- Schools in Group (Govt Admin) -->
    <section v-if="isGovtAdmin && !isViewingSchool && schools.length > 0" class="panel animate-in delay-2">
      <Card :title="`Schools in ${groupSummary?.group_name || 'Group'}`" :subtitle="`${schools.length} schools`">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </template>
        <div class="schools-grid">
          <button
            v-for="school in schools"
            :key="school.id"
            class="school-tile"
            @click="selectSchoolToView(school)"
          >
            <div class="school-tile-head">
              <div class="school-tile-avatar">
                <span>{{ school.school_name.substring(0, 2).toUpperCase() }}</span>
              </div>
              <div class="school-tile-info">
                <h4>{{ school.school_name }}</h4>
                <span class="school-tile-meta">
                  <span class="mono">{{ school.teacher_count }}</span> teachers
                  <span class="sep">·</span>
                  <span class="mono">{{ school.class_count }}</span> classes
                </span>
              </div>
              <svg class="school-tile-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
            <div class="school-tile-stats">
              <div class="school-tile-stat">
                <span class="school-tile-num mono-tabular">{{ school.student_count }}</span>
                <span class="school-tile-label">Students</span>
              </div>
              <div class="school-tile-stat">
                <span class="school-tile-num mono-tabular">{{ Math.round(school.total_practice_hours) }}</span>
                <span class="school-tile-label">Hours</span>
              </div>
            </div>
          </button>
        </div>
      </Card>
    </section>

    <!-- Quick Actions (not shown for teachers) -->
    <section v-if="!isTeacher" class="actions animate-in delay-3">
      <h2 class="section-title">Quick actions</h2>
      <div class="actions-rail">
        <router-link to="/schools/classes" class="action-pill action-pill--primary">
          <span class="action-pill-glyph">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <polygon points="6 3 20 12 6 21 6 3"/>
            </svg>
          </span>
          <span>Start session</span>
        </router-link>

        <router-link to="/schools/students" class="action-pill">
          <span class="action-pill-glyph">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="10" cy="8" r="3.2"/>
              <path d="M3.5 19.5c.5-3 3.3-5 6.5-5 1.1 0 2.2.25 3.1.7"/>
              <line x1="17" y1="11" x2="17" y2="17"/>
              <line x1="14" y1="14" x2="20" y2="14"/>
            </svg>
          </span>
          <span>Add student</span>
        </router-link>

        <router-link to="/schools/teachers" class="action-pill">
          <span class="action-pill-glyph">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3.5" y="7" width="17" height="11" rx="1.5"/>
              <path d="M9 7V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5V7"/>
              <line x1="3.5" y1="12.5" x2="20.5" y2="12.5" opacity="0.6"/>
            </svg>
          </span>
          <span>Add teacher</span>
        </router-link>

        <router-link to="/schools/analytics" class="action-pill">
          <span class="action-pill-glyph">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="5" y1="20" x2="5" y2="13"/>
              <line x1="12" y1="20" x2="12" y2="6"/>
              <line x1="19" y1="20" x2="19" y2="10"/>
            </svg>
          </span>
          <span>View reports</span>
        </router-link>
      </div>
    </section>

    <!-- Contribution Counter (Govt Admin) -->
    <section v-if="isGovtAdmin && todayContributions" class="panel animate-in delay-3">
      <div class="contribution">
        <div class="contribution-head">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l9 4.5-9 4.5-9-4.5z"/>
            <path d="M3 16.5l9 4.5 9-4.5" opacity="0.6"/>
            <path d="M3 12l9 4.5 9-4.5" opacity="0.35"/>
          </svg>
          <span>
            <strong>{{ languageNames[todayContributions.target_language] || todayContributions.target_language }}</strong>
            spoken today
          </span>
        </div>
        <div class="contribution-stats">
          <div class="contribution-stat">
            <span class="contribution-value mono-tabular">{{ todayContributions.phrases_count.toLocaleString() }}</span>
            <span class="contribution-label">phrases</span>
          </div>
          <div class="contribution-divider"></div>
          <div class="contribution-stat">
            <span class="contribution-value mono-tabular">{{ todayContributions.minutes_practiced.toLocaleString() }}</span>
            <span class="contribution-label">minutes</span>
          </div>
          <div class="contribution-divider"></div>
          <div class="contribution-stat">
            <span class="contribution-value mono-tabular">{{ todayContributions.unique_speakers.toLocaleString() }}</span>
            <span class="contribution-label">speakers</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Group Cycles Summary (Govt Admin) -->
    <section v-if="isGovtAdmin && groupReport && !isViewingSchool" class="panel animate-in delay-3">
      <Card title="Speaking Opportunities by School" :subtitle="`${groupReport.groupTotal.toLocaleString()} total across group`">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        </template>
        <div class="group-school-list">
          <div
            v-for="school in groupReport.schools"
            :key="school.school_id"
            class="group-school-row"
          >
            <div class="group-school-name">{{ school.school_name }}</div>
            <div class="group-school-meta">
              <span class="mono">{{ school.class_count }}</span> classes
              <span class="sep">·</span>
              <span class="mono">{{ school.active_students }}</span> students
            </div>
            <div class="group-school-cycles mono-tabular">{{ school.total_cycles.toLocaleString() }}</div>
          </div>
        </div>
      </Card>
    </section>

    <!-- Debug Panel (hidden) -->
    <section v-if="false" class="panel animate-in delay-4">
      <Card title="Debug Info" subtitle="God Mode state">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </template>
        <pre class="debug-output mono">{{ JSON.stringify(debugInfo, null, 2) }}</pre>
      </Card>
    </section>
  </div>
</template>

<style scoped>
/* ============================================================
 * FROSTWELL COURTYARD — local design tokens
 * ============================================================ */
.dashboard-view {
  --glass-bg: rgba(255, 255, 255, 0.62);
  --glass-bg-strong: rgba(255, 255, 255, 0.78);
  --glass-bg-hover: rgba(255, 255, 255, 0.82);
  --glass-border: rgba(255, 255, 255, 0.75);
  --glass-sheen: rgba(255, 255, 255, 0.95);
  --glass-shadow:
    0 1px 2px rgba(44, 38, 34, 0.06),
    0 6px 20px rgba(44, 38, 34, 0.08),
    0 22px 48px rgba(44, 38, 34, 0.07);
  --glass-shadow-hover:
    0 1px 2px rgba(44, 38, 34, 0.08),
    0 10px 28px rgba(44, 38, 34, 0.10),
    0 30px 60px rgba(44, 38, 34, 0.09);

  --tone-blue: 96, 165, 250;
  --tone-gold: 212, 168, 83;
  --tone-red: 217, 69, 69;
  --tone-green: 74, 222, 128;

  --ink-primary: #2C2622;
  --ink-secondary: #4A4440;
  --ink-muted: #8A8078;
  --ink-faint: #B5AEA6;

  position: relative;
  max-width: 1200px;
  padding-bottom: var(--space-16);
  /* Local fluid baseline */
  color: var(--ink-primary);
}

/* Atmosphere layer is now rendered once by SchoolsContainer via
 * AtmosphereBackdrop; DashboardView no longer carries its own. */

.dashboard-view > * {
  position: relative;
  z-index: 1;
}

/* ============================================================
 * BREADCRUMB
 * ============================================================ */
.breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-1);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
}

.breadcrumb-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--ssi-red);
  cursor: pointer;
  font: inherit;
  padding: 6px 10px 6px 8px;
  border-radius: var(--radius-full);
  transition: background var(--transition-base), border-color var(--transition-base);
}

.breadcrumb-link:hover {
  background: rgba(255, 255, 255, 0.6);
  border-color: var(--glass-border);
}

.breadcrumb-separator {
  color: var(--ink-faint);
}

.breadcrumb-current {
  color: var(--ink-primary);
  font-weight: var(--font-medium);
}

/* ============================================================
 * HERO IDENTITY
 * ============================================================ */
.hero {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-8);
  padding: clamp(var(--space-6), 4vw, var(--space-10)) clamp(var(--space-6), 4vw, var(--space-10));
  margin-bottom: var(--space-8);
  background: var(--glass-bg-strong);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 28px;
  box-shadow: var(--glass-shadow);
  overflow: hidden;
}

/* Inner sheen — top edge highlight */
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 35%);
  opacity: 0.7;
  mix-blend-mode: screen;
}

/* Subtle warm halo behind seal */
.hero::after {
  content: '';
  position: absolute;
  top: -40%;
  right: -12%;
  width: 60%;
  height: 180%;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    rgba(212, 168, 83, 0.18) 0%,
    rgba(212, 168, 83, 0.04) 35%,
    transparent 65%
  );
  filter: blur(8px);
}

.hero-text {
  position: relative;
  z-index: 2;
  min-width: 0;
}

.hero-eyebrow {
  display: inline-block;
  padding: 4px 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-secondary);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  margin-bottom: var(--space-4);
}

.hero-title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 3.8vw, 2.8rem);
  font-weight: var(--font-bold);
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: var(--ink-primary);
  margin: 0 0 var(--space-2) 0;
  /* Edge-lit text shimmer */
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
}

.hero-subtitle {
  font-size: var(--text-base);
  color: var(--ink-secondary);
  margin: 0;
  letter-spacing: 0.005em;
}

.hero-seal {
  position: relative;
  z-index: 2;
  width: 120px;
  height: 120px;
  flex-shrink: 0;
  filter: drop-shadow(0 10px 24px rgba(194, 58, 58, 0.28));
}

.hero-seal-ring {
  display: block;
  width: 100%;
  height: 100%;
  animation: sealBreathe 9s ease-in-out infinite;
}

@keyframes sealBreathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.018); }
}

.hero-seal-initials {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-weight: var(--font-bold);
  font-size: 2.1rem;
  letter-spacing: 0.01em;
  color: #fff;
  text-shadow: 0 1px 2px rgba(122, 30, 30, 0.5);
  pointer-events: none;
}

@media (max-width: 640px) {
  .hero {
    grid-template-columns: 1fr;
    gap: var(--space-5);
    padding: var(--space-6);
  }
  .hero-seal {
    width: 84px;
    height: 84px;
  }
  .hero-seal-initials {
    font-size: 1.4rem;
  }
}

/* ============================================================
 * SECTION TITLE
 * ============================================================ */
.section-title {
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--ink-primary);
  letter-spacing: 0.01em;
  margin: 0 0 var(--space-3) 4px;
  text-transform: none;
}

/* ============================================================
 * STATS AS GLASS STONES
 * ============================================================ */
.stones {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-8);
}

.stone {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--space-6);
  min-height: 140px;
  padding: var(--space-5) var(--space-5) var(--space-6);
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  box-shadow: var(--glass-shadow);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  transition:
    transform var(--transition-base),
    box-shadow var(--transition-base),
    background var(--transition-base);
}

/* Top inner sheen */
.stone::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, var(--glass-sheen) 0%, rgba(255,255,255,0) 42%);
  opacity: 0.55;
}

/* Belt-tone rim glow */
.stone::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    inset 0 0 0 1px rgba(var(--stone-tone), 0.18),
    0 0 0 1px rgba(var(--stone-tone), 0.05);
  transition: box-shadow var(--transition-base);
}

.stone[data-tone="blue"]  { --stone-tone: var(--tone-blue); }
.stone[data-tone="gold"]  { --stone-tone: var(--tone-gold); }
.stone[data-tone="red"]   { --stone-tone: var(--tone-red); }
.stone[data-tone="green"] { --stone-tone: var(--tone-green); }

.stone:hover {
  background: var(--glass-bg-hover);
  transform: translateY(-2px);
  box-shadow: var(--glass-shadow-hover);
}

.stone:hover::after {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 0 0 1px rgba(var(--stone-tone), 0.32),
    0 0 0 1px rgba(var(--stone-tone), 0.12),
    0 0 22px rgba(var(--stone-tone), 0.22);
}

.stone:focus-visible {
  outline: none;
}

.stone:focus-visible::after {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 0 0 2px rgba(var(--stone-tone), 0.55);
}

.stone-head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.stone-label {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--ink-secondary);
  letter-spacing: 0.005em;
  line-height: 1.2;
}

.stone-glyph {
  flex-shrink: 0;
  color: rgba(var(--stone-tone), 0.85);
  opacity: 0.85;
  transition: transform var(--transition-base);
}

.stone:hover .stone-glyph {
  transform: translateY(-1px) scale(1.04);
}

.stone-value {
  position: relative;
  z-index: 2;
  font-family: var(--font-display);
  font-size: clamp(2.1rem, 3.6vw, 2.6rem);
  font-weight: var(--font-bold);
  line-height: 1;
  color: var(--ink-primary);
  letter-spacing: -0.015em;
}

/* ============================================================
 * PANEL WRAPPER — shared frost cassette for Card-based sections
 * Restyles Card via :deep() to match the Frostwell look.
 * ============================================================ */
.panel {
  margin-bottom: var(--space-8);
}

.panel :deep(.card) {
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  box-shadow: var(--glass-shadow);
  overflow: hidden;
  position: relative;
}

.panel :deep(.card)::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, var(--glass-sheen) 0%, rgba(255,255,255,0) 30%);
  opacity: 0.45;
}

.panel :deep(.card) > * {
  position: relative;
  z-index: 1;
}

.panel :deep(.card-header) {
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
  padding: var(--space-4) var(--space-6);
  background: transparent;
}

.panel :deep(.card-title) {
  font-family: var(--font-display);
  font-size: var(--text-base);
  color: var(--ink-primary);
  letter-spacing: 0.005em;
}

.panel :deep(.card-subtitle) {
  color: var(--ink-muted);
  margin-top: 2px;
}

.panel :deep(.card-body) {
  padding: var(--space-5) var(--space-6) var(--space-6);
  background: transparent;
}

.panel :deep(.card-footer) {
  background: transparent;
  border-top: 1px solid rgba(44, 38, 34, 0.06);
}

/* ============================================================
 * TEACHER QUICK LAUNCH
 * ============================================================ */
.teacher-classes {
  margin-bottom: var(--space-8);
}

.teacher-class-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.teacher-class-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-4) var(--space-5);
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 18px;
  box-shadow: var(--glass-shadow);
  cursor: pointer;
  transition:
    transform var(--transition-base),
    box-shadow var(--transition-base),
    background var(--transition-base);
  text-align: left;
  width: 100%;
  color: inherit;
  font: inherit;
  overflow: hidden;
}

.teacher-class-row::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, var(--glass-sheen) 0%, rgba(255,255,255,0) 40%);
  opacity: 0.5;
}

.teacher-class-row > * {
  position: relative;
  z-index: 1;
}

.teacher-class-row:hover {
  background: var(--glass-bg-hover);
  transform: translateY(-1px);
  box-shadow: var(--glass-shadow-hover);
}

.teacher-class-mark {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(194, 58, 58, 0.12), rgba(212, 168, 83, 0.12));
  color: var(--ssi-red);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 0 0 1px rgba(194, 58, 58, 0.22);
  flex-shrink: 0;
  transition: transform var(--transition-base);
}

.teacher-class-row:hover .teacher-class-mark {
  transform: scale(1.05);
}

.teacher-class-info {
  flex: 1;
  min-width: 0;
}

.teacher-class-name {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--ink-primary);
  letter-spacing: -0.005em;
}

.teacher-class-course {
  display: block;
  font-size: var(--text-sm);
  color: var(--ink-muted);
  margin-top: 2px;
}

.teacher-class-meta {
  flex-shrink: 0;
}

.teacher-class-students {
  font-size: var(--text-sm);
  color: var(--ink-secondary);
}

.teacher-play-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px 9px 16px;
  background: linear-gradient(180deg, #d64545 0%, #b02e2e 100%);
  color: white;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  letter-spacing: 0.005em;
  white-space: nowrap;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    0 2px 8px rgba(194, 58, 58, 0.28);
  flex-shrink: 0;
  transition: box-shadow var(--transition-base);
}

.teacher-class-row:hover .teacher-play-btn {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    0 4px 14px rgba(194, 58, 58, 0.36);
}

.teacher-play-btn svg {
  transition: transform var(--transition-base);
}

.teacher-class-row:hover .teacher-play-btn svg {
  transform: translateX(2px);
}

.teacher-manage-link {
  margin-top: var(--space-4);
  text-align: center;
}

.teacher-manage-link a {
  color: var(--ink-muted);
  font-size: var(--text-sm);
  text-decoration: underline;
  text-decoration-color: rgba(138, 128, 120, 0.35);
  text-underline-offset: 3px;
  transition: color var(--transition-base), text-decoration-color var(--transition-base);
}

.teacher-manage-link a:hover {
  color: var(--ink-primary);
  text-decoration-color: rgba(138, 128, 120, 0.7);
}

/* ============================================================
 * EMPTY PANEL
 * ============================================================ */
.empty-panel {
  padding: var(--space-8);
  text-align: center;
  color: var(--ink-muted);
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  box-shadow: var(--glass-shadow);
  margin-bottom: var(--space-8);
}

.empty-panel p {
  margin: 0 0 var(--space-2);
}

.empty-panel-cta {
  display: inline-block;
  color: var(--ssi-red);
  font-weight: var(--font-semibold);
  text-decoration: none;
}

.empty-panel-cta:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ============================================================
 * COURSE LIST
 * ============================================================ */
.course-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.course-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.06);
  border-radius: 14px;
  transition: background var(--transition-base), border-color var(--transition-base);
}

.course-row:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(44, 38, 34, 0.12);
}

.course-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.course-name {
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
  color: var(--ink-primary);
}

.course-source {
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

.course-code {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  letter-spacing: 0.02em;
  flex-shrink: 0;
  padding: 2px 8px;
  background: rgba(44, 38, 34, 0.04);
  border-radius: var(--radius-full);
}

.course-empty {
  text-align: center;
  padding: var(--space-6);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.course-empty p {
  margin: 0;
}

/* ============================================================
 * SCHOOLS GRID (Govt Admin)
 * ============================================================ */
.schools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}

.school-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  background: rgba(255, 255, 255, 0.52);
  -webkit-backdrop-filter: blur(18px) saturate(170%);
  backdrop-filter: blur(18px) saturate(170%);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: 18px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  color: inherit;
  font: inherit;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.04);
  transition:
    transform var(--transition-base),
    background var(--transition-base),
    border-color var(--transition-base),
    box-shadow var(--transition-base);
  overflow: hidden;
}

.school-tile::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0) 30%);
  opacity: 0.55;
}

.school-tile > * {
  position: relative;
  z-index: 1;
}

.school-tile:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.78);
  border-color: rgba(194, 58, 58, 0.22);
  box-shadow:
    0 1px 2px rgba(44, 38, 34, 0.06),
    0 8px 24px rgba(44, 38, 34, 0.08),
    0 0 0 1px rgba(194, 58, 58, 0.08);
}

.school-tile-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.school-tile-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--ssi-red) 0%, var(--ssi-gold) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: var(--font-bold);
  font-size: var(--text-sm);
  letter-spacing: 0.02em;
  flex-shrink: 0;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 2px 6px rgba(194, 58, 58, 0.22);
}

.school-tile-info {
  flex: 1;
  min-width: 0;
}

.school-tile-info h4 {
  font-family: var(--font-display);
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
  color: var(--ink-primary);
  margin: 0 0 2px;
  letter-spacing: -0.005em;
}

.school-tile-meta {
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

.school-tile-meta .sep {
  margin: 0 4px;
  color: var(--ink-faint);
}

.school-tile-chevron {
  flex-shrink: 0;
  color: var(--ink-faint);
  opacity: 0;
  transform: translateX(-4px);
  transition: all var(--transition-base);
}

.school-tile:hover .school-tile-chevron {
  opacity: 1;
  transform: translateX(0);
  color: var(--ssi-red);
}

.school-tile-stats {
  display: flex;
  gap: var(--space-6);
  padding-top: var(--space-3);
  border-top: 1px solid rgba(44, 38, 34, 0.06);
}

.school-tile-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.school-tile-num {
  font-family: var(--font-display);
  font-weight: var(--font-bold);
  font-size: var(--text-lg);
  color: var(--ink-primary);
  letter-spacing: -0.01em;
}

.school-tile-label {
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

/* ============================================================
 * QUICK ACTIONS — iOS Control Center rail
 * ============================================================ */
.actions {
  margin-bottom: var(--space-8);
}

.actions-rail {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
}

.action-pill {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  text-decoration: none;
  color: var(--ink-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  letter-spacing: -0.005em;
  box-shadow: var(--glass-shadow);
  transition:
    transform var(--transition-base),
    background var(--transition-base),
    box-shadow var(--transition-base),
    border-color var(--transition-base);
  overflow: hidden;
}

.action-pill::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, var(--glass-sheen) 0%, rgba(255,255,255,0) 48%);
  opacity: 0.55;
}

.action-pill > * {
  position: relative;
  z-index: 1;
}

.action-pill:hover {
  transform: translateY(-2px);
  background: var(--glass-bg-hover);
  box-shadow: var(--glass-shadow-hover);
}

.action-pill-glyph {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 0 0 1px rgba(44, 38, 34, 0.06);
  color: var(--ink-secondary);
  flex-shrink: 0;
}

/* Primary action (Start Session) — red glass */
.action-pill--primary {
  background: linear-gradient(180deg, #d94545 0%, #a83232 100%);
  color: white;
  border-color: rgba(194, 58, 58, 0.35);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    0 2px 8px rgba(194, 58, 58, 0.28),
    0 12px 28px rgba(194, 58, 58, 0.18);
}

.action-pill--primary::before {
  background: linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 55%);
  opacity: 0.9;
}

.action-pill--primary:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    0 4px 14px rgba(194, 58, 58, 0.35),
    0 18px 40px rgba(194, 58, 58, 0.22);
}

.action-pill--primary .action-pill-glyph {
  background: rgba(255, 255, 255, 0.22);
  color: white;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}

/* ============================================================
 * CONTRIBUTION BANNER
 * ============================================================ */
.contribution {
  position: relative;
  padding: var(--space-6);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.74) 0%, rgba(253, 245, 226, 0.78) 100%);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  box-shadow: var(--glass-shadow);
  overflow: hidden;
}

.contribution::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, var(--glass-sheen) 0%, rgba(255,255,255,0) 30%);
  opacity: 0.55;
}

.contribution::after {
  content: '';
  position: absolute;
  top: -50%;
  right: -20%;
  width: 60%;
  height: 180%;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    rgba(212, 168, 83, 0.22) 0%,
    rgba(212, 168, 83, 0.06) 40%,
    transparent 70%
  );
  filter: blur(10px);
}

.contribution > * {
  position: relative;
  z-index: 1;
}

.contribution-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-base);
  color: var(--ink-secondary);
  margin-bottom: var(--space-5);
  letter-spacing: 0.005em;
}

.contribution-head svg {
  color: var(--ssi-gold-dark);
  flex-shrink: 0;
}

.contribution-head strong {
  color: var(--ink-primary);
  font-weight: var(--font-semibold);
}

.contribution-stats {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.contribution-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.contribution-value {
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 3vw, 2.25rem);
  font-weight: var(--font-bold);
  color: var(--ssi-gold-dark);
  line-height: 1;
  letter-spacing: -0.015em;
}

.contribution-label {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.09em;
}

.contribution-divider {
  width: 1px;
  height: 34px;
  background: linear-gradient(180deg, transparent, rgba(44, 38, 34, 0.15), transparent);
}

/* ============================================================
 * GROUP CYCLES LIST
 * ============================================================ */
.group-school-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.group-school-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.06);
  border-radius: 14px;
  transition: background var(--transition-base);
}

.group-school-row:hover {
  background: rgba(255, 255, 255, 0.8);
}

.group-school-name {
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
  color: var(--ink-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-school-meta {
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

.group-school-meta .sep {
  margin: 0 4px;
  color: var(--ink-faint);
}

.group-school-cycles {
  font-family: var(--font-display);
  font-weight: var(--font-bold);
  font-size: var(--text-lg);
  color: var(--ssi-gold-dark);
  min-width: 72px;
  text-align: right;
  letter-spacing: -0.01em;
}

/* ============================================================
 * DEBUG
 * ============================================================ */
.debug-output {
  background: rgba(44, 38, 34, 0.05);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow-x: auto;
  white-space: pre-wrap;
  color: var(--ink-secondary);
}

/* ============================================================
 * UTILITIES
 * ============================================================ */
.mono {
  font-family: var(--font-mono);
  font-size: 0.95em;
  letter-spacing: 0.01em;
}

.mono-tabular {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

/* ============================================================
 * FALLBACK — no backdrop-filter support
 * Firefox (pre-103) and old Safari get more opaque surfaces.
 * ============================================================ */
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .dashboard-view {
    --glass-bg: rgba(255, 255, 255, 0.96);
    --glass-bg-strong: rgba(255, 255, 255, 0.98);
    --glass-bg-hover: rgba(255, 255, 255, 0.99);
  }
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .hero-seal-ring {
    animation: none;
  }
  .stone,
  .action-pill,
  .teacher-class-row,
  .school-tile {
    transition: none;
  }
}

/* ============================================================
 * RESPONSIVE
 * ============================================================ */
@media (max-width: 1024px) {
  .stones {
    grid-template-columns: repeat(2, 1fr);
  }
  .actions-rail {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .stones {
    grid-template-columns: 1fr;
  }
  .actions-rail {
    grid-template-columns: 1fr;
  }
  .stone {
    min-height: auto;
  }
  .teacher-class-row {
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .teacher-class-meta {
    display: none;
  }
  .teacher-play-btn {
    width: 100%;
    justify-content: center;
    padding: 11px 16px;
  }
  .contribution-stats {
    gap: var(--space-4);
  }
  .group-school-row {
    grid-template-columns: 1fr auto;
  }
  .group-school-meta {
    grid-column: 1 / -1;
  }
}
</style>
