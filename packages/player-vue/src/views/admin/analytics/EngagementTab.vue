<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsEngagement } from '@/composables/admin/useAnalyticsEngagement'
import BarChart from '@/components/admin/charts/BarChart.vue'
import { parseCourseCode, formatDuration } from '@/composables/admin/adminUtils'

const { getClient } = useAdminClient()
const client = getClient()

const engagement = useAnalyticsEngagement(client)

const avgDurationFormatted = computed(() => {
  if (!engagement.data.value) return '0m'
  return formatDuration(engagement.data.value.avg_session_duration_s / 60)
})

const avgSessionsFormatted = computed(() => {
  if (!engagement.data.value) return '0'
  return engagement.data.value.avg_sessions_per_user_per_week.toFixed(1)
})

const frequencyChartData = computed(() => {
  if (!engagement.data.value?.session_frequency_distribution) return []
  return Object.entries(engagement.data.value.session_frequency_distribution)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => {
      const numA = parseInt(a.bucket) || 99
      const numB = parseInt(b.bucket) || 99
      return numA - numB
    })
})

const durationChartData = computed(() => {
  if (!engagement.data.value?.session_duration_distribution) return []
  const order = ['<5m', '5-15m', '15-30m', '30m+']
  return Object.entries(engagement.data.value.session_duration_distribution)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => {
      const idxA = order.indexOf(a.bucket)
      const idxB = order.indexOf(b.bucket)
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB)
    })
})

const beltChartData = computed(() => {
  if (!engagement.data.value?.avg_belt_per_course) return []
  return Object.entries(engagement.data.value.avg_belt_per_course)
    .map(([course, belt]) => ({
      course,
      belt,
    }))
})

function formatCourseLabel(code: string): string {
  return parseCourseCode(code).label
}

const beltColorMap: Record<string, string> = {
  white: '#f4f3ef',
  yellow: '#f7d24a',
  orange: '#ec8a3a',
  green: '#2a8d5e',
  blue: '#3768c4',
  purple: '#7e5bbd',
  brown: '#8b5a2b',
  black: '#1c1b18',
}

function beltStyle(belt: string): Record<string, string> {
  const c = beltColorMap[belt.toLowerCase()] || 'var(--schools-fg-3)'
  return {
    background: '#fafaf8',
    borderColor: c,
    color: c,
  }
}

onMounted(() => {
  engagement.fetch()
})
</script>

<template>
  <div class="tab-content">
    <!-- Loading / error -->
    <div v-if="engagement.isLoading.value" class="loading schools-subtle">Loading engagement metrics…</div>
    <div v-if="engagement.error.value" class="error-banner">{{ engagement.error.value }}</div>

    <!-- KPI cards -->
    <div v-if="engagement.data.value" class="kpi-grid">
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Daily active</span>
        <span class="arsenal kpi-value">{{ engagement.data.value.dau }}</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Weekly active</span>
        <span class="arsenal kpi-value">{{ engagement.data.value.wau }}</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Monthly active</span>
        <span class="arsenal kpi-value">{{ engagement.data.value.mau }}</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Avg session</span>
        <span class="arsenal kpi-value">{{ avgDurationFormatted }}</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Sessions / user / wk</span>
        <span class="arsenal kpi-value">{{ avgSessionsFormatted }}</span>
      </div>
    </div>

    <!-- Session frequency distribution -->
    <div class="schools-card chart-panel">
      <div class="panel-head">
        <span class="schools-kicker">Session frequency · sessions / user / week</span>
      </div>
      <div class="panel-body">
        <BarChart
          :data="frequencyChartData"
          x-key="bucket"
          y-key="count"
          color="var(--schools-fg)"
          :height="220"
          :format-x="(v: any) => `${v}/wk`"
          :format-y="(v: number) => `${v} users`"
        />
      </div>
    </div>

    <!-- Session duration distribution -->
    <div class="schools-card chart-panel">
      <div class="panel-head">
        <span class="schools-kicker">Session duration · how long learners practise</span>
      </div>
      <div class="panel-body">
        <BarChart
          :data="durationChartData"
          x-key="bucket"
          y-key="count"
          color="var(--schools-fg)"
          :height="220"
          :format-x="(v: any) => String(v)"
          :format-y="(v: number) => `${v} sessions`"
        />
      </div>
    </div>

    <!-- Average belt per course -->
    <div class="schools-card chart-panel">
      <div class="panel-head">
        <span class="schools-kicker">Average belt per course</span>
      </div>
      <div class="panel-body">
        <div v-if="beltChartData.length === 0" class="empty-inline schools-subtle">
          No belt data available yet.
        </div>
        <div v-else class="belt-list">
          <div
            v-for="item in beltChartData"
            :key="item.course"
            class="belt-row"
          >
            <span class="belt-course">{{ formatCourseLabel(item.course) }}</span>
            <span class="belt-pill" :style="beltStyle(item.belt)">{{ item.belt }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* KPI cards */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 120px;
}

.kpi-label { letter-spacing: 0.10em; }

.kpi-value {
  font-size: 30px;
  line-height: 1.05;
  letter-spacing: -0.015em;
  color: var(--schools-fg);
}

/* Panels */
.chart-panel { padding: 0; overflow: hidden; }

.panel-head {
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--schools-border);
}

.panel-body { padding: 16px 20px 20px; }

/* Belt list */
.belt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.belt-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #fafaf8;
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-md);
  font-size: 13.5px;
  transition: background 160ms ease-out;
}

.belt-row:hover { background: #fff; }

.belt-course {
  color: var(--schools-fg);
  font-weight: 500;
}

.belt-pill {
  display: inline-block;
  padding: 3px 12px;
  border-radius: var(--schools-radius-pill);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

/* Status */
.loading {
  text-align: center;
  padding: 40px 20px;
  font-size: 13px;
}

.error-banner {
  padding: 10px 14px;
  background: rgba(219, 30, 23, 0.06);
  border: 1px solid rgba(219, 30, 23, 0.25);
  border-radius: var(--schools-radius-md);
  color: var(--schools-red-deep);
  font-size: 13px;
}

.empty-inline {
  text-align: center;
  padding: 22px 16px;
  font-size: 13px;
}

@media (max-width: 1200px) {
  .kpi-grid { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 768px) {
  .kpi-grid { grid-template-columns: 1fr; }
}
</style>
