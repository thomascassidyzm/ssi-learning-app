<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue'
import JoinCodeBanner from '@/components/schools/JoinCodeBanner.vue'
import StatsCard from '@/components/schools/StatsCard.vue'
import type { useSchoolsData } from '@/composables/useSchoolsData'

// Injected from SchoolsContainer
const schoolsData = inject<ReturnType<typeof useSchoolsData>>('schoolsData')!
const devUser = inject<any>('devUser')

// Live data
const schoolName = ref('Loading...')
const adminName = ref('')
const teacherJoinCode = ref('')

const stats = ref({
  teachers: { count: 0, trend: null as string | null },
  students: { count: 0, trend: null as string | null },
  classes: { count: 0, trend: null as string | null },
  phrasesThisWeek: { count: 0, trend: null as string | null },
})

const teachers = ref<any[]>([])

// Load data from Supabase
onMounted(async () => {
  const userId = devUser?.value?.id ?? 'admin-001'
  const school = await schoolsData.getSchoolForUser(userId)
  if (!school) {
    schoolName.value = 'No school found'
    return
  }

  schoolName.value = school.school_name
  teacherJoinCode.value = school.teacher_join_code
  adminName.value = devUser?.value?.name?.split(' ')[0] ?? 'Admin'

  // Fetch summary
  const summary = await schoolsData.getSchoolSummary(school.id)
  if (summary) {
    stats.value = {
      teachers: { count: summary.teacher_count, trend: null },
      students: { count: summary.student_count, trend: null },
      classes: { count: summary.class_count, trend: null },
      phrasesThisWeek: { count: Math.round(summary.total_practice_hours * 60), trend: null },
    }
  }

  // Fetch teacher list
  const teacherList = await schoolsData.getTeachers(school.id)
  teachers.value = teacherList.map((t, i) => ({
    id: i + 1,
    name: t.name === t.user_id ? `Teacher ${i + 1}` : t.name,
    initials: t.name === t.user_id ? `T${i + 1}` : t.name.split(' ').map((n: string) => n[0]).join(''),
    course: 'Welsh',
    belt: 'white',
    classCount: 0,
    studentCount: 0,
  }))
})

const recentActivity = ref([
  {
    id: 1,
    type: 'join',
    icon: 'celebration',
    text: 'Megan Davies joined Sian\'s Welsh 101 class',
    highlight: 'Megan Davies',
    time: '2 minutes ago'
  },
  {
    id: 2,
    type: 'achievement',
    icon: 'trophy',
    text: 'Gareth Llywelyn earned Yellow Belt!',
    highlight: 'Gareth Llywelyn',
    time: '15 minutes ago'
  },
  {
    id: 3,
    type: 'progress',
    icon: 'chart',
    text: 'Welsh 201 reached 500 phrases milestone',
    highlight: 'Welsh 201',
    time: '1 hour ago'
  },
  {
    id: 4,
    type: 'class',
    icon: 'book',
    text: 'Elen Williams created a new class',
    highlight: 'Elen Williams',
    time: '3 hours ago'
  }
])

const weeklyProgress = ref({
  bars: [
    { day: 'M', value: 65 },
    { day: 'T', value: 80 },
    { day: 'W', value: 45 },
    { day: 'T', value: 90 },
    { day: 'F', value: 70 },
    { day: 'S', value: 30, isToday: true },
    { day: 'S', value: 0 }
  ],
  hoursLearned: 847,
  engagement: 92
})

const beltGradients: Record<string, string> = {
  white: 'linear-gradient(135deg, #f5f5f5, #e0e0e0)',
  yellow: 'linear-gradient(135deg, #fbbf24, #d97706)',
  orange: 'linear-gradient(135deg, #f97316, #ea580c)',
  green: 'linear-gradient(135deg, #22c55e, #16a34a)',
  blue: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  brown: 'linear-gradient(135deg, #92400e, #78350f)',
  black: 'linear-gradient(135deg, #1f2937, #111827)'
}

const beltColors: Record<string, string> = {
  white: '#333',
  yellow: '#333',
  orange: '#fff',
  green: '#fff',
  blue: '#fff',
  brown: '#fff',
  black: '#fff'
}

function handleCopyCode() {
  // Analytics tracking could go here
  console.log('Join code copied')
}

function handleRegenerateCode() {
  // API call to regenerate code
  console.log('Regenerating join code...')
}

