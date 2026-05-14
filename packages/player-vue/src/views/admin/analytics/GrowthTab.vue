<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsGrowth } from '@/composables/admin/useAnalyticsGrowth'
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
    <div class="schools-card chart-panel">
      <div class="panel-head">
        <span class="schools-kicker">New users per week · last 12 weeks</span>
      </div>
      <div class="panel-body">
        <div v-if="weeklyGrowth.isLoading.value" class="loading schools-subtle">Loading…</div>
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

    <!-- Monthly new users -->
    <div class="schools-card chart-panel">
      <div class="panel-head">
        <span class="schools-kicker">New users per month · last 6 months</span>
      </div>
      <div class="panel-body">
        <div v-if="monthlyGrowth.isLoading.value" class="loading schools-subtle">Loading…</div>
        <BarChart
          v-else
          :data="monthlyChartData"
          x-key="month"
          y-key="count"
          color="var(--schools-fg)"
          :height="250"
          :format-x="(v: any) => String(v)"
          :format-y="(v: number) => String(v)"
        />
      </div>
    </div>

    <!-- Enrollments by course -->
    <div class="schools-card chart-panel">
      <div class="panel-head">
        <span class="schools-kicker">Enrolments by course</span>
      </div>
      <div class="panel-body">
        <HorizontalBarChart
          :data="enrollmentData"
          label-key="course"
          value-key="count"
          color="var(--schools-fg)"
          :format-label="formatCourseLabel"
          :format-value="(v: number) => String(v)"
        />
      </div>
    </div>

    <!-- Entitlement funnel -->
    <div class="schools-card chart-panel">
      <div class="panel-head">
        <span class="schools-kicker">Entitlement funnel · signup to paid</span>
      </div>
      <div class="panel-body">
        <div v-if="funnelLoading" class="loading schools-subtle">Loading…</div>
        <div v-else-if="funnelData.length === 0" class="empty-inline schools-subtle">
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

/* Panels */
.chart-panel { padding: 0; overflow: hidden; }

.panel-head {
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--schools-border);
}

.panel-body { padding: 16px 20px 20px; }

.loading {
  text-align: center;
  padding: 28px 20px;
  font-size: 13px;
}

.empty-inline {
  text-align: center;
  padding: 22px 16px;
  font-size: 13px;
}

/* Funnel */
.funnel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.funnel-step {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.funnel-bar-track {
  width: 100%;
  height: 28px;
  background: #f3f1ec;
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-md);
  overflow: hidden;
}

.funnel-bar-fill {
  height: 100%;
  background: var(--schools-fg);
  border-radius: var(--schools-radius-md);
  transition: width 0.4s ease;
  min-width: 4px;
}

.funnel-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.funnel-stage {
  font-size: 13.5px;
  color: var(--schools-fg-2);
  text-transform: capitalize;
}

.funnel-count {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--schools-fg);
}
</style>
