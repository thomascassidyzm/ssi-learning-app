<script setup lang="ts">
type Health = 'excellent' | 'good' | 'needs-attention' | 'inactive'

const props = withDefaults(defineProps<{
  health: Health
  size?: number
}>(), {
  size: 8,
})
</script>

<template>
  <span
    class="health-dot"
    :style="{
      width: `${props.size}px`,
      height: `${props.size}px`,
      background: `var(--schools-health-${props.health})`,
    }"
    :title="props.health.replace('-', ' ')"
    :aria-label="props.health.replace('-', ' ')"
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
