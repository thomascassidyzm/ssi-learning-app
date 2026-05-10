<script setup lang="ts">
import { ref, computed, onMounted, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import ClassCard from '@/components/schools/ClassCard.vue'
import CreateClassModal from '@/components/schools/CreateClassModal.vue'
import ClassCreatedModal from '@/components/schools/ClassCreatedModal.vue'
import { useGodMode } from '@/composables/schools/useGodMode'
import { useClassesData } from '@/composables/schools/useClassesData'
import { getLanguageName } from '@/composables/useI18n'

const router = useRouter()

// God Mode and data
const { selectedUser } = useGodMode()
const { classes: classesData, fetchClasses, createClass, getClassReport, isLoading } = useClassesData()

// Modal state
const isCreateModalOpen = ref(false)
const createdClass = ref(null)
const isCreatedModalOpen = ref(false)

// Search and filter state
const searchQuery = ref('')

// Benchmark reports stored by class ID
const classReports = reactive(new Map())

// Fetch benchmark reports in background (non-blocking)
async function fetchReportsForClasses() {
  for (const cls of classesData.value) {
    try {
      const report = await getClassReport(cls.id)
      if (report) {
        classReports.set(cls.id, report)
      }
    } catch (err) {
      // Silently skip — benchmark is optional enhancement
    }
  }
}

// Transform classes data for ClassCard component, merging benchmark data
const classes = computed(() => {
  return classesData.value.map(c => {
    const report = classReports.get(c.id)
    return {
      id: c.id,
      class_name: c.class_name,
      course_code: c.course_code,
      student_count: c.student_count,
      current_seed: c.current_seed,
      student_join_code: c.student_join_code,
      last_lego_id: c.last_lego_id,
      created_at: c.created_at,
      // Benchmark data from report (may be undefined if not yet loaded)
      total_cycles: report?.class?.total_cycles ?? 0,
      total_sessions: report?.class?.total_sessions ?? 0,
      total_practice_seconds: report?.class?.total_practice_seconds ?? 0,
      avg_cycles_per_session: report?.class?.avg_cycles_per_session ?? 0,
      school_avg_cycles: report?.schoolAvg?.avg_total_cycles ?? 0,
      group_avg_cycles: report?.groupAvg?.avg_total_cycles ?? 0,
      course_avg_cycles: report?.courseAvg?.avg_total_cycles ?? 0,
    }
  })
})

// Fetch data when user changes
onMounted(async () => {
  if (selectedUser.value) {
    await fetchClasses()
    fetchReportsForClasses()
  }
})

watch(selectedUser, async (newUser) => {
  if (newUser) {
    classReports.clear()
    await fetchClasses()
    fetchReportsForClasses()
  }
})

// Also re-fetch reports when classesData changes (e.g. after creating a class)
watch(classesData, () => {
  fetchReportsForClasses()
})

// Filtered classes based on search
const filteredClasses = computed(() => {
  if (!searchQuery.value.trim()) {
    return classes.value
  }
  const query = searchQuery.value.toLowerCase()
  return classes.value.filter(cls => {
    const match = cls.course_code?.match(/^([a-z_]+?)_for_/)
    const langName = match ? getLanguageName(match[1]).toLowerCase() : ''
    return cls.class_name.toLowerCase().includes(query) ||
      cls.course_code.toLowerCase().includes(query) ||
      langName.includes(query)
  })
})

// Empty state check
const hasClasses = computed(() => classes.value.length > 0)
const hasFilteredClasses = computed(() => filteredClasses.value.length > 0)

// Handlers
const openCreateModal = () => {
  isCreateModalOpen.value = true
}

const closeCreateModal = () => {
  isCreateModalOpen.value = false
}

const createClassError = ref<string | null>(null)

const handleCreateClass = async (params) => {
  createClassError.value = null
  const schoolId = selectedUser.value?.school_id
  if (!schoolId) {
    createClassError.value = 'No school found for your account. Please contact an administrator.'
    return
  }
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
}

const handleGoToCreatedClass = () => {
  if (createdClass.value) {
    isCreatedModalOpen.value = false
    sessionStorage.setItem('ssi-class-detail', JSON.stringify(createdClass.value))
    router.push({ name: 'class-detail', params: { id: createdClass.value.id } })
  }
}

const closeCreatedModal = () => {
  isCreatedModalOpen.value = false
  createdClass.value = null
}

const handlePlayClass = (classData) => {
  // Store class context for player
  const activeClass = {
    id: classData.id,
    name: classData.class_name,
    course_code: classData.course_code,
    current_seed: classData.current_seed,
    last_lego_id: classData.last_lego_id,
    teacherUserId: selectedUser.value?.user_id,
    timestamp: new Date().toISOString()
  }
  localStorage.setItem('ssi-active-class', JSON.stringify(activeClass))

  // Navigate to player with class context (in-app, no reload)
  router.push({ path: '/', query: { class: classData.id } })
}

const handleViewRoster = (classData) => {
  // Store class data for detail view (in production would be fetched from Supabase)
  sessionStorage.setItem('ssi-class-detail', JSON.stringify(classData))
  router.push({ name: 'class-detail', params: { id: classData.id } })
}

const handleClassSettings = (classData) => {
  // Would open settings for this class
  console.log('Settings for:', classData.class_name)
}
</script>

<template>
  <div class="teacher-dashboard">
    <!-- Header -->
    <header class="page-header">
      <div class="header-content">
        <div class="header-text">
          <h1 class="page-title">My Classes</h1>
          <p class="page-subtitle">
            Manage your classes and start learning sessions
          </p>
        </div>

        <div class="header-actions">
          <button class="btn-create" @click="openCreateModal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>Create Class</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Search Bar -->
    <div class="search-bar" v-if="hasClasses">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search by class name or language..."
      />
      <button
        v-if="searchQuery"
        class="search-clear"
        @click="searchQuery = ''"
        aria-label="Clear search"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Classes Grid -->
    <main class="classes-content">
      <!-- Has classes -->
      <div v-if="hasClasses && hasFilteredClasses" class="classes-grid">
        <TransitionGroup name="card-list">
          <ClassCard
            v-for="cls in filteredClasses"
            :key="cls.id"
            :classData="cls"
            @play="handlePlayClass"
            @viewRoster="handleViewRoster"
            @settings="handleClassSettings"
          />
        </TransitionGroup>
      </div>

      <!-- No search results -->
      <div v-else-if="hasClasses && !hasFilteredClasses" class="empty-state empty-search">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
        </div>
        <h3 class="empty-title">No classes found</h3>
        <p class="empty-text">
          No classes match "{{ searchQuery }}"
        </p>
        <button class="btn-secondary" @click="searchQuery = ''">
          Clear search
        </button>
      </div>

      <!-- Empty state - no classes -->
      <div v-else class="empty-state">
        <div class="empty-illustration">
          <svg viewBox="0 0 200 160" fill="none">
            <!-- Chalkboard frame -->
            <rect x="30" y="20" width="140" height="100" rx="4" fill="#1a1a1a" stroke="#333" stroke-width="2"/>
            <!-- Inner board -->
            <rect x="40" y="30" width="120" height="80" rx="2" fill="#0d4a2c"/>
            <!-- Chalk marks -->
            <path d="M50 50 L100 50" stroke="#a8d5ba" stroke-width="2" stroke-linecap="round"/>
            <path d="M50 65 L90 65" stroke="#a8d5ba" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
            <path d="M50 80 L110 80" stroke="#a8d5ba" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
            <!-- Stand -->
            <path d="M100 120 L100 150" stroke="#666" stroke-width="4"/>
            <path d="M70 150 L130 150" stroke="#666" stroke-width="4" stroke-linecap="round"/>
            <!-- Decorative -->
            <circle cx="145" cy="45" r="8" fill="#c23a3a" opacity="0.8"/>
            <circle cx="55" cy="95" r="5" fill="#d4a853" opacity="0.6"/>
          </svg>
        </div>
        <h3 class="empty-title">No classes yet</h3>
        <p class="empty-text">
          Create your first class to start teaching with SSi. Students will be able to join using a unique code.
        </p>
        <button class="btn-primary" @click="openCreateModal">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Create Your First Class
        </button>
      </div>
    </main>

    <!-- Create Class Error -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="createClassError" class="error-toast" @click="createClassError = null">
          {{ createClassError }}
        </div>
      </Transition>
    </Teleport>

    <!-- Create Class Modal -->
    <CreateClassModal
      :isOpen="isCreateModalOpen"
      @close="closeCreateModal"
      @create="handleCreateClass"
    />

    <!-- Class Created Success Modal -->
    <ClassCreatedModal
      :isOpen="isCreatedModalOpen"
      :classData="createdClass"
      @close="closeCreatedModal"
      @goToClass="handleGoToCreatedClass"
    />
  </div>
</template>

<style scoped>
.error-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(220, 38, 38, 0.95);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 0.875rem;
  cursor: pointer;
  z-index: 10000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.teacher-dashboard {
  min-height: calc(100vh - 64px - 64px);
  position: relative;
  max-width: 1120px;
  margin: 0 auto;
  padding: 40px 32px 80px;
}

/* Header */
.page-header {
  margin-bottom: 36px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  flex-wrap: wrap;
}

.header-text {
  flex: 1;
  min-width: 280px;
}

.page-title {
  font-family: var(--font-display, 'Fraunces', serif);
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-style: italic;
  margin: 0 0 6px 0;
}

.page-subtitle {
  font-size: 0.9375rem;
  color: var(--text-muted, #8A8078);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.btn-create {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--ssi-red, #c23a3a);
  color: white;
  border: none;
  border-radius: var(--radius-md, 14px);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 48px;
}

.btn-create:hover {
  background: var(--ssi-red-hover, #a83232);
  transform: translateY(-1px);
}

/* Search Bar */
.search-bar {
  position: relative;
  margin-bottom: 32px;
}

.search-bar > svg {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-faint, #b5aea6);
  pointer-events: none;
}

.search-bar input {
  width: 100%;
  padding: 14px 44px 14px 48px;
  border: 1px solid var(--border-subtle, rgba(44, 38, 34, 0.06));
  border-radius: var(--radius-md, 14px);
  background: var(--bg-card, #ffffff);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 0.9375rem;
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-bar input::placeholder {
  color: var(--text-faint, #b5aea6);
}

.search-bar input:focus {
  border-color: var(--ssi-red, #c23a3a);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.1);
}

.search-clear {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary, #ece7e1);
  border: none;
  border-radius: 6px;
  color: var(--text-muted, #8A8078);
  cursor: pointer;
  transition: all 0.2s ease;
}

.search-clear:hover {
  background: var(--ssi-red, #c23a3a);
  color: white;
}

/* Classes Content */
.classes-content {
  position: relative;
  z-index: 1;
}

.classes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
  gap: 20px;
}

/* Card list transitions */
.card-list-enter-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-list-leave-active {
  transition: all 0.3s ease-in;
  position: absolute;
}

.card-list-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.card-list-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}

.card-list-move {
  transition: transform 0.4s ease;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 80px 40px;
  background: var(--bg-card, #ffffff);
  border: 2px dashed var(--border-medium, rgba(44, 38, 34, 0.10));
  border-radius: var(--radius-lg, 20px);
  max-width: 560px;
  margin: 0 auto;
}

.empty-illustration {
  margin-bottom: 24px;
}

.empty-illustration svg {
  width: 160px;
  height: auto;
}

.empty-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary, #ece7e1);
  border-radius: 16px;
  margin-bottom: 24px;
}

.empty-icon svg {
  width: 32px;
  height: 32px;
  color: var(--text-muted, #8A8078);
}

.empty-title {
  font-family: var(--font-display, 'Fraunces', serif);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.empty-text {
  font-size: 0.9375rem;
  color: var(--text-secondary, #5a524a);
  margin: 0 0 24px 0;
  max-width: 360px;
  line-height: 1.6;
}

.btn-primary,
.btn-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 24px;
  border-radius: var(--radius-md, 14px);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 48px;
}

.btn-primary {
  background: var(--ssi-red, #c23a3a);
  border: none;
  color: white;
}

.btn-primary:hover {
  background: var(--ssi-red-hover, #a83232);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--bg-secondary, #ece7e1);
  border: 1px solid var(--border-medium, rgba(44, 38, 34, 0.10));
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-card, #ffffff);
  border-color: var(--ssi-red, #c23a3a);
}

/* Responsive */
@media (max-width: 768px) {
  .teacher-dashboard {
    padding: 24px 16px 60px;
  }

  .header-content {
    flex-direction: column;
    align-items: stretch;
  }

  .header-actions {
    width: 100%;
  }

  .btn-create {
    width: 100%;
    justify-content: center;
  }

  .page-title {
    font-size: 1.6rem;
  }

  .classes-grid {
    grid-template-columns: 1fr;
  }

  .empty-state {
    padding: 48px 24px;
  }
}

@media (min-width: 769px) and (max-width: 960px) {
  .classes-grid {
    grid-template-columns: 1fr;
    max-width: 560px;
  }
}
</style>
