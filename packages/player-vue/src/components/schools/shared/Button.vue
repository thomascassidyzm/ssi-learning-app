<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'

interface Props {
  /** Button variant: primary (red), secondary (outlined), ghost, play (gradient) */
  variant?: 'primary' | 'secondary' | 'ghost' | 'play'
  /** Button size */
  size?: 'sm' | 'md' | 'lg'
  /** Full width button */
  block?: boolean
  /** Disabled state */
  disabled?: boolean
  /** Loading state */
  loading?: boolean
  /** Icon to display before text */
  icon?: Component
  /** Icon only button (square) */
  iconOnly?: boolean
  /** HTML type attribute */
  type?: 'button' | 'submit' | 'reset'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  block: false,
  disabled: false,
  loading: false,
  iconOnly: false,
  type: 'button',
})

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const classes = computed(() => [
  'btn',
  `btn-${props.variant}`,
  `btn-${props.size}`,
  {
    'btn-block': props.block,
    'btn-icon-only': props.iconOnly,
    'btn-loading': props.loading,
  },
])

const handleClick = (event: MouseEvent) => {
  if (!props.disabled && !props.loading) {
    emit('click', event)
  }
}
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <!-- Loading spinner -->
    <span v-if="loading" class="btn-spinner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
      </svg>
    </span>

    <!-- Icon slot or prop -->
    <span v-if="$slots.icon || icon" class="btn-icon">
      <slot name="icon">
        <component :is="icon" v-if="icon" />
      </slot>
    </span>

    <!-- Text content -->
    <span v-if="!iconOnly" class="btn-text">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-family: inherit;
  font-weight: var(--font-semibold);
  text-decoration: none;
  border: none;
  cursor: pointer;
  transition: all var(--transition-base);
  white-space: nowrap;
  position: relative;
  overflow: hidden;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Sizes */
.btn-sm {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  border-radius: var(--radius-md);
}

.btn-md {
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-sm);
  border-radius: var(--radius-lg);
}

.btn-lg {
  padding: var(--space-4) var(--space-6);
  font-size: var(--text-base);
  border-radius: var(--radius-lg);
}

/* Icon only */
.btn-icon-only.btn-sm {
  padding: var(--space-2);
}

.btn-icon-only.btn-md {
  padding: var(--space-3);
}

.btn-icon-only.btn-lg {
  padding: var(--space-4);
}

/* Block */
.btn-block {
  width: 100%;
}

/* Variants */
.btn-primary {
  background: var(--ssi-red);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--ssi-red-light);
  transform: translateY(-2px);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(0);
}

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: var(--ssi-red);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--bg-card);
  color: var(--text-primary);
}

.btn-play {
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-red-dark));
  color: white;
  box-shadow: 0 4px 15px rgba(194, 58, 58, 0.4);
}

.btn-play:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 6px 20px rgba(194, 58, 58, 0.5);
}

.btn-play:active:not(:disabled) {
  transform: translateY(0) scale(1);
}

/* Icon */
.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon svg,
.btn-icon :deep(svg) {
  width: 1em;
  height: 1em;
}

.btn-sm .btn-icon svg,
.btn-sm .btn-icon :deep(svg) {
  width: 14px;
  height: 14px;
}

.btn-md .btn-icon svg,
.btn-md .btn-icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.btn-lg .btn-icon svg,
.btn-lg .btn-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

/* Loading */
.btn-loading .btn-icon,
.btn-loading .btn-text {
  opacity: 0;
}

.btn-spinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-spinner svg {
  width: 1.25em;
  height: 1.25em;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
