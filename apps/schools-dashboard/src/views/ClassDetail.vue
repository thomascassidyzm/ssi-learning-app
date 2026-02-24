<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useGodMode } from '@/composables/useGodMode'
import { useClassesData, type ClassReport } from '@/composables/useClassesData'

const router = useRouter()
const route = useRoute()

// God Mode and data
const { selectedUser } = useGodMode()
const { classDetail, fetchClassDetail, getClassReport } = useClassesData()

// Report data
const classReport = ref<ClassReport | null>(null)
const reportLoading = ref(false)

// Class data - derived from classDetail
const classData = computed(() => {
  if (classDetail.value) {
    return {
      id: classDetail.value.class_id,
      class_name: classDetail.value.class_name,
      course_code: classDetail.value.course_code,
      student_count: classDetail.value.students.length,
      current_seed: classDetail.value.current_seed || 1,
      student_join_code: classDetail.value.student_join_code || 'N/A'
    }
  }
  // Fallback to sessionStorage for backwards compatibility
  const stored = sessionStorage.getItem('ssi-class-detail')
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch (e) {
      return { id: '', class_name: '', course_code: '', student_count: 0, current_seed: 1, student_join_code: '' }
    }
  }
  return { id: '', class_name: '', course_code: '', student_count: 0, current_seed: 1, student_join_code: '' }
})

// Belt gradients for avatars
const beltGradients: Record<string, string> = {
  white: 'linear-gradient(135deg, #f5f5f5, #e0e0e0)',
  yellow: 'linear-gradient(135deg, #fbbf24, #d97706)',
  orange: 'linear-gradient(135deg, #f97316, #ea580c)',
  green: 'linear-gradient(135deg, #22c55e, #16a34a)',
  blue: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  brown: 'linear-gradient(135deg, #92400e, #78350f)',
  black: 'linear-gradient(135deg, #1f2937, #111827)'
}

const beltTextColors: Record<string, string> = {
  white: '#333',
  yellow: '#333',
  orange: '#fff',
  green: '#fff',
  blue: '#fff',
  brown: '#fff',
  black: '#fff'
}

// Get belt based on seeds completed
function getBelt(seedsCompleted: number): string {
  if (seedsCompleted >= 400) return 'black'
  if (seedsCompleted >= 280) return 'brown'
  if (seedsCompleted >= 150) return 'blue'
  if (seedsCompleted >= 80) return 'green'
  if (seedsCompleted >= 40) return 'orange'
  if (seedsCompleted >= 20) return 'yellow'
  return 'white'
}

// Get initials from name
function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// Format date for display
function formatJoinDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Transform students from classDetail
const students = computed(() => {
  if (!classDetail.value?.students) return []
  return classDetail.value.students.map(s => {
    const belt = getBelt(s.seeds_completed)
    return {
      id: s.learner_id,
      name: s.display_name,
      email: `${s.user_id.replace('user_2bre_', '')}@student.edu`,
      initials: getInitials(s.display_name),
      avatarColor: beltGradients[belt],
      textColor: beltTextColors[belt],
      joined_at: s.joined_at,
      joined_display: formatJoinDate(s.joined_at)
    }
  })
})

// Load report data
async function loadReport(classId: string) {
  reportLoading.value = true
  classReport.value = await getClassReport(classId)
  reportLoading.value = false
}

// Load class data on mount
onMounted(() => {
  const classId = route.params.id as string
  if (classId && selectedUser.value) {
    fetchClassDetail(classId)
    loadReport(classId)
  } else if (!classId) {
    const stored = sessionStorage.getItem('ssi-class-detail')
    if (!stored) {
      router.push({ name: 'classes' })
    }
  }
})

watch(selectedUser, (newUser) => {
  const classId = route.params.id as string
  if (newUser && classId) {
    fetchClassDetail(classId)
    loadReport(classId)
  }
})

// Copy state for join code
const copySuccess = ref(false)

// Search students
const searchQuery = ref('')

