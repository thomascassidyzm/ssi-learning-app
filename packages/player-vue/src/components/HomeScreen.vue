<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import CourseSelector from './CourseSelector.vue'
import { BELTS } from '@/composables/useBeltProgress'

// Language metadata mapping (3-letter codes to display info)
const LANGUAGE_META = {
  eng: { name: 'English', flag: '🇬🇧' },
  spa: { name: 'Spanish', flag: '🇪🇸' },
  ita: { name: 'Italian', flag: '🇮🇹' },
  fra: { name: 'French', flag: '🇫🇷' },
  deu: { name: 'German', flag: '🇩🇪' },
  por: { name: 'Portuguese', flag: '🇵🇹' },
  cym: { name: 'Welsh', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  jpn: { name: 'Japanese', flag: '🇯🇵' },
  zho: { name: 'Chinese', flag: '🇨🇳' },
  kor: { name: 'Korean', flag: '🇰🇷' },
  ara: { name: 'Arabic', flag: '🇸🇦' },
  nld: { name: 'Dutch', flag: '🇳🇱' },
  rus: { name: 'Russian', flag: '🇷🇺' },
  pol: { name: 'Polish', flag: '🇵🇱' },
}

const getLangMeta = (code) => LANGUAGE_META[code] || { name: code?.toUpperCase() || '?', flag: '🌐' }

// Get display name for target language
// Strips " for X Speakers" suffix if present, otherwise uses display_name as-is
// Falls back to language code lookup if no display_name
const getTargetDisplayName = (course) => {
  if (!course.display_name) {
    return getLangMeta(course.target_lang).name
  }
  // Strip " for ..." suffix if present
  return course.display_name.replace(/\s+for\s+.+$/i, '')
}

const props = defineProps({
  supabase: {
    type: Object,
    required: true
  },
  activeCourse: {
    type: Object,
    default: null
  },
  enrolledCourses: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['startLearning', 'viewJourney', 'selectCourse', 'viewBrainMap'])

const router = useRouter()

// Schools access — god mode for now, later checks user_tags for teacher/admin role
const hasSchoolsAccess = computed(() => {
  try { return !!localStorage.getItem('ssi-dev-role') } catch { return false }
})

// Course selector state
const showCourseSelector = ref(false)

// Normalize course data from database to display format
const activeCourseData = computed(() => {
  const course = props.activeCourse
  if (!course) {
    // No course yet - will show loading state
    return null
  }

  // Get language metadata for display
  const targetMeta = getLangMeta(course.target_lang)
  const knownMeta = getLangMeta(course.known_lang)

  return {
    ...course,
    // Display fields derived from database fields
    // Use display_name first (e.g., "Welsh (North)", "Chinese (Concept-First Experiment)")
    title: getTargetDisplayName(course),
    subtitle: course.subtitle || `for ${knownMeta.name} Speakers`,
    target_flag: course.target_flag || targetMeta.flag,
    // Progress fields (from learner data or defaults)
    completedRounds: course.completedRounds || course.completed_seeds || 0,
    totalSeeds: course.totalSeeds || course.total_seeds || 668,
    progress: course.progress || 0,
  }
})

// Belt for display — uses shared BELTS from useBeltProgress
const getCurrentBelt = (seeds) => {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seeds >= BELTS[i].seedsRequired) {
      return BELTS[i]
    }
  }
  return BELTS[0]
}

const activeBelt = computed(() => getCurrentBelt(activeCourseData.value?.completedRounds || 0))

// Greeting based on time
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
})

// Quick actions
const handleStartLearning = () => {
  emit('startLearning', activeCourseData.value)
}

const handleViewJourney = () => {
  emit('viewJourney', activeCourseData.value)
}

// Course selection
const handleCourseSelect = (course) => {
  showCourseSelector.value = false
  emit('selectCourse', course)
}

const openCourseSelector = () => {
  showCourseSelector.value = true
}

