<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  /** Card variant: default, stats (for metric cards), elevated */
  variant?: 'default' | 'stats' | 'elevated'
  /** Accent color for top border on hover */
  accent?: 'red' | 'gold' | 'green' | 'blue' | 'gradient' | 'none'
  /** Make card hoverable with lift effect */
  hoverable?: boolean
  /** Remove padding */
  noPadding?: boolean
  /** Card header title */
  title?: string
  /** Card header subtitle */
  subtitle?: string
  /** Loading state */
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  accent: 'gradient',
  hoverable: false,
  noPadding: false,
  loading: false,
})

const classes = computed(() => [
  'card',
  `card-${props.variant}`,
  `card-accent-${props.accent}`,
  {
    'card-hoverable': props.hoverable,
    'card-no-padding': props.noPadding,
    'card-loading': props.loading,
  },
])
</script>

<template>
  <div :class="classes">
    <!-- Top accent bar (shows on hover for hoverable cards) -->
    <div v-if="accent !== 'none'" class="card-accent-bar" aria-hidden="true"></div>

    <!-- Optional header with title/subtitle -->
    <div v-if="title || $slots.header" class="card-header">
      <slot name="header">
        <div v-if="title" class="card-header-content">
          <h3 class="card-title">
            <slot name="icon" />
            {{ title }}
          </h3>
          <p v-if="subtitle" class="card-subtitle">{{ subtitle }}</p>
        </div>
      </slot>
      <div v-if="$slots['header-actions']" class="card-header-actions">
        <slot name="header-actions" />
      </div>
    </div>

    <!-- Card body -->
    <div class="card-body">
      <!-- Loading skeleton -->
      <div v-if="loading" class="card-loading-skeleton">
        <div class="skeleton-line skeleton-line-lg"></div>
        <div class="skeleton-line skeleton-line-md"></div>
        <div class="skeleton-line skeleton-line-sm"></div>
      </div>

      <!-- Actual content -->
      <slot v-else />
    </div>

    <!-- Optional footer -->
    <div v-if="$slots.footer" class="card-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  position: relative;
  overflow: hidden;
  transition: all var(--transition-slow);
}

/* Variants */
.card-default {
  /* Base styles */
}

.card-stats {
  padding: var(--space-6);
}

.card-elevated {
  box-shadow: var(--shadow-md);
}

/* Accent bar (top) */
.card-accent-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  opacity: 0;
  transition: opacity var(--transition-slow);
}

.card-hoverable .card-accent-bar {
  height: 4px;
}

.card-accent-red .card-accent-bar {
  background: linear-gradient(90deg, var(--ssi-red), var(--ssi-red-light));
}

.card-accent-gold .card-accent-bar {
  background: linear-gradient(90deg, var(--ssi-gold-dark), var(--ssi-gold));
}

.card-accent-green .card-accent-bar {
  background: linear-gradient(90deg, #16a34a, var(--success));
}

.card-accent-blue .card-accent-bar {
  background: linear-gradient(90deg, #2563eb, var(--info));
}

.card-accent-gradient .card-accent-bar {
  background: linear-gradient(90deg, var(--ssi-red), var(--ssi-gold));
}

/* Hoverable */
.card-hoverable {
  cursor: pointer;
}

.card-hoverable:hover {
  border-color: var(--ssi-red);
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
}

.card-hoverable:hover .card-accent-bar {
  opacity: 1;
}

/* No padding */
.card-no-padding .card-body {
  padding: 0;
}

/* Header */
.card-header {
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.card-header-content {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
}

.card-title :deep(svg) {
  color: var(--ssi-red);
  flex-shrink: 0;
}

.card-subtitle {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: var(--space-1) 0 0 0;
}

.card-header-actions {
  flex-shrink: 0;
}

/* Body */
.card-body {
  padding: var(--space-6);
}

.card-stats .card-body {
  padding: 0;
}

/* Footer */
.card-footer {
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

/* Loading skeleton */
.card-loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.skeleton-line {
  background: linear-gradient(
    90deg,
    var(--bg-secondary) 25%,
    var(--bg-elevated) 50%,
    var(--bg-secondary) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}

.skeleton-line-lg {
  height: 24px;
  width: 60%;
}

.skeleton-line-md {
  height: 16px;
  width: 80%;
}

.skeleton-line-sm {
  height: 16px;
  width: 40%;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