const filteredStudents = computed(() => {
  if (!searchQuery.value.trim()) {
    return students.value
  }
  const query = searchQuery.value.toLowerCase()
  return students.value.filter(s =>
    s.name.toLowerCase().includes(query) ||
    s.email.toLowerCase().includes(query)
  )
})

// Course info
const courseFlags = {
  'cym_for_eng': '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F',
  'cym_for_eng_north': '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F',
  'cym_for_eng_south': '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F',
  'spa_for_eng': '\uD83C\uDDEA\uD83C\uDDF8',
  'spa_for_eng_latam': '\uD83C\uDDEA\uD83C\uDDF8',
  'nld_for_eng': '\uD83C\uDDF3\uD83C\uDDF1',
  'cor_for_eng': '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F',
  'glv_for_eng': '\uD83C\uDDEE\uD83C\uDDF2'
}

const courseNames = {
  'cym_for_eng': 'Welsh',
  'cym_for_eng_north': 'Welsh (Northern)',
  'cym_for_eng_south': 'Welsh (Southern)',
  'spa_for_eng': 'Spanish',
  'spa_for_eng_latam': 'Spanish (Latin Am.)',
  'nld_for_eng': 'Dutch',
  'cor_for_eng': 'Cornish',
  'glv_for_eng': 'Manx'
}

const courseFlag = computed(() => {
  const code = classData.value.course_code as keyof typeof courseFlags
  return courseFlags[code] || '\uD83C\uDF10'
})

const courseName = computed(() => {
  const code = classData.value.course_code as keyof typeof courseNames
  return courseNames[code] || classData.value.course_code
})

// Handlers
const handleBack = () => {
  router.push({ name: 'classes' })
}

const handlePlay = () => {
  // Store class context for player
  const activeClass = {
    id: classData.value.id,
    name: classData.value.class_name,
    course_code: classData.value.course_code,
    current_seed: classData.value.current_seed,
    timestamp: new Date().toISOString()
  }
  localStorage.setItem('ssi-active-class', JSON.stringify(activeClass))
  window.location.href = `/play?mode=class&class_id=${classData.value.id}`
}