// ============================================
// USAGE STATS SECTION
// ============================================

// Stats data - would come from database in production
const usageStats = computed(() => ({
  totalMinutes: activeCourseData.value?.totalMinutes || 47,
  totalWordsIntroduced: activeCourseData.value?.completedRounds || 0,
  totalPhrasesSpoken: (activeCourseData.value?.completedRounds || 0) * 5,
}))

// Format total time as hours and minutes
const formattedTotalTime = computed(() => {
  const mins = usageStats.value.totalMinutes
  const hours = Math.floor(mins / 60)
  if (hours === 0) {
    return `${mins}m`
  }
  return `${hours}h ${mins % 60}m`
})

// ============================================
// MINI BRAIN VISUALIZATION
// ============================================

// Seeded random for deterministic dot placement
const seededRandom = (seed) => {
  let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Generate dots inside a brain-shaped boundary
const brainDots = computed(() => {
  const count = Math.min(activeCourseData.value?.completedRounds || 0, 120)
  const dots = []
  const cx = 60  // center x
  const cy = 50  // center y
  const rx = 45  // horizontal radius
  const ry = 38  // vertical radius

  for (let i = 0; i < count; i++) {
    // Deterministic placement using seeded random
    const angle = seededRandom(i * 2) * Math.PI * 2
    const dist = Math.sqrt(seededRandom(i * 2 + 1)) * 0.85 // sqrt for uniform distribution
    const x = cx + Math.cos(angle) * rx * dist
    const y = cy + Math.sin(angle) * ry * dist
    const r = 1.2 + seededRandom(i * 3) * 1.0 // radius 1.2-2.2
    const opacity = 0.3 + seededRandom(i * 3 + 1) * 0.5 // opacity 0.3-0.8
    dots.push({ x, y, r, opacity })
  }
  return dots
})

// Brain boundary path (elliptical with slight lobes)
const brainPath = computed(() => {
  return 'M60,12 C82,12 104,28 104,50 C104,72 82,88 60,88 C38,88 16,72 16,50 C16,28 38,12 60,12 Z'
})
</script>

<template>
  <div class="home-screen">
    <!-- Background layers -->
    <div class="bg-gradient"></div>
    <div class="bg-stars"></div>
    <div class="bg-noise"></div>

    <!-- Header -->
    <header class="header">
      <div class="brand">
        <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
      </div>
    </header>

    <!-- Main Content -->
    <main class="main">
      <!-- Greeting Section -->
      <section class="greeting-section">
        <h1 class="greeting">{{ greeting }}</h1>
        <p class="subtitle">Ready to continue your journey?</p>
      </section>

      <!-- Mini Brain Visualization -->
      <div v-if="activeCourseData" class="mini-brain" @click="emit('viewBrainMap')">
        <svg viewBox="0 0 120 100" class="brain-svg">
          <!-- Brain outline with belt-colored glow -->
          <path
            :d="brainPath"
            fill="none"
            :stroke="activeBelt.color"
            stroke-width="1.5"
            :opacity="0.5"
          />
          <!-- Glow filter -->
          <defs>
            <filter id="brain-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          <!-- Glowing boundary -->
          <path
            :d="brainPath"
            fill="none"
            :stroke="activeBelt.color"
            stroke-width="0.8"
            :opacity="0.25"
            filter="url(#brain-glow)"
          />
          <!-- Dots inside brain (LEGOs learned) -->
          <circle
            v-for="(dot, i) in brainDots"
            :key="i"
            :cx="dot.x"
            :cy="dot.y"
            :r="dot.r"
            :fill="activeBelt.color"
            :opacity="dot.opacity"
          />
        </svg>
        <span class="brain-label">{{ activeCourseData.completedRounds || 0 }} words learned</span>
      </div>

      <!-- Active Course Hero (only render when course loaded) -->
      <section class="hero-card" v-if="activeCourseData">
        <div class="hero-bg">
          <div class="hero-pattern"></div>
        </div>
        <div class="hero-content">
          <!-- Course Header - Tappable to change course -->
          <div class="hero-header" @click="openCourseSelector">
            <span class="course-flag">{{ activeCourseData.target_flag || activeCourseData.flag }}</span>
            <div class="course-info">
              <div class="course-title-row">
                <h2 class="course-title">{{ activeCourseData.title }}</h2>
                <span v-if="activeCourseData.status === 'beta'" class="beta-badge">BETA</span>
              </div>
              <span class="course-subtitle">{{ activeCourseData.subtitle }}</span>
            </div>
            <!-- Change course indicator -->
            <button class="change-course-btn" @click.stop="openCourseSelector">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
          </div>

          <div class="hero-progress">
            <div class="progress-stats">
              <div class="belt-badge">
                <div class="belt-swatch" :style="{ background: activeBelt.color }"></div>
                <span class="belt-label">{{ activeBelt.label }}</span>
              </div>
              <span class="progress-text">{{ activeCourseData.completedRounds || 0 }} / {{ activeCourseData.totalSeeds || activeCourseData.total_seeds || 668 }} seeds</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: (activeCourseData.progress || 0) + '%' }"></div>
            </div>
          </div>

          <div class="hero-actions">
            <button class="btn btn-primary" @click.stop="handleStartLearning">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3"/>
              </svg>
              <span>Continue Learning</span>
            </button>
            <button class="btn btn-ghost" @click.stop="handleViewJourney">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 20V10"/>
                <path d="M12 20V4"/>
                <path d="M6 20v-6"/>
              </svg>
              <span>Progress</span>
            </button>
          </div>
        </div>
      </section>

      <!-- Browse Courses Button -->
      <section class="browse-section">
        <button class="browse-btn" @click="openCourseSelector">
          <div class="browse-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <div class="browse-content">
            <span class="browse-title">Browse All Courses</span>
            <span class="browse-subtitle">Learn another language or try language chaining</span>
          </div>
          <svg class="browse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </section>

      <!-- Usage Stats Section -->
      <section class="usage-section" v-if="activeCourseData">
        <h3 class="section-title">Your Activity</h3>

        <!-- Stats Cards -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="stat-value">{{ formattedTotalTime }}</div>
            <div class="stat-label">Total Time</div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </div>
            <div class="stat-value">{{ usageStats.totalWordsIntroduced }}</div>
            <div class="stat-label">Words</div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              </svg>
            </div>
            <div class="stat-value">{{ usageStats.totalPhrasesSpoken }}</div>
            <div class="stat-label">Phrases</div>
          </div>
        </div>

      </section>

      <!-- Schools Dashboard Link (for teachers/admins) -->
      <section v-if="hasSchoolsAccess" class="schools-section">
        <button class="browse-btn" @click="router.push('/schools')">
          <div class="schools-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M2 10l10-7 10 7"/>
              <path d="M4 10v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V10"/>
              <path d="M10 21V14h4v7"/>
            </svg>
          </div>
          <div class="browse-content">
            <span class="browse-title">My School</span>
            <span class="browse-subtitle">Classes, students and progress</span>
          </div>
          <svg class="browse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </section>

    </main>

    <!-- Bottom Safe Area -->
    <div class="safe-area"></div>

    <!-- Course Selector Sheet -->
    <CourseSelector
      :isOpen="showCourseSelector"
      :supabase="supabase"
      :enrolledCourses="enrolledCourses"
      :activeCourseId="activeCourseData?.course_code || activeCourseData?.id"
      :defaultKnownLang="activeCourseData?.known_lang || 'eng'"
      @close="showCourseSelector = false"
      @selectCourse="handleCourseSelect"
    />
  </div>
