<script setup>
import { ref, computed, onMounted } from 'vue'

const emit = defineEmits(['startLearning', 'viewJourney', 'openProfile', 'openSettings'])

// Mock data - in production this comes from Supabase
const courses = ref([
  {
    id: 'ita_for_eng_v2',
    title: 'Italian',
    subtitle: 'for English Speakers',
    flag: '🇮🇹',
    progress: 6.3,
    completedSeeds: 42,
    totalSeeds: 668,
    lastSession: '2 hours ago',
    streak: 7,
    isActive: true,
  },
  {
    id: 'spa_for_eng_v2',
    title: 'Spanish',
    subtitle: 'for English Speakers',
    flag: '🇪🇸',
    progress: 0,
    completedSeeds: 0,
    totalSeeds: 668,
    lastSession: null,
    streak: 0,
    isActive: false,
  },
])

const selectedCourse = ref(courses.value[0])

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

const activeCourse = computed(() => courses.value.find(c => c.isActive))
const activeBelt = computed(() => getCurrentBelt(activeCourse.value?.completedSeeds || 0))

// Greeting based on time
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
})

// Quick actions
const handleStartLearning = () => {
  emit('startLearning', selectedCourse.value)
}

const handleViewJourney = () => {
  emit('viewJourney', selectedCourse.value)
}
</script>

<template>
  <div class="home-screen">
    <!-- Background layers -->
    <div class="bg-gradient"></div>
    <div class="bg-stars"></div>
    <div class="bg-noise"></div>

    <!-- Floating elements -->
    <div class="ambient-glow glow-1"></div>
    <div class="ambient-glow glow-2"></div>

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

      <!-- Active Course Hero -->
      <section class="hero-card" v-if="activeCourse" @click="handleStartLearning">
        <div class="hero-bg">
          <div class="hero-pattern"></div>
        </div>
        <div class="hero-content">
          <div class="hero-header">
            <span class="course-flag">{{ activeCourse.flag }}</span>
            <div class="course-info">
              <h2 class="course-title">{{ activeCourse.title }}</h2>
              <span class="course-subtitle">{{ activeCourse.subtitle }}</span>
            </div>
            <div class="streak-badge" v-if="activeCourse.streak > 0">
              <span class="streak-icon">🔥</span>
              <span class="streak-count">{{ activeCourse.streak }}</span>
            </div>
          </div>

          <div class="hero-progress">
            <div class="progress-stats">
              <div class="belt-badge">
                <div class="belt-swatch" :style="{ background: activeBelt.color }"></div>
                <span class="belt-label">{{ activeBelt.label }}</span>
              </div>
              <span class="progress-text">{{ activeCourse.completedSeeds }} / {{ activeCourse.totalSeeds }} seeds</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: activeCourse.progress + '%' }"></div>
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
            <span class="stat-value">{{ activeCourse?.completedSeeds || 0 }}</span>
            <span class="stat-label">Seeds Mastered</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon flame">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2c-4 4-6 8-6 10a6 6 0 1 0 12 0c0-2-2-6-6-10z"/>
            </svg>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ activeCourse?.streak || 0 }}</span>
            <span class="stat-label">Day Streak</span>
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

      <!-- Other Courses -->
      <section class="courses-section" v-if="courses.filter(c => !c.isActive).length > 0">
        <h3 class="section-title">Other Languages</h3>
        <div class="course-list">
          <div
            v-for="course in courses.filter(c => !c.isActive)"
            :key="course.id"
            class="course-card"
            @click="selectedCourse = course"
          >
            <span class="course-flag">{{ course.flag }}</span>
            <div class="course-details">
              <span class="course-name">{{ course.title }}</span>
              <span class="course-status">
                {{ course.completedSeeds > 0 ? `${course.progress}% complete` : 'Not started' }}
              </span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      </section>
    </main>

    <!-- Bottom Safe Area -->
    <div class="safe-area"></div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.home-screen {
  --accent: #c23a3a;
  --accent-soft: rgba(194, 58, 58, 0.15);
  --gold: #d4a853;
  --gold-soft: rgba(212, 168, 83, 0.15);

  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #0a0a0f;
  font-family: 'DM Sans', sans-serif;
  position: relative;
  overflow-x: hidden;
}

