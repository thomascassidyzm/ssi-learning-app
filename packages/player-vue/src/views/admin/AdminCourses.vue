<script setup lang="ts">
import { onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminCourses } from '@/composables/admin/useAdminCourses'
import { parseCourseCode, formatDuration } from '@/composables/admin/adminUtils'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

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

type Tier = 'community' | 'premium' | 'free'

function tierFor(course: { is_community?: boolean; pricing_tier?: string | null }): Tier {
  if (course.is_community) return 'community'
  const tier = (course.pricing_tier || '').toLowerCase()
  if (tier === 'premium' || tier === 'paid') return 'premium'
  return 'free'
}

function tierLabel(tier: Tier): string {
  if (tier === 'community') return 'Community'
  if (tier === 'premium') return 'Premium'
  return 'Free'
}

onMounted(() => {
  fetchCourses()
})
</script>

<template>
  <div class="admin-courses">
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Courses</h1>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ totalCourses }}</span>
            courses
          </span>
        </div>
      </div>
    </header>

    <!-- Error -->
    <Transition name="fade">
      <div v-if="error" class="banner banner-error">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span>{{ error }}</span>
      </div>
    </Transition>

    <!-- KPI stones -->
    <div class="kpi-strip">
      <FrostCard variant="stone" tone="blue">
        <div class="stone-content">
          <span class="stone-label">Total courses</span>
          <span class="stone-value frost-mono-nums">{{ totalCourses }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="gold">
        <div class="stone-content">
          <span class="stone-label">Total enrolments</span>
          <span class="stone-value frost-mono-nums">{{ totalEnrollments }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="green">
        <div class="stone-content">
          <span class="stone-label">Active (30d)</span>
          <span class="stone-value frost-mono-nums">{{ totalActive30d }}</span>
        </div>
      </FrostCard>
    </div>

    <!-- Sort controls — own row, segmented pill -->
    <div class="filters-bar">
      <span class="frost-eyebrow">Sort by</span>
      <div class="sort-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          class="sort-btn"
          :class="{ 'is-active': sortBy === 'enrolled' }"
          :aria-selected="sortBy === 'enrolled'"
          @click="setSortBy('enrolled')"
        >Enrolment</button>
        <button
          type="button"
          role="tab"
          class="sort-btn"
          :class="{ 'is-active': sortBy === 'active' }"
          :aria-selected="sortBy === 'active'"
          @click="setSortBy('active')"
        >Active</button>
        <button
          type="button"
          role="tab"
          class="sort-btn"
          :class="{ 'is-active': sortBy === 'name' }"
          :aria-selected="sortBy === 'name'"
          @click="setSortBy('name')"
        >Name</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading courses…</div>

    <!-- Course tiles -->
    <div v-else-if="courses.length > 0" class="course-grid">
      <FrostCard
        v-for="course in courses"
        :key="course.course_code"
        variant="tile"
        class="course-card"
        :class="`tier-${tierFor(course)}`"
      >
        <div class="course-content">
          <!-- Title + tier pill -->
          <div class="course-header">
            <div class="course-title frost-display">
              {{ parseCourseCode(course.course_code).label }}
            </div>
            <span class="tier-pill">{{ tierLabel(tierFor(course)) }}</span>
          </div>

          <!-- Metrics row -->
          <div class="course-metrics">
            <div class="course-metric">
              <span class="cm-value frost-mono-nums">{{ getStats(course.course_code).enrolled_count }}</span>
              <span class="cm-label">Enrolled</span>
            </div>
            <div class="course-metric">
              <span class="cm-value frost-mono-nums">{{ getStats(course.course_code).active_30d }}</span>
              <span class="cm-label">Active 30d</span>
            </div>
            <div class="course-metric">
              <span class="cm-value frost-mono-nums">{{ formatDuration(getStats(course.course_code).total_practice_minutes) }}</span>
              <span class="cm-label">Practice</span>
            </div>
          </div>
        </div>
      </FrostCard>
    </div>

    <!-- Empty state — canon §5.5 -->
    <FrostCard
      v-else-if="!isLoading"
      variant="tile"
      class="empty"
    >
      <div class="empty-ghost">courses</div>
      <div class="empty-copy">
        <strong>No courses yet</strong>
        <p>Once Popty publishes a course, it'll appear here.</p>
      </div>
    </FrostCard>
  </div>
</template>

<style scoped>
.admin-courses {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Page header */
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-6);
}

.title-block h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 0 0 var(--space-2);
}

.metrics {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.metric-value {
  color: var(--ink-primary);
  font-weight: var(--font-semibold);
  margin-right: 4px;
}

/* Banners */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

/* KPI stones */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}

.stone-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: var(--space-5) var(--space-6);
  min-height: 120px;
}

.stone-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.stone-value {
  font-family: var(--font-display);
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.025em;
  color: var(--ink-primary);
  margin-top: var(--space-3);
}

/* Filters bar (sort) — own row, NOT inside a card */
.filters-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.sort-toggle {
  display: inline-flex;
  background: rgba(44, 38, 34, 0.05);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
}

.sort-btn {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 6px 14px;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  color: var(--ink-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sort-btn:hover { color: var(--ink-primary); }

.sort-btn.is-active {
  background: var(--ssi-red);
  color: #fff;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.10), 0 4px 12px rgba(194, 58, 58, 0.20);
}

/* Course grid */
.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}

.course-card {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.course-content {
  padding: var(--space-5) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.course-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}

.course-title {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  letter-spacing: -0.01em;
  color: var(--ink-primary);
}

/* Tier pill — outlined, tier-coloured, mono uppercase */
.tier-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  flex-shrink: 0;
  border: 1px solid transparent;
}

.course-card.tier-premium .tier-pill {
  background: rgba(var(--tone-gold), 0.18);
  border-color: rgba(var(--tone-gold), 0.42);
  color: rgb(var(--tone-gold));
}

.course-card.tier-free .tier-pill {
  background: rgba(var(--tone-blue), 0.14);
  border-color: rgba(var(--tone-blue), 0.32);
  color: rgb(var(--tone-blue));
}

.course-card.tier-community .tier-pill {
  background: rgba(var(--tone-green), 0.14);
  border-color: rgba(var(--tone-green), 0.36);
  color: rgb(var(--tone-green));
}

/* Course metrics */
.course-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}

.course-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.cm-value {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--ink-primary);
}

.cm-label {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* Empty state */
.empty {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-6);
  align-items: center;
  padding: var(--space-10) var(--space-8);
  min-height: 180px;
}

.empty-ghost {
  font-family: var(--font-display);
  font-size: 88px;
  font-weight: var(--font-bold);
  letter-spacing: -0.03em;
  color: var(--ink-faint);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--ink-primary);
  margin-bottom: 4px;
}

.empty-copy p {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.loading {
  text-align: center;
  padding: var(--space-12);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Transitions */
.fade-enter-active, .fade-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 768px) {
  .kpi-strip { grid-template-columns: 1fr; }
  .course-grid { grid-template-columns: 1fr; }
  .course-metrics { grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
}
</style>
