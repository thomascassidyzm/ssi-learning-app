<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsRetention } from '@/composables/admin/useAnalyticsRetention'

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

type RetentionTone = 'green' | 'gold' | 'orange' | 'red'

function retentionTone(pct: number): RetentionTone {
  if (pct >= 60) return 'green'
  if (pct >= 40) return 'gold'
  if (pct >= 20) return 'orange'
  return 'red'
}

function retentionStyle(pct: number): Record<string, string> {
  const tone = retentionTone(pct)
  // Health-style palette tuned to the schools surface (warm putty, white cards).
  const map: Record<RetentionTone, { bg: string; border: string; color: string }> = {
    green: {
      bg: 'rgba(31, 138, 91, 0.12)',
      border: 'rgba(31, 138, 91, 0.32)',
      color: '#1F8A5B',
    },
    gold: {
      bg: 'rgba(198, 154, 28, 0.14)',
      border: 'rgba(198, 154, 28, 0.32)',
      color: '#8a6d10',
    },
    orange: {
      bg: 'rgba(198, 106, 28, 0.14)',
      border: 'rgba(198, 106, 28, 0.32)',
      color: '#a55715',
    },
    red: {
      bg: 'rgba(219, 30, 23, 0.10)',
      border: 'rgba(219, 30, 23, 0.30)',
      color: 'var(--schools-red-deep)',
    },
  }
  const m = map[tone]
  return { background: m.bg, borderColor: m.border, color: m.color }
}

onMounted(() => {
  retention.fetch(12)
})
</script>

<template>
  <div class="tab-content">
    <!-- Loading / error -->
    <div v-if="retention.isLoading.value" class="loading schools-subtle">Loading retention data…</div>
    <div v-if="retention.error.value" class="error-banner">{{ retention.error.value }}</div>

    <!-- KPI cards -->
    <div v-if="retention.data.value.length > 0" class="kpi-grid">
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Avg W1 retention</span>
        <span class="arsenal kpi-value">{{ avgW1 }}%</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Avg W4 retention</span>
        <span class="arsenal kpi-value">{{ avgW4 }}%</span>
      </div>
      <div class="schools-card schools-card-pad kpi">
        <span class="schools-kicker kpi-label">Avg W8 retention</span>
        <span class="arsenal kpi-value">{{ avgW8 }}%</span>
      </div>
    </div>

    <!-- Cohort table -->
    <div class="schools-card cohort-panel">
      <div class="panel-head">
        <span class="schools-kicker">Retention by signup cohort · % active in window</span>
      </div>

      <div v-if="retention.data.value.length === 0 && !retention.isLoading.value" class="empty-inline schools-subtle">
        Not enough data yet — cohorts need at least 8 weeks of history.
      </div>

      <div v-else class="table-wrapper">
        <table class="ssi-table cohort-table">
          <thead>
            <tr>
              <th>Cohort week</th>
              <th>Users</th>
              <th>Week 1</th>
              <th>Week 2</th>
              <th>Week 4</th>
              <th>Week 8</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in retention.data.value" :key="c.cohort_week">
              <td class="cell-week">{{ formatWeek(c.cohort_week) }}</td>
              <td class="cell-users">{{ c.cohort_size }}</td>
              <td>
                <span class="retention-cell" :style="retentionStyle(c.w1_pct)">
                  {{ c.w1_pct }}%
                </span>
              </td>
              <td>
                <span class="retention-cell" :style="retentionStyle(c.w2_pct)">
                  {{ c.w2_pct }}%
                </span>
              </td>
              <td>
                <span class="retention-cell" :style="retentionStyle(c.w4_pct)">
                  {{ c.w4_pct }}%
                </span>
              </td>
              <td>
                <span class="retention-cell" :style="retentionStyle(c.w8_pct)">
                  {{ c.w8_pct }}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Legend -->
      <div v-if="retention.data.value.length > 0" class="legend">
        <span class="legend-item">
          <span class="legend-swatch" :style="retentionStyle(80)"></span>
          <span>60%+</span>
        </span>
        <span class="legend-item">
          <span class="legend-swatch" :style="retentionStyle(50)"></span>
          <span>40–59%</span>
        </span>
        <span class="legend-item">
          <span class="legend-swatch" :style="retentionStyle(30)"></span>
          <span>20–39%</span>
        </span>
        <span class="legend-item">
          <span class="legend-swatch" :style="retentionStyle(10)"></span>
          <span>&lt;20%</span>
        </span>
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
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 110px;
}

.kpi-label { letter-spacing: 0.10em; }

.kpi-value {
  font-size: 34px;
  line-height: 1.05;
  letter-spacing: -0.015em;
  color: var(--schools-fg);
}

/* Cohort panel */
.cohort-panel { padding: 0; overflow: hidden; }

.panel-head {
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--schools-border);
}

.empty-inline {
  text-align: center;
  padding: 32px 20px;
  font-size: 13px;
}

/* Cohort table — overrides ssi-table defaults for numeric cells */
.table-wrapper {
  overflow-x: auto;
  padding: 4px 12px 12px;
}

.cohort-table thead th {
  background: transparent;
  border-bottom: 1px solid var(--schools-border);
}

.cell-week { color: var(--schools-fg); font-weight: 500; }
.cell-users { color: var(--schools-fg-3); }

.retention-cell {
  display: inline-block;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: var(--schools-radius-md);
  min-width: 56px;
  text-align: center;
  font-weight: 600;
  font-size: 13px;
}

/* Legend */
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 10px 20px 16px;
  border-top: 1px solid var(--schools-border);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
}

.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid transparent;
  flex-shrink: 0;
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

@media (max-width: 768px) {
  .kpi-grid { grid-template-columns: 1fr; }
}
</style>