/* Backgrounds */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 120% 80% at 50% -30%, rgba(194, 58, 58, 0.1) 0%, transparent 50%),
    radial-gradient(ellipse 80% 60% at 100% 100%, rgba(212, 168, 83, 0.08) 0%, transparent 50%);
  pointer-events: none;
}

.bg-stars {
  position: fixed;
  inset: 0;
  background-image:
    radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.3) 0%, transparent 100%),
    radial-gradient(1px 1px at 40% 70%, rgba(255,255,255,0.2) 0%, transparent 100%),
    radial-gradient(1px 1px at 60% 20%, rgba(255,255,255,0.4) 0%, transparent 100%),
    radial-gradient(1px 1px at 80% 50%, rgba(255,255,255,0.3) 0%, transparent 100%),
    radial-gradient(1px 1px at 10% 80%, rgba(255,255,255,0.2) 0%, transparent 100%),
    radial-gradient(1px 1px at 90% 90%, rgba(255,255,255,0.3) 0%, transparent 100%);
  pointer-events: none;
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.02;
  pointer-events: none;
}

.ambient-glow {
  position: fixed;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  filter: blur(100px);
  pointer-events: none;
  animation: glow-drift 20s ease-in-out infinite;
}

.glow-1 {
  top: -100px;
  right: -100px;
  background: rgba(194, 58, 58, 0.15);
}

.glow-2 {
  bottom: -100px;
  left: -100px;
  background: rgba(212, 168, 83, 0.1);
  animation-delay: -10s;
}

@keyframes glow-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(20px, 20px) scale(1.1); }
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
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: 1.125rem;
  letter-spacing: -0.02em;
}

.logo-say, .logo-in { color: var(--accent); }
.logo-something { color: white; }

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
  border-color: rgba(255, 255, 255, 0.2);
}

.icon-btn svg {
  width: 20px;
  height: 20px;
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
  font-size: 1.75rem;
  font-weight: 700;
  color: white;
  margin: 0 0 0.25rem 0;
}

.subtitle {
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.5);
  margin: 0;
}

/* Hero Card */
.hero-card {
  position: relative;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s ease;
  margin-bottom: 1.5rem;
}

.hero-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

.hero-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.hero-pattern {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 80% 20%, rgba(194, 58, 58, 0.1) 0%, transparent 50%),
    radial-gradient(circle at 20% 80%, rgba(212, 168, 83, 0.08) 0%, transparent 50%);
}

.hero-content {
  position: relative;
  padding: 1.5rem;
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
  color: white;
  margin: 0;
}

.course-subtitle {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.5);
}

.streak-badge {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: rgba(255, 149, 0, 0.15);
  border: 1px solid rgba(255, 149, 0, 0.3);
  border-radius: 100px;
}

.streak-icon {
  font-size: 0.875rem;
}

.streak-count {
  font-family: 'Space Mono', monospace;
  font-size: 0.875rem;
  font-weight: 700;
  color: #ff9500;
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
  color: rgba(255, 255, 255, 0.8);
}

.progress-text {
  font-family: 'Space Mono', monospace;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent) 0%, var(--gold) 100%);
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
  font-family: 'DM Sans', sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.btn svg {
  width: 18px;
  height: 18px;
}

.btn-primary {
  flex: 1;
  background: var(--accent);
  color: white;
  box-shadow: 0 4px 20px rgba(194, 58, 58, 0.3);
}

.btn-primary:hover {
  background: #d44545;
  transform: translateY(-1px);
  box-shadow: 0 6px 24px rgba(194, 58, 58, 0.4);
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.stat-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

.stat-icon {
  width: 32px;
  height: 32px;
  color: rgba(255, 255, 255, 0.4);
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
  font-size: 1.25rem;
  font-weight: 700;
  color: white;
}

.stat-label {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Courses Section */
.courses-section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.course-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
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
  color: white;
}

.course-status {
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.4);
}

.chevron {
  width: 20px;
  height: 20px;
  color: rgba(255, 255, 255, 0.3);
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
