<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useAdminAnalytics } from '@/composables/useAdminAnalytics'

const {
  totalUsers,
  newUsersPerWeek,
  newUsersPerMonth,
  usersPerCourse,
  totalMau,
  mauPerCourse,
  avgSessionsPerUserPerWeek,
  avgSessionDurationMinutes,
  sessionsPerWeek,
  retentionCohorts,
  isLoading,
  error,
  fetchAll,
} = useAdminAnalytics()

const activeTab = ref<'acquisition' | 'engagement' | 'retention'>('acquisition')

// Computed values for charts
const maxWeeklyUsers = computed(() =>
  Math.max(...newUsersPerWeek.value.map(w => w.count), 1)
)

const maxMontlyUsers = computed(() =>
  Math.max(...newUsersPerMonth.value.map(m => m.count), 1)
)

const maxCourseEnrollment = computed(() =>
  Math.max(...usersPerCourse.value.map(c => c.count), 1)
)

const maxCourseMau = computed(() =>
  Math.max(...mauPerCourse.value.map(c => c.mau), 1)
)

const maxSessionsPerWeek = computed(() =>
  Math.max(...sessionsPerWeek.value.map(w => w.count), 1)
)

function formatWeek(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const d = new Date(Number(year), Number(month) - 1)
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

function formatCourseCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function retentionColor(pct: number): string {
  if (pct >= 60) return '#4ade80'
  if (pct >= 40) return '#fbbf24'
  if (pct >= 20) return '#f97316'
  return '#ef4444'
}

onMounted(() => {
  fetchAll()
})
</script>

<template>
  <div class="admin-analytics">
    <h2 class="page-title">Platform Analytics</h2>

    <!-- Loading / Error -->
    <div v-if="isLoading" class="loading">Loading analytics data...</div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <!-- Tab Navigation -->
    <div class="tab-nav">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'acquisition' }"
        @click="activeTab = 'acquisition'"
      >
        User Acquisition
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'engagement' }"
        @click="activeTab = 'engagement'"
      >
        Engagement
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'retention' }"
        @click="activeTab = 'retention'"
      >
        Retention
      </button>
    </div>

    <!-- ==================== ACQUISITION ==================== -->
    <div v-if="activeTab === 'acquisition' && !isLoading" class="tab-content">
      <!-- Hero: Total Users -->
      <div class="hero-card">
        <div class="hero-number">{{ totalUsers.toLocaleString() }}</div>
        <div class="hero-label">total users</div>
      </div>

      <!-- New Users Per Week -->
      <section class="card">
        <h3 class="card-title">New Users Per Week (last 12 weeks)</h3>
        <div class="bar-chart">
          <div
            v-for="w in newUsersPerWeek"
            :key="w.week"
            class="bar-group"
          >
            <div class="bar-value">{{ w.count }}</div>
            <div class="bar-track">
              <div
                class="bar-fill bar-fill--blue"
                :style="{ height: `${(w.count / maxWeeklyUsers) * 100}%` }"
              ></div>
            </div>
            <div class="bar-label">{{ formatWeek(w.week) }}</div>
          </div>
        </div>
      </section>

      <!-- New Users Per Month -->
      <section class="card">
        <h3 class="card-title">New Users Per Month (last 6 months)</h3>
        <div class="bar-chart bar-chart--wide">
          <div
            v-for="m in newUsersPerMonth"
            :key="m.month"
            class="bar-group"
          >
            <div class="bar-value">{{ m.count }}</div>
            <div class="bar-track">
              <div
                class="bar-fill bar-fill--gold"
                :style="{ height: `${(m.count / maxMontlyUsers) * 100}%` }"
              ></div>
            </div>
            <div class="bar-label">{{ formatMonth(m.month) }}</div>
          </div>
        </div>
      </section>

      <!-- Users Per Course -->
      <section class="card">
        <h3 class="card-title">Users Per Course</h3>
        <div v-if="usersPerCourse.length === 0" class="empty-state">No enrollment data yet.</div>
        <div v-else class="h-bar-chart">
          <div
            v-for="c in usersPerCourse"
            :key="c.course_id"
            class="h-bar-row"
          >
            <div class="h-bar-label">{{ formatCourseCode(c.course_id) }}</div>
            <div class="h-bar-track">
              <div
                class="h-bar-fill"
                :style="{ width: `${(c.count / maxCourseEnrollment) * 100}%` }"
              ></div>
            </div>
            <div class="h-bar-value">{{ c.count }}</div>
          </div>
        </div>
      </section>
    </div>

    <!-- ==================== ENGAGEMENT ==================== -->
    <div v-if="activeTab === 'engagement' && !isLoading" class="tab-content">
      <!-- Metric Cards -->
      <div class="metrics-row">
        <div class="metric-card">
          <div class="metric-value">{{ totalMau.toLocaleString() }}</div>
          <div class="metric-label">Monthly Active Users</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">{{ avgSessionsPerUserPerWeek }}</div>
          <div class="metric-label">Avg Sessions / User / Week</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">{{ avgSessionDurationMinutes }} min</div>
          <div class="metric-label">Avg Session Duration</div>
        </div>
      </div>

      <!-- MAU Per Course -->
      <section class="card">
        <h3 class="card-title">MAU Per Course</h3>
        <div v-if="mauPerCourse.length === 0" class="empty-state">No session data yet.</div>
        <div v-else class="h-bar-chart">
          <div
            v-for="c in mauPerCourse"
            :key="c.course_id"
            class="h-bar-row"
          >
            <div class="h-bar-label">{{ formatCourseCode(c.course_id) }}</div>
            <div class="h-bar-track">
              <div
                class="h-bar-fill h-bar-fill--green"
                :style="{ width: `${(c.mau / maxCourseMau) * 100}%` }"
              ></div>
            </div>
            <div class="h-bar-value">{{ c.mau }}</div>
          </div>
        </div>
      </section>

      <!-- Sessions Per Week -->
      <section class="card">
        <h3 class="card-title">Sessions Per Week (last 12 weeks)</h3>
        <div class="bar-chart">
          <div
            v-for="w in sessionsPerWeek"
            :key="w.week"
            class="bar-group"
          >
            <div class="bar-value">{{ w.count }}</div>
            <div class="bar-track">
              <div
                class="bar-fill bar-fill--green"
                :style="{ height: `${(w.count / maxSessionsPerWeek) * 100}%` }"
              ></div>
            </div>
            <div class="bar-label">{{ formatWeek(w.week) }}</div>
          </div>
        </div>
      </section>
    </div>

    <!-- ==================== RETENTION ==================== -->
    <div v-if="activeTab === 'retention' && !isLoading" class="tab-content">
      <section class="card">
        <h3 class="card-title">Retention by Signup Cohort</h3>
        <p class="card-subtitle">Percentage of users who had at least one session in each window after signup</p>

        <div v-if="retentionCohorts.length === 0" class="empty-state">
          Not enough data yet. Cohorts need at least 8 weeks of history.
        </div>

        <div v-else class="table-wrapper">
          <table class="retention-table">
            <thead>
              <tr>
                <th>Cohort Week</th>
                <th>Users</th>
                <th>Week 1</th>
                <th>Week 2</th>
                <th>Week 4</th>
                <th>Week 8</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in retentionCohorts" :key="c.week">
                <td>{{ formatWeek(c.week) }}</td>
                <td class="users-cell">{{ c.users }}</td>
                <td>
                  <span class="retention-cell" :style="{ color: retentionColor(c.w1) }">
                    {{ c.w1 }}%
                  </span>
                </td>
                <td>
                  <span class="retention-cell" :style="{ color: retentionColor(c.w2) }">
                    {{ c.w2 }}%
                  </span>
                </td>
                <td>
                  <span class="retention-cell" :style="{ color: retentionColor(c.w4) }">
                    {{ c.w4 }}%
                  </span>
                </td>
                <td>
                  <span class="retention-cell" :style="{ color: retentionColor(c.w8) }">
                    {{ c.w8 }}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.admin-analytics {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary, #e8e8f0);
}

