<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsRetention } from '@/composables/admin/useAnalyticsRetention'
import Card from '@/components/schools/shared/Card.vue'
import StatsCard from '@/components/schools/StatsCard.vue'

const { getClient } = useAdminClient()
const client = getClient()

const retention = useAnalyticsRetention(client)

// Summary averages
const avgW1 = computed(() => average(retention.data.value.map(c => c.w1_pct)))
const avgW4 = computed(() => average(retention.data.value.map(c => c.w4_pct)))
const avgW8 = computed(() => average(retention.data.value.map(c => c.w8_pct)))

function average(nums: number[]): number {
  if (nums.length === 0) return 0
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

function formatWeek(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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
  retention.fetch(12)
})
</script>

<template>
  <div class="tab-content">
    <!-- Loading -->
    <div v-if="retention.isLoading.value" class="loading-state animate-in">
      Loading retention data...
    </div>
    <div v-if="retention.error.value" class="alert-error animate-in">
      {{ retention.error.value }}
    </div>

    <!-- Summary Stats -->
    <div v-if="retention.data.value.length > 0" class="summary-grid animate-in delay-1">
      <StatsCard
        :value="`${avgW1}%`"
        label="Avg W1 Retention"
        variant="green"
        size="compact"
      />
      <StatsCard
        :value="`${avgW4}%`"
        label="Avg W4 Retention"
        variant="gold"
        size="compact"
      />
      <StatsCard
        :value="`${avgW8}%`"
        label="Avg W8 Retention"
        variant="red"
        size="compact"
      />
    </div>

    <!-- Heatmap -->
    <Card
      title="Retention by Signup Cohort"
      subtitle="Percentage of users active in each window after signup"
      accent="red"
      class="animate-in delay-2"
    >
      <div v-if="retention.data.value.length === 0" class="empty-state">
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
            <tr v-for="c in retention.data.value" :key="c.cohort_week">
              <td>{{ formatWeek(c.cohort_week) }}</td>
              <td class="users-cell">{{ c.cohort_size }}</td>
              <td>
                <span
                  class="retention-cell"
                  :style="{
                    color: retentionColor(c.w1_pct),
                    background: retentionBgColor(c.w1_pct),
                  }"
                >
                  {{ c.w1_pct }}%
                </span>
              </td>
              <td>
                <span
                  class="retention-cell"
                  :style="{
                    color: retentionColor(c.w2_pct),
                    background: retentionBgColor(c.w2_pct),
                  }"
                >
                  {{ c.w2_pct }}%
                </span>
              </td>
              <td>
                <span
                  class="retention-cell"
                  :style="{
                    color: retentionColor(c.w4_pct),
                    background: retentionBgColor(c.w4_pct),
                  }"
                >
                  {{ c.w4_pct }}%
                </span>
              </td>
              <td>
                <span
                  class="retention-cell"
                  :style="{
                    color: retentionColor(c.w8_pct),
                    background: retentionBgColor(c.w8_pct),
                  }"
                >
                  {{ c.w8_pct }}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Legend -->
      <div class="legend">
        <div class="legend-item">
          <span class="legend-swatch" style="background: #4ade80;"></span>
          <span>60%+</span>
        </div>
        <div class="legend-item">
          <span class="legend-swatch" style="background: #fbbf24;"></span>
          <span>40-59%</span>
        </div>
        <div class="legend-item">
          <span class="legend-swatch" style="background: #f97316;"></span>
          <span>20-39%</span>
        </div>
        <div class="legend-item">
          <span class="legend-swatch" style="background: #ef4444;"></span>
          <span>&lt;20%</span>
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

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
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

/* Retention Table */
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

/* Legend */
.legend {
  display: flex;
  gap: var(--space-4, 16px);
  margin-top: var(--space-4, 16px);
  padding-top: var(--space-3, 12px);
  border-top: 1px solid var(--border-subtle);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--space-2, 6px);
  font-size: var(--text-xs, 0.75rem);
  color: var(--text-muted);
}

.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .legend {
    flex-wrap: wrap;
  }
}
</style>