const copyJoinCode = async () => {
  try {
    await navigator.clipboard.writeText(classData.value.student_join_code)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

const handleRemoveStudent = (student: { id: string; name: string }) => {
  if (confirm(`Remove ${student.name} from this class?`)) {
    // TODO: Implement Supabase call to remove the class tag from the student
    console.log('Would remove student:', student.id, 'from class:', classData.value.id)
    // After removal, refetch the class detail
    // fetchClassDetail(classData.value.id)
  }
}
</script>

<template>
  <div class="class-detail">
    <!-- Background pattern -->
    <div class="bg-pattern" aria-hidden="true">
      <svg viewBox="0 0 400 400" class="pattern-svg">
        <defs>
          <pattern id="detail-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="currentColor"
              stroke-width="0.5"
              opacity="0.08"
            />
          </pattern>
        </defs>
        <rect width="400" height="400" fill="url(#detail-grid)" />
      </svg>
    </div>

    <!-- Header -->
    <header class="detail-header">
      <button class="btn-back" @click="handleBack">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
        <span>Back to Classes</span>
      </button>

      <div class="header-content">
        <div class="class-info">
          <h1 class="class-title">{{ classData.class_name }}</h1>
          <div class="class-meta">
            <span class="course-badge">
              <span class="course-flag">{{ courseFlag }}</span>
              {{ courseName }}
            </span>
            <span class="meta-divider"></span>
            <span class="student-count">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>
              </svg>
              {{ students.length }} students
            </span>
            <span class="meta-divider"></span>
            <span class="position-info">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Position {{ classData.current_seed || 1 }}
            </span>
          </div>
        </div>

        <button class="btn-play-main" @click="handlePlay">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>Play as Class</span>
        </button>
      </div>
    </header>

    <!-- Speaking Opportunities Report -->
    <section v-if="classReport" class="report-section">
      <!-- Hero Card -->
      <div class="report-hero">
        <div class="hero-main">
          <div class="hero-number">{{ classReport.class.total_cycles.toLocaleString() }}</div>
          <div class="hero-label">speaking opportunities</div>
        </div>
        <div class="hero-meta">
          <span class="hero-stat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {{ classReport.class.avg_cycles_per_session }} per session
          </span>
          <span class="meta-divider"></span>
          <span class="hero-stat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            {{ classReport.class.active_days_last_7 }} days active this week
          </span>
        </div>
      </div>

      <!-- Comparison Strip -->
      <div class="comparison-strip">
        <div class="comparison-item yours">
          <div class="comparison-label">Your class</div>
          <div class="comparison-value">{{ classReport.class.avg_cycles_per_session }}</div>
          <div class="comparison-unit">/session</div>
        </div>
        <div v-if="classReport.schoolAvg" class="comparison-item">
          <div class="comparison-label">School avg</div>
          <div class="comparison-value">{{ classReport.schoolAvg.avg_cycles_per_session }}</div>
          <div class="comparison-unit">/session</div>
        </div>
        <div v-if="classReport.regionAvg" class="comparison-item">
          <div class="comparison-label">Regional avg</div>
          <div class="comparison-value">{{ classReport.regionAvg.avg_cycles_per_session }}</div>
          <div class="comparison-unit">/session</div>
        </div>
        <div v-if="classReport.courseAvg" class="comparison-item">
          <div class="comparison-label">All classes</div>
          <div class="comparison-value">{{ classReport.courseAvg.avg_cycles_per_session }}</div>
          <div class="comparison-unit">/session</div>
        </div>
      </div>
    </section>

    <!-- Join Code Section -->
    <section class="join-code-section">
      <div class="join-code-card">
        <div class="join-code-header">
          <div class="join-code-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <div class="join-code-text">
            <h2>Student Join Code</h2>
            <p>Share this code with students to join your class</p>
          </div>
        </div>

        <div class="join-code-display">
          <span class="join-code">{{ classData.student_join_code }}</span>
          <button
            class="btn-copy"
            :class="{ copied: copySuccess }"
            @click="copyJoinCode"
          >
            <svg v-if="!copySuccess" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>{{ copySuccess ? 'Copied!' : 'Copy' }}</span>
          </button>
        </div>

        <div class="join-url">
          <span class="url-label">Or share this link:</span>
          <code class="url-code">ssi.app/join/{{ classData.student_join_code }}</code>
        </div>
      </div>
    </section>

    <!-- Student Roster -->
    <section class="roster-section">
      <div class="roster-header">
        <h2 class="roster-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Student Roster
        </h2>

        <div class="roster-search">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="Search students..."
          />
        </div>
      </div>

      <!-- Students Table -->
      <div class="roster-table-wrapper" v-if="filteredStudents.length > 0">
        <table class="roster-table">
          <thead>
            <tr>
              <th class="col-student">Student</th>
              <th class="col-joined">Joined</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <TransitionGroup name="table-row">
              <tr v-for="student in filteredStudents" :key="student.id">
                <td class="col-student">
                  <div class="student-cell">
                    <div
                      class="student-avatar"
                      :style="{
                        background: student.avatarColor,
                        color: student.textColor || 'white'
                      }"
                    >
                      {{ student.initials }}
                    </div>
                    <div class="student-info">
                      <span class="student-name">{{ student.name }}</span>
                      <span class="student-email">{{ student.email }}</span>
                    </div>
                  </div>
                </td>
                <td class="col-joined">
                  <span class="joined-date">{{ student.joined_display }}</span>
                </td>
                <td class="col-action">
                  <button
                    class="btn-remove"
                    @click="handleRemoveStudent(student)"
                    title="Remove from class"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </td>
              </tr>
            </TransitionGroup>
          </tbody>
        </table>
      </div>

      <!-- Empty state -->
      <div v-else class="roster-empty">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="17" y1="11" x2="23" y2="11"/>
          </svg>
        </div>
        <p v-if="searchQuery">No students match "{{ searchQuery }}"</p>
        <p v-else>No students have joined this class yet.<br/>Share the join code to get started.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.class-detail {
  min-height: calc(100vh - 64px - 64px); /* Account for nav and padding */
  position: relative;
}

/* Background pattern */
.bg-pattern {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.pattern-svg {
  width: 100%;
  height: 100%;
  color: var(--text-primary, #ffffff);
}

/* Header */
.detail-header {
  position: relative;
  z-index: 1;
  margin-bottom: 24px;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: transparent;
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 10px;
  color: var(--text-secondary, #b0b0b0);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 20px;
}

.btn-back:hover {
  background: var(--bg-card, #242424);
  border-color: var(--ssi-red, #c23a3a);
  color: var(--text-primary, #ffffff);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  flex-wrap: wrap;
}

.class-info {
  flex: 1;
  min-width: 280px;
}

.class-title {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0 0 12px 0;
}

.class-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.875rem;
  color: var(--text-secondary, #b0b0b0);
}

.course-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-card, #242424);
  border-radius: 8px;
  font-weight: 500;
}

.course-flag {
  font-size: 1rem;
}

.meta-divider {
  width: 4px;
  height: 4px;
  background: var(--text-muted, #707070);
  border-radius: 50%;
}

.student-count,
.position-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.student-count svg,
.position-info svg {
  opacity: 0.7;
}

.btn-play-main {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 28px;
  background: linear-gradient(135deg, var(--ssi-red, #c23a3a), var(--ssi-red-dark, #9a2e2e));
  color: white;
  border: none;
  border-radius: 14px;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 6px 20px rgba(194, 58, 58, 0.4);
  min-height: 52px;
}

.btn-play-main:hover {
  transform: translateY(-3px) scale(1.02);
  box-shadow: 0 8px 28px rgba(194, 58, 58, 0.5);
}

.btn-play-main:active {
  transform: translateY(0) scale(0.98);
}

.btn-play-main svg {
  width: 22px;
  height: 22px;
}

/* Report Section */
.report-section {
  position: relative;
  z-index: 1;
  margin-bottom: 32px;
}

.report-hero {
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 16px;
  border-left: 4px solid var(--ssi-red, #c23a3a);
}

.hero-main {
  margin-bottom: 16px;
}

.hero-number {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 3rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  line-height: 1;
}

.hero-label {
  font-size: 1.125rem;
  color: var(--text-secondary, #b0b0b0);
  margin-top: 4px;
}

.hero-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.875rem;
  color: var(--text-secondary, #b0b0b0);
}

.hero-stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hero-stat svg {
  opacity: 0.7;
}

.comparison-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.comparison-item {
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 12px;
  padding: 16px;
  text-align: center;
}

.comparison-item.yours {
  border-color: var(--ssi-red, #c23a3a);
  background: rgba(194, 58, 58, 0.08);
}

.comparison-label {
  font-size: 0.75rem;
  color: var(--text-muted, #707070);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.comparison-value {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  line-height: 1;
}

.comparison-unit {
  font-size: 0.75rem;
  color: var(--text-muted, #707070);
  margin-top: 4px;
}

/* Join Code Section */
.join-code-section {
  position: relative;
  z-index: 1;
  margin-bottom: 32px;
}

.join-code-card {
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 16px;
  padding: 24px;
  max-width: 560px;
}

.join-code-header {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
}

.join-code-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--ssi-red, #c23a3a), var(--ssi-gold, #d4a853));
  border-radius: 12px;
  flex-shrink: 0;
}

.join-code-icon svg {
  color: white;
}

.join-code-text h2 {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0 0 4px 0;
}

.join-code-text p {
  font-size: 0.875rem;
  color: var(--text-secondary, #b0b0b0);
  margin: 0;
}

.join-code-display {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: var(--bg-secondary, #1a1a1a);
  border: 2px dashed var(--border-medium, rgba(255,255,255,0.15));
  border-radius: 12px;
  margin-bottom: 16px;
}

.join-code {
  flex: 1;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--ssi-gold, #d4a853);
}

.btn-copy {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-medium, rgba(255,255,255,0.15));
  border-radius: 8px;
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 44px;
}

.btn-copy:hover {
  background: var(--bg-elevated, #333333);
  border-color: var(--ssi-red, #c23a3a);
}

.btn-copy.copied {
  background: rgba(74, 222, 128, 0.15);
  border-color: var(--success, #4ade80);
  color: var(--success, #4ade80);
}

.join-url {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-muted, #707070);
}

.url-code {
  padding: 4px 8px;
  background: var(--bg-secondary, #1a1a1a);
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--text-secondary, #b0b0b0);
}

/* Roster Section */
.roster-section {
  position: relative;
  z-index: 1;
}

.roster-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.roster-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0;
}

.roster-title svg {
  color: var(--ssi-gold, #d4a853);
}

.roster-search {
  position: relative;
  width: 280px;
}

.roster-search .search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted, #707070);
  pointer-events: none;
}

.roster-search .search-input {
  width: 100%;
  padding: 10px 12px 10px 38px;
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 10px;
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  min-height: 44px;
}

.roster-search .search-input::placeholder {
  color: var(--text-muted, #707070);
}

.roster-search .search-input:focus {
  outline: none;
  border-color: var(--ssi-red, #c23a3a);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

/* Roster Table */
.roster-table-wrapper {
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 16px;
  overflow: hidden;
}

.roster-table {
  width: 100%;
  border-collapse: collapse;
}

.roster-table th {
  text-align: left;
  padding: 14px 20px;
  background: var(--bg-secondary, #1a1a1a);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted, #707070);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
}

.roster-table td {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  vertical-align: middle;
}

.roster-table tr:last-child td {
  border-bottom: none;
}

.roster-table tr:hover td {
  background: var(--bg-secondary, #1a1a1a);
}

.col-student {
  width: 60%;
}

.col-joined {
  width: 25%;
}

.col-action {
  width: 15%;
  text-align: right;
}

.student-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.student-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.875rem;
  flex-shrink: 0;
}

.student-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.student-name {
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--text-primary, #ffffff);
}

.student-email {
  font-size: 0.8125rem;
  color: var(--text-muted, #707070);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.joined-date {
  font-size: 0.875rem;
  color: var(--text-secondary, #b0b0b0);
}

.btn-remove {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 8px;
  color: var(--text-muted, #707070);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-remove:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: var(--error, #ef4444);
  color: var(--error, #ef4444);
}

/* Table row transitions */
.table-row-enter-active,
.table-row-leave-active {
  transition: all 0.3s ease;
}

.table-row-enter-from,
.table-row-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* Empty State */
.roster-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
  background: var(--bg-card, #242424);
  border: 2px dashed var(--border-medium, rgba(255,255,255,0.15));
  border-radius: 16px;
  text-align: center;
}

.roster-empty .empty-icon {
  margin-bottom: 16px;
  color: var(--text-muted, #707070);
}

.roster-empty p {
  font-size: 0.9375rem;
  color: var(--text-secondary, #b0b0b0);
  line-height: 1.6;
  margin: 0;
}

/* Responsive */
@media (max-width: 768px) {
  .class-detail {
    padding: 16px;
  }

  .header-content {
    flex-direction: column;
  }

  .btn-play-main {
    width: 100%;
    justify-content: center;
  }

  .join-code {
    font-size: 1.25rem;
    letter-spacing: 2px;
  }

  .join-code-display {
    flex-direction: column;
    align-items: stretch;
    text-align: center;
  }

  .btn-copy {
    justify-content: center;
  }

  .roster-header {
    flex-direction: column;
    align-items: stretch;
  }

  .roster-search {
    width: 100%;
  }

  .roster-table th,
  .roster-table td {
    padding: 12px 16px;
  }

  .col-joined {
    display: none;
  }

  .col-student {
    width: 80%;
  }

  .col-action {
    width: 20%;
  }
}
</style>
