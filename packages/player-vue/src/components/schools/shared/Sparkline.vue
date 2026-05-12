<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  data: number[]
  color?: string
  width?: number
  height?: number
}>(), {
  color: 'var(--schools-red)',
  width: 88,
  height: 24,
})

const shape = computed(() => {
  const data = props.data.length ? props.data : [0, 0]
  const max = Math.max(...data, 1)
  const step = props.data.length > 1 ? props.width / (props.data.length - 1) : 0
  const pts = data.map((v, i) => `${i * step},${props.height - (v / max) * props.height}`).join(' ')
  const fillPts = `0,${props.height} ${pts} ${props.width},${props.height}`
  return { pts, fillPts }
})
</script>

<template>
  <svg
    class="sparkline"
    :width="props.width"
    :height="props.height"
    :viewBox="`0 0 ${props.width} ${props.height}`"
  >
    <polygon :points="shape.fillPts" :fill="props.color" opacity="0.12" />
    <polyline
      :points="shape.pts"
      fill="none"
      :stroke="props.color"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.sparkline { display: block; }
</style>