/* Loading / Error */
.loading {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.875rem;
}

.alert {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.875rem;
}

.alert-error {
  background: rgba(220, 60, 60, 0.15);
  border: 1px solid rgba(220, 60, 60, 0.3);
  color: #ff8080;
}

/* Tabs */
.tab-nav {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.04);
  padding: 4px;
  border-radius: 10px;
}

.tab-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #a0a0b8);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn:hover {
  color: var(--text-primary, #e8e8f0);
}

.tab-btn.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e8e8f0);
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Hero Card */
.hero-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 4px solid #3b82f6;
  border-radius: 12px;
  padding: 32px;
  text-align: center;
}

.hero-number {
  font-size: 3rem;
  font-weight: 700;
  color: var(--text-primary, #e8e8f0);
  line-height: 1;
}

.hero-label {
  font-size: 0.875rem;
  color: var(--text-secondary, #a0a0b8);
  margin-top: 8px;
}

/* Cards */
.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 24px;
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--text-primary, #e8e8f0);
}

.card-subtitle {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a0a0b8);
  margin: 0 0 20px;
}

.empty-state {
  text-align: center;
  padding: 32px 20px;
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.875rem;
}

/* Metrics Row */
.metrics-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.metric-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}

.metric-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary, #e8e8f0);
  line-height: 1.2;
}

