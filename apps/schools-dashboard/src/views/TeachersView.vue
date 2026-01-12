<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import JoinCodeBanner from '../components/JoinCodeBanner.vue'

interface Teacher {
  id: number
  name: string
  initials: string
  email: string
  course: string
  belt: string
  status: 'active' | 'inactive'
  classCount: number
  studentCount: number
  phrasesLearned: number
  engagementRate: number
  joinDate: string
}

// Mock data
const teacherJoinCode = ref('CYM-247')
const searchQuery = ref('')
const selectedCourse = ref('all')
const selectedBelt = ref('all')
const showAddModal = ref(false)

const teachers = ref<Teacher[]>([
  {
    id: 1,
    name: 'Sian Morgan',
    initials: 'SM',
    email: 'sian.morgan@ysgolcymraeg.edu',
    course: 'Welsh (Northern)',
    belt: 'black',
    status: 'active',
    classCount: 3,
    studentCount: 67,
    phrasesLearned: 2450,
    engagementRate: 92,
    joinDate: '2024-09-15'
  },
  {
    id: 2,
    name: 'Rhys Jones',
    initials: 'RJ',
    email: 'rhys.jones@ysgolcymraeg.edu',
    course: 'Welsh (Southern)',
    belt: 'blue',
    status: 'active',
    classCount: 2,
    studentCount: 48,
    phrasesLearned: 1820,
    engagementRate: 87,
    joinDate: '2024-10-02'
  },
  {
    id: 3,
    name: 'Elen Williams',
    initials: 'EW',
    email: 'elen.williams@ysgolcymraeg.edu',
    course: 'Welsh (Northern)',
    belt: 'yellow',
    status: 'active',
    classCount: 2,
    studentCount: 52,
    phrasesLearned: 980,
    engagementRate: 78,
    joinDate: '2024-11-20'
  },
  {
    id: 4,
    name: 'Dewi Pritchard',
    initials: 'DP',
    email: 'dewi.pritchard@ysgolcymraeg.edu',
    course: 'Welsh (Southern)',
    belt: 'green',
    status: 'inactive',
    classCount: 2,
    studentCount: 38,
    phrasesLearned: 1240,
    engagementRate: 65,
    joinDate: '2024-08-10'
  },
  {
    id: 5,
    name: 'Maria Garcia',
    initials: 'MG',
    email: 'maria.garcia@ysgolcymraeg.edu',
    course: 'Spanish (Latin Am)',
    belt: 'orange',
    status: 'active',
    classCount: 3,
    studentCount: 79,
    phrasesLearned: 1650,
    engagementRate: 88,
    joinDate: '2024-10-15'
  },
  {
    id: 6,
    name: 'Carys Thomas',
    initials: 'CT',
    email: 'carys.thomas@ysgolcymraeg.edu',
    course: 'Welsh (Northern)',
    belt: 'white',
    status: 'active',
    classCount: 1,
    studentCount: 18,
    phrasesLearned: 156,
    engagementRate: 95,
    joinDate: '2025-01-05'
  }
])

const courses = ['Welsh (Northern)', 'Welsh (Southern)', 'Spanish (Latin Am)']
const belts = ['white', 'yellow', 'orange', 'green', 'blue', 'brown', 'black']

const beltGradients: Record<string, string> = {
  white: 'linear-gradient(135deg, #f5f5f5, #e0e0e0)',
  yellow: 'linear-gradient(135deg, #fbbf24, #d97706)',
  orange: 'linear-gradient(135deg, #f97316, #ea580c)',
  green: 'linear-gradient(135deg, #22c55e, #16a34a)',
  blue: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  brown: 'linear-gradient(135deg, #92400e, #78350f)',
  black: 'linear-gradient(135deg, #1f2937, #111827)'
}

const beltColors: Record<string, string> = {
  white: '#333',
  yellow: '#333',
  orange: '#fff',
  green: '#fff',
  blue: '#fff',
  brown: '#fff',
  black: '#fff'
}

const filteredTeachers = computed(() => {
  return teachers.value.filter(teacher => {
    const matchesSearch = !searchQuery.value ||
      teacher.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      teacher.email.toLowerCase().includes(searchQuery.value.toLowerCase())

    const matchesCourse = selectedCourse.value === 'all' ||
      teacher.course === selectedCourse.value

    const matchesBelt = selectedBelt.value === 'all' ||
      teacher.belt === selectedBelt.value

    return matchesSearch && matchesCourse && matchesBelt
  })
})

