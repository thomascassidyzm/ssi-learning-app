<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue'
import StatsCard from '@/components/schools/StatsCard.vue'
import type { useSchoolsData } from '@/composables/useSchoolsData'

type TimePeriod = '7d' | '30d' | '90d' | 'year'

// Injected from SchoolsContainer
const schoolsData = inject<ReturnType<typeof useSchoolsData>>('schoolsData')!

// State
const selectedPeriod = ref<TimePeriod>('30d')

// Data — loaded from school_summary view, with fallback defaults
const metrics = ref({
  phrasesLearned: { value: 0, trend: null as string | null },
  hoursLearned: { value: 0, trend: null as string | null },
  activeRate: { value: '0%', trend: null as string | null },
  beltPromotions: { value: 0, trend: null as string | null },
})

onMounted(async () => {
  const school = await schoolsData.getSchoolForUser('admin-001')
  if (!school) return

  const summary = await schoolsData.getSchoolSummary(school.id)
  if (summary) {
    metrics.value = {
      phrasesLearned: { value: Math.round(summary.total_practice_hours * 60), trend: null },
      hoursLearned: { value: Math.round(summary.total_practice_hours), trend: null },
      activeRate: { value: summary.student_count > 0 ? '—' : '0%', trend: null },
      beltPromotions: { value: 0, trend: null },
    }
  }
})

const weeklyActivity = ref([
  { label: 'Week 1', phrases: 2800, hours: 180 },
  { label: 'Week 2', phrases: 3200, hours: 220 },
  { label: 'Week 3', phrases: 2600, hours: 170 },
  { label: 'Week 4', phrases: 4247, hours: 277 }
])

const maxPhrases = computed(() => Math.max(...weeklyActivity.value.map(w => w.phrases)))
const maxHours = computed(() => Math.max(...weeklyActivity.value.map(w => w.hours)))

const beltDistribution = ref([
  { name: 'White Belt', color: 'white', count: 98, percentage: 35 },
  { name: 'Yellow Belt', color: 'yellow', count: 79, percentage: 28 },
  { name: 'Orange Belt', color: 'orange', count: 51, percentage: 18 },
  { name: 'Green Belt', color: 'green', count: 28, percentage: 10 },
  { name: 'Blue Belt', color: 'blue', count: 17, percentage: 6 },
  { name: 'Brown Belt', color: 'brown', count: 8, percentage: 3 },
  { name: 'Black Belt', color: 'black', count: 3, percentage: 1 }
])

const topLearners = ref([
  { id: 1, name: 'Angharad Roberts', initials: 'AR', class: 'Welsh 201', phrases: 1247, belt: 'blue' },
  { id: 2, name: 'Megan Davies', initials: 'MD', class: 'Welsh 201', phrases: 892, belt: 'blue' },
  { id: 3, name: 'Catrin Edwards', initials: 'CE', class: 'Welsh 101', phrases: 756, belt: 'green' },
  { id: 4, name: 'Gareth Llywelyn', initials: 'GL', class: 'Welsh 101', phrases: 623, belt: 'yellow' },
  { id: 5, name: 'Tomos Hughes', initials: 'TH', class: 'Advanced Welsh', phrases: 589, belt: 'orange' },
  { id: 6, name: 'Owen Price', initials: 'OP', class: 'Beginners Welsh', phrases: 412, belt: 'white' }
])

const coursePerformance = ref([
  { flag: 'welsh', name: 'Welsh (Northern)', classes: 8, students: 156, phrases: 8420, activeRate: 94 },
  { flag: 'welsh', name: 'Welsh (Southern)', classes: 6, students: 89, phrases: 3240, activeRate: 91 },
  { flag: 'spanish', name: 'Spanish (Latin American)', classes: 4, students: 39, phrases: 1187, activeRate: 88 }
])

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

const beltBarColors: Record<string, string> = {
  white: '#e0e0e0',
  yellow: '#fbbf24',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
  brown: '#92400e',
  black: '#374151'
}

