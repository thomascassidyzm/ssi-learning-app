<script setup lang="ts">
import { ref, computed } from 'vue'

interface Props {
  /** v-model value */
  modelValue?: string
  /** Placeholder text */
  placeholder?: string
  /** Full width */
  block?: boolean
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Autofocus on mount */
  autofocus?: boolean
  /** Disabled state */
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: 'Search...',
  block: false,
  size: 'md',
  autofocus: false,
  disabled: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'search', value: string): void
  (e: 'clear'): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const isFocused = ref(false)

const hasValue = computed(() => props.modelValue.length > 0)

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

const handleSearch = () => {
  emit('search', props.modelValue)
}

const handleClear = () => {
  emit('update:modelValue', '')
  emit('clear')
  inputRef.value?.focus()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    handleSearch()
  }
  if (event.key === 'Escape' && hasValue.value) {
    handleClear()
  }
}

const classes = computed(() => [
  'search-box',
  `search-box-${props.size}`,
  {
    'search-box-block': props.block,
    'search-box-focused': isFocused.value,
    'search-box-disabled': props.disabled,
    'search-box-has-value': hasValue.value,
  },
])
</script>

<template>
  <div :class="classes">
    <!-- Search icon -->
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/>
      <path d="m21 21-4.35-4.35"/>
    </svg>

    <!-- Input -->
    <input
      ref="inputRef"
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :autofocus="autofocus"
      class="search-input"
      @input="handleInput"
      @keydown="handleKeydown"
      @focus="isFocused = true"
      @blur="isFocused = false"
    />

    <!-- Clear button -->
    <button
      v-if="hasValue"
      type="button"
      class="search-clear"
      @click="handleClear"
      aria-label="Clear search"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.search-box {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.search-box-block {
  display: flex;
  width: 100%;
}

/* Sizes */
.search-box-sm .search-input {
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-10);
  font-size: var(--text-sm);
}

.search-box-md .search-input {
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-12);
  font-size: var(--text-sm);
}

.search-box-lg .search-input {
  padding: var(--space-4) var(--space-5) var(--space-4) var(--space-12);
  font-size: var(--text-base);
}

/* Input */
.search-input {
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-family: inherit;
  transition: all var(--transition-base);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-input:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

.search-box-disabled .search-input {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Search icon */
.search-icon {
  position: absolute;
  left: var(--space-4);
  color: var(--text-muted);
  pointer-events: none;
  transition: color var(--transition-base);
}

.search-box-sm .search-icon {
  width: 16px;
  height: 16px;
  left: var(--space-3);
}

.search-box-md .search-icon {
  width: 18px;
  height: 18px;
}

.search-box-lg .search-icon {
  width: 20px;
  height: 20px;
}

.search-box-focused .search-icon {
  color: var(--ssi-red);
}

/* Clear button */
.search-clear {
  position: absolute;
  right: var(--space-3);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border-radius: var(--radius-full);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-base);
}

.search-clear:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.search-clear svg {
  width: 14px;
  height: 14px;
}

.search-box-sm .search-clear {
  width: 20px;
  height: 20px;
  right: var(--space-2);
}

.search-box-sm .search-clear svg {
  width: 12px;
  height: 12px;
}
</style>