const teacherCount = computed(() => teachers.value.length)

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

function handleCopyCode() {
  console.log('Code copied')
}

function handleRegenerateCode() {
  console.log('Regenerating code...')
}

function handleRemoveTeacher(teacherId: number) {
  if (confirm('Are you sure you want to remove this teacher from your school?')) {
    teachers.value = teachers.value.filter(t => t.id !== teacherId)
  }
}

function openAddModal() {
  showAddModal.value = true
}

function closeAddModal() {
  showAddModal.value = false
}

// Animation state
const isVisible = ref(false)
onMounted(() => {
  setTimeout(() => {
    isVisible.value = true
  }, 50)
})
</script>

<template>
  <div class="teachers-view" :class="{ 'is-visible': isVisible }">
    <div class="page-content">
      <!-- Page Header -->
      <header class="page-header animate-item" :class="{ 'show': isVisible }">
        <div class="page-title">
          <h1>Teachers</h1>
          <div class="teacher-count">
            <span class="count-value">{{ teacherCount }}</span> teachers
          </div>
        </div>
        <div class="header-actions">
          <button class="btn btn-secondary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export
          </button>
          <button class="btn btn-primary" @click="openAddModal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Teacher
          </button>
        </div>
      </header>

      <!-- Join Code Banner -->
      <div class="join-code-section animate-item delay-1" :class="{ 'show': isVisible }">
        <JoinCodeBanner
          :code="teacherJoinCode"
          label="Teacher Join Code"
          description="Share this code with teachers to let them join your school"
          variant="teacher"
          :can-regenerate="true"
          @copy="handleCopyCode"
          @regenerate="handleRegenerateCode"
        />
      </div>

      <!-- Filters Bar -->
      <div class="filters-bar animate-item delay-1" :class="{ 'show': isVisible }">
        <div class="search-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search teachers by name or email..."
          >
        </div>

        <div class="filter-dropdown">
          <select v-model="selectedCourse" class="filter-select">
            <option value="all">All Courses</option>
            <option v-for="course in courses" :key="course" :value="course">
              {{ course }}
            </option>
          </select>
        </div>

        <div class="filter-dropdown">
          <select v-model="selectedBelt" class="filter-select">
            <option value="all">All Belts</option>
            <option v-for="belt in belts" :key="belt" :value="belt">
              {{ belt.charAt(0).toUpperCase() + belt.slice(1) }} Belt
            </option>
          </select>
        </div>
      </div>

      <!-- Teachers Grid -->
      <div class="teachers-grid animate-item delay-2" :class="{ 'show': isVisible }">
        <div
          v-for="teacher in filteredTeachers"
          :key="teacher.id"
          class="teacher-card"
        >
          <!-- Card Header -->
          <div class="teacher-card-header">
            <div class="teacher-avatar-lg"
              :style="{
                background: beltGradients[teacher.belt],
                color: beltColors[teacher.belt]
              }"
            >
              {{ teacher.initials }}
              <span
                class="status-indicator"
                :class="teacher.status"
              ></span>
            </div>

            <div class="teacher-card-info">
              <div class="teacher-card-name">{{ teacher.name }}</div>
              <div class="teacher-card-email">{{ teacher.email }}</div>
              <div class="teacher-card-meta">
                <span class="meta-tag course">{{ teacher.course }}</span>
                <span class="meta-tag belt" :class="teacher.belt">
                  {{ teacher.belt.charAt(0).toUpperCase() + teacher.belt.slice(1) }} Belt
                </span>
              </div>
            </div>

            <div class="teacher-card-actions">
              <button class="action-btn" title="View Details">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
              <button class="action-btn" title="Edit">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button
                class="action-btn danger"
                title="Remove"
                @click="handleRemoveTeacher(teacher.id)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Stats Row -->
          <div class="teacher-card-stats">
            <div class="stat-mini">
              <div class="stat-mini-value">{{ teacher.classCount }}</div>
              <div class="stat-mini-label">Classes</div>
            </div>
            <div class="stat-mini">
              <div class="stat-mini-value">{{ teacher.studentCount }}</div>
              <div class="stat-mini-label">Students</div>
            </div>
            <div class="stat-mini">
              <div class="stat-mini-value">{{ teacher.phrasesLearned.toLocaleString() }}</div>
              <div class="stat-mini-label">Phrases</div>
            </div>
            <div class="stat-mini">
              <div class="stat-mini-value">{{ teacher.engagementRate }}%</div>
              <div class="stat-mini-label">Active</div>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="teacher-progress">
            <div class="progress-header">
              <span class="progress-label">Student Engagement</span>
              <span class="progress-value">{{ teacher.engagementRate }}%</span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{ width: `${teacher.engagementRate}%` }"
              ></div>
            </div>
          </div>

          <!-- Join Date -->
          <div class="teacher-join-date">
            Joined {{ formatDate(teacher.joinDate) }}
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="filteredTeachers.length === 0"
        class="empty-state animate-item delay-2"
        :class="{ 'show': isVisible }"
      >
        <div class="empty-icon">teacher</div>
        <h3>No teachers found</h3>
        <p v-if="searchQuery || selectedCourse !== 'all' || selectedBelt !== 'all'">
          Try adjusting your search or filters
        </p>
        <p v-else>
          Share your join code to invite teachers to your school
        </p>
      </div>
    </div>

    <!-- Add Teacher Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddModal" class="modal-overlay" @click.self="closeAddModal">
          <div class="modal">
            <div class="modal-header">
              <h2 class="modal-title">Add New Teacher</h2>
              <button class="modal-close" @click="closeAddModal">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Teacher's Name</label>
                <input type="text" class="form-input" placeholder="e.g., Sian Morgan">
              </div>
              <div class="form-group">
                <label class="form-label">Email Address</label>
                <input type="email" class="form-input" placeholder="e.g., sian.morgan@school.edu">
              </div>
              <div class="form-group">
                <label class="form-label">Course / Language</label>
                <select class="form-input form-select">
                  <option>Welsh (Northern)</option>
                  <option>Welsh (Southern)</option>
                  <option>Spanish (Latin American)</option>
                  <option>Spanish (Castilian)</option>
                  <option>Dutch</option>
                  <option>Cornish</option>
                  <option>Manx</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Department (Optional)</label>
                <input type="text" class="form-input" placeholder="e.g., Languages">
                <p class="form-hint">Help organize teachers by department</p>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" @click="closeAddModal">Cancel</button>
              <button class="btn btn-primary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Send Invitation
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ========== Layout ========== */
.teachers-view {
  min-height: 100vh;
  background: var(--bg-primary);
}

