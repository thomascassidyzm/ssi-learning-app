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

// Extract target language name from display_name or fall back to locale lookup
// e.g., "Welsh (North) for English Speakers" → "Welsh (North)"
const getTargetDisplayName = (course) => {
  if (course.display_name) {
    const match = course.display_name.match(/^(.+?)\s+for\s+/i)
    if (match) return match[1]
  }
  return getLangMeta(course.target_lang).name
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
    // Use display_name first (e.g., "Welsh (North)"), then target_lang lookup
    title: course.title || getTargetDisplayName(course),
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
                <path d="M18 20V10"/>
                <path d="M12 20V4"/>
                <path d="M6 20v-6"/>
              </svg>
              <span>Stats</span>
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
  padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.5rem 1rem 1.5rem;
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
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 0.625rem;
  font-weight: 700;
  color: white;
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

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE - Full breakpoint coverage
   ═══════════════════════════════════════════════════════════════ */

/* Extra small phones (320px) */
@media (max-width: 360px) {
  .header {
    padding: calc(0.5rem + env(safe-area-inset-top, 0px)) 0.75rem 0.5rem 0.75rem;
  }

  .brand {
    font-size: 0.9375rem;
  }

  .main {
    padding: 0 0.75rem;
  }

  .greeting-section {
    margin-bottom: 1rem;
  }

  .greeting {
    font-size: 1.25rem;
  }

  .subtitle {
    font-size: 0.8125rem;
  }

  .hero-card {
    border-radius: 16px;
    margin-bottom: 1rem;
  }

  .hero-content {
    padding: 1rem;
  }

  .hero-header {
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .course-flag {
    font-size: 1.75rem;
  }

  .course-title {
    font-size: 1.125rem;
  }

  .course-subtitle {
    font-size: 0.75rem;
  }

  .change-course-btn {
    width: 44px;
    height: 44px;
    border-radius: 10px;
  }

  .change-course-btn svg {
    width: 18px;
    height: 18px;
  }

  .belt-swatch {
    width: 14px;
    height: 14px;
  }

  .belt-label {
    font-size: 0.75rem;
  }

  .progress-text {
    font-size: 0.6875rem;
  }

  .hero-actions {
    flex-direction: column;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.875rem 1rem;
    min-height: 48px;
    font-size: 0.875rem;
    justify-content: center;
  }

  .btn-primary {
    flex: none;
  }

  .browse-section {
    margin-bottom: 1rem;
  }

  .browse-btn {
    padding: 0.875rem 1rem;
    border-radius: 14px;
    gap: 0.75rem;
    min-height: 56px;
  }

  .browse-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .browse-icon svg {
    width: 18px;
    height: 18px;
  }

  .browse-title {
    font-size: 0.9375rem;
  }

  .browse-subtitle {
    font-size: 0.75rem;
  }

  .icon-btn {
    min-width: 44px;
    min-height: 44px;
  }
}

/* Small phones (361-479px) */
@media (min-width: 361px) and (max-width: 479px) {
  .header {
    padding: calc(0.75rem + env(safe-area-inset-top, 0px)) 1rem 0.75rem 1rem;
  }

  .main {
    padding: 0 1rem;
  }

  .greeting {
    font-size: 1.375rem;
  }

  .hero-content {
    padding: 1.125rem;
  }

  .course-flag {
    font-size: 2rem;
  }

  .course-title {
    font-size: 1.25rem;
  }

  .hero-actions {
    flex-direction: column;
    gap: 0.625rem;
  }

  .btn {
    min-height: 48px;
  }

  .btn-primary {
    flex: none;
  }

  .change-course-btn {
    min-width: 44px;
    min-height: 44px;
  }
}

/* Phone landscape / small tablets (480-767px) */
@media (min-width: 480px) and (max-width: 767px) {
  .main {
    padding: 0 1.5rem;
    max-width: 540px;
    margin: 0 auto;
  }

  .greeting {
    font-size: 1.625rem;
  }

  .hero-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .btn-primary {
    flex: 1 1 100%;
  }

  .btn-ghost {
    flex: 1;
  }
}

/* Tablets (768-1023px) */
@media (min-width: 768px) and (max-width: 1023px) {
  .main {
    max-width: 640px;
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
    font-size: 3rem;
  }

  .course-title {
    font-size: 1.75rem;
  }

  .course-subtitle {
    font-size: 1rem;
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
    width: 26px;
    height: 26px;
  }

  .browse-title {
    font-size: 1.125rem;
  }

  .browse-subtitle {
    font-size: 0.9375rem;
  }
}

/* Laptops (1024-1279px) */
@media (min-width: 1024px) and (max-width: 1279px) {
  .home-screen {
    padding-bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  }

  .main {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 2.5rem;
  }

  .greeting-section {
    margin-bottom: 2.5rem;
  }

  .greeting {
    font-size: 2.25rem;
  }

  .hero-content {
    padding: 2rem;
  }

  .hero-actions {
    gap: 1rem;
  }
}

/* Desktops (1280-1535px) */
@media (min-width: 1280px) and (max-width: 1535px) {
  .home-screen {
    padding-bottom: calc(120px + env(safe-area-inset-bottom, 0px));
  }

  .header {
    padding: calc(1.5rem + env(safe-area-inset-top, 0px)) 3rem 1.5rem 3rem;
  }

  .brand {
    font-size: 1.25rem;
  }

  .main {
    max-width: 800px;
    margin: 0 auto;
    padding: 0 3rem;
  }

  .greeting-section {
    margin-bottom: 3rem;
  }

  .greeting {
    font-size: 2.5rem;
  }

  .subtitle {
    font-size: 1.125rem;
  }

  .hero-card {
    margin-bottom: 2rem;
  }

  .hero-content {
    padding: 2.5rem;
  }

  .course-flag {
    font-size: 3.5rem;
  }

  .course-title {
    font-size: 2rem;
  }

  .hero-progress {
    margin-bottom: 1.75rem;
  }

  .progress-bar {
    height: 8px;
  }

  .btn {
    padding: 1.125rem 1.75rem;
    font-size: 1.0625rem;
    border-radius: 14px;
  }

  .btn svg {
    width: 20px;
    height: 20px;
  }

  .browse-section {
    margin-bottom: 2rem;
  }

  .browse-btn {
    padding: 1.5rem 2rem;
  }
}

/* Large desktops and ultrawides (1536px+) */
@media (min-width: 1536px) {
  .home-screen {
    padding-bottom: calc(140px + env(safe-area-inset-bottom, 0px));
  }

  .header {
    padding: calc(2rem + env(safe-area-inset-top, 0px)) 4rem 2rem 4rem;
  }

  .brand {
    font-size: 1.375rem;
  }

  .main {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 4rem;
  }

  .greeting-section {
    margin-bottom: 3.5rem;
  }

  .greeting {
    font-size: 3rem;
  }

  .subtitle {
    font-size: 1.25rem;
  }

  .hero-card {
    border-radius: 28px;
    margin-bottom: 2.5rem;
  }

  .hero-content {
    padding: 3rem;
  }

  .hero-header {
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  .course-flag {
    font-size: 4rem;
  }

  .course-title {
    font-size: 2.5rem;
  }

  .course-subtitle {
    font-size: 1.125rem;
  }

  .hero-progress {
    margin-bottom: 2rem;
  }

  .belt-swatch {
    width: 20px;
    height: 20px;
    border-radius: 6px;
  }

  .belt-label {
    font-size: 1rem;
  }

  .progress-text {
    font-size: 0.9375rem;
  }

  .progress-bar {
    height: 10px;
    border-radius: 5px;
  }

  .hero-actions {
    gap: 1.25rem;
  }

  .btn {
    padding: 1.25rem 2rem;
    font-size: 1.125rem;
    border-radius: 16px;
  }

  .btn svg {
    width: 22px;
    height: 22px;
  }

  .change-course-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
  }

  .change-course-btn svg {
    width: 20px;
    height: 20px;
  }

  .browse-section {
    margin-bottom: 2.5rem;
  }

  .browse-btn {
    padding: 1.75rem 2.25rem;
    border-radius: 22px;
    gap: 1.5rem;
  }

  .browse-icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
  }

  .browse-icon svg {
    width: 30px;
    height: 30px;
  }

  .browse-title {
    font-size: 1.25rem;
  }

  .browse-subtitle {
    font-size: 1rem;
  }

  .browse-chevron {
    width: 24px;
    height: 24px;
  }

  .icon-btn {
    width: 48px;
    height: 48px;
  }

  .icon-btn svg {
    width: 22px;
    height: 22px;
  }
}

/* Landscape orientation */
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
