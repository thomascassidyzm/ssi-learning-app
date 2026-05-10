<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsOverview } from '@/composables/admin/useAnalyticsOverview'
import { useAnalyticsGrowth } from '@/composables/admin/useAnalyticsGrowth'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import BarChart from '@/components/admin/charts/BarChart.vue'

const { getClient } = useAdminClient()
const client = getClient()

const overview = useAnalyticsOverview(client)
const growth = useAnalyticsGrowth(client)

const stickinessPct = computed(() => {
  if (!overview.data.value) return 0
  return Math.round(overview.data.value.dau_mau_ratio * 100)
})

const practiceHoursFormatted = computed(() => {
  if (!overview.data.value) return '0'
  const h = overview.data.value.total_practice_hours
  return h >= 1000 ? `${(h / 1000).toFixed(1)}k` : String(Math.round(h))
})

const weeklyChartData = computed(() =>
  growth.data.value.map(row => ({
    week: formatWeek(row.period_start),
    count: row.new_users,
  }))
)

function formatWeek(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

onMounted(() => {
  overview.fetch()
  growth.fetch('week', 12)
})
</script>

<template>
  <div class="tab-content">
    <!-- Loading -->
    <div v-if="overview.isLoading.value" class="loading">Loading overview…</div>
    <div v-if="overview.error.value" class="error-banner">{{ overview.error.value }}</div>

    <!-- KPI stones -->
    <div v-if="overview.data.value" class="kpi-strip">
      <FrostCard variant="stone" tone="blue">
        <div class="stone-content">
          <span class="stone-label">Total learners</span>
          <span class="stone-value frost-mono-nums">{{ overview.data.value.total_learners }}</span>
          <span
            v-if="overview.data.value.delta_vs_30d_ago > 0"
            class="stone-trend"
          >+{{ overview.data.value.delta_vs_30d_ago }} (30d)</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="green">
        <div class="stone-content">
          <span class="stone-label">Monthly active</span>
          <span class="stone-value frost-mono-nums">{{ overview.data.value.mau }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="gold">
        <div class="stone-content">
          <span class="stone-label">DAU / MAU stickiness</span>
          <span class="stone-value frost-mono-nums">{{ stickinessPct }}%</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="red">
        <div class="stone-content">
          <span class="stone-label">Practice hours</span>
          <span class="stone-value frost-mono-nums">{{ practiceHoursFormatted }}</span>
        </div>
      </FrostCard>
    </div>

    <!-- New users / week -->
    <FrostCard variant="panel" class="chart-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">New users · last 12 weeks</span>
      </div>
      <div class="panel-body">
        <div v-if="growth.isLoading.value" class="loading">Loading…</div>
        <BarChart
          v-else
          :data="weeklyChartData"
          x-key="week"
          y-key="count"
          color="rgb(var(--tone-blue))"
          :height="250"
          :format-x="(v: any) => String(v)"
          :format-y="(v: number) => String(v)"
        />
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
  grid-template-columns: repeat(4, 1fr);
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
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.025em;
  color: var(--ink-primary);
  margin-top: var(--space-3);
}

.stone-trend {
  margin-top: var(--space-2);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: rgb(var(--tone-green));
}

/* Panel */
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

@media (max-width: 1024px) {
  .kpi-strip { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 640px) {
  .kpi-strip { grid-template-columns: 1fr; }
}
</style>
