<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsEngagement } from '@/composables/admin/useAnalyticsEngagement'
import Card from '@/components/schools/shared/Card.vue'
import StatsCard from '@/components/schools/StatsCard.vue'
import BarChart from '@/components/admin/charts/BarChart.vue'
import HorizontalBarChart from '@/components/admin/charts/HorizontalBarChart.vue'
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

onMounted(() => {
  engagement.fetch()
})
</script>

<template>
  <div class="tab-content">
    <!-- Loading -->
    <div v-if="engagement.isLoading.value" class="loading-state animate-in">
      Loading engagement metrics...
    </div>
    <div v-if="engagement.error.value" class="alert-error animate-in">
      {{ engagement.error.value }}
    </div>

    <!-- Hero Stats -->
    <div v-if="engagement.data.value" class="hero-grid animate-in delay-1">
      <StatsCard
        :value="engagement.data.value.dau"
        label="Daily Active Users"
        icon="&#128994;"
        variant="green"
        size="compact"
      />
      <StatsCard
        :value="engagement.data.value.wau"
        label="Weekly Active Users"
        icon="&#128200;"
        variant="blue"
        size="compact"
      />
      <StatsCard
        :value="engagement.data.value.mau"
        label="Monthly Active Users"
        icon="&#127775;"
        variant="gold"
        size="compact"
      />
      <StatsCard
        :value="avgDurationFormatted"
        label="Avg Session Duration"
        icon="&#9201;"
        variant="purple"
        size="compact"
      />
      <StatsCard
        :value="avgSessionsFormatted"
        label="Avg Sessions / User / Week"
        icon="&#9889;"
        variant="red"
        size="compact"
      />
    </div>

    <!-- Session Frequency Distribution -->
    <Card
      title="Session Frequency Distribution"
      subtitle="Sessions per user per week"
      accent="blue"
      class="animate-in delay-2"
    >
      <BarChart
        :data="frequencyChartData"
        x-key="bucket"
        y-key="count"
        color="var(--info, #3b82f6)"
        :height="220"
        :format-x="(v: any) => `${v}/wk`"
        :format-y="(v: number) => `${v} users`"
      />
    </Card>

    <!-- Session Duration Distribution -->
    <Card
      title="Session Duration Distribution"
      subtitle="How long learners practice"
      accent="green"
      class="animate-in delay-3"
    >
      <BarChart
        :data="durationChartData"
        x-key="bucket"
        y-key="count"
        color="var(--success, #4ade80)"
        :height="220"
        :format-x="(v: any) => String(v)"
        :format-y="(v: number) => `${v} sessions`"
      />
    </Card>

    <!-- Average Belt Per Course -->
    <Card
      title="Average Belt Per Course"
      subtitle="Typical learner progression by course"
      accent="gold"
      class="animate-in delay-4"
    >
      <div v-if="beltChartData.length === 0" class="empty-state">
        No belt data available yet.
      </div>
      <div v-else class="belt-list">
        <div
          v-for="item in beltChartData"
          :key="item.course"
          class="belt-row"
        >
          <span class="belt-course">{{ formatCourseLabel(item.course) }}</span>
          <span class="belt-badge" :data-belt="item.belt">{{ item.belt }}</span>
        </div>
      </div>
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
  grid-template-columns: repeat(5, 1fr);
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

.empty-state {
  text-align: center;
  padding: var(--space-8, 32px) var(--space-5, 20px);
  color: var(--text-muted);
  font-size: var(--text-sm, 0.875rem);
}

/* Belt list */
.belt-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}

.belt-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2, 8px) var(--space-3, 12px);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-secondary);
}

.belt-course {
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-primary);
  font-weight: var(--font-medium, 500);
}

.belt-badge {
  font-size: var(--text-xs, 0.75rem);
  font-weight: var(--font-bold, 700);
  text-transform: capitalize;
  padding: var(--space-1, 4px) var(--space-3, 12px);
  border-radius: var(--radius-full, 9999px);
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.belt-badge[data-belt="white"] { color: #ffffff; }
.belt-badge[data-belt="yellow"] { color: #facc15; }
.belt-badge[data-belt="orange"] { color: #f97316; }
.belt-badge[data-belt="green"] { color: #4ade80; }
.belt-badge[data-belt="blue"] { color: #3b82f6; }
.belt-badge[data-belt="purple"] { color: #a855f7; }
.belt-badge[data-belt="brown"] { color: #a16207; }
.belt-badge[data-belt="black"] { color: #e2e8f0; }

@media (max-width: 1200px) {
  .hero-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }
}
</style>