function getRankClass(index: number): string {
  if (index === 0) return 'gold'
  if (index === 1) return 'silver'
  if (index === 2) return 'bronze'
  return 'default'
}

function handleExport() {
  console.log('Exporting report...')
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
  <div class="analytics-view" :class="{ 'is-visible': isVisible }">
    <div class="page-content">
      <!-- Page Header -->
      <header class="page-header animate-item" :class="{ 'show': isVisible }">
        <div class="page-title">
          <h1>School Analytics</h1>
          <p class="page-subtitle">Track learning progress and engagement across your school</p>
        </div>
        <div class="header-actions">
          <!-- Period Selector -->
          <div class="period-selector">
            <button
              v-for="period in [
                { key: '7d', label: '7 Days' },
                { key: '30d', label: '30 Days' },
                { key: '90d', label: '90 Days' },
                { key: 'year', label: 'Year' }
              ]"
              :key="period.key"
              class="period-btn"
              :class="{ active: selectedPeriod === period.key }"
              @click="selectedPeriod = period.key as TimePeriod"
            >
              {{ period.label }}
            </button>
          </div>

          <button class="btn btn-secondary" @click="handleExport">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Report
          </button>
        </div>
      </header>

      <!-- Key Metrics Grid -->
      <div class="metrics-grid animate-item delay-1" :class="{ 'show': isVisible }">
        <div class="metric-card red">
          <div class="accent-bar"></div>
          <div class="metric-content">
            <div class="metric-header">
              <span class="metric-icon">books</span>
              <span class="metric-trend up">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                </svg>
                {{ metrics.phrasesLearned.trend }}
              </span>
            </div>
            <div class="metric-value">{{ metrics.phrasesLearned.value.toLocaleString() }}</div>
            <div class="metric-label">Phrases Learned</div>
            <div class="sparkline">
              <svg viewBox="0 0 100 30" preserveAspectRatio="none">
                <path d="M0,25 Q10,20 20,22 T40,15 T60,18 T80,10 T100,5" fill="none" stroke="var(--ssi-red)" stroke-width="2"/>
                <path d="M0,25 Q10,20 20,22 T40,15 T60,18 T80,10 T100,5 L100,30 L0,30 Z" fill="url(#redGradient)" opacity="0.2"/>
                <defs>
                  <linearGradient id="redGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="var(--ssi-red)"/>
                    <stop offset="100%" stop-color="transparent"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
        </div>

        <div class="metric-card gold">
          <div class="accent-bar"></div>
          <div class="metric-content">
            <div class="metric-header">
              <span class="metric-icon">schedule</span>
              <span class="metric-trend up">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                </svg>
                {{ metrics.hoursLearned.trend }}
              </span>
            </div>
            <div class="metric-value">{{ metrics.hoursLearned.value }}</div>
            <div class="metric-label">Hours Learned</div>
            <div class="sparkline">
              <svg viewBox="0 0 100 30" preserveAspectRatio="none">
                <path d="M0,20 Q15,25 30,18 T50,20 T70,12 T100,8" fill="none" stroke="var(--ssi-gold)" stroke-width="2"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="metric-card green">
          <div class="accent-bar"></div>
          <div class="metric-content">
            <div class="metric-header">
              <span class="metric-icon">target</span>
              <span class="metric-trend up">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                </svg>
                {{ metrics.activeRate.trend }}
              </span>
            </div>
            <div class="metric-value">{{ metrics.activeRate.value }}</div>
            <div class="metric-label">Active Students</div>
            <div class="sparkline">
              <svg viewBox="0 0 100 30" preserveAspectRatio="none">
                <path d="M0,15 Q20,10 40,12 T60,8 T80,10 T100,6" fill="none" stroke="var(--success)" stroke-width="2"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="metric-card blue">
          <div class="accent-bar"></div>
          <div class="metric-content">
            <div class="metric-header">
              <span class="metric-icon">trophy</span>
              <span class="metric-trend up">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                </svg>
                {{ metrics.beltPromotions.trend }}
              </span>
            </div>
            <div class="metric-value">{{ metrics.beltPromotions.value }}</div>
            <div class="metric-label">Belt Promotions</div>
            <div class="sparkline">
              <svg viewBox="0 0 100 30" preserveAspectRatio="none">
                <path d="M0,22 Q25,20 35,15 T55,18 T75,10 T100,12" fill="none" stroke="var(--info)" stroke-width="2"/>
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- Charts Row -->
      <div class="charts-grid animate-item delay-2" :class="{ 'show': isVisible }">
        <!-- Activity Chart -->
        <div class="card activity-card">
          <div class="card-header">
            <h2 class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
              Learning Activity
            </h2>
            <div class="chart-legend">
              <span class="legend-item">
                <span class="legend-color red"></span>
                Phrases
              </span>
              <span class="legend-item">
                <span class="legend-color gold"></span>
                Hours
              </span>
            </div>
          </div>
          <div class="card-body">
            <div class="activity-chart">
              <div class="chart-grid">
                <div class="chart-grid-line" data-value="4000"></div>
                <div class="chart-grid-line" data-value="3000"></div>
                <div class="chart-grid-line" data-value="2000"></div>
                <div class="chart-grid-line" data-value="1000"></div>
                <div class="chart-grid-line" data-value="0"></div>
              </div>
              <div class="chart-bars">
                <div
                  v-for="week in weeklyActivity"
                  :key="week.label"
                  class="chart-bar-group"
                >
                  <div class="bar-pair">
                    <div
                      class="chart-bar primary"
                      :style="{ height: `${(week.phrases / 4500) * 100}%` }"
                    ></div>
                    <div
                      class="chart-bar secondary"
                      :style="{ height: `${(week.hours / 300) * 100}%` }"
                    ></div>
                  </div>
                  <span class="chart-bar-label">{{ week.label }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Belt Distribution -->
        <div class="card belt-card">
          <div class="card-header">
            <h2 class="card-title">
              Belt Distribution
            </h2>
          </div>
          <div class="card-body">
            <div class="belt-distribution">
              <div
                v-for="belt in beltDistribution"
                :key="belt.name"
                class="belt-row"
              >
                <div
                  class="belt-icon"
                  :style="{ background: beltGradients[belt.color], color: beltColors[belt.color] }"
                >
                  belt
                </div>
                <div class="belt-info">
                  <div class="belt-name">{{ belt.name }}</div>
                  <div class="belt-bar-track">
                    <div
                      class="belt-bar-fill"
                      :style="{
                        width: `${belt.percentage}%`,
                        background: beltBarColors[belt.color]
                      }"
                    ></div>
                  </div>
                </div>
                <div class="belt-count">{{ belt.count }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Row -->
      <div class="bottom-grid animate-item delay-3" :class="{ 'show': isVisible }">
        <!-- Top Learners -->
        <div class="card leaderboard-card">
          <div class="card-header">
            <h2 class="card-title">
              Top Learners This Month
            </h2>
            <router-link to="/students" class="btn btn-secondary btn-sm">
              View All
            </router-link>
          </div>
          <div class="card-body">
            <div class="leaderboard-grid">
              <div
                v-for="(learner, index) in topLearners"
                :key="learner.id"
                class="leaderboard-item"
              >
                <div class="leaderboard-rank" :class="getRankClass(index)">
                  {{ index + 1 }}
                </div>
                <div
                  class="leaderboard-avatar"
                  :style="{
                    background: beltGradients[learner.belt],
                    color: beltColors[learner.belt]
                  }"
                >
                  {{ learner.initials }}
                </div>
                <div class="leaderboard-info">
                  <div class="leaderboard-name">{{ learner.name }}</div>
                  <div class="leaderboard-class">{{ learner.class }}</div>
                </div>
                <div class="leaderboard-score">
                  <div class="leaderboard-score-value">{{ learner.phrases.toLocaleString() }}</div>
                  <div class="leaderboard-score-label">phrases</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Course Performance -->
        <div class="card course-card">
          <div class="card-header">
            <h2 class="card-title">
              Course Performance
            </h2>
          </div>
          <div class="card-body">
            <div class="course-performance">
              <div
                v-for="course in coursePerformance"
                :key="course.name"
                class="course-item"
              >
                <div class="course-flag">
                  <template v-if="course.flag === 'welsh'">welsh</template>
                  <template v-else>spanish</template>
                </div>
                <div class="course-info">
                  <div class="course-name">{{ course.name }}</div>
                  <div class="course-meta">
                    {{ course.classes }} classes &bull; {{ course.students }} students
                  </div>
                </div>
                <div class="course-stats">
                  <div class="course-stat">
                    <div class="course-stat-value red">{{ course.phrases.toLocaleString() }}</div>
                    <div class="course-stat-label">Phrases</div>
                  </div>
                  <div class="course-stat">
                    <div class="course-stat-value gold">{{ course.activeRate }}%</div>
                    <div class="course-stat-label">Active</div>
                  </div>
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
.analytics-view {
  min-height: 100vh;
  background: var(--bg-primary);
}

