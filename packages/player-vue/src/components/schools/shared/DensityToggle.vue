<script setup lang="ts">
type Density = 'compact' | 'detailed'

const props = defineProps<{
  modelValue: Density
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Density): void
}>()

const options: Array<{ id: Density; label: string }> = [
  { id: 'compact',  label: 'Compact' },
  { id: 'detailed', label: 'Detailed' },
]
</script>

<template>
  <div role="radiogroup" aria-label="Display density" class="density-toggle">
    <button
      v-for="opt in options"
      :key="opt.id"
      type="button"
      role="radio"
      :aria-checked="opt.id === props.modelValue"
      :class="['density-option', { active: opt.id === props.modelValue }]"
      @click="emit('update:modelValue', opt.id)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.density-toggle {
  display: inline-flex;
  background: #f3f1ec;
  border-radius: 7px;
  padding: 3px;
  gap: 2px;
  border: 1px solid var(--schools-border);
}
.density-option {
  padding: 5px 10px 6px;
  border: none;
  cursor: pointer;
  border-radius: 5px;
  background: transparent;
  color: var(--schools-fg-2);
  font-weight: 500;
  font-size: 12px;
  font-family: var(--font-body);
  transition: background 120ms ease-out, color 120ms ease-out;
}
.density-option.active {
  background: #fff;
  color: var(--schools-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  font-weight: 600;
}
</style>
