<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import SearchBox from '@/components/shared/SearchBox.vue'
import FilterDropdown from '@/components/shared/FilterDropdown.vue'
import Badge from '@/components/shared/Badge.vue'
import Button from '@/components/shared/Button.vue'
import { useGodMode } from '@/composables/useGodMode'
import { useStudentsData } from '@/composables/useStudentsData'

// God Mode and data
const { selectedUser } = useGodMode()
const { students: studentsData, fetchStudents } = useStudentsData()

// Filters
const searchQuery = ref('')
const selectedClass = ref<string | null>(null)
const selectedBelt = ref<string | null>(null)

// Get belt based on seeds completed (rough approximation)
function getBelt(seedsCompleted: number): 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'brown' | 'black' {
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

// Format last active
function formatLastActive(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return `${Math.floor(diffDays / 30)} months ago`
}

// Transform students data for display
const students = computed(() => {
  return studentsData.value.map((s, idx) => ({
    id: idx + 1,
    name: s.display_name,
    initials: getInitials(s.display_name),
    email: `${s.user_id}@student.edu`,
    class: s.class_name,
    belt: getBelt(s.seeds_completed),
    phrasesLearned: s.legos_mastered * 3, // Rough estimate
    sessionsCompleted: Math.ceil(s.total_practice_minutes / 20),
    lastActive: formatLastActive(s.last_active_at),
    progress: Math.min(100, Math.round((s.seeds_completed / 50) * 100))
  }))
})

// Build class options from actual classes
const classOptions = computed(() => {
  const uniqueClasses = [...new Set(studentsData.value.map(s => s.class_name))]
  return uniqueClasses.map(c => ({ value: c, label: c }))
})

const beltOptions = [
  { value: 'white', label: 'White Belt' },
  { value: 'yellow', label: 'Yellow Belt' },
  { value: 'orange', label: 'Orange Belt' },
  { value: 'green', label: 'Green Belt' },
  { value: 'blue', label: 'Blue Belt' },
  { value: 'brown', label: 'Brown Belt' },
  { value: 'black', label: 'Black Belt' },
]

const filteredStudents = computed(() => {
  return students.value.filter(student => {
    const matchesSearch = !searchQuery.value ||
      student.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      student.email.toLowerCase().includes(searchQuery.value.toLowerCase())

    const matchesClass = !selectedClass.value || student.class === selectedClass.value
    const matchesBelt = !selectedBelt.value || student.belt === selectedBelt.value

    return matchesSearch && matchesClass && matchesBelt
  })
})

const totalStudents = computed(() => students.value.length)

// Animation
const isVisible = ref(false)
onMounted(() => {
  setTimeout(() => { isVisible.value = true }, 50)
  if (selectedUser.value) {
    fetchStudents()
  }
})

watch(selectedUser, (newUser) => {
  if (newUser) {
    fetchStudents()
  }
})
</script>

<template>
  <div class="students-view" :class="{ 'is-visible': isVisible }">
    <!-- Page Header -->
    <header class="page-header animate-item" :class="{ 'show': isVisible }">
      <div class="page-title">
        <h1>Students</h1>
        <div class="student-count">
          <span class="count-value">{{ totalStudents }}</span> students enrolled
        </div>
      </div>
      <div class="header-actions">
        <Button variant="secondary">
          <template #icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </template>
          Export
        </Button>
        <Button variant="primary">
          <template #icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </template>
          Add Student
        </Button>
      </div>
    </header>

    <!-- Filters Bar -->
    <div class="filters-bar animate-item delay-1" :class="{ 'show': isVisible }">
      <SearchBox
        v-model="searchQuery"
        placeholder="Search students by name or email..."
        block
      />
      <FilterDropdown
        v-model="selectedClass"
        :options="classOptions"
        placeholder="All Classes"
      />
      <FilterDropdown
        v-model="selectedBelt"
        :options="beltOptions"
        placeholder="All Belts"
      />
    </div>

    <!-- Students Table -->
    <div class="students-table-container animate-item delay-2" :class="{ 'show': isVisible }">
      <table class="students-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Class</th>
            <th>Belt</th>
            <th>Progress</th>
            <th>Phrases</th>
            <th>Sessions</th>
            <th>Last Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="student in filteredStudents" :key="student.id">
            <td>
              <div class="student-cell">
                <div class="student-avatar">{{ student.initials }}</div>
                <div class="student-info">
                  <div class="student-name">{{ student.name }}</div>
                  <div class="student-email">{{ student.email }}</div>
                </div>
              </div>
            </td>
            <td>{{ student.class }}</td>
            <td>
              <Badge :belt="student.belt" size="sm">
                {{ student.belt.charAt(0).toUpperCase() + student.belt.slice(1) }}
              </Badge>
            </td>
            <td>
              <div class="progress-cell">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: `${student.progress}%` }"></div>
                </div>
                <span class="progress-value">{{ student.progress }}%</span>
              </div>
            </td>
            <td class="text-gold">{{ student.phrasesLearned.toLocaleString() }}</td>
            <td>{{ student.sessionsCompleted }}</td>
            <td class="text-muted">{{ student.lastActive }}</td>
            <td>
              <button class="action-btn" title="View Details">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="1"/>
                  <circle cx="19" cy="12" r="1"/>
                  <circle cx="5" cy="12" r="1"/>
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty State -->
    <div v-if="filteredStudents.length === 0" class="empty-state">
      <div class="empty-icon">students</div>
      <h3>No students found</h3>
      <p>Try adjusting your search or filters</p>
    </div>
  </div>
