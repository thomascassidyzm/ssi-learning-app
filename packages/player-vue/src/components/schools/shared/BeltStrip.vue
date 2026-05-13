<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  distribution: Record<string, number>
  height?: number
}>()

const total = computed(() =>
  Object.values(props.distribution).reduce((a, b) => a + b, 0) || 1,
)

const segments = computed(() =>
  Object.entries(props.distribution).map(([belt, n]) => ({
    belt,
    pct: (n / total.value) * 100,
  })),
)
</script>

<template>
  <div
    class="belt-strip"
    :style="{ height: `${props.height ?? 6}px`, borderRadius: `${(props.height ?? 6) / 2}px` }"
    role="img"
    aria-label="Belt distribution"
  >
    <div
      v-for="seg in segments"
      :key="seg.belt"
      class="belt-segment"
      :style="{
        width: `${seg.pct}%`,
        background: `var(--schools-belt-${seg.belt})`,
      }"
    />
  </div>
</template>

<style scoped>
.belt-strip {
  display: flex;
  width: 100%;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.05);
}
.belt-segment { height: 100%; }
</style>
