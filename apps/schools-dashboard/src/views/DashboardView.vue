<script setup lang="ts">
import { onMounted, computed, watch } from 'vue'
import Card from '@/components/shared/Card.vue'
import { useGodMode } from '@/composables/useGodMode'
import { useSchoolData } from '@/composables/useSchoolData'

const { selectedUser, isGovtAdmin } = useGodMode()
const {
  schools,
  currentSchool,
  regionSummary,
  totalStudents,
  totalTeachers,
  totalClasses,
  totalPracticeHours,
  fetchSchools,
  isLoading,
  error
} = useSchoolData()

// Display values
const schoolName = computed(() => {
  if (isGovtAdmin.value && regionSummary.value) return regionSummary.value.region_name
  return currentSchool.value?.school_name || selectedUser.value?.school_name || 'Your School'
})

const practiceHoursDisplay = computed(() => Math.round(totalPracticeHours.value))

// Debug info for testing
const debugInfo = computed(() => ({
  hasUser: !!selectedUser.value,
  userName: selectedUser.value?.display_name,
  role: selectedUser.value?.educational_role,
  regionCode: selectedUser.value?.region_code,
  isGovtAdmin: isGovtAdmin.value,
  hasRegionSummary: !!regionSummary.value,
  error: error.value,
}))

// Fetch data when user changes
watch(selectedUser, (user) => {
  if (user) {
    fetchSchools()
  }
}, { immediate: true })

onMounted(() => {
  if (selectedUser.value) {
    fetchSchools()
  }
})
</script>

<template>
  <div class="dashboard-view">
    <!-- Page Header -->
    <header class="page-header animate-in">
      <div class="page-title">
        <h1>Dashboard</h1>
        <p class="page-subtitle">
          <template v-if="selectedUser">
            {{ isGovtAdmin ? 'Regional overview for' : 'Welcome back!' }} {{ schoolName }}
          </template>
          <template v-else>
            Select a user from God Mode to view dashboard data
          </template>
        </p>
      </div>
    </header>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-state animate-in delay-1">
      <p>Loading dashboard data...</p>
    </div>

    <!-- Stats Grid -->
    <div v-else class="stats-grid animate-in delay-1">
      <Card variant="stats" accent="blue">
        <div class="stat-card">
          <div class="stat-icon">&#128101;</div>
          <div class="stat-content">
            <div class="stat-value">{{ totalStudents.toLocaleString() }}</div>
            <div class="stat-label">{{ isGovtAdmin ? 'Total Students' : 'Active Students' }}</div>
          </div>
        </div>
      </Card>

      <Card variant="stats" accent="gold">
        <div class="stat-card">
          <div class="stat-icon">&#128337;</div>
          <div class="stat-content">
            <div class="stat-value">{{ practiceHoursDisplay.toLocaleString() }}</div>
            <div class="stat-label">Hours Practiced</div>
          </div>
        </div>
      </Card>

      <Card variant="stats" accent="red">
        <div class="stat-card">
          <div class="stat-icon">&#128218;</div>
          <div class="stat-content">
            <div class="stat-value">{{ totalClasses }}</div>
            <div class="stat-label">{{ isGovtAdmin ? 'Total Classes' : 'Active Classes' }}</div>
          </div>
        </div>
      </Card>

      <Card variant="stats" accent="green">
        <div class="stat-card">
          <div class="stat-icon">&#127979;</div>
          <div class="stat-content">
            <div class="stat-value">{{ totalTeachers }}</div>
            <div class="stat-label">Teachers</div>
          </div>
        </div>
      </Card>
    </div>

    <!-- Schools in Region (Govt Admin only) -->
    <section v-if="isGovtAdmin && schools.length > 0" class="region-schools animate-in delay-2">
      <Card :title="`Schools in ${regionSummary?.region_name || 'Region'}`" :subtitle="`${schools.length} schools`">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </template>
        <div class="schools-grid">
          <div v-for="school in schools" :key="school.id" class="school-card">
            <div class="school-header">
              <div class="school-avatar">{{ school.school_name.substring(0, 2).toUpperCase() }}</div>
              <div class="school-info">
                <h4>{{ school.school_name }}</h4>
                <span class="school-meta">{{ school.teacher_count }} teachers · {{ school.class_count }} classes</span>
              </div>
            </div>
            <div class="school-stats">
              <div class="school-stat">
                <span class="stat-num">{{ school.student_count }}</span>
                <span class="stat-label">Students</span>
              </div>
              <div class="school-stat">
                <span class="stat-num">{{ Math.round(school.total_practice_hours) }}</span>
                <span class="stat-label">Hours</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </section>

    <!-- Quick Actions -->
    <section class="quick-actions animate-in delay-3">
      <Card title="Quick Actions">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </template>
        <div class="actions-grid">
          <router-link to="/classes" class="action-card">
            <div class="action-icon">&#9658;</div>
            <span>Start Session</span>
          </router-link>
          <router-link to="/students" class="action-card">
            <div class="action-icon">&#128100;</div>
            <span>Add Student</span>
          </router-link>
          <router-link to="/teachers" class="action-card">
            <div class="action-icon">&#128188;</div>
            <span>Add Teacher</span>
          </router-link>
          <router-link to="/analytics" class="action-card">
            <div class="action-icon">&#128200;</div>
            <span>View Reports</span>
          </router-link>
        </div>
      </Card>
    </section>

    <!-- Recent Activity Placeholder -->
    <section class="recent-activity animate-in delay-3">
      <Card title="Recent Activity" subtitle="Last 7 days">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </template>
        <div class="activity-placeholder">
          <p class="text-muted">Activity feed will appear here...</p>
        </div>
      </Card>
    </section>

    <!-- Debug Panel (temporary) -->
    <section class="debug-panel animate-in delay-4">
      <Card title="Debug Info" subtitle="God Mode state">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </template>
        <pre class="debug-output">{{ JSON.stringify(debugInfo, null, 2) }}</pre>
      </Card>
    </section>
  </div>
