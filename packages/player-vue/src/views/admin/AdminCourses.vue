<script setup lang="ts">
import { onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminCourses } from '@/composables/admin/useAdminCourses'
import { parseCourseCode, getBeltForSeeds, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'

const { getClient } = useAdminClient()

const {
  courses,
  isLoading,
  error,
  sortBy,
  totalCourses,
  totalEnrollments,
  totalActive30d,
  fetchCourses,
  getStats,
  setSortBy,
} = useAdminCourses(getClient())

onMounted(() => {
  fetchCourses()
})
</script>

<template>
  <div class="admin-courses">
    <h2 class="page-title">Courses</h2>

    <!-- Hero stat cards -->
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-value">{{ totalCourses }}</div>
        <div class="stat-label">Total Courses</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ totalEnrollments.toLocaleString() }}</div>
        <div class="stat-label">Total Enrollments</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ totalActive30d.toLocaleString() }}</div>
        <div class="stat-label">Active Learners (30d)</div>
      </div>
    </div>

    <!-- Sort controls -->
    <div class="sort-bar">
      <span class="sort-label">Sort by:</span>
      <button
        class="sort-btn"
        :class="{ active: sortBy === 'enrolled' }"
        @click="setSortBy('enrolled')"
      >
        Enrollment
      </button>
      <button
        class="sort-btn"
        :class="{ active: sortBy === 'active' }"
        @click="setSortBy('active')"
      >
        Active Users
      </button>
      <button
        class="sort-btn"
        :class="{ active: sortBy === 'name' }"
        @click="setSortBy('name')"
      >
        Name
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading courses...</div>

    <!-- Course cards -->
    <div v-else-if="courses.length > 0" class="course-grid">
      <div v-for="course in courses" :key="course.course_code" class="course-card">
        <div class="course-header">
          <div class="course-title">{{ parseCourseCode(course.course_code).label }}</div>
          <div class="course-badges">
            <Badge
              v-if="course.is_community"
              variant="ssi-gold"
              size="sm"
              pill
            >
              Community
            </Badge>
            <Badge
              v-else-if="course.pricing_tier"
              variant="info"
              size="sm"
              pill
            >
              {{ course.pricing_tier }}
            </Badge>
          </div>
        </div>

        <div class="course-metrics">
          <div class="metric">
            <span class="metric-value">{{ getStats(course.course_code).enrolled_count }}</span>
            <span class="metric-label">Enrolled</span>
          </div>
          <div class="metric">
            <span class="metric-value">{{ getStats(course.course_code).active_30d }}</span>
            <span class="metric-label">Active (30d)</span>
          </div>
          <div class="metric">
            <span class="metric-value">
              <Badge
                :belt="getBeltForSeeds(getStats(course.course_code).avg_seeds_introduced).name as any"
                size="sm"
                pill
              >
                {{ getBeltForSeeds(getStats(course.course_code).avg_seeds_introduced).name }}
              </Badge>
            </span>
            <span class="metric-label">Avg Belt</span>
          </div>
          <div class="metric">
            <span class="metric-value">{{ formatDuration(getStats(course.course_code).total_practice_minutes) }}</span>
            <span class="metric-label">Total Practice</span>
          </div>
        </div>

        <!-- Progress bar (avg seeds / 300) -->
        <div class="progress-track">
          <div
            class="progress-fill"
            :style="{ width: `${Math.min((getStats(course.course_code).avg_seeds_introduced / 300) * 100, 100)}%` }"
          ></div>
        </div>
        <div class="progress-label">
          Avg {{ getStats(course.course_code).avg_seeds_introduced }} / 300 seeds
        </div>
      </div>
    </div>

    <div v-else-if="!isLoading" class="empty-state">No courses found.</div>
  </div>
</template>

<style scoped>
.admin-courses {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #e8e8f0);
}

/* Stat cards */
.stat-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary, #e8e8f0);
  line-height: 1;
}

.stat-label {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a0a0b8);
  margin-top: 8px;
}

/* Sort bar */
.sort-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sort-label {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a0a0b8);
}

.sort-btn {
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.sort-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e8e8f0);
}

.sort-btn.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: var(--text-primary, #e8e8f0);
  font-weight: 500;
}

/* Course grid */
.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.course-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: border-color 0.15s;
}

.course-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

.course-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.course-title {
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary, #e8e8f0);
}

.course-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* Metrics grid */
.course-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.metric {
  text-align: center;
}

.metric-value {
  display: block;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary, #e8e8f0);
}

.metric-label {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-secondary, #a0a0b8);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-top: 2px;
}

/* Progress bar */
.progress-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #d4a853, #f0c674);
  border-radius: 2px;
  transition: width 0.3s;
}

.progress-label {
  font-size: 0.75rem;
  color: var(--text-secondary, #a0a0b8);
}

/* Error */
.error-banner {
  padding: 12px 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #ef4444;
  font-size: 0.875rem;
}

/* Loading */
.loading {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #a0a0b8);
}

/* Empty */
.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.875rem;
}

@media (max-width: 768px) {
  .stat-cards {
    grid-template-columns: 1fr;
  }

  .course-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