</template>

<style scoped>
.home-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: var(--font-body);
  position: relative;
  overflow-x: hidden;
  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

/* Backgrounds */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 100% 60% at 50% -20%, var(--accent-glow) 0%, transparent 50%),
    linear-gradient(to bottom, var(--bg-secondary) 0%, var(--bg-primary) 100%);
  pointer-events: none;
}

.bg-stars {
  position: fixed;
  inset: 0;
  background-image:
    radial-gradient(1.5px 1.5px at 18% 25%, var(--text-muted) 0%, transparent 100%),
    radial-gradient(1px 1px at 38% 65%, var(--text-muted) 0%, transparent 100%),
    radial-gradient(1.2px 1.2px at 58% 15%, var(--text-muted) 0%, transparent 100%),
    radial-gradient(1px 1px at 78% 48%, var(--text-muted) 0%, transparent 100%),
    radial-gradient(0.8px 0.8px at 12% 75%, var(--text-muted) 0%, transparent 100%),
    radial-gradient(1px 1px at 88% 85%, var(--text-muted) 0%, transparent 100%);
  animation: starfield 8s ease-in-out infinite;
  pointer-events: none;
}

@keyframes starfield {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.02;
  pointer-events: none;
}


/* Header */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.5rem 1rem 1.5rem;
}

