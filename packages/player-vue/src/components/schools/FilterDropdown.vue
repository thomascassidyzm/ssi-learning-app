<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface FilterOption {
  value: string | number
  label: string
  icon?: string
}

interface Props {
  /** v-model value */
  modelValue?: string | number | null
  /** Dropdown options */
  options: FilterOption[]
  /** Placeholder when no selection */
  placeholder?: string
  /** Show filter icon */
  showFilterIcon?: boolean
  /** Disabled state */
  disabled?: boolean
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  placeholder: 'All',
  showFilterIcon: false,
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number | null): void
  (e: 'change', value: string | number | null): void
}>()

const isOpen = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)

const selectedOption = computed(() =>
  props.options.find(opt => opt.value === props.modelValue)
)

const displayText = computed(() =>
  selectedOption.value?.label || props.placeholder
)

const toggle = () => {
  if (!props.disabled) {
    isOpen.value = !isOpen.value
  }
}

const close = () => {
  isOpen.value = false
}

const select = (option: FilterOption) => {
  emit('update:modelValue', option.value)
  emit('change', option.value)
  close()
}

const clearSelection = (event: Event) => {
  event.stopPropagation()
  emit('update:modelValue', null)
  emit('change', null)
}

// Close on click outside
const handleClickOutside = (event: MouseEvent) => {
  if (
    triggerRef.value &&
    dropdownRef.value &&
    !triggerRef.value.contains(event.target as Node) &&
    !dropdownRef.value.contains(event.target as Node)
  ) {
    close()
  }
}

// Close on escape
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})

const classes = computed(() => [
  'filter-dropdown',
  `filter-dropdown-${props.size}`,
  {
    'filter-dropdown-open': isOpen.value,
    'filter-dropdown-disabled': props.disabled,
    'filter-dropdown-has-value': props.modelValue !== null,
  },
])
</script>

<template>
  <div :class="classes">
    <!-- Trigger button -->
    <button
      ref="triggerRef"
      type="button"
      class="filter-trigger"
      :disabled="disabled"
      @click="toggle"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
    >
      <!-- Filter icon -->
      <svg v-if="showFilterIcon" class="filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
      </svg>

      <!-- Selected option icon -->
      <span v-if="selectedOption?.icon" class="filter-option-icon">{{ selectedOption.icon }}</span>

      <!-- Text -->
      <span class="filter-text">{{ displayText }}</span>

      <!-- Clear button (when has value) -->
      <button
        v-if="modelValue !== null"
        type="button"
        class="filter-clear"
        @click="clearSelection"
        aria-label="Clear filter"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <!-- Chevron -->
      <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>

    <!-- Dropdown menu -->
    <Transition name="dropdown">
      <div v-if="isOpen" ref="dropdownRef" class="filter-menu" role="listbox">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          class="filter-option"
          :class="{ 'filter-option-selected': option.value === modelValue }"
          role="option"
          :aria-selected="option.value === modelValue"
          @click="select(option)"
        >
          <span v-if="option.icon" class="filter-option-icon">{{ option.icon }}</span>
          <span class="filter-option-label">{{ option.label }}</span>
          <svg v-if="option.value === modelValue" class="filter-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.filter-dropdown {
  position: relative;
  display: inline-flex;
}

/* Trigger */
.filter-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-base);
  white-space: nowrap;
}

/* Sizes */
.filter-dropdown-sm .filter-trigger {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
}

.filter-dropdown-md .filter-trigger {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
}

.filter-dropdown-lg .filter-trigger {
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-base);
}

.filter-trigger:hover:not(:disabled) {
  border-color: var(--ssi-red);
  background: var(--bg-card-hover);
}

.filter-dropdown-open .filter-trigger {
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

.filter-dropdown-disabled .filter-trigger {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Filter icon */
.filter-icon {
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.filter-dropdown-sm .filter-icon {
  width: 14px;
  height: 14px;
}

/* Option icon (emoji) */
.filter-option-icon {
  font-size: 1.1em;
}

/* Text */
.filter-text {
  flex: 1;
  text-align: left;
}

/* Clear button */
.filter-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  color: var(--text-muted);
  transition: all var(--transition-base);
}

.filter-clear:hover {
  background: var(--error-muted);
  color: var(--error);
}

.filter-clear svg {
  width: 12px;
  height: 12px;
}

/* Chevron */
.filter-chevron {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform var(--transition-base);
}

.filter-dropdown-open .filter-chevron {
  transform: rotate(180deg);
}

/* Menu */
.filter-menu {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  min-width: 100%;
  max-height: 300px;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: var(--z-dropdown);
  padding: var(--space-1);
}

/* Options */
.filter-option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--transition-base);
  text-align: left;
}

.filter-option:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.filter-option-selected {
  color: var(--text-primary);
  font-weight: var(--font-medium);
}

.filter-option-label {
  flex: 1;
}

.filter-check {
  width: 16px;
  height: 16px;
  color: var(--ssi-red);
  flex-shrink: 0;
}

/* Dropdown animation */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all var(--transition-base);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
