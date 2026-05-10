<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsOverview } from '@/composables/admin/useAnalyticsOverview'
import { useAnalyticsGrowth } from '@/composables/admin/useAnalyticsGrowth'
import Card from '@/components/schools/shared/Card.vue'
import StatsCard from '@/components/schools/StatsCard.vue'
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
    <div v-if="overview.isLoading.value" class="loading-state animate-in">
      Loading overview...
    </div>
    <div v-if="overview.error.value" class="alert-error animate-in">
      {{ overview.error.value }}
    </div>

    <!-- Hero Stats -->
    <div v-if="overview.data.value" class="hero-grid animate-in delay-1">
      <StatsCard
        :value="overview.data.value.total_learners"
        label="Total Learners"
        icon="&#128101;"
        variant="blue"
        :trend="overview.data.value.delta_vs_30d_ago > 0
          ? { value: `+${overview.data.value.delta_vs_30d_ago} (30d)`, direction: 'up' as const }
          : undefined"
      />
      <StatsCard
        :value="overview.data.value.mau"
        label="Monthly Active Users"
        icon="&#128200;"
        variant="green"
      />
      <StatsCard
        :value="`${stickinessPct}%`"
        label="DAU/MAU Stickiness"
        icon="&#9889;"
        variant="gold"
      />
      <StatsCard
        :value="practiceHoursFormatted"
        label="Total Practice Hours"
        icon="&#9201;"
        variant="purple"
      />
    </div>

    <!-- New Users Per Week -->
    <Card
      title="New Users Per Week"
      subtitle="Last 12 weeks"
      accent="blue"
      :loading="growth.isLoading.value"
      class="animate-in delay-2"
    >
      <BarChart
        :data="weeklyChartData"
        x-key="week"
        y-key="count"
        color="var(--info, #3b82f6)"
        :height="250"
        :format-x="(v: any) => String(v)"
        :format-y="(v: number) => String(v)"
      />
    </Card>
  </div>
</template>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 24px);
}

.hero-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4, 16px);
}

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

@media (max-width: 1024px) {
  .hero-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }
}
</style>
