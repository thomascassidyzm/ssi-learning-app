<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Card from '@/components/schools/shared/Card.vue'
import Badge from '@/components/schools/shared/Badge.vue'
import { useGodMode } from '@/composables/schools/useGodMode'
import { getSchoolsClient } from '@/composables/schools/client'

interface CourseProgress {
  course_id: string
  enrolled_at: string
  last_practiced_at: string | null
  total_practice_minutes: number
  seeds_completed: number
  legos_mastered: number
  legos_retired: number
}

const { selectedUser } = useGodMode()
const client = getSchoolsClient()

const courses = ref<CourseProgress[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// Get belt based on seeds completed
function getBelt(seedsCompleted: number): 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'brown' | 'black' {
  if (seedsCompleted >= 400) return 'black'
  if (seedsCompleted >= 280) return 'brown'
  if (seedsCompleted >= 150) return 'blue'
  if (seedsCompleted >= 80) return 'green'
  if (seedsCompleted >= 40) return 'orange'
  if (seedsCompleted >= 20) return 'yellow'
  return 'white'
}

// Belt thresholds for progress calculation
const beltThresholds = [
  { belt: 'white', min: 0, max: 20 },
  { belt: 'yellow', min: 20, max: 40 },
  { belt: 'orange', min: 40, max: 80 },
  { belt: 'green', min: 80, max: 150 },
  { belt: 'blue', min: 150, max: 280 },
  { belt: 'brown', min: 280, max: 400 },
  { belt: 'black', min: 400, max: 500 },
]

function getBeltProgress(seeds: number): number {
  const currentBelt = beltThresholds.find(b => seeds >= b.min && seeds < b.max) || beltThresholds[beltThresholds.length - 1]
  const progress = ((seeds - currentBelt.min) / (currentBelt.max - currentBelt.min)) * 100
  return Math.min(100, Math.max(0, progress))
}

function getNextBelt(seeds: number): string {
  const idx = beltThresholds.findIndex(b => seeds >= b.min && seeds < b.max)
  if (idx === -1 || idx === beltThresholds.length - 1) return 'Master'
  return beltThresholds[idx + 1].belt.charAt(0).toUpperCase() + beltThresholds[idx + 1].belt.slice(1)
}

function getSeedsToNextBelt(seeds: number): number {
  const currentBelt = beltThresholds.find(b => seeds >= b.min && seeds < b.max)
  if (!currentBelt) return 0
  return currentBelt.max - seeds
}

// Format time
function formatPracticeTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

// Format date
function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return date.toLocaleDateString()
}

// Fetch student progress
async function fetchProgress() {
  if (!selectedUser.value?.learner_id) return

  isLoading.value = true
  error.value = null

  try {
    // Fetch course enrollments
    const { data: enrollments, error: enrollError } = await client
      .from('course_enrollments')
      .select('course_id, enrolled_at, last_practiced_at, total_practice_minutes')
      .eq('learner_id', selectedUser.value.learner_id)
      .order('last_practiced_at', { ascending: false, nullsFirst: false })

    if (enrollError) throw enrollError

    // Fetch seed progress counts
    const { data: seedCounts, error: seedError } = await client
      .from('seed_progress')
      .select('course_id')
      .eq('learner_id', selectedUser.value.learner_id)
      .eq('is_introduced', true)

    if (seedError) throw seedError

    // Fetch lego progress counts
    const { data: legoCounts, error: legoError } = await client
      .from('lego_progress')
      .select('course_id, is_retired')
      .eq('learner_id', selectedUser.value.learner_id)

    if (legoError) throw legoError

    // Count seeds and legos per course
    const seedCountMap = new Map<string, number>()
    seedCounts?.forEach(s => {
      seedCountMap.set(s.course_id, (seedCountMap.get(s.course_id) || 0) + 1)
    })

    const legoCountMap = new Map<string, { total: number, retired: number }>()
    legoCounts?.forEach(l => {
      const existing = legoCountMap.get(l.course_id) || { total: 0, retired: 0 }
      existing.total++
      if (l.is_retired) existing.retired++
      legoCountMap.set(l.course_id, existing)
    })

    // Build course progress
    courses.value = (enrollments || []).map(e => ({
      course_id: e.course_id,
      enrolled_at: e.enrolled_at,
      last_practiced_at: e.last_practiced_at,
      total_practice_minutes: e.total_practice_minutes || 0,
      seeds_completed: seedCountMap.get(e.course_id) || 0,
      legos_mastered: legoCountMap.get(e.course_id)?.total || 0,
      legos_retired: legoCountMap.get(e.course_id)?.retired || 0,
    }))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to fetch progress'
    console.error('Progress fetch error:', err)
  } finally {
    isLoading.value = false
  }
}

