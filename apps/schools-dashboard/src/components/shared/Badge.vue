<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  /** Badge variant */
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'ssi-red' | 'ssi-gold'
  /** Belt color (for belt badges) */
  belt?: 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'brown' | 'black'
  /** Badge size */
  size?: 'sm' | 'md' | 'lg'
  /** Rounded pill style */
  pill?: boolean
  /** Dot indicator (no text) */
  dot?: boolean
  /** Pulsing animation */
  pulse?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'md',
  pill: false,
  dot: false,
  pulse: false,
})

const classes = computed(() => [
  'badge',
  `badge-${props.size}`,
  {
    [`badge-${props.variant}`]: !props.belt,
    [`badge-belt-${props.belt}`]: props.belt,
    'badge-pill': props.pill,
    'badge-dot': props.dot,
    'badge-pulse': props.pulse,
  },
])
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body);
  font-weight: var(--font-semibold);
  line-height: 1;
  white-space: nowrap;
  border-radius: var(--radius-md);
  transition: all var(--transition-base);
}

/* Sizes */
.badge-sm {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
}

.badge-md {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
}

.badge-lg {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
}

/* Pill style */
.badge-pill {
  border-radius: var(--radius-full);
}

/* Dot style */
.badge-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border-radius: var(--radius-full);
}

.badge-dot.badge-lg {
  width: 12px;
  height: 12px;
}

/* Variants */
.badge-default {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.badge-success {
  background: var(--success-muted);
  color: var(--success);
}

.badge-warning {
  background: var(--warning-muted);
  color: var(--warning);
}

.badge-error {
  background: var(--error-muted);
  color: var(--error);
}

.badge-info {
  background: var(--info-muted);
  color: var(--info);
}

.badge-ssi-red {
  background: rgba(194, 58, 58, 0.15);
  color: var(--ssi-red);
}

.badge-ssi-gold {
  background: rgba(212, 168, 83, 0.15);
  color: var(--ssi-gold);
}

/* Belt variants */
.badge-belt-white {
  background: linear-gradient(135deg, var(--belt-white), var(--belt-white-dark));
  color: #333333;
}

.badge-belt-yellow {
  background: linear-gradient(135deg, var(--belt-yellow), var(--belt-yellow-dark));
  color: #333333;
}

.badge-belt-orange {
  background: linear-gradient(135deg, var(--belt-orange), var(--belt-orange-dark));
  color: white;
}

.badge-belt-green {
  background: linear-gradient(135deg, var(--belt-green), var(--belt-green-dark));
  color: white;
}

.badge-belt-blue {
  background: linear-gradient(135deg, var(--belt-blue), var(--belt-blue-dark));
  color: white;
}

.badge-belt-brown {
  background: linear-gradient(135deg, var(--belt-brown), var(--belt-brown-dark));
  color: white;
}

.badge-belt-black {
  background: linear-gradient(135deg, var(--belt-black), var(--belt-black-dark));
  color: white;
}

/* Pulse animation */
.badge-pulse {
  animation: badgePulse 2s ease-in-out infinite;
}

@keyframes badgePulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