.brand {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 1.0625rem;
  letter-spacing: -0.02em;
}

.logo-say, .logo-in { color: var(--accent); }
.logo-something { color: var(--text-primary); }

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.icon-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.icon-btn svg {
  width: 18px;
  height: 18px;
}

/* Main */
.main {
  flex: 1;
  padding: 0 1.5rem;
  position: relative;
  z-index: 10;
}

/* Greeting */
.greeting-section {
  margin-bottom: 1.5rem;
}

.greeting {
  font-size: 1.625rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.25rem 0;
  letter-spacing: -0.02em;
}

.subtitle {
  font-size: 0.9375rem;
  color: var(--text-muted);
  margin: 0;
}

/* Hero Card */
.hero-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.25s ease;
  margin-bottom: 1.5rem;
  -webkit-tap-highlight-color: transparent;
}

.hero-card:hover {
  border-color: var(--border-medium);
  transform: translateY(-1px);
}

.hero-card:active {
  transform: scale(0.99);
}

.hero-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.hero-pattern {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 85% 15%, var(--accent-glow) 0%, transparent 50%);
}

.hero-content {
  position: relative;
  padding: 1.25rem;
}

.hero-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.course-flag {
  font-size: 2.5rem;
  line-height: 1;
}

.course-info {
  flex: 1;
}

.course-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.course-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.beta-badge {
  padding: 0.2rem 0.5rem;
  background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
  border-radius: 4px;
  font-family: var(--font-body);
  font-size: 0.625rem;
  font-weight: 700;
  color: var(--text-inverse);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.course-subtitle {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.hero-progress {
  margin-bottom: 1.25rem;
}

.progress-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.belt-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.belt-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.belt-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.progress-text {
  font-family: 'Space Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.progress-bar {
  height: 6px;
  background: var(--bg-elevated);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--gradient-accent);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  border: none;
  -webkit-tap-highlight-color: transparent;
}

.btn svg {
  width: 16px;
  height: 16px;
}

.btn-primary {
  flex: 1;
  background: var(--gradient-accent);
  color: var(--text-inverse);
  box-shadow: var(--glow-accent);
}

.btn-primary:hover {
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: scale(0.98);
}

.btn-ghost {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.btn-ghost:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.btn-ghost:active {
  transform: scale(0.98);
}

.course-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.course-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.course-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
}

.course-card .course-flag {
  font-size: 1.75rem;
}

.course-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.course-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.course-status {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.chevron {
  width: 20px;
  height: 20px;
  color: var(--text-muted);
}

/* Change Course Button */
.change-course-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
  margin-left: auto;
}

.change-course-btn:hover {
  background: var(--bg-card);
  color: var(--text-secondary);
  border-color: var(--border-medium);
}

.change-course-btn svg {
  width: 16px;
  height: 16px;
}

/* Browse Courses Section */
.browse-section {
  margin-bottom: 1.5rem;
}

.browse-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.browse-btn:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
  transform: translateY(-1px);
}