// Animation state
const isVisible = ref(false)
onMounted(() => {
  setTimeout(() => {
    isVisible.value = true
  }, 50)
})
</script>

<template>
  <div class="dashboard" :class="{ 'is-visible': isVisible }">
    <!-- Mountain Background -->
    <div class="bg-mountains">
      <svg class="mountain-layer back" viewBox="0 0 1440 300" preserveAspectRatio="none">
        <path d="M0,300 L0,150 Q180,80 360,150 T720,120 T1080,160 T1440,140 L1440,300 Z"/>
      </svg>
      <svg class="mountain-layer mid" viewBox="0 0 1440 300" preserveAspectRatio="none">
        <path d="M0,300 L0,180 Q240,100 480,180 T960,150 T1440,170 L1440,300 Z"/>
      </svg>
      <svg class="mountain-layer front" viewBox="0 0 1440 300" preserveAspectRatio="none">
        <path d="M0,300 L0,220 Q360,160 720,220 T1440,200 L1440,300 Z"/>
      </svg>

      <!-- Decorative elements -->
      <svg class="torii-gate" viewBox="0 0 40 50" fill="currentColor">
        <rect x="2" y="8" width="4" height="42"/>
        <rect x="34" y="8" width="4" height="42"/>
        <rect x="0" y="0" width="40" height="6" rx="1"/>
        <rect x="4" y="12" width="32" height="4"/>
      </svg>
    </div>

    <div class="dashboard-content">
      <!-- Header -->
      <header class="dashboard-header animate-item" :class="{ 'show': isVisible }">
        <div class="welcome-section">
          <h1>Welcome back, <span class="highlight">{{ adminName }}</span></h1>
          <p>{{ schoolName }} &bull; School Administrator</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-secondary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Data
          </button>
          <button class="btn btn-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Teacher
          </button>
        </div>
      </header>

      <!-- Join Code Banner - HERO ELEMENT -->
      <div class="join-code-wrapper animate-item delay-1" :class="{ 'show': isVisible }">
        <JoinCodeBanner
          :code="teacherJoinCode"
          label="Teacher Join Code"
          description="Share this code with teachers to let them join your school"
          variant="teacher"
          :can-regenerate="true"
          @copy="handleCopyCode"
          @regenerate="handleRegenerateCode"
        />
      </div>

      <!-- Stats Grid -->
      <div class="stats-grid animate-item delay-2" :class="{ 'show': isVisible }">
        <StatsCard
          :value="stats.teachers.count"
          label="Teachers"
          icon="teacher"
          variant="red"
          :trend="{ value: stats.teachers.trend, direction: 'up' }"
        />
        <StatsCard
          :value="stats.students.count"
          label="Students"
          icon="martial-arts"
          variant="gold"
          :trend="{ value: stats.students.trend, direction: 'up' }"
        />
        <StatsCard
          :value="stats.classes.count"
          label="Active Classes"
          icon="book"
          variant="green"
        />
        <StatsCard
          :value="stats.phrasesThisWeek.count"
          label="Phrases Learned This Week"
          icon="lightning"
          variant="blue"
          :trend="{ value: stats.phrasesThisWeek.trend, direction: 'up' }"
        />
      </div>

      <!-- Main Grid -->
      <div class="main-grid animate-item delay-3" :class="{ 'show': isVisible }">
        <!-- Teachers Panel -->
        <div class="card teachers-card">
          <div class="card-header">
            <h2 class="card-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Your Teachers
            </h2>
            <router-link to="/teachers" class="btn btn-secondary btn-sm">
              View All
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </router-link>
          </div>
          <div class="card-body">
            <div
              v-for="teacher in teachers"
              :key="teacher.id"
              class="teacher-item"
            >
              <div
                class="teacher-avatar"
                :style="{
                  background: beltGradients[teacher.belt],
                  color: beltColors[teacher.belt]
                }"
              >
                {{ teacher.initials }}
              </div>
              <div class="teacher-info">
                <div class="teacher-name">{{ teacher.name }}</div>
                <div class="teacher-meta">
                  <span class="meta-course">{{ teacher.course }}</span>
                  <span class="meta-belt" :class="teacher.belt">
                    {{ teacher.belt.charAt(0).toUpperCase() + teacher.belt.slice(1) }} Belt
                  </span>
                </div>
              </div>
              <div class="teacher-stats">
                <div class="teacher-stat">
                  <div class="stat-value">{{ teacher.classCount }}</div>
                  <div class="stat-label">Classes</div>
                </div>
                <div class="teacher-stat">
                  <div class="stat-value">{{ teacher.studentCount }}</div>
                  <div class="stat-label">Students</div>
                </div>
              </div>
              <div class="teacher-actions">
                <button class="icon-btn" title="View Details">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <button class="icon-btn" title="Message">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column -->
        <div class="right-column">
          <!-- Weekly Progress -->
          <div class="card progress-card">
            <div class="card-header">
              <h2 class="card-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="20" x2="18" y2="10"/>
                  <line x1="12" y1="20" x2="12" y2="4"/>
                  <line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
                This Week
              </h2>
            </div>
            <div class="card-body">
              <div class="progress-chart">
                <div class="progress-bars">
                  <div
                    v-for="bar in weeklyProgress.bars"
                    :key="bar.day"
                    class="day-bar"
                  >
                    <div class="bar-container">
                      <div
                        class="bar-fill"
                        :style="{ height: `${bar.value}%` }"
                      ></div>
                    </div>
                    <span class="day-label" :class="{ today: bar.isToday }">
                      {{ bar.day }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="progress-summary">
                <div class="progress-stat">
                  <div class="progress-stat-value">{{ weeklyProgress.hoursLearned }}</div>
                  <div class="progress-stat-label">Hours Learned</div>
                </div>
                <div class="progress-stat">
                  <div class="progress-stat-value">{{ weeklyProgress.engagement }}%</div>
                  <div class="progress-stat-label">Engagement</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Recent Activity -->
          <div class="card activity-card">
            <div class="card-header">
              <h2 class="card-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                Recent Activity
              </h2>
            </div>
            <div class="card-body activity-body">
              <div
                v-for="activity in recentActivity"
                :key="activity.id"
                class="activity-item"
              >
                <div class="activity-icon" :class="activity.type">
                  <template v-if="activity.type === 'join'">celebration</template>
                  <template v-else-if="activity.type === 'achievement'">trophy</template>
                  <template v-else-if="activity.type === 'progress'">trending_up</template>
                  <template v-else>menu_book</template>
                </div>
                <div class="activity-content">
                  <div class="activity-text">
                    <span v-html="activity.text.replace(activity.highlight, `<strong>${activity.highlight}</strong>`)"></span>
                  </div>
                  <div class="activity-time">{{ activity.time }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ========== Layout ========== */
.dashboard {
  position: relative;
  min-height: 100vh;
  background: var(--bg-primary);
  overflow-x: hidden;
}

.dashboard-content {
  position: relative;
  z-index: 1;
  padding: 32px;
  max-width: 1440px;
  margin: 0 auto;
}

/* ========== Background ========== */
.bg-mountains {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 320px;
  pointer-events: none;
  z-index: 0;
}

.mountain-layer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100%;
  fill: var(--bg-secondary);
}

.mountain-layer.back { opacity: 0.25; }
.mountain-layer.mid { opacity: 0.45; }
.mountain-layer.front { opacity: 0.7; }

.torii-gate {
  position: absolute;
  bottom: 45px;
  right: 12%;
  width: 32px;
  height: 44px;
  opacity: 0.18;
  color: var(--text-secondary);
}

/* ========== Header ========== */
.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.welcome-section h1 {
  font-family: 'Noto Sans JP', system-ui, sans-serif;
  font-size: 34px;
  font-weight: 700;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.welcome-section h1 .highlight {
  color: var(--ssi-red);
}

.welcome-section p {
  color: var(--text-secondary);
  font-size: 15px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* ========== Buttons ========== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 22px;
  border-radius: 12px;
  border: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  text-decoration: none;
}

.btn-primary {
  background: var(--ssi-red);
  color: white;
}

.btn-primary:hover {
  background: var(--ssi-red-light);
  box-shadow: 0 0 32px rgba(194, 58, 58, 0.35);
  transform: translateY(-2px);
}

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
}

.btn-secondary:hover {
  background: var(--bg-elevated);
  border-color: var(--ssi-red);
}

.btn-sm {
  padding: 8px 14px;
  font-size: 13px;
}

/* ========== Join Code ========== */
.join-code-wrapper {
  margin-bottom: 32px;
}

/* ========== Stats Grid ========== */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 32px;
}

