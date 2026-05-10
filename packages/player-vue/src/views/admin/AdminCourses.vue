<script setup lang="ts">
import { onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminCourses } from '@/composables/admin/useAdminCourses'
import { parseCourseCode, getBeltForSeeds, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'
import Card from '@/components/schools/shared/Card.vue'
import StatsCard from '@/components/schools/StatsCard.vue'

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

/**
 * Map belt color names to Card accent variants.
 * Falls back to 'gradient' for unrecognised belts.
 */
function beltAccent(beltName: string): 'red' | 'gold' | 'green' | 'blue' | 'gradient' {
  const map: Record<string, 'red' | 'gold' | 'green' | 'blue' | 'gradient'> = {
    white: 'gradient',
    yellow: 'gold',
    orange: 'gold',
    green: 'green',
    blue: 'blue',
    purple: 'gradient',
    brown: 'red',
    black: 'red',
  }
  return map[beltName.toLowerCase()] || 'gradient'
}

onMounted(() => {
  fetchCourses()
})
</script>

<template>
  <div class="admin-courses">
    <!-- Page Header -->
    <header class="page-header animate-in">
      <h1 class="page-title">Courses</h1>
      <p class="page-subtitle">Overview of all courses, enrolments and activity</p>
    </header>

    <!-- Hero Stats -->
    <div class="stats-grid animate-in delay-1">
      <StatsCard
        icon="📚"
        label="Total Courses"
        :value="totalCourses"
        variant="blue"
      />
      <StatsCard
        icon="👥"
        label="Total Enrollments"
        :value="totalEnrollments"
        variant="gold"
      />
      <StatsCard
        icon="🔥"
        label="Active Learners (30d)"
        :value="totalActive30d"
        variant="green"
      />
    </div>

    <!-- Error -->
    <div v-if="error" class="error-banner animate-in delay-2">{{ error }}</div>

    <!-- Course List Card -->
    <Card
      title="All Courses"
      :subtitle="`${totalCourses} course${totalCourses !== 1 ? 's' : ''}`"
      class="animate-in delay-2"
    >
      <template #icon>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </template>

      <template #header-actions>
        <div class="sort-controls">
          <span class="sort-label">Sort by</span>
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
      </template>

      <!-- Loading -->
      <div v-if="isLoading" class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading courses&hellip;</p>
      </div>

      <!-- Course Grid -->
      <div v-else-if="courses.length > 0" class="course-grid">
        <Card
          v-for="(course, idx) in courses"
          :key="course.course_code"
          hoverable
          :accent="beltAccent(getBeltForSeeds(getStats(course.course_code).avg_seeds_introduced).name)"
          class="course-card animate-in"
          :class="`delay-${Math.min(idx + 1, 5)}`"
          variant="default"
          no-padding
        >
          <div class="course-inner">
            <!-- Colored belt bar -->
            <div
              class="belt-bar"
              :style="{ background: getBeltForSeeds(getStats(course.course_code).avg_seeds_introduced).color }"
            ></div>

            <div class="course-content">
              <!-- Header row -->
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

              <!-- Metrics -->
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

              <!-- Progress bar -->
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
        </Card>
      </div>

      <!-- Empty -->
      <div v-else-if="!isLoading" class="empty-state">
        <p>No courses found.</p>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.admin-courses {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 24px);
}

/* ── Page Header ─────────────────────────────────── */
.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-1, 4px);
}

.page-title {
  font-family: var(--font-display, system-ui);
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
}

.page-subtitle {
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-muted);
  margin: 0;
}

/* ── Stats Grid ──────────────────────────────────── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4, 16px);
}

/* ── Sort Controls (inside Card header-actions slot) */
.sort-controls {
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
}

.sort-label {
  font-size: var(--text-xs, 0.75rem);
  color: var(--text-muted);
  font-weight: 500;
}

.sort-btn {
  padding: var(--space-1, 4px) var(--space-3, 12px);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--text-xs, 0.75rem);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s);
  font-family: var(--font-body, inherit);
}

.sort-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--border-medium);
}

.sort-btn.active {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
  color: var(--text-primary);
  font-weight: 600;
}

/* ── Course Grid ─────────────────────────────────── */
.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4, 16px);
}

.course-card {
  /* Override any Card body padding — handled by .course-inner */
}

.course-inner {
  position: relative;
}

/* Belt accent bar at top of each course card */
.belt-bar {
  height: 4px;
  width: 100%;
  opacity: 0.85;
  transition: opacity var(--transition-fast, 0.15s);
}

.course-card:hover .belt-bar {
  opacity: 1;
}

.course-content {
  padding: var(--space-5, 20px);
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 16px);
}

/* ── Course Header ───────────────────────────────── */
.course-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2, 8px);
}

.course-title {
  font-family: var(--font-display, system-ui);
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary);
}

.course-badges {
  display: flex;
  gap: var(--space-1, 4px);
  flex-shrink: 0;
}

/* ── Metrics Grid ────────────────────────────────── */
.course-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2, 8px);
}

.metric {
  text-align: center;
}

.metric-value {
  display: block;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.metric-label {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 2px;
}

/* ── Progress Bar ────────────────────────────────── */
.progress-track {
  height: 4px;
  background: var(--bg-elevated);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ssi-gold-dark, #b8942e), var(--ssi-gold, #d4a853));
  border-radius: var(--radius-sm, 2px);
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-label {
  font-size: var(--text-xs, 0.75rem);
  color: var(--text-muted);
}

/* ── Error ───────────────────────────────────────── */
.error-banner {
  padding: var(--space-3, 12px) var(--space-4, 16px);
  background: var(--bg-card);
  border: 1px solid var(--ssi-red, #c23a3a);
  border-radius: var(--radius-lg, 12px);
  color: var(--ssi-red, #c23a3a);
  font-size: var(--text-sm, 0.875rem);
}

/* ── Loading ─────────────────────────────────────── */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3, 12px);
  padding: var(--space-10, 40px);
  color: var(--text-muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-subtle);
  border-top-color: var(--ssi-red, #c23a3a);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Empty ───────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: var(--space-10, 40px);
  color: var(--text-muted);
  font-size: var(--text-sm, 0.875rem);
}

.empty-state p {
  margin: 0;
}

/* ── Responsive ──────────────────────────────────── */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .sort-controls {
    flex-wrap: wrap;
  }

  .course-metrics {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3, 12px);
  }

  .course-grid {
    grid-template-columns: 1fr;
  }
}
</style>