.browse-btn:active {
  transform: scale(0.99);
}

.browse-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--accent-glow);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.browse-icon svg {
  width: 22px;
  height: 22px;
  color: var(--accent);
}

.browse-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.browse-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.browse-subtitle {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.browse-chevron {
  width: 20px;
  height: 20px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Schools Section */
.schools-section {
  margin-bottom: 1.5rem;
}

.schools-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(139, 92, 246, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.schools-icon svg {
  width: 22px;
  height: 22px;
  color: #a78bfa;
}

/* Safe Area */
.safe-area {
  height: 2rem;
  flex-shrink: 0;
}

/* ═══════════════════════════════════════════════════════════════
   USAGE STATS SECTION
   ═══════════════════════════════════════════════════════════════ */

.usage-section {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0.25rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-bottom: 1rem;
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

/* ═══════════════════════════════════════════════════════════════
   MINI BRAIN VISUALIZATION
   ═══════════════════════════════════════════════════════════════ */

.mini-brain {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 1rem;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.2s ease;
}

.mini-brain:active {
  transform: scale(0.97);
}

.brain-svg {
  width: 120px;
  height: 100px;
}

.brain-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE - Simplified 2-breakpoint system
   Base: Mobile (0-767px)
   768px+: Tablet/Desktop
   ═══════════════════════════════════════════════════════════════ */

/* Tablet and Desktop (768px+) */
@media (min-width: 768px) {
  .main {
    max-width: 600px;
    margin: 0 auto;
    padding: 0 2rem;
  }

  .greeting-section {
    margin-bottom: 2rem;
  }

  .greeting {
    font-size: 2rem;
  }

  .subtitle {
    font-size: 1rem;
  }

  .hero-card {
    border-radius: 24px;
  }

  .hero-content {
    padding: 1.5rem;
  }

  .course-flag {
    font-size: 2.5rem;
  }

  .course-title {
    font-size: 1.5rem;
  }

  .course-subtitle {
    font-size: 0.9375rem;
  }

  .btn {
    padding: 1rem 1.5rem;
    font-size: 1rem;
  }

  .browse-btn {
    padding: 1.25rem 1.5rem;
    border-radius: 20px;
  }

  .browse-icon {
    width: 48px;
    height: 48px;
  }

  .browse-icon svg {
    width: 24px;
    height: 24px;
  }

  .browse-title {
    font-size: 1.125rem;
  }
}

/* Landscape phones - compact vertical spacing */
@media (orientation: landscape) and (max-height: 500px) {
  .home-screen {
    padding-bottom: calc(60px + env(safe-area-inset-bottom, 0px));
  }

  .header {
    padding: 0.5rem 1rem;
  }

  .main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    align-items: start;
    max-width: none;
  }

  .greeting-section {
    grid-column: 1 / -1;
    margin-bottom: 0.5rem;
  }

  .greeting {
    font-size: 1.25rem;
    margin-bottom: 0;
  }

  .subtitle {
    display: none;
  }

  .hero-card {
    margin-bottom: 0;
  }

  .hero-content {
    padding: 0.75rem;
  }

  .hero-header {
    margin-bottom: 0.5rem;
  }

  .course-flag {
    font-size: 1.5rem;
  }

  .course-title {
    font-size: 1rem;
  }

  .hero-progress {
    margin-bottom: 0.5rem;
  }

  .hero-actions {
    flex-direction: row;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    min-height: 36px;
  }

  .browse-section {
    margin-bottom: 0;
  }

  .browse-btn {
    padding: 0.75rem 1rem;
  }

  .browse-subtitle {
    display: none;
  }
}
</style>
