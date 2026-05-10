<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsGrowth } from '@/composables/admin/useAnalyticsGrowth'
import Card from '@/components/schools/shared/Card.vue'
import BarChart from '@/components/admin/charts/BarChart.vue'
import HorizontalBarChart from '@/components/admin/charts/HorizontalBarChart.vue'
import { parseCourseCode } from '@/composables/admin/adminUtils'
import type { SupabaseClient } from '@supabase/supabase-js'

const { getClient } = useAdminClient()
const client = getClient()

const weeklyGrowth = useAnalyticsGrowth(client)
const monthlyGrowth = useAnalyticsGrowth(client)

// Entitlement funnel
const funnelData = ref<Array<{ stage: string; count: number }>>([])
const funnelLoading = ref(false)

const weeklyChartData = computed(() =>
  weeklyGrowth.data.value.map(row => ({
    week: formatWeek(row.period_start),
    count: row.new_users,
  }))
)

const monthlyChartData = computed(() =>
  monthlyGrowth.data.value.map(row => ({
    month: formatMonth(row.period_start),
    count: row.new_users,
  }))
)

const enrollmentData = computed(() => {
  // Aggregate enrollments_by_course across all growth rows
  const totals = new Map<string, number>()
  weeklyGrowth.data.value.forEach(row => {
    if (row.enrollments_by_course) {
      Object.entries(row.enrollments_by_course).forEach(([course, count]) => {
        totals.set(course, (totals.get(course) || 0) + count)
      })
    }
  })
  return Array.from(totals.entries())
    .map(([course, count]) => ({ course, count }))
    .sort((a, b) => b.count - a.count)
})

function formatWeek(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatMonth(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

function formatCourseLabel(code: string): string {
  return parseCourseCode(code).label
}

async function fetchFunnel() {
  funnelLoading.value = true
  try {
    const { data, error } = await client.rpc('analytics_entitlement_funnel')
    if (error) throw error
    funnelData.value = data || []
  } catch (e: any) {
    console.error('[GrowthTab] funnel error:', e)
  } finally {
    funnelLoading.value = false
  }
}

onMounted(() => {
  weeklyGrowth.fetch('week', 12)
  monthlyGrowth.fetch('month', 6)
  fetchFunnel()
})
</script>

<template>
  <div class="tab-content">
    <!-- Weekly New Users -->
    <Card
      title="New Users Per Week"
      subtitle="Last 12 weeks"
      accent="blue"
      :loading="weeklyGrowth.isLoading.value"
      class="animate-in delay-1"
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

    <!-- Monthly New Users -->
    <Card
      title="New Users Per Month"
      subtitle="Last 6 months"
      accent="gold"
      :loading="monthlyGrowth.isLoading.value"
      class="animate-in delay-2"
    >
      <BarChart
        :data="monthlyChartData"
        x-key="month"
        y-key="count"
        color="var(--ssi-gold, #d4a853)"
        :height="250"
        :format-x="(v: any) => String(v)"
        :format-y="(v: number) => String(v)"
      />
    </Card>

    <!-- Enrollments by Course -->
    <Card
      title="Enrollments by Course"
      subtitle="Total enrollments across period"
      accent="gradient"
      class="animate-in delay-3"
    >
      <HorizontalBarChart
        :data="enrollmentData"
        label-key="course"
        value-key="count"
        color="var(--info, #3b82f6)"
        :format-label="formatCourseLabel"
        :format-value="(v: number) => String(v)"
      />
    </Card>

    <!-- Entitlement Funnel -->
    <Card
      title="Entitlement Funnel"
      subtitle="Signup to paid conversion"
      accent="green"
      :loading="funnelLoading"
      class="animate-in delay-4"
    >
      <div v-if="funnelData.length === 0" class="empty-state">
        No funnel data available yet.
      </div>
      <div v-else class="funnel">
        <div
          v-for="(step, i) in funnelData"
          :key="step.stage"
          class="funnel-step"
        >
          <div class="funnel-bar-track">
            <div
              class="funnel-bar-fill"
              :style="{
                width: `${(step.count / (funnelData[0]?.count || 1)) * 100}%`,
                opacity: 1 - (i * 0.15),
              }"
            ></div>
          </div>
          <div class="funnel-label">
            <span class="funnel-stage">{{ step.stage }}</span>
            <span class="funnel-count">{{ step.count.toLocaleString() }}</span>
          </div>
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

.empty-state {
  text-align: center;
  padding: var(--space-8, 32px) var(--space-5, 20px);
  color: var(--text-muted);
  font-size: var(--text-sm, 0.875rem);
}

/* Funnel */
.funnel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
  margin-top: var(--space-2, 8px);
}

.funnel-step {
  display: flex;
  flex-direction: column;
  gap: var(--space-1, 4px);
}

.funnel-bar-track {
  width: 100%;
  height: 28px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}

.funnel-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #16a34a, var(--success, #4ade80));
  border-radius: var(--radius-md, 6px);
  transition: width 0.4s ease;
  min-width: 4px;
}

.funnel-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.funnel-stage {
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-secondary);
  text-transform: capitalize;
}

.funnel-count {
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-semibold, 600);
  color: var(--text-primary);
}
</style>
