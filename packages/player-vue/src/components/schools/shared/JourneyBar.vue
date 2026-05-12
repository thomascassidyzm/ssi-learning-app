<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  done: number
  total: number
  color?: string
  label?: string
}>(), {
  color: 'var(--schools-red)',
  label: 'Course Journey',
})

const pct = computed(() => {
  if (!props.total) return 0
  return Math.max(0, Math.min(100, (props.done / props.total) * 100))
})
</script>

<template>
  <div class="journey">
    <div class="journey-head">
      <span>{{ props.label }}</span>
      <span>{{ props.done }}/{{ props.total }}</span>
    </div>
    <div class="journey-track">
      <div
        class="journey-fill"
        :style="{ width: `${pct}%`, background: props.color }"
      />
    </div>
  </div>
</template>

<style scoped>
.journey { width: 100%; }
.journey-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--schools-fg-2);
  margin-bottom: 4px;
}
.journey-track {
  height: 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.05);
  overflow: hidden;
}
.journey-fill { height: 100%; }
</style>