// Total stats
const totalStats = computed(() => {
  const totalSeeds = courses.value.reduce((sum, c) => sum + c.seeds_completed, 0)
  const totalLegos = courses.value.reduce((sum, c) => sum + c.legos_mastered, 0)
  const totalMinutes = courses.value.reduce((sum, c) => sum + c.total_practice_minutes, 0)
  return {
    seeds: totalSeeds,
    legos: totalLegos,
    minutes: totalMinutes,
    belt: getBelt(totalSeeds),
  }
})

// Course name display
function formatCourseName(courseId: string): string {
  const parts = courseId.split('_')
  if (parts.length >= 3) {
    const target = parts[0].toUpperCase()
    const known = parts[2].toUpperCase()
    return `${target} for ${known} speakers`
  }
  return courseId
}

// Animation
const isVisible = ref(false)
onMounted(() => {
  setTimeout(() => { isVisible.value = true }, 50)
  fetchProgress()
})

watch(selectedUser, () => {
  fetchProgress()
})
</script>

<template>
  <div class="progress-view" :class="{ 'is-visible': isVisible }">
    <!-- Page Header -->
    <header class="page-header animate-item" :class="{ 'show': isVisible }">
      <div class="page-title">
        <h1>My Progress</h1>
        <p class="page-subtitle">Track your learning journey</p>
      </div>
    </header>

    <!-- Overall Progress Card -->
    <Card class="overall-progress animate-item delay-1" :class="{ 'show': isVisible }">
      <div class="progress-hero">
        <div class="belt-display">
          <Badge :belt="totalStats.belt" size="lg">
            {{ totalStats.belt.charAt(0).toUpperCase() + totalStats.belt.slice(1) }} Belt
          </Badge>
          <div class="belt-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${getBeltProgress(totalStats.seeds)}%` }"></div>
            </div>
            <div class="progress-label">
              {{ getSeedsToNextBelt(totalStats.seeds) }} seeds to {{ getNextBelt(totalStats.seeds) }} Belt
            </div>
          </div>
        </div>
        <div class="stats-row">
          <div class="stat">
            <span class="stat-value">{{ totalStats.seeds }}</span>
            <span class="stat-label">Seeds Completed</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ totalStats.legos }}</span>
            <span class="stat-label">LEGOs Learned</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ formatPracticeTime(totalStats.minutes) }}</span>
            <span class="stat-label">Practice Time</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ courses.length }}</span>
            <span class="stat-label">Courses</span>
          </div>
        </div>
      </div>
    </Card>

    <!-- Course Progress -->
    <section class="courses-section animate-item delay-2" :class="{ 'show': isVisible }">
      <h2 class="section-title">Your Courses</h2>
      <div class="courses-grid">
        <Card v-for="course in courses" :key="course.course_id" class="course-card">
          <div class="course-header">
            <h3 class="course-name">{{ formatCourseName(course.course_id) }}</h3>
            <Badge :belt="getBelt(course.seeds_completed)" size="sm">
              {{ getBelt(course.seeds_completed) }}
            </Badge>
          </div>
          <div class="course-stats">
            <div class="course-stat">
              <span class="value">{{ course.seeds_completed }}</span>
              <span class="label">Seeds</span>
            </div>
            <div class="course-stat">
              <span class="value">{{ course.legos_mastered }}</span>
              <span class="label">LEGOs</span>
            </div>
            <div class="course-stat">
              <span class="value">{{ formatPracticeTime(course.total_practice_minutes) }}</span>
              <span class="label">Time</span>
            </div>
          </div>
          <div class="course-footer">
            <span class="last-practiced">Last practiced: {{ formatDate(course.last_practiced_at) }}</span>
          </div>
        </Card>
      </div>
    </section>

    <!-- Empty State -->
    <div v-if="courses.length === 0 && !isLoading" class="empty-state">
      <h3>No courses yet</h3>
      <p>You haven't enrolled in any courses yet. Ask your teacher for a class join code!</p>
    </div>
  </div>
</template>

<style scoped>
.progress-view {
  max-width: 1000px;
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

/* Overall Progress */
.overall-progress {
  margin-bottom: var(--space-8);
}

.progress-hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.belt-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) 0;
}

.belt-progress {
  width: 100%;
  max-width: 400px;
}

.progress-bar {
  height: 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: var(--space-2);
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-full);
  transition: width 0.5s ease;
}

.progress-label {
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  padding-top: var(--space-6);
  border-top: 1px solid var(--border-subtle);
}

.stat {
  text-align: center;
}

.stat .stat-value {
  display: block;
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--ssi-gold);
  margin-bottom: var(--space-1);
}

.stat .stat-label {
  display: block;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* Courses Section */
.section-title {
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  margin-bottom: var(--space-5);
}

.courses-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-5);
}

.course-card {
  padding: var(--space-5);
}

.course-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.course-name {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}

.course-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.course-stat {
  text-align: center;
}

.course-stat .value {
  display: block;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
}

.course-stat .label {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
}

.course-footer {
  padding-top: var(--space-4);
}

.last-practiced {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: var(--space-20);
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
@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
  }

  .courses-grid {
    grid-template-columns: 1fr;
  }
}
</style>
