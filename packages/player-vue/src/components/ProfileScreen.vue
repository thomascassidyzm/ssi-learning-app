<script setup>
import { ref, computed } from 'vue'

const emit = defineEmits(['close'])

// Mock user data
const user = ref({
  name: 'Language Learner',
  email: 'learner@example.com',
  joinedDate: '2024-08-15',
  avatar: null, // Could be a URL
})

// Stats across all courses
const stats = ref({
  totalSeeds: 42,
  totalHours: 12.5,
  coursesStarted: 2,
  coursesCompleted: 0,
})

// Belt achievements earned
const beltAchievements = ref([
  { name: 'white', earnedDate: '2024-08-15', color: '#f5f5f5', label: 'Beginner' },
  { name: 'yellow', earnedDate: '2024-08-22', color: '#fcd34d', label: 'Explorer' },
  { name: 'orange', earnedDate: '2024-09-05', color: '#fb923c', label: 'Apprentice' },
  { name: 'green', earnedDate: '2024-10-01', color: '#4ade80', label: 'Practitioner' },
])

// Recent activity
const recentActivity = ref([
  { type: 'session', course: 'Italian', date: '2 hours ago', details: '15 minutes, 12 seeds' },
  { type: 'session', course: 'Italian', date: 'Yesterday', details: '22 minutes, 18 seeds' },
  { type: 'belt', course: 'Italian', date: '3 days ago', details: 'Earned Green Belt' },
  { type: 'session', course: 'Italian', date: '4 days ago', details: '18 minutes, 14 seeds' },
])

// Format dates
const formatDate = (dateStr) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Member since
const memberSince = computed(() => {
  return formatDate(user.value.joinedDate)
})

// Activity icon
const getActivityIcon = (type) => {
  switch (type) {
    case 'session': return 'play'
    case 'belt': return 'award'
    default: return 'circle'
  }
}
</script>

<template>
  <div class="profile-screen">
    <!-- Background layers -->
    <div class="bg-gradient"></div>
    <div class="bg-noise"></div>

    <!-- Header -->
    <header class="header">
      <h1 class="title">Profile</h1>
    </header>

    <!-- Main Content -->
    <main class="main">
      <!-- Profile Card -->
      <section class="profile-card">
        <div class="avatar">
          <span class="avatar-initial">{{ user.name.charAt(0).toUpperCase() }}</span>
        </div>
        <div class="profile-info">
          <h2 class="profile-name">{{ user.name }}</h2>
          <p class="profile-meta">Member since {{ memberSince }}</p>
        </div>
        <button class="edit-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </section>

      <!-- Stats Grid -->
      <section class="stats-grid">
        <div class="stat-tile">
          <span class="stat-value">{{ stats.totalSeeds }}</span>
          <span class="stat-label">Seeds Mastered</span>
        </div>
        <div class="stat-tile">
          <span class="stat-value">{{ stats.totalHours }}h</span>
          <span class="stat-label">Learning Time</span>
        </div>
        <div class="stat-tile">
          <span class="stat-value">{{ stats.coursesStarted }}</span>
          <span class="stat-label">Courses</span>
        </div>
      </section>

      <!-- Belt Collection -->
      <section class="section">
        <h3 class="section-title">Belt Collection</h3>
        <div class="belt-grid">
          <div
            v-for="belt in beltAchievements"
            :key="belt.name"
            class="belt-tile"
          >
            <div class="belt-visual" :style="{ background: belt.color }">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <span class="belt-name">{{ belt.label }}</span>
            <span class="belt-date">{{ formatDate(belt.earnedDate) }}</span>
          </div>
          <!-- Locked belts -->
          <div class="belt-tile locked">
            <div class="belt-visual">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <span class="belt-name">Adept</span>
            <span class="belt-date">38 seeds to go</span>
          </div>
        </div>
      </section>

      <!-- Recent Activity -->
      <section class="section">
        <h3 class="section-title">Recent Activity</h3>
        <div class="activity-list">
          <div
            v-for="(activity, idx) in recentActivity"
            :key="idx"
            class="activity-item"
          >
            <div class="activity-icon" :class="activity.type">
              <svg v-if="activity.type === 'session'" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3"/>
              </svg>
              <svg v-else-if="activity.type === 'belt'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="7"/>
                <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2c-4 4-6 8-6 10a6 6 0 1 0 12 0c0-2-2-6-6-10z"/>
              </svg>
            </div>
            <div class="activity-content">
              <span class="activity-details">{{ activity.details }}</span>
              <span class="activity-meta">
                <span v-if="activity.course">{{ activity.course }} · </span>
                {{ activity.date }}
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* Fonts loaded globally in style.css */

