<script setup>
import { ref, computed, onMounted } from 'vue'
import CourseSelector from './CourseSelector.vue'

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

const emit = defineEmits(['startLearning', 'viewJourney', 'selectCourse', 'openExplorer'])

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
    title: course.title || targetMeta.name,
    subtitle: course.subtitle || `for ${knownMeta.name} Speakers`,
    target_flag: course.target_flag || targetMeta.flag,
    // Progress fields (from learner data or defaults)
    completedSeeds: course.completedSeeds || course.completed_seeds || 0,
    totalSeeds: course.totalSeeds || course.total_seeds || 668,
    progress: course.progress || 0,
  }
})

// Belt for display
const BELT_CONFIG = {
  belts: [
    { name: 'white',   seedsRequired: 0,   color: '#f5f5f5', label: 'Beginner' },
    { name: 'yellow',  seedsRequired: 8,   color: '#fcd34d', label: 'Explorer' },
    { name: 'orange',  seedsRequired: 20,  color: '#fb923c', label: 'Apprentice' },
    { name: 'green',   seedsRequired: 40,  color: '#4ade80', label: 'Practitioner' },
    { name: 'blue',    seedsRequired: 80,  color: '#60a5fa', label: 'Adept' },
    { name: 'purple',  seedsRequired: 150, color: '#a78bfa', label: 'Master' },
    { name: 'brown',   seedsRequired: 280, color: '#a8856c', label: 'Expert' },
    { name: 'black',   seedsRequired: 400, color: '#1f1f1f', label: 'Sensei' },
  ]
}

const getCurrentBelt = (seeds) => {
  const belts = BELT_CONFIG.belts
  for (let i = belts.length - 1; i >= 0; i--) {
    if (seeds >= belts[i].seedsRequired) {
      return belts[i]
    }
  }
  return belts[0]
}

const activeBelt = computed(() => getCurrentBelt(activeCourseData.value?.completedSeeds || 0))

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

const handleViewScript = () => {
  emit('openExplorer')
}

// Course selection
const handleCourseSelect = (course) => {
  showCourseSelector.value = false
  emit('selectCourse', course)
}

const openCourseSelector = () => {
  showCourseSelector.value = true
}
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
              <h2 class="course-title">{{ activeCourseData.title }}</h2>
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
              <span class="progress-text">{{ activeCourseData.completedSeeds || 0 }} / {{ activeCourseData.totalSeeds || activeCourseData.total_seeds || 668 }} seeds</span>
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
            <button class="btn btn-ghost" @click.stop="handleViewScript">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <span>View Script</span>
            </button>
            <button class="btn btn-ghost" @click.stop="handleViewJourney">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
                <path d="M13 13l6 6"/>
              </svg>
              <span>View Journey</span>
            </button>
          </div>
        </div>
      </section>

      <!-- Quick Stats -->
      <section class="stats-row">
        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ activeCourseData?.completedSeeds || 0 }}</span>
            <span class="stat-label">Seeds Mastered</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div class="stat-content">
            <span class="stat-value">1.2h</span>
            <span class="stat-label">This Week</span>
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
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.home-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: 'DM Sans', -apple-system, sans-serif;
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
  padding: 1rem 1.5rem;
}

.brand {
  font-family: 'DM Sans', -apple-system, sans-serif;
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

.course-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
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
  font-family: 'DM Sans', -apple-system, sans-serif;
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

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.625rem;
  margin-bottom: 1.75rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 0.875rem 0.75rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  text-align: center;
}

.stat-icon {
  width: 26px;
  height: 26px;
  color: var(--text-muted);
}

.stat-icon.flame {
  color: #ff9500;
}

.stat-icon svg {
  width: 100%;
  height: 100%;
}

.stat-content {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.stat-label {
  font-size: 0.5625rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Courses Section */
.courses-section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 1rem 0;
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

/* Safe Area */
.safe-area {
  height: 2rem;
  flex-shrink: 0;
}

/* Responsive */
@media (max-width: 480px) {
  .header {
    padding: 0.75rem 1rem;
  }

  .main {
    padding: 0 1rem;
  }

  .greeting {
    font-size: 1.5rem;
  }

  .hero-content {
    padding: 1.25rem;
  }

  .course-flag {
    font-size: 2rem;
  }

  .course-title {
    font-size: 1.25rem;
  }

  .hero-actions {
    flex-direction: column;
  }

  .btn-primary {
    flex: none;
  }

  .stats-row {
    gap: 0.5rem;
  }

  .stat-card {
    padding: 0.75rem;
  }

  .stat-value {
    font-size: 1.125rem;
  }
}

@media (min-width: 768px) {
  .main {
    max-width: 600px;
    margin: 0 auto;
  }

  .greeting {
    font-size: 2rem;
  }

  .stats-row {
    gap: 1rem;
  }

  .stat-card {
    padding: 1.25rem;
  }
}
</style>
