<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  label: string
  value: string | number
  icon?: string
  trend?: {
    value: string
    direction: 'up' | 'down' | 'neutral'
  }
  variant?: 'red' | 'gold' | 'green' | 'blue' | 'purple'
  size?: 'default' | 'compact'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'red',
  size: 'default'
})

const variantStyles = computed(() => ({
  red: {
    accentBar: 'linear-gradient(90deg, var(--ssi-red), var(--ssi-red-light))',
    iconBg: 'rgba(194, 58, 58, 0.15)',
    trendUpBg: 'rgba(74, 222, 128, 0.15)',
    trendDownBg: 'rgba(239, 68, 68, 0.15)'
  },
  gold: {
    accentBar: 'linear-gradient(90deg, var(--ssi-gold-dark), var(--ssi-gold))',
    iconBg: 'rgba(212, 168, 83, 0.15)',
    trendUpBg: 'rgba(74, 222, 128, 0.15)',
    trendDownBg: 'rgba(239, 68, 68, 0.15)'
  },
  green: {
    accentBar: 'linear-gradient(90deg, #16a34a, var(--success))',
    iconBg: 'rgba(74, 222, 128, 0.15)',
    trendUpBg: 'rgba(74, 222, 128, 0.15)',
    trendDownBg: 'rgba(239, 68, 68, 0.15)'
  },
  blue: {
    accentBar: 'linear-gradient(90deg, #2563eb, var(--info))',
    iconBg: 'rgba(96, 165, 250, 0.15)',
    trendUpBg: 'rgba(74, 222, 128, 0.15)',
    trendDownBg: 'rgba(239, 68, 68, 0.15)'
  },
  purple: {
    accentBar: 'linear-gradient(90deg, #7c3aed, #a855f7)',
    iconBg: 'rgba(168, 85, 247, 0.15)',
    trendUpBg: 'rgba(74, 222, 128, 0.15)',
    trendDownBg: 'rgba(239, 68, 68, 0.15)'
  }
}[props.variant]))

const formattedValue = computed(() => {
  if (typeof props.value === 'number') {
    return props.value.toLocaleString()
  }
  return props.value
})

const trendClass = computed(() => {
  if (!props.trend) return ''
  return props.trend.direction
})
</script>

<template>
  <div
    class="stats-card"
    :class="[`variant-${variant}`, `size-${size}`]"
  >
    <!-- Accent bar at top -->
    <div
      class="accent-bar"
      :style="{ background: variantStyles.accentBar }"
    ></div>

    <div class="card-content">
      <!-- Header: Icon + Trend -->
      <div class="card-header">
        <div
          v-if="icon"
          class="stat-icon"
          :style="{ background: variantStyles.iconBg }"
        >
          {{ icon }}
        </div>

        <span
          v-if="trend"
          class="trend-badge"
          :class="trendClass"
          :style="{
            background: trend.direction === 'up'
              ? variantStyles.trendUpBg
              : trend.direction === 'down'
                ? variantStyles.trendDownBg
                : 'var(--bg-elevated)'
          }"
        >
          <svg
            v-if="trend.direction === 'up'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
            <polyline points="17 6 23 6 23 12"/>
          </svg>
          <svg
            v-else-if="trend.direction === 'down'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
            <polyline points="17 18 23 18 23 12"/>
          </svg>
          {{ trend.value }}
        </span>
      </div>

      <!-- Value -->
      <div class="stat-value">{{ formattedValue }}</div>

      <!-- Label -->
      <div class="stat-label">{{ label }}</div>
    </div>
  </div>
</template>

<style scoped>
.stats-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.stats-card:hover {
  transform: translateY(-6px);
  border-color: var(--border-medium);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
}

.accent-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
}

.card-content {
  padding: 24px;
}

.size-compact .card-content {
  padding: 18px;
}

/* Header */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.size-compact .card-header {
  margin-bottom: 12px;
}

.stat-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  transition: transform 0.3s ease;
}

.size-compact .stat-icon {
  width: 44px;
  height: 44px;
  font-size: 22px;
  border-radius: 12px;
}

.stats-card:hover .stat-icon {
  transform: scale(1.08);
}

/* Trend Badge */
.trend-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.trend-badge.up {
  color: var(--success);
}

.trend-badge.down {
  color: var(--error);
}

.trend-badge.neutral {
  color: var(--text-muted);
}

/* Value */
.stat-value {
  font-family: 'Noto Sans JP', system-ui, sans-serif;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.1;
  margin-bottom: 6px;
  color: var(--text-primary);
  transition: color 0.3s ease;
}

.size-compact .stat-value {
  font-size: 32px;
}

/* Label */
.stat-label {
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 500;
}

.size-compact .stat-label {
  font-size: 13px;
}

/* Variant-specific hover effects */
.variant-red:hover .stat-value {
  color: var(--ssi-red);
}

.variant-gold:hover .stat-value {
  color: var(--ssi-gold);
}

.variant-green:hover .stat-value {
  color: var(--success);
}

.variant-blue:hover .stat-value {
  color: var(--info);
}

.variant-purple:hover .stat-value {
  color: #a855f7;
}

/* Responsive */
@media (max-width: 768px) {
  .stat-value {
    font-size: 32px;
  }

  .stat-icon {
    width: 44px;
    height: 44px;
    font-size: 22px;
  }
}
</style>
