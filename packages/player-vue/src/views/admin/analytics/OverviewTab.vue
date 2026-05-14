<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsOverview } from '@/composables/admin/useAnalyticsOverview'
import { useAnalyticsGrowth } from '@/composables/admin/useAnalyticsGrowth'
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
    <!-- Loading / error -->
    <div v-if="overview.isLoading.value" class="loading schools-subtle">Loading overview…</div>
    <div v-if="overview.error.value" class="error-banner">{{ overview.error.value }}</div>

    <!-- KPI cards -->
    <div v-if="overview.data.value" class="kpi-grid">
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Total learners</span>
        <span class="arsenal kpi-value">{{ overview.data.value.total_learners }}</span>
        <span
          v-if="overview.data.value.delta_vs_30d_ago > 0"
          class="kpi-detail schools-subtle"
        >+{{ overview.data.value.delta_vs_30d_ago }} (30d)</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Monthly active</span>
        <span class="arsenal kpi-value">{{ overview.data.value.mau }}</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">DAU / MAU stickiness</span>
        <span class="arsenal kpi-value">{{ stickinessPct }}%</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Practice hours</span>
        <span class="arsenal kpi-value">{{ practiceHoursFormatted }}</span>
      </div>
    </div>

    <!-- New users / week -->
    <div class="schools-card chart-panel">
      <div class="panel-head">
        <span class="schools-kicker">New users · last 12 weeks</span>
      </div>
      <div class="panel-body">
        <div v-if="growth.isLoading.value" class="loading schools-subtle">Loading…</div>
        <BarChart
          v-else
          :data="weeklyChartData"
          x-key="week"
          y-key="count"
          color="var(--schools-fg)"
          :height="250"
          :format-x="(v: any) => String(v)"
          :format-y="(v: number) => String(v)"
        />
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
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 130px;
}

.kpi-label { letter-spacing: 0.10em; }

.kpi-value {
  font-size: 36px;
  line-height: 1.05;
  letter-spacing: -0.015em;
  color: var(--schools-fg);
}

.kpi-detail { font-size: 12px; }

/* Panel */
.chart-panel { padding: 0; overflow: hidden; }

.panel-head {
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--schools-border);
}

.panel-body { padding: 16px 20px 20px; }

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

@media (max-width: 1024px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 640px) {
  .kpi-grid { grid-template-columns: 1fr; }
}
</style>