.profile-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: 'DM Sans', -apple-system, sans-serif;
  position: relative;
  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

/* Backgrounds */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 40% at 50% -10%, rgba(167, 139, 250, 0.06) 0%, transparent 50%),
    linear-gradient(to bottom, var(--bg-secondary) 0%, var(--bg-primary) 100%);
  pointer-events: none;
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
  justify-content: center;
  padding: 1rem 1.5rem;
}

.title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

/* Main */
.main {
  flex: 1;
  padding: 0 1.5rem 2rem;
  position: relative;
  z-index: 10;
  overflow-y: auto;
}

/* Profile Card */
.profile-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  margin-bottom: 1.5rem;
}

.avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--gradient-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar-initial {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-inverse);
}

.profile-info {
  flex: 1;
  min-width: 0;
}

.profile-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.25rem 0;
}

.profile-meta {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin: 0;
}

.edit-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.edit-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.edit-btn svg {
  width: 18px;
  height: 18px;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.stat-tile {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem;
  text-align: center;
}

.stat-tile.highlight {
  background: rgba(255, 149, 0, 0.1);
  border-color: rgba(255, 149, 0, 0.2);
}

.stat-tile.highlight .stat-value {
  color: #ff9500;
}

.stat-value {
  display: block;
  font-family: 'Space Mono', monospace;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Section */
.section {
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

/* Belt Grid */
.belt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 0.75rem;
}

.belt-tile {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

.belt-tile.locked {
  opacity: 0.5;
}

.belt-visual {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.belt-visual svg {
  width: 24px;
  height: 24px;
  color: rgba(0, 0, 0, 0.5);
}

.belt-tile.locked .belt-visual {
  background: var(--bg-elevated);
}

.belt-tile.locked .belt-visual svg {
  color: var(--text-muted);
}

.belt-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.belt-date {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

/* Activity List */
.activity-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.activity-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
}

.activity-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.activity-icon.session {
  background: var(--accent-glow);
  color: var(--accent);
}

.activity-icon.belt {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}

.activity-icon svg {
  width: 18px;
  height: 18px;
}

.activity-content {
  flex: 1;
  min-width: 0;
}

.activity-details {
  display: block;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.activity-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Responsive */
@media (max-width: 480px) {
  .header {
    padding: 0.75rem 1rem;
  }

  .main {
    padding: 0 1rem 1.5rem;
  }

  .profile-card {
    padding: 1rem;
  }

  .avatar {
    width: 56px;
    height: 56px;
  }

  .profile-name {
    font-size: 1.125rem;
  }

  .stats-grid {
    gap: 0.5rem;
  }

  .stat-tile {
    padding: 0.875rem;
  }

  .stat-value {
    font-size: 1.25rem;
  }

  .belt-grid {
    grid-template-columns: repeat(auto-fill, minmax(85px, 1fr));
    gap: 0.5rem;
  }

  .belt-tile {
    padding: 0.75rem;
  }

  .belt-visual {
    width: 40px;
    height: 40px;
  }
}

@media (min-width: 768px) {
  .main {
    max-width: 600px;
    margin: 0 auto;
  }

  .stats-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
