<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import { BELTS, getSharedBeltProgress, getSeedFromLegoId } from '@/composables/useBeltProgress'
import { getLanguageName } from '@/composables/useI18n'

const props = defineProps({
  activeCourse: {
    type: Object,
    default: null
  },
  enrolledCourses: {
    type: Array,
    default: () => []
  },
  completedSeeds: {
    type: Number,
    default: 0
  },
  totalSeeds: {
    type: Number,
    default: 668
  },
  currentBeltName: {
    type: String,
    default: 'white'
  },
  totalLearningMinutes: {
    type: Number,
    default: 0
  },
  totalPhrasesSpoken: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['open-belts', 'open-brain', 'select-course', 'close'])

// Supabase for course fetching
const supabaseClient = inject('supabase')

// Belt progress
const beltProgress = computed(() => getSharedBeltProgress())

// Current belt object
const currentBelt = computed(() => {
  return BELTS.find(b => b.name === props.currentBeltName) || BELTS[0]
})

// Current belt index
const currentBeltIndex = computed(() => {
  return BELTS.findIndex(b => b.name === props.currentBeltName)
})

// Next belt (for "N to next" display)
const nextBelt = computed(() => {
  const idx = currentBeltIndex.value
  if (idx < BELTS.length - 1) return BELTS[idx + 1]
  return null
})

// Seeds remaining to next belt
const seedsToNext = computed(() => {
  if (!nextBelt.value) return 0
  return Math.max(0, nextBelt.value.seedsRequired - props.completedSeeds)
})

// Format time
const formattedTime = computed(() => {
  const mins = props.totalLearningMinutes
  const hours = Math.floor(mins / 60)
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins % 60}m`
})

// ── Course catalog ──
const allCourses = ref([])
const isLoadingCourses = ref(true)

const fetchCourses = async () => {
  isLoadingCourses.value = true
  if (!supabaseClient) {
    isLoadingCourses.value = false
    return
  }

  try {
    const { data, error } = await supabaseClient
      .from('courses')
      .select('*')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')

    if (error) throw error
    allCourses.value = data || []
  } catch (e) {
    console.error('[BrowseScreen] Failed to fetch courses:', e)
  } finally {
    isLoadingCourses.value = false
  }
}

// Filter courses for current known language
const coursesForKnownLang = computed(() => {
  const knownLang = props.activeCourse?.known_lang || 'eng'
  return allCourses.value.filter(c => c.known_lang === knownLang)
})

// Check if course is enrolled
const isEnrolled = (courseCode) => {
  return props.enrolledCourses.some(e => e.course_code === courseCode || e.course_id === courseCode)
}

// Check if course is currently active
const isActiveCourse = (courseCode) => {
  return props.activeCourse?.course_code === courseCode
}

// Get target display name
const getTargetDisplayName = (course) => {
  if (course.display_name) {
    const match = course.display_name.match(/^(.+?)\s+for\s+/i)
    if (match) return match[1]
  }
  return getLanguageName(course.target_lang)
}

// Get enrollment progress
const getProgress = (courseCode) => {
  const enrollment = props.enrolledCourses.find(e => e.course_code === courseCode || e.course_id === courseCode)
  if (!enrollment) return 0
  return enrollment.progress || Math.round((enrollment.completed_seeds || 0) / (enrollment.total_seeds || 668) * 100)
}

onMounted(() => {
  fetchCourses()
})
</script>

<template>
  <div class="browse-screen">
    <!-- Header -->
    <div class="browse-header">
      <h1 class="browse-title">Browse</h1>
    </div>

    <div class="browse-content">
      <!-- ── Section 1: Progress Strip ── -->
      <section class="section">
        <h3 class="section-label">Your Progress</h3>
        <div class="progress-card" @click="emit('open-belts')">
          <!-- Belt strip: 8 colored dots -->
          <div class="belt-strip">
            <div
              v-for="(belt, i) in BELTS"
              :key="belt.name"
              class="belt-pip"
              :class="{
                completed: i < currentBeltIndex,
                current: i === currentBeltIndex,
                future: i > currentBeltIndex,
              }"
              :style="{ background: i <= currentBeltIndex ? belt.color : undefined }"
            >
              <!-- Checkmark for completed belts -->
              <svg v-if="i < currentBeltIndex" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
          </div>

          <!-- Belt label + progress -->
          <div class="progress-meta">
            <span class="progress-belt-name" :style="{ color: currentBelt.color }">
              {{ currentBelt.name }} Belt
            </span>
            <span v-if="nextBelt" class="progress-to-next">
              {{ seedsToNext }} seeds to {{ nextBelt.name }}
            </span>
            <span v-else class="progress-to-next">
              {{ completedSeeds }} / {{ totalSeeds }} seeds
            </span>
          </div>

          <!-- Chevron -->
          <div class="card-action">
            <span class="card-action-label">View Seeds</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- ── Section 2: Brain Map ── -->
      <section class="section">
        <h3 class="section-label">Brain Map</h3>
        <div class="brain-card" @click="emit('open-brain')">
          <div class="brain-icon-area">
            <!-- Brain icon -->
            <svg class="brain-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" opacity="0.2" fill="currentColor"/>
              <circle cx="8" cy="9" r="1.5" fill="currentColor" opacity="0.6"/>
              <circle cx="15" cy="8" r="1" fill="currentColor" opacity="0.6"/>
              <circle cx="10" cy="14" r="1.2" fill="currentColor" opacity="0.6"/>
              <circle cx="16" cy="13" r="0.8" fill="currentColor" opacity="0.6"/>
              <circle cx="12" cy="11" r="0.9" fill="currentColor" opacity="0.6"/>
              <line x1="8" y1="9" x2="12" y2="11" stroke="currentColor" opacity="0.3" stroke-width="0.5"/>
              <line x1="15" y1="8" x2="12" y2="11" stroke="currentColor" opacity="0.3" stroke-width="0.5"/>
              <line x1="10" y1="14" x2="12" y2="11" stroke="currentColor" opacity="0.3" stroke-width="0.5"/>
              <line x1="16" y1="13" x2="12" y2="11" stroke="currentColor" opacity="0.3" stroke-width="0.5"/>
            </svg>
          </div>
          <div class="brain-meta">
            <span class="brain-stat">{{ completedSeeds }} words learned</span>
            <span class="brain-sub">{{ totalPhrasesSpoken }} phrase connections</span>
          </div>
          <div class="card-action">
            <span class="card-action-label">View</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- ── Section 3: Activity ── -->
      <section class="section">
        <h3 class="section-label">Activity</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="stat-value">{{ formattedTime }}</div>
            <div class="stat-label">Total Time</div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </div>
            <div class="stat-value">{{ completedSeeds }}</div>
            <div class="stat-label">Words</div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              </svg>
            </div>
            <div class="stat-value">{{ totalPhrasesSpoken }}</div>
            <div class="stat-label">Phrases</div>
          </div>
        </div>
      </section>

      <!-- ── Section 4: All Courses ── -->
      <section class="section">
        <h3 class="section-label">All Courses</h3>

        <!-- Loading state -->
        <div v-if="isLoadingCourses" class="courses-loading">
          <div class="loading-spinner"></div>
        </div>

        <!-- Course grid -->
        <div v-else class="course-grid">
          <button
            v-for="course in coursesForKnownLang"
            :key="course.course_code"
            class="course-card"
            :class="{ active: isActiveCourse(course.course_code) }"
            @click="emit('select-course', course)"
          >
            <!-- Status badge -->
            <div v-if="isActiveCourse(course.course_code)" class="course-badge active-badge">
              <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
              </svg>
            </div>
            <div v-else-if="course.new_app_status === 'beta'" class="course-badge beta-badge">B</div>
            <div v-else-if="!isEnrolled(course.course_code)" class="course-badge new-badge">NEW</div>

            <span class="course-name">{{ getTargetDisplayName(course) }}</span>

            <span class="course-status">
              <template v-if="isEnrolled(course.course_code)">
                {{ getProgress(course.course_code) }}%
              </template>
              <template v-else-if="course.pricing_tier === 'premium'">
                Free preview
              </template>
              <template v-else>
                Start
              </template>
            </span>
          </button>
        </div>
      </section>
    </div>

    <!-- Bottom safe area -->
    <div class="safe-area"></div>
  </div>
</template>

<style scoped>
.browse-screen {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'DM Sans', -apple-system, sans-serif;
  overflow-y: auto;
  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

/* Header */
.browse-header {
  padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.5rem 0.75rem;
}

.browse-title {
  font-size: 1.625rem;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.02em;
}

/* Content */
.browse-content {
  padding: 0 1.5rem;
}

/* Section */
.section {
  margin-bottom: 1.5rem;
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0.25rem;
}

/* ── Progress Card ── */
.progress-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem 1.25rem;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.progress-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
}

.progress-card:active {
  transform: scale(0.99);
}

/* Belt strip */
.belt-strip {
  display: flex;
  gap: 6px;
  margin-bottom: 0.75rem;
}

.belt-pip {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.belt-pip.completed {
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.1);
}

.belt-pip.completed svg {
  width: 14px;
  height: 14px;
  color: #000;
}

.belt-pip.current {
  box-shadow: 0 0 0 2px var(--bg-card), 0 0 0 4px currentColor;
  position: relative;
}

.belt-pip.future {
  background: var(--bg-elevated) !important;
  opacity: 0.4;
}

/* Progress meta */
.progress-meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.progress-belt-name {
  font-size: 0.9375rem;
  font-weight: 600;
  text-transform: capitalize;
}

.progress-to-next {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

/* Shared card action row */
.card-action {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
}

.card-action-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--accent);
}

.card-action svg {
  width: 16px;
  height: 16px;
  color: var(--accent);
}

/* ── Brain Card ── */
.brain-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem 1.25rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.brain-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
}

.brain-card:active {
  transform: scale(0.99);
}

.brain-icon-area {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--accent-glow);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brain-icon {
  width: 28px;
  height: 28px;
  color: var(--accent);
}

.brain-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.brain-stat {
  font-size: 0.9375rem;
  font-weight: 600;
}

.brain-sub {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

/* ── Stats Grid ── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 0.875rem 0.75rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.375rem;
}

.stat-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-glow);
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon svg {
  width: 16px;
  height: 16px;
  color: var(--accent);
}

.stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-label {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* ── Course Grid ── */
.courses-loading {
  display: flex;
  justify-content: center;
  padding: 2rem 0;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.course-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

.course-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
  color: var(--text-primary);
  text-align: center;
  -webkit-tap-highlight-color: transparent;
}

.course-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
}

.course-card:active {
  transform: scale(0.98);
}

.course-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow, rgba(194, 58, 58, 0.15));
}

.course-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  line-height: 1.2;
}

.course-badge.active-badge {
  background: var(--accent);
  color: #fff;
  padding: 0.125rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
}

.course-badge.active-badge svg {
  width: 10px;
  height: 10px;
}

.course-badge.beta-badge {
  background: linear-gradient(135deg, #8b5cf6, #a78bfa);
  color: #fff;
}

.course-badge.new-badge {
  background: var(--accent);
  color: #fff;
}

.course-name {
  font-size: 0.9375rem;
  font-weight: 600;
}

.course-status {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Safe area */
.safe-area {
  height: 2rem;
  flex-shrink: 0;
}

/* ── Tablet (768px+) ── */
@media (min-width: 768px) {
  .browse-content {
    max-width: 600px;
    margin: 0 auto;
    padding: 0 2rem;
  }

  .course-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>

<!-- Belt pip future needs !important to override inline style attribute -->
<style>
:root[data-theme="mist"] .browse-screen .belt-pip.future {
  background: var(--bg-elevated) !important;
}
</style>
