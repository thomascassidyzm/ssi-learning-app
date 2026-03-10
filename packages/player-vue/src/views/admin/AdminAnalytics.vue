<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminAnalytics } from '@/composables/useAdminAnalytics'
import Card from '@/components/schools/shared/Card.vue'
import StatsCard from '@/components/schools/StatsCard.vue'

const { getClient } = useAdminClient()

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
} = useAdminAnalytics(getClient())

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

function retentionBgColor(pct: number): string {
  if (pct >= 60) return 'rgba(74, 222, 128, 0.15)'
  if (pct >= 40) return 'rgba(251, 191, 36, 0.15)'
  if (pct >= 20) return 'rgba(249, 115, 22, 0.15)'
  return 'rgba(239, 68, 68, 0.15)'
}

onMounted(() => {
  fetchAll()
})
</script>

<template>
  <div class="admin-analytics">
    <!-- Page Header -->
    <header class="page-header animate-in">
      <h1 class="page-title">Platform Analytics</h1>
      <p class="page-subtitle">User growth, engagement metrics, and retention analysis</p>
    </header>

    <!-- Loading / Error -->
    <div v-if="isLoading" class="loading-state animate-in delay-1">
      Loading analytics data...
    </div>
    <div v-if="error" class="alert-error animate-in delay-1">{{ error }}</div>

    <!-- Tab Navigation -->
    <div class="tab-nav animate-in delay-1">
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
      <div class="hero-stats animate-in delay-2">
        <StatsCard
          :value="totalUsers"
          label="Total Users"
          icon="&#128101;"
          variant="blue"
        />
      </div>

      <!-- New Users Per Week -->
      <Card
        title="New Users Per Week"
        subtitle="Last 12 weeks"
        accent="blue"
        class="animate-in delay-3"
      >
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
      </Card>

      <!-- New Users Per Month -->
      <Card
        title="New Users Per Month"
        subtitle="Last 6 months"
        accent="gold"
        class="animate-in delay-4"
      >
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
      </Card>

      <!-- Users Per Course -->
      <Card
        title="Users Per Course"
        accent="gradient"
        class="animate-in delay-5"
      >
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
      </Card>
    </div>

    <!-- ==================== ENGAGEMENT ==================== -->
    <div v-if="activeTab === 'engagement' && !isLoading" class="tab-content">
      <!-- Metric Cards -->
      <div class="metrics-row animate-in delay-2">
        <StatsCard
          :value="totalMau"
          label="Monthly Active Users"
          icon="&#128200;"
          variant="green"
        />
        <StatsCard
          :value="avgSessionsPerUserPerWeek"
          label="Avg Sessions / User / Week"
          icon="&#9889;"
          variant="blue"
        />
        <StatsCard
          :value="`${avgSessionDurationMinutes} min`"
          label="Avg Session Duration"
          icon="&#9201;"
          variant="gold"
        />
      </div>

      <!-- MAU Per Course -->
      <Card
        title="MAU Per Course"
        accent="green"
        class="animate-in delay-3"
      >
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
      </Card>

      <!-- Sessions Per Week -->
      <Card
        title="Sessions Per Week"
        subtitle="Last 12 weeks"
        accent="green"
        class="animate-in delay-4"
      >
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
      </Card>
    </div>

    <!-- ==================== RETENTION ==================== -->
    <div v-if="activeTab === 'retention' && !isLoading" class="tab-content">
      <Card
        title="Retention by Signup Cohort"
        subtitle="Percentage of users who had at least one session in each window after signup"
        accent="red"
        class="animate-in delay-2"
      >
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
                  <span
                    class="retention-cell"
                    :style="{
                      color: retentionColor(c.w1),
                      background: retentionBgColor(c.w1)
                    }"
                  >
                    {{ c.w1 }}%
                  </span>
                </td>
                <td>
                  <span
                    class="retention-cell"
                    :style="{
                      color: retentionColor(c.w2),
                      background: retentionBgColor(c.w2)
                    }"
                  >
                    {{ c.w2 }}%
                  </span>
                </td>
                <td>
                  <span
                    class="retention-cell"
                    :style="{
                      color: retentionColor(c.w4),
                      background: retentionBgColor(c.w4)
                    }"
                  >
                    {{ c.w4 }}%
                  </span>
                </td>
                <td>
                  <span
                    class="retention-cell"
                    :style="{
                      color: retentionColor(c.w8),
                      background: retentionBgColor(c.w8)
                    }"
                  >
                    {{ c.w8 }}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.admin-analytics {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 24px);
  max-width: 1200px;
}

/* Page Header */
.page-header {
  margin-bottom: var(--space-2, 8px);
}