/* ========== Main Grid ========== */
.main-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;
}

.right-column {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ========== Cards ========== */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  overflow: hidden;
}

.card-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-title svg {
  color: var(--ssi-red);
}

.card-body {
  padding: 24px;
}

/* ========== Teachers List ========== */
.teacher-item {
  display: flex;
  align-items: center;
  padding: 16px;
  border-radius: 14px;
  background: var(--bg-secondary);
  border: 1px solid transparent;
  margin-bottom: 12px;
  transition: all 0.25s ease;
  cursor: pointer;
}

.teacher-item:hover {
  border-color: var(--border-medium);
  background: var(--bg-elevated);
  transform: translateX(4px);
}

.teacher-item:last-child {
  margin-bottom: 0;
}

.teacher-avatar {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 18px;
  margin-right: 16px;
  flex-shrink: 0;
}

.teacher-info {
  flex: 1;
  min-width: 0;
}

.teacher-name {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 5px;
  color: var(--text-primary);
}

.teacher-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.meta-course {
  font-size: 13px;
  color: var(--text-secondary);
}

.meta-belt {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 6px;
}

.meta-belt.white { background: rgba(255,255,255,0.1); color: #f5f5f5; }
.meta-belt.yellow { background: rgba(251,191,36,0.15); color: #fbbf24; }
.meta-belt.orange { background: rgba(249,115,22,0.15); color: #f97316; }
.meta-belt.green { background: rgba(34,197,94,0.15); color: #22c55e; }
.meta-belt.blue { background: rgba(59,130,246,0.15); color: #3b82f6; }
.meta-belt.brown { background: rgba(146,64,14,0.15); color: #b45309; }
.meta-belt.black { background: rgba(31,41,55,0.5); color: #9ca3af; border: 1px solid #374151; }

.teacher-stats {
  display: flex;
  gap: 24px;
  margin-right: 16px;
}

.teacher-stat {
  text-align: center;
}

.teacher-stat .stat-value {
  font-family: 'Noto Sans JP', sans-serif;
  font-weight: 700;
  font-size: 20px;
  color: var(--ssi-gold);
}

.teacher-stat .stat-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.teacher-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: var(--ssi-red);
  border-color: var(--ssi-red);
  color: white;
}

/* ========== Weekly Progress ========== */
.progress-chart {
  height: 180px;
  margin-bottom: 20px;
}

.progress-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  height: 100%;
  padding: 0 8px;
}

.day-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.bar-container {
  width: 28px;
  height: 140px;
  background: var(--bg-secondary);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}

.bar-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(180deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
  border-radius: 8px;
  transition: height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.day-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.day-label.today {
  color: var(--ssi-gold);
}

.progress-summary {
  display: flex;
  justify-content: space-around;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
}

.progress-stat {
  text-align: center;
}

.progress-stat-value {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 26px;
  font-weight: 700;
  color: var(--ssi-red);
}

.progress-stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ========== Activity Feed ========== */
.activity-body {
  padding: 12px 24px 16px;
}

.activity-item {
  display: flex;
  align-items: flex-start;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.activity-item:last-child {
  border-bottom: none;
}

.activity-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 14px;
  font-size: 18px;
  flex-shrink: 0;
}

.activity-icon.join { background: rgba(74,222,128,0.15); }
.activity-icon.achievement { background: rgba(194,58,58,0.15); }
.activity-icon.progress { background: rgba(212,168,83,0.15); }
.activity-icon.class { background: rgba(96,165,250,0.15); }

.activity-content {
  flex: 1;
  min-width: 0;
}

.activity-text {
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.activity-text :deep(strong) {
  color: var(--ssi-gold);
  font-weight: 600;
}

.activity-time {
  font-size: 12px;
  color: var(--text-muted);
}

/* ========== Animations ========== */
.animate-item {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.animate-item.show {
  opacity: 1;
  transform: translateY(0);
}

.animate-item.delay-1 { transition-delay: 0.1s; }
.animate-item.delay-2 { transition-delay: 0.2s; }
.animate-item.delay-3 { transition-delay: 0.3s; }

/* ========== Responsive ========== */
@media (max-width: 1200px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .main-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .dashboard-content {
    padding: 20px;
  }

  .dashboard-header {
    flex-direction: column;
    gap: 20px;
  }

  .welcome-section h1 {
    font-size: 26px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .teacher-item {
    flex-wrap: wrap;
    gap: 12px;
  }

  .teacher-stats {
    width: 100%;
    justify-content: flex-start;
    margin-right: 0;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .teacher-actions {
    margin-left: auto;
  }
}
</style>
