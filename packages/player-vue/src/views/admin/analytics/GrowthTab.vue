<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsGrowth } from '@/composables/admin/useAnalyticsGrowth'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import BarChart from '@/components/admin/charts/BarChart.vue'
import HorizontalBarChart from '@/components/admin/charts/HorizontalBarChart.vue'
import { parseCourseCode } from '@/composables/admin/adminUtils'

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
    <!-- Weekly new users -->
    <FrostCard variant="panel" class="chart-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">New users per week · last 12 weeks</span>
      </div>
      <div class="panel-body">
        <div v-if="weeklyGrowth.isLoading.value" class="loading">Loading…</div>
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

    <!-- Monthly new users -->
    <FrostCard variant="panel" class="chart-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">New users per month · last 6 months</span>
      </div>
      <div class="panel-body">
        <div v-if="monthlyGrowth.isLoading.value" class="loading">Loading…</div>
        <BarChart
          v-else
          :data="monthlyChartData"
          x-key="month"
          y-key="count"
          color="rgb(var(--tone-gold))"
          :height="250"
          :format-x="(v: any) => String(v)"
          :format-y="(v: number) => String(v)"
        />
      </div>
    </FrostCard>

    <!-- Enrollments by course -->
    <FrostCard variant="panel" class="chart-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Enrolments by course</span>
      </div>
      <div class="panel-body">
        <HorizontalBarChart
          :data="enrollmentData"
          label-key="course"
          value-key="count"
          color="rgb(var(--tone-blue))"
          :format-label="formatCourseLabel"
          :format-value="(v: number) => String(v)"
        />
      </div>
    </FrostCard>

    <!-- Entitlement funnel -->
    <FrostCard variant="panel" class="chart-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Entitlement funnel · signup to paid</span>
      </div>
      <div class="panel-body">
        <div v-if="funnelLoading" class="loading">Loading…</div>
        <div v-else-if="funnelData.length === 0" class="empty-inline">
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
              <span class="funnel-count frost-mono-nums">{{ step.count.toLocaleString() }}</span>
            </div>
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

.loading {
  text-align: center;
  padding: var(--space-8) var(--space-5);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.empty-inline {
  text-align: center;
  padding: var(--space-6) var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Funnel */
.funnel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.funnel-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.funnel-bar-track {
  width: 100%;
  height: 28px;
  background: rgba(44, 38, 34, 0.05);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.funnel-bar-fill {
  height: 100%;
  background: rgb(var(--tone-green));
  border-radius: var(--radius-md);
  transition: width 0.4s ease;
  min-width: 4px;
}

.funnel-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.funnel-stage {
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  text-transform: capitalize;
}

.funnel-count {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--ink-primary);
}
</style>