</template>

<style scoped>
.students-view {
  max-width: 1400px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-8);
}

.page-title {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.page-title h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
}

.student-count {
  background: var(--bg-card);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.student-count .count-value {
  color: var(--ssi-gold);
  font-weight: var(--font-bold);
}

.header-actions {
  display: flex;
  gap: var(--space-3);
}

/* Filters */
.filters-bar {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.filters-bar > :first-child {
  flex: 1;
}

/* Table */
.students-table-container {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.students-table {
  width: 100%;
  border-collapse: collapse;
}

.students-table th {
  text-align: left;
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
}

.students-table td {
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.students-table tr:last-child td {
  border-bottom: none;
}

.students-table tr:hover {
  background: var(--bg-card-hover);
}

/* Student Cell */
.student-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.student-avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-gold));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold);
  font-size: var(--text-sm);
  color: white;
}

.student-name {
  font-weight: var(--font-semibold);
}

.student-email {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* Progress Cell */
.progress-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.progress-bar {
  width: 80px;
  height: 6px;
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-full);
  transition: width 0.5s ease;
}

.progress-value {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  min-width: 40px;
}

/* Text Colors */
.text-gold {
  color: var(--ssi-gold);
  font-weight: var(--font-semibold);
}

.text-muted {
  color: var(--text-muted);
}

/* Action Button */
.action-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-base);
}

.action-btn:hover {
  background: var(--ssi-red);
  border-color: var(--ssi-red);
  color: white;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: var(--space-20);
}

.empty-icon {
  font-size: 4rem;
  opacity: 0.25;
  margin-bottom: var(--space-5);
}

.empty-state h3 {
  font-size: var(--text-xl);
  margin-bottom: var(--space-2);
}

.empty-state p {
  color: var(--text-secondary);
}

/* Animations */
.animate-item {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.animate-item.show {
  opacity: 1;
  transform: translateY(0);
}

.animate-item.delay-1 { transition-delay: 0.1s; }
.animate-item.delay-2 { transition-delay: 0.2s; }

/* Responsive */
@media (max-width: 1024px) {
  .filters-bar {
    flex-wrap: wrap;
  }

  .filters-bar > :first-child {
    flex-basis: 100%;
  }
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
  }

  .students-table-container {
    overflow-x: auto;
  }

  .students-table {
    min-width: 800px;
  }
}
</style>