.page-content {
  padding: 32px;
  max-width: 1440px;
  margin: 0 auto;
}

/* ========== Header ========== */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title h1 {
  font-family: 'Noto Sans JP', system-ui, sans-serif;
  font-size: 30px;
  font-weight: 700;
  color: var(--text-primary);
}

.teacher-count {
  background: var(--bg-card);
  padding: 8px 16px;
  border-radius: 24px;
  font-size: 14px;
  color: var(--text-secondary);
}

.teacher-count .count-value {
  color: var(--ssi-gold);
  font-weight: 700;
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* ========== Buttons ========== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 22px;
  border-radius: 12px;
  border: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-primary {
  background: var(--ssi-red);
  color: white;
}

.btn-primary:hover {
  background: var(--ssi-red-light);
  box-shadow: 0 0 32px rgba(194, 58, 58, 0.35);
  transform: translateY(-2px);
}

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
}

.btn-secondary:hover {
  background: var(--bg-elevated);
  border-color: var(--ssi-red);
}

/* ========== Join Code Section ========== */
.join-code-section {
  margin-bottom: 28px;
}

/* ========== Filters ========== */
.filters-bar {
  display: flex;
  gap: 16px;
  margin-bottom: 28px;
}

.search-box {
  flex: 1;
  position: relative;
}

.search-box svg {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.search-box input {
  width: 100%;
  padding: 14px 16px 14px 50px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  transition: all 0.2s ease;
}

.search-box input::placeholder {
  color: var(--text-muted);
}

.search-box input:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

.filter-dropdown {
  position: relative;
}

.filter-select {
  appearance: none;
  padding: 14px 44px 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23707070' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
}

.filter-select:hover {
  border-color: var(--border-medium);
}

.filter-select:focus {
  outline: none;
  border-color: var(--ssi-red);
}

/* ========== Teachers Grid ========== */
.teachers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 24px;
}

