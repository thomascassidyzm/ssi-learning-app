<script setup lang="ts">
import { computed } from 'vue'

type Health = 'excellent' | 'good' | 'needs-attention' | 'inactive'

const props = withDefaults(defineProps<{
  health?: Health
  size?: number
}>(), {
  size: 8,
})

// Some School objects (demo fixtures, in-flight creates before the next
// fetchSchools() refetch) don't carry a health bucket yet — fall back to
// "inactive" rather than throwing on `undefined.replace(...)`.
const health = computed(() => props.health ?? 'inactive')
const label = computed(() => health.value.replace('-', ' '))
</script>

<template>
  <span
    class="health-dot"
    :style="{
      width: `${props.size}px`,
      height: `${props.size}px`,
      background: `var(--schools-health-${health})`,
    }"
    :title="label"
    :aria-label="label"
  />
</template>

<style scoped>
.health-dot {
  display: inline-block;
  border-radius: 50%;
  flex: none;
  vertical-align: middle;
}
</style>
