<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsRetention } from '@/composables/admin/useAnalyticsRetention'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

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
  // Use tonal triplets, except orange which falls back to a warm amber
  const map: Record<RetentionTone, { bg: string; border: string; color: string }> = {
    green: {
      bg: 'rgba(var(--tone-green), 0.14)',
      border: 'rgba(var(--tone-green), 0.32)',
      color: 'rgb(var(--tone-green))',
    },
    gold: {
      bg: 'rgba(var(--tone-gold), 0.14)',
      border: 'rgba(var(--tone-gold), 0.32)',
      color: 'rgb(var(--tone-gold))',
    },
    orange: {
      bg: 'rgba(220, 130, 60, 0.14)',
      border: 'rgba(220, 130, 60, 0.32)',
      color: 'rgb(180, 105, 45)',
    },
    red: {
      bg: 'rgba(var(--tone-red), 0.14)',
      border: 'rgba(var(--tone-red), 0.32)',
      color: 'rgb(var(--tone-red))',
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
    <!-- Loading -->
    <div v-if="retention.isLoading.value" class="loading">Loading retention data…</div>
    <div v-if="retention.error.value" class="error-banner">{{ retention.error.value }}</div>

    <!-- KPI stones -->
    <div v-if="retention.data.value.length > 0" class="kpi-strip">
      <FrostCard variant="stone" tone="green">
        <div class="stone-content">
          <span class="stone-label">Avg W1 retention</span>
          <span class="stone-value frost-mono-nums">{{ avgW1 }}%</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="gold">
        <div class="stone-content">
          <span class="stone-label">Avg W4 retention</span>
          <span class="stone-value frost-mono-nums">{{ avgW4 }}%</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="red">
        <div class="stone-content">
          <span class="stone-label">Avg W8 retention</span>
          <span class="stone-value frost-mono-nums">{{ avgW8 }}%</span>
        </div>
      </FrostCard>
    </div>

    <!-- Cohort table -->
    <FrostCard variant="panel" class="cohort-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Retention by signup cohort · % active in window</span>
      </div>

      <div v-if="retention.data.value.length === 0 && !retention.isLoading.value" class="empty-inline">
        Not enough data yet — cohorts need at least 8 weeks of history.
      </div>

      <div v-else class="table-wrapper">
        <table class="cohort-table">
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
              <td class="cell-week frost-mono-nums">{{ formatWeek(c.cohort_week) }}</td>
              <td class="cell-users frost-mono-nums">{{ c.cohort_size }}</td>
              <td>
                <span class="retention-cell frost-mono-nums" :style="retentionStyle(c.w1_pct)">
                  {{ c.w1_pct }}%
                </span>
              </td>
              <td>
                <span class="retention-cell frost-mono-nums" :style="retentionStyle(c.w2_pct)">
                  {{ c.w2_pct }}%
                </span>
              </td>
              <td>
                <span class="retention-cell frost-mono-nums" :style="retentionStyle(c.w4_pct)">
                  {{ c.w4_pct }}%
                </span>
              </td>
              <td>
                <span class="retention-cell frost-mono-nums" :style="retentionStyle(c.w8_pct)">
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
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}

.stone-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: var(--space-5) var(--space-6);
  min-height: 120px;
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

/* Panel */
.cohort-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.empty-inline {
  text-align: center;
  padding: var(--space-8) var(--space-5);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Cohort table */
.table-wrapper {
  overflow-x: auto;
  padding: var(--space-2) var(--space-4) var(--space-4);
}

.cohort-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.cohort-table th {
  text-align: left;
  padding: var(--space-3);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-muted);
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
}

.cohort-table td {
  padding: var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  color: var(--ink-secondary);
}

.cell-week { color: var(--ink-primary); font-weight: var(--font-medium); }
.cell-users { color: var(--ink-muted); }

.retention-cell {
  display: inline-block;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  min-width: 56px;
  text-align: center;
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
}

/* Legend */
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6) var(--space-4);
  border-top: 1px solid rgba(44, 38, 34, 0.06);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--ink-muted);
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

@media (max-width: 768px) {
  .kpi-strip { grid-template-columns: 1fr; }
}
</style>