/* ========== Teacher Card ========== */
.teacher-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  padding: 24px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.teacher-card:hover {
  transform: translateY(-6px);
  border-color: var(--border-medium);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
}

.teacher-card-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.teacher-avatar-lg {
  width: 68px;
  height: 68px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 24px;
  position: relative;
  flex-shrink: 0;
}

.status-indicator {
  position: absolute;
  bottom: -3px;
  right: -3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 3px solid var(--bg-card);
}

.status-indicator.active { background: var(--success); }
.status-indicator.inactive { background: var(--text-muted); }

.teacher-card-info {
  flex: 1;
  min-width: 0;
}

.teacher-card-name {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.teacher-card-email {
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 10px;
}

.teacher-card-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.meta-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
}

.meta-tag.course {
  background: rgba(194, 58, 58, 0.12);
  color: var(--ssi-red-light);
}

.meta-tag.belt {
  font-weight: 600;
}

.meta-tag.belt.white { background: rgba(255,255,255,0.1); color: #f5f5f5; }
.meta-tag.belt.yellow { background: rgba(251,191,36,0.15); color: #fbbf24; }
.meta-tag.belt.orange { background: rgba(249,115,22,0.15); color: #f97316; }
.meta-tag.belt.green { background: rgba(34,197,94,0.15); color: #22c55e; }
.meta-tag.belt.blue { background: rgba(59,130,246,0.15); color: #3b82f6; }
.meta-tag.belt.brown { background: rgba(146,64,14,0.15); color: #b45309; }
.meta-tag.belt.black { background: rgba(31,41,55,0.5); color: #9ca3af; border: 1px solid #374151; }

.teacher-card-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: var(--ssi-red);
  border-color: var(--ssi-red);
  color: white;
}

.action-btn.danger:hover {
  background: var(--error);
  border-color: var(--error);
}

/* Stats Row */
.teacher-card-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 20px 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.stat-mini {
  text-align: center;
}

.stat-mini-value {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-mini-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Progress Bar */
.teacher-progress {
  margin-top: 18px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
}

.progress-label { color: var(--text-secondary); }
.progress-value { color: var(--ssi-gold); font-weight: 600; }

.progress-track {
  height: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ssi-red) 0%, var(--ssi-gold) 100%);
  border-radius: 4px;
  transition: width 0.5s ease;
}

.teacher-join-date {
  margin-top: 14px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
}

/* ========== Empty State ========== */
.empty-state {
  text-align: center;
  padding: 80px 20px;
}

.empty-icon {
  font-size: 72px;
  margin-bottom: 20px;
  opacity: 0.25;
}

.empty-state h3 {
  font-size: 20px;
  margin-bottom: 10px;
  color: var(--text-primary);
}

.empty-state p {
  color: var(--text-secondary);
}

/* ========== Modal ========== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 20px;
}

.modal {
  background: var(--bg-card);
  border: 1px solid var(--border-medium);
  border-radius: 22px;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  padding: 24px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: var(--error);
  color: white;
}

.modal-body {
  padding: 24px;
}

.form-group {
  margin-bottom: 22px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-input {
  width: 100%;
  padding: 14px 18px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  transition: all 0.2s ease;
}

.form-input::placeholder {
  color: var(--text-muted);
}

.form-input:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

.form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23707070' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;
  padding-right: 50px;
  cursor: pointer;
}

.form-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.modal-footer {
  padding: 24px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

/* Modal Transition */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: translateY(20px) scale(0.95);
}

/* ========== Animations ========== */
.animate-item {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.animate-item.show {
  opacity: 1;
  transform: translateY(0);
}

.animate-item.delay-1 { transition-delay: 0.1s; }
.animate-item.delay-2 { transition-delay: 0.2s; }

/* ========== Responsive ========== */
@media (max-width: 900px) {
  .teachers-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .page-content {
    padding: 20px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 20px;
  }

  .filters-bar {
    flex-direction: column;
  }

  .teacher-card-header {
    flex-wrap: wrap;
  }

  .teacher-card-actions {
    width: 100%;
    justify-content: flex-end;
    margin-top: 12px;
  }
}
</style>