</template>

<style scoped>
.dashboard-view {
  max-width: 1200px;
}

.page-header {
  margin-bottom: var(--space-8);
}

.page-title h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  margin-bottom: var(--space-1);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-6);
  margin-bottom: var(--space-8);
}

.stat-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-6);
}

.stat-icon {
  font-size: var(--text-3xl);
  line-height: 1;
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  line-height: 1;
  margin-bottom: var(--space-1);
}

.stat-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.stat-badge {
  flex-shrink: 0;
}

/* Region Schools */
.region-schools {
  margin-bottom: var(--space-8);
}

.schools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

.school-card {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  transition: all var(--transition-base);
}

.school-card:hover {
  background: var(--bg-elevated);
  transform: translateY(-2px);
}

.school-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.school-avatar {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold);
  font-size: var(--text-sm);
  color: white;
}

.school-info h4 {
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
  margin-bottom: var(--space-1);
}

.school-meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.school-stats {
  display: flex;
  gap: var(--space-6);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.school-stat {
  display: flex;
  flex-direction: column;
}

.school-stat .stat-num {
  font-family: var(--font-display);
  font-weight: var(--font-bold);
  font-size: var(--text-lg);
}

.school-stat .stat-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* Quick Actions */
.quick-actions {
  margin-bottom: var(--space-8);
}

.actions-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  text-decoration: none;
  color: var(--text-secondary);
  transition: all var(--transition-base);
}

.action-card:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  transform: translateY(-2px);
}

.action-icon {
  font-size: var(--text-2xl);
}

/* Recent Activity */
.activity-placeholder {
  padding: var(--space-12);
  text-align: center;
}

/* Debug Panel */
.debug-panel {
  margin-top: var(--space-8);
}

.debug-output {
  background: var(--bg-secondary);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  font-family: monospace;
  font-size: var(--text-sm);
  overflow-x: auto;
  white-space: pre-wrap;
  color: var(--text-secondary);
}

/* Responsive */
@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .actions-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .actions-grid {
    grid-template-columns: 1fr;
  }
}
</style>
