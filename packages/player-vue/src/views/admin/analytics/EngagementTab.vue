<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsEngagement } from '@/composables/admin/useAnalyticsEngagement'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
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
  white: 'rgb(180, 175, 165)',
  yellow: 'rgb(220, 180, 70)',
  orange: 'rgb(220, 130, 60)',
  green: 'rgb(74, 180, 110)',
  blue: 'rgb(96, 145, 220)',
  purple: 'rgb(150, 110, 200)',
  brown: 'rgb(150, 100, 60)',
  black: 'rgb(40, 36, 32)',
}

function beltStyle(belt: string): Record<string, string> {
  const c = beltColorMap[belt.toLowerCase()] || 'rgb(120, 110, 100)'
  return {
    background: 'rgba(44, 38, 34, 0.04)',
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
    <!-- Loading -->
    <div v-if="engagement.isLoading.value" class="loading">Loading engagement metrics…</div>
    <div v-if="engagement.error.value" class="error-banner">{{ engagement.error.value }}</div>

    <!-- KPI stones -->
    <div v-if="engagement.data.value" class="kpi-strip">
      <FrostCard variant="stone" tone="green">
        <div class="stone-content">
          <span class="stone-label">Daily active</span>
          <span class="stone-value frost-mono-nums">{{ engagement.data.value.dau }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="blue">
        <div class="stone-content">
          <span class="stone-label">Weekly active</span>
          <span class="stone-value frost-mono-nums">{{ engagement.data.value.wau }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="gold">
        <div class="stone-content">
          <span class="stone-label">Monthly active</span>
          <span class="stone-value frost-mono-nums">{{ engagement.data.value.mau }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="red">
        <div class="stone-content">
          <span class="stone-label">Avg session</span>
          <span class="stone-value frost-mono-nums">{{ avgDurationFormatted }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="gold">
        <div class="stone-content">
          <span class="stone-label">Sessions / user / wk</span>
          <span class="stone-value frost-mono-nums">{{ avgSessionsFormatted }}</span>
        </div>
      </FrostCard>
    </div>

    <!-- Session frequency distribution -->
    <FrostCard variant="panel" class="chart-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Session frequency · sessions / user / week</span>
      </div>
      <div class="panel-body">
        <BarChart
          :data="frequencyChartData"
          x-key="bucket"
          y-key="count"
          color="rgb(var(--tone-blue))"
          :height="220"
          :format-x="(v: any) => `${v}/wk`"
          :format-y="(v: number) => `${v} users`"
        />
      </div>
    </FrostCard>

    <!-- Session duration distribution -->
    <FrostCard variant="panel" class="chart-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Session duration · how long learners practise</span>
      </div>
      <div class="panel-body">
        <BarChart
          :data="durationChartData"
          x-key="bucket"
          y-key="count"
          color="rgb(var(--tone-green))"
          :height="220"
          :format-x="(v: any) => String(v)"
          :format-y="(v: number) => `${v} sessions`"
        />
      </div>
    </FrostCard>

    <!-- Average belt per course -->
    <FrostCard variant="panel" class="chart-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Average belt per course</span>
      </div>
      <div class="panel-body">
        <div v-if="beltChartData.length === 0" class="empty-inline">
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
    </FrostCard>
  </div>
</template>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* KPI stones */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--space-4);
}

.stone-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: var(--space-5) var(--space-6);
  min-height: 140px;
}

.stone-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.stone-value {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.025em;
  color: var(--ink-primary);
  margin-top: var(--space-3);
}

/* Panels */
.chart-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.panel-body {
  padding: var(--space-5) var(--space-6);
}

/* Belt list */
.belt-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.belt-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.45);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  transition: background var(--transition-fast);
}

.belt-row:hover {
  background: rgba(255, 255, 255, 0.72);
}

.belt-course {
  color: var(--ink-primary);
  font-weight: var(--font-medium);
}

.belt-pill {
  display: inline-block;
  padding: 3px 12px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

/* Status */
.loading {
  text-align: center;
  padding: var(--space-12);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.error-banner {
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.25);
  border-radius: var(--radius-lg);
  color: rgb(var(--tone-red));
  font-size: var(--text-sm);
}

.empty-inline {
  text-align: center;
  padding: var(--space-6) var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

@media (max-width: 1200px) {
  .kpi-strip { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 768px) {
  .kpi-strip { grid-template-columns: 1fr; }
}
</style>