.metric-label {
  font-size: 0.75rem;
  color: var(--text-secondary, #a0a0b8);
  margin-top: 6px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Vertical Bar Chart */
.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 200px;
  margin-top: 16px;
  padding-top: 24px;
}

.bar-chart--wide .bar-group {
  flex: 1;
  min-width: 60px;
}

.bar-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.bar-value {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary, #a0a0b8);
  min-height: 16px;
}

.bar-track {
  width: 100%;
  max-width: 32px;
  height: 140px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 4px 4px 0 0;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.bar-fill {
  width: 100%;
  border-radius: 4px 4px 0 0;
  transition: height 0.4s ease;
  min-height: 2px;
}

.bar-fill--blue {
  background: linear-gradient(180deg, #3b82f6, #2563eb);
}

.bar-fill--gold {
  background: linear-gradient(180deg, #d4a853, #b8922e);
}

.bar-fill--green {
  background: linear-gradient(180deg, #4ade80, #22c55e);
}

.bar-label {
  font-size: 0.625rem;
  color: var(--text-tertiary, #606078);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

/* Horizontal Bar Chart */
.h-bar-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.h-bar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.h-bar-label {
  width: 160px;
  flex-shrink: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary, #e8e8f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.h-bar-track {
  flex: 1;
  height: 24px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  overflow: hidden;
}

.h-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  border-radius: 6px;
  transition: width 0.4s ease;
  min-width: 4px;
}

.h-bar-fill--green {
  background: linear-gradient(90deg, #22c55e, #4ade80);
}

.h-bar-value {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #e8e8f0);
}

/* Retention Table */
.table-wrapper {
  overflow-x: auto;
  margin-top: 16px;
}

.retention-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.retention-table th {
  text-align: left;
  padding: 10px 12px;
  color: var(--text-secondary, #a0a0b8);
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.retention-table td {
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--text-primary, #e8e8f0);
}

.users-cell {
  font-weight: 600;
  color: var(--text-secondary, #a0a0b8) !important;
}

.retention-cell {
  font-weight: 700;
  font-size: 0.9375rem;
}

/* Responsive */
@media (max-width: 768px) {
  .metrics-row {
    grid-template-columns: 1fr;
  }

  .tab-nav {
    flex-direction: column;
  }

  .bar-chart {
    overflow-x: auto;
  }

  .h-bar-label {
    width: 100px;
    font-size: 0.75rem;
  }

  .hero-number {
    font-size: 2.5rem;
  }
}
</style>