.page-title {
  font-family: var(--font-display, 'Noto Sans JP', system-ui, sans-serif);
  font-size: var(--text-3xl, 1.875rem);
  font-weight: var(--font-bold, 700);
  margin: 0 0 var(--space-1, 4px);
  color: var(--text-primary);
}

.page-subtitle {
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-secondary);
  margin: 0;
}

/* Loading / Error */
.loading-state {
  text-align: center;
  padding: var(--space-10, 40px) var(--space-5, 20px);
  color: var(--text-secondary);
  font-size: var(--text-sm, 0.875rem);
}

.alert-error {
  padding: var(--space-3, 12px) var(--space-4, 16px);
  border-radius: var(--radius-lg, 12px);
  font-size: var(--text-sm, 0.875rem);
  background: var(--bg-card);
  border: 1px solid var(--ssi-red);
  color: var(--ssi-red-light, #ff8080);
}

/* Tabs */
.tab-nav {
  display: flex;
  gap: var(--space-1, 4px);
  background: var(--bg-secondary);
  padding: var(--space-1, 4px);
  border-radius: var(--radius-lg, 10px);
}

.tab-btn {
  flex: 1;
  padding: var(--space-3, 10px) var(--space-4, 16px);
  border: none;
  border-radius: var(--radius-md, 8px);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--font-medium, 500);
  cursor: pointer;
  transition: all var(--transition-base, 0.15s);
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-weight: var(--font-semibold, 600);
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 24px);
}

/* Hero Stats (single StatsCard wrapper) */
.hero-stats {
  max-width: 320px;
}

/* Metrics Row */
.metrics-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-6, 16px);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: var(--space-8, 32px) var(--space-5, 20px);
  color: var(--text-muted);
  font-size: var(--text-sm, 0.875rem);
}

/* ============================
   Vertical Bar Chart
   ============================ */
.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2, 8px);
  height: 200px;
  margin-top: var(--space-2, 8px);
  padding-top: var(--space-6, 24px);
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
  gap: var(--space-1, 6px);
  min-width: 0;
}

.bar-value {
  font-size: 0.6875rem;
  font-weight: var(--font-semibold, 600);
  color: var(--text-secondary);
  min-height: 16px;
}

.bar-track {
  width: 100%;
  max-width: 32px;
  height: 140px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm, 4px) var(--radius-sm, 4px) 0 0;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.bar-fill {
  width: 100%;
  border-radius: var(--radius-sm, 4px) var(--radius-sm, 4px) 0 0;
  transition: height 0.4s ease;
  min-height: 2px;
}

.bar-fill--blue {
  background: linear-gradient(180deg, var(--info, #3b82f6), #2563eb);
}

.bar-fill--gold {
  background: linear-gradient(180deg, var(--ssi-gold, #d4a853), var(--ssi-gold-dark, #b8922e));
}

.bar-fill--green {
  background: linear-gradient(180deg, var(--success, #4ade80), #22c55e);
}

.bar-label {
  font-size: 0.625rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

/* ============================
   Horizontal Bar Chart
   ============================ */
.h-bar-chart {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
  margin-top: var(--space-2, 8px);
}

.h-bar-row {
  display: flex;
  align-items: center;
  gap: var(--space-3, 12px);
}

.h-bar-label {
  width: 160px;
  flex-shrink: 0;
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--font-medium, 500);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.h-bar-track {
  flex: 1;
  height: 24px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}

.h-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #2563eb, var(--info, #60a5fa));
  border-radius: var(--radius-md, 6px);
  transition: width 0.4s ease;
  min-width: 4px;
}

.h-bar-fill--green {
  background: linear-gradient(90deg, #22c55e, var(--success, #4ade80));
}

.h-bar-value {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-semibold, 600);
  color: var(--text-primary);
}

/* ============================
   Retention Table
   ============================ */
.table-wrapper {
  overflow-x: auto;
  margin-top: var(--space-2, 8px);
}

.retention-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm, 0.875rem);
}

.retention-table th {
  text-align: left;
  padding: var(--space-3, 10px) var(--space-3, 12px);
  color: var(--text-muted);
  font-weight: var(--font-medium, 500);
  font-size: var(--text-xs, 0.75rem);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-medium);
}

.retention-table td {
  padding: var(--space-3, 12px);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.users-cell {
  font-weight: var(--font-semibold, 600);
  color: var(--text-muted) !important;
}

.retention-cell {
  display: inline-block;
  font-weight: var(--font-bold, 700);
  font-size: 0.9375rem;
  padding: var(--space-1, 4px) var(--space-2, 8px);
  border-radius: var(--radius-md, 6px);
  min-width: 52px;
  text-align: center;
}

/* ============================
   Responsive
   ============================ */
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
    font-size: var(--text-xs, 0.75rem);
  }

  .hero-stats {
    max-width: 100%;
  }
}
</style>