.page-content {
  padding: 32px;
  max-width: 1440px;
  margin: 0 auto;
}

/* ========== Header ========== */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
}

.page-title h1 {
  font-family: 'Noto Sans JP', system-ui, sans-serif;
  font-size: 30px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: 14px;
}

.header-actions {
  display: flex;
  gap: 16px;
  align-items: center;
}

/* Period Selector */
.period-selector {
  display: flex;
  gap: 6px;
  background: var(--bg-card);
  padding: 5px;
  border-radius: 12px;
}

.period-btn {
  padding: 10px 18px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.period-btn:hover {
  color: var(--text-primary);
}

.period-btn.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
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

/* ========== Metrics Grid ========== */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 32px;
}

.metric-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.metric-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
}

.metric-card .accent-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
}

.metric-card.red .accent-bar { background: linear-gradient(90deg, var(--ssi-red), var(--ssi-red-light)); }
.metric-card.gold .accent-bar { background: linear-gradient(90deg, var(--ssi-gold-dark), var(--ssi-gold)); }
.metric-card.green .accent-bar { background: linear-gradient(90deg, #16a34a, var(--success)); }
.metric-card.blue .accent-bar { background: linear-gradient(90deg, #2563eb, var(--info)); }

.metric-content {
  padding: 24px;
}

.metric-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.metric-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.metric-card.red .metric-icon { background: rgba(194, 58, 58, 0.15); }
.metric-card.gold .metric-icon { background: rgba(212, 168, 83, 0.15); }
.metric-card.green .metric-icon { background: rgba(74, 222, 128, 0.15); }
.metric-card.blue .metric-icon { background: rgba(96, 165, 250, 0.15); }

.metric-trend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.metric-trend.up {
  background: rgba(74, 222, 128, 0.15);
  color: var(--success);
}

.metric-trend.down {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error);
}

.metric-value {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 38px;
  font-weight: 700;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.metric-label {
  color: var(--text-secondary);
  font-size: 14px;
}

.sparkline {
  margin-top: 16px;
  height: 40px;
}

.sparkline svg {
  width: 100%;
  height: 100%;
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

/* ========== Charts Grid ========== */
.charts-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;
  margin-bottom: 32px;
}

/* Chart Legend */
.chart-legend {
  display: flex;
  gap: 20px;
  font-size: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}

.legend-color {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}

.legend-color.red { background: var(--ssi-red); }
.legend-color.gold { background: var(--ssi-gold); opacity: 0.7; }

/* Activity Chart */
.activity-chart {
  height: 280px;
  position: relative;
}

.chart-grid {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.chart-grid-line {
  border-bottom: 1px dashed var(--border-subtle);
  position: relative;
}

.chart-grid-line::before {
  content: attr(data-value);
  position: absolute;
  left: -45px;
  top: -8px;
  font-size: 11px;
  color: var(--text-muted);
}

.chart-bars {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  padding: 0 40px;
}

.chart-bar-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.bar-pair {
  display: flex;
  gap: 6px;
  align-items: flex-end;
  height: 240px;
}

.chart-bar {
  width: 28px;
  border-radius: 6px 6px 0 0;
  transition: height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.chart-bar.primary {
  background: linear-gradient(180deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
}

.chart-bar.secondary {
  background: linear-gradient(180deg, var(--ssi-gold) 0%, var(--ssi-gold-dark) 100%);
  opacity: 0.65;
}

.chart-bar-label {
  font-size: 12px;
  color: var(--text-muted);
}

/* ========== Belt Distribution ========== */
.belt-distribution {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.belt-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.belt-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.belt-info {
  flex: 1;
}

.belt-name {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.belt-bar-track {
  height: 10px;
  background: var(--bg-secondary);
  border-radius: 5px;
  overflow: hidden;
}

.belt-bar-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.belt-count {
  font-size: 15px;
  font-weight: 600;
  color: var(--ssi-gold);
  min-width: 40px;
  text-align: right;
}

/* ========== Bottom Grid ========== */
.bottom-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;
}

/* ========== Leaderboard ========== */
.leaderboard-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.leaderboard-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: var(--bg-secondary);
  border-radius: 14px;
  transition: all 0.2s ease;
}

.leaderboard-item:hover {
  background: var(--bg-elevated);
  transform: translateX(4px);
}

.leaderboard-rank {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}

.leaderboard-rank.gold { background: linear-gradient(135deg, #fbbf24, #d97706); color: #1f2937; }
.leaderboard-rank.silver { background: linear-gradient(135deg, #94a3b8, #64748b); color: white; }
.leaderboard-rank.bronze { background: linear-gradient(135deg, #d97706, #92400e); color: white; }
.leaderboard-rank.default { background: var(--bg-card); color: var(--text-secondary); }

.leaderboard-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.leaderboard-info {
  flex: 1;
  min-width: 0;
}

.leaderboard-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.leaderboard-class {
  font-size: 12px;
  color: var(--text-muted);
}

.leaderboard-score {
  text-align: right;
}

.leaderboard-score-value {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: var(--ssi-gold);
}

.leaderboard-score-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
}

/* ========== Course Performance ========== */
.course-performance {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.course-item {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px;
  background: var(--bg-secondary);
  border-radius: 14px;
  transition: all 0.2s ease;
}

.course-item:hover {
  background: var(--bg-elevated);
}

.course-flag {
  font-size: 32px;
  flex-shrink: 0;
}

.course-info {
  flex: 1;
  min-width: 0;
}

.course-name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.course-meta {
  font-size: 13px;
  color: var(--text-muted);
}

.course-stats {
  display: flex;
  gap: 28px;
}

.course-stat {
  text-align: center;
}

.course-stat-value {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 22px;
  font-weight: 700;
}

.course-stat-value.red { color: var(--ssi-red); }
.course-stat-value.gold { color: var(--ssi-gold); }

.course-stat-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
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
  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .charts-grid,
  .bottom-grid {
    grid-template-columns: 1fr;
  }

  .leaderboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .page-content {
    padding: 20px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 20px;
  }

  .header-actions {
    flex-direction: column;
    width: 100%;
    align-items: stretch;
  }

  .period-selector {
    width: 100%;
    justify-content: center;
  }

  .metrics-grid {
    grid-template-columns: 1fr;
  }

  .metric-value {
    font-size: 32px;
  }
}
</style>
