<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import ClassCard from '../components/ClassCard.vue'
import CreateClassModal from '../components/CreateClassModal.vue'
import { useGodMode } from '@/composables/useGodMode'
import { useClassesData } from '@/composables/useClassesData'

const router = useRouter()

// God Mode and data
const { selectedUser } = useGodMode()
const { classes: classesData, fetchClasses, isLoading } = useClassesData()

// Modal state
const isCreateModalOpen = ref(false)

// Search and filter state
const searchQuery = ref('')

// Transform classes data for ClassCard component
const classes = computed(() => {
  return classesData.value.map(c => ({
    id: c.id,
    class_name: c.class_name,
    course_code: c.course_code,
    student_count: c.student_count,
    current_seed: c.current_seed,
    sessions: 0, // Would need session count from analytics
    total_time: `${c.avg_practice_minutes}m avg`,
    student_join_code: c.student_join_code,
    last_played: 'N/A', // Would need last session timestamp
    last_played_recently: false,
    created_at: c.created_at
  }))
})

// Fetch data when user changes
onMounted(() => {
  if (selectedUser.value) {
    fetchClasses()
  }
})

watch(selectedUser, (newUser) => {
  if (newUser) {
    fetchClasses()
  }
})

// Filtered classes based on search
const filteredClasses = computed(() => {
  if (!searchQuery.value.trim()) {
    return classes.value
  }
  const query = searchQuery.value.toLowerCase()
  return classes.value.filter(cls =>
    cls.class_name.toLowerCase().includes(query) ||
    cls.course_code.toLowerCase().includes(query)
  )
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

const handleCreateClass = (newClass) => {
  classes.value.unshift({
    ...newClass,
    last_played: 'Never played',
    last_played_recently: false
  })
  closeCreateModal()
}

const handlePlayClass = (classData) => {
  // Store class context for player
  const activeClass = {
    id: classData.id,
    name: classData.class_name,
    course_code: classData.course_code,
    current_seed: classData.current_seed,
    timestamp: new Date().toISOString()
  }
  localStorage.setItem('ssi-active-class', JSON.stringify(activeClass))

  // Navigate to player with class context
  window.location.href = `/play?mode=class&class_id=${classData.id}`
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
    <!-- Background pattern -->
    <div class="bg-pattern" aria-hidden="true">
      <svg viewBox="0 0 400 400" class="pattern-svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="currentColor"
              stroke-width="0.5"
              opacity="0.08"
            />
          </pattern>
        </defs>
        <rect width="400" height="400" fill="url(#grid)" />
      </svg>
    </div>

    <!-- Header -->
    <header class="dashboard-header">
      <div class="header-content">
        <div class="header-text">
          <h1 class="page-title">
            <span class="title-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            My Classes
          </h1>
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
    <div class="search-section" v-if="hasClasses">
      <div class="search-box">
        <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="Search classes..."
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

    <!-- Create Class Modal -->
    <CreateClassModal
      :isOpen="isCreateModalOpen"
      @close="closeCreateModal"
      @create="handleCreateClass"
    />
  </div>
</template>

<style scoped>
.teacher-dashboard {
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
.dashboard-header {
  margin-bottom: 32px;
  position: relative;
  z-index: 1;
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
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0 0 8px 0;
}

.title-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, var(--ssi-red, #c23a3a), var(--ssi-red-dark, #9a2e2e));
  border-radius: 10px;
}

.title-icon svg {
  width: 22px;
  height: 22px;
  color: white;
}

.page-subtitle {
  font-size: 0.9375rem;
  color: var(--text-secondary, #b0b0b0);
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
  border-radius: 12px;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 48px;
}

.btn-create:hover {
  background: var(--ssi-red-light, #e54545);
  transform: translateY(-2px);
}

/* Search Section */
.search-section {
  margin-bottom: 24px;
  position: relative;
  z-index: 1;
}

.search-box {
  position: relative;
  max-width: 480px;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted, #707070);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 14px 44px 14px 48px;
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 12px;
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 0.9375rem;
  transition: all 0.2s ease;
  min-height: 48px;
}

.search-input::placeholder {
  color: var(--text-muted, #707070);
}

.search-input:focus {
  outline: none;
  border-color: var(--ssi-red, #c23a3a);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
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
  background: var(--bg-secondary, #1a1a1a);
  border: none;
  border-radius: 6px;
  color: var(--text-muted, #707070);
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
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 24px;
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
  background: var(--bg-card, #242424);
  border: 2px dashed var(--border-medium, rgba(255,255,255,0.15));
  border-radius: 20px;
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
  background: var(--bg-secondary, #1a1a1a);
  border-radius: 16px;
  margin-bottom: 24px;
}

.empty-icon svg {
  width: 32px;
  height: 32px;
  color: var(--text-muted, #707070);
}

.empty-title {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0 0 8px 0;
}

.empty-text {
  font-size: 0.9375rem;
  color: var(--text-secondary, #b0b0b0);
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
  border-radius: 12px;
  font-family: inherit;
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
  background: var(--ssi-red-light, #e54545);
  transform: translateY(-2px);
}

.btn-secondary {
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-medium, rgba(255,255,255,0.15));
  color: var(--text-primary, #ffffff);
}

.btn-secondary:hover {
  background: var(--bg-elevated, #333333);
  border-color: var(--ssi-red, #c23a3a);
}

/* Responsive */
@media (max-width: 768px) {
  .teacher-dashboard {
    padding: 20px;
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

  .classes-grid {
    grid-template-columns: 1fr;
  }

  .empty-state {
    padding: 48px 24px;
  }
}
</style>
