<script setup lang="ts">
/**
 * Sumi-e ink wash mountain pilgrimage — mist theme only.
 * Uses a real ink wash painting as background with a programmatic
 * belt-colour splash that climbs the mountain path as the learner progresses.
 *
 * Two painting variants:
 *   1 = misty landscape with wide path (default)
 *   2 = stepped mountain trail, more vertical, bolder ink
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  beltName: string
  beltColor: string
  variant?: 1 | 2
}>(), {
  variant: 1,
})

// Belt index drives splash position (0=white at base, 7=black at summit)
const BELT_ORDER = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']
const beltIndex = computed(() => {
  const idx = BELT_ORDER.indexOf(props.beltName)
  return idx >= 0 ? idx : 0
})

// Splash waypoints per variant (% of container, matched to each painting's path)
const WAYPOINTS: Record<number, { x: number; y: number }[]> = {
  1: [
    { x: 28, y: 88 },  // White — foothills, bottom-left
    { x: 35, y: 78 },  // Yellow
    { x: 42, y: 68 },  // Orange
    { x: 48, y: 58 },  // Green
    { x: 54, y: 48 },  // Blue
    { x: 58, y: 38 },  // Purple
    { x: 62, y: 28 },  // Brown
    { x: 65, y: 18 },  // Black — summit temple
  ],
  2: [
    { x: 45, y: 92 },  // White — rocks at base, center-bottom
    { x: 42, y: 82 },  // Yellow
    { x: 48, y: 72 },  // Orange
    { x: 52, y: 60 },  // Green — mid-path switchback
    { x: 58, y: 48 },  // Blue
    { x: 62, y: 38 },  // Purple
    { x: 64, y: 28 },  // Brown
    { x: 66, y: 16 },  // Black — temple at summit
  ],
}

const imageSrc = computed(() =>
  props.variant === 2
    ? '/design/sumi-e-mountain-2.webp'
    : '/design/sumi-e-mountain.webp'
)

const splashStyle = computed(() => {
  const wp = (WAYPOINTS[props.variant] || WAYPOINTS[1])[beltIndex.value]
  return {
    '--splash-x': `${wp.x}%`,
    '--splash-y': `${wp.y}%`,
    '--splash-color': props.beltColor,
  }
})
</script>

<template>
  <div class="sumi-e-bg" :style="splashStyle" aria-hidden="true">
    <!-- The painting -->
    <img
      :src="imageSrc"
      alt=""
      class="sumi-e-painting"
      loading="eager"
      draggable="false"
    >
    <!-- Belt colour splash overlay -->
    <div class="belt-splash"></div>
  </div>
</template>

<style scoped>
.sumi-e-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

.sumi-e-painting {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center bottom;
  opacity: 0.18;
  mix-blend-mode: multiply;
}

.belt-splash {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at var(--splash-x, 50%) var(--splash-y, 50%),
    var(--splash-color, transparent) 0%,
    color-mix(in srgb, var(--splash-color, transparent) 40%, transparent) 8%,
    transparent 18%
  );
  opacity: 0.35;
  mix-blend-mode: multiply;
}
</style>
