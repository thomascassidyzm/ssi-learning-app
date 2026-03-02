<script setup lang="ts">
/**
 * Sumi-e ink wash mountain pilgrimage — mist theme only.
 * Uses a real ink wash painting as background with a programmatic
 * belt-colour splash that climbs the mountain path as the learner progresses.
 */
import { computed } from 'vue'

const props = defineProps<{
  beltName: string
  beltColor: string
}>()

// Belt index drives splash position (0=white at base, 7=black at summit)
const BELT_ORDER = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']
const beltIndex = computed(() => {
  const idx = BELT_ORDER.indexOf(props.beltName)
  return idx >= 0 ? idx : 0
})

// Splash position follows the painted path: bottom-left → top-right
// Coordinates as % of container (matched to the painting's path)
const SPLASH_WAYPOINTS = [
  { x: 28, y: 88 },  // White — foothills, bottom-left
  { x: 35, y: 78 },  // Yellow
  { x: 42, y: 68 },  // Orange
  { x: 48, y: 58 },  // Green
  { x: 54, y: 48 },  // Blue
  { x: 58, y: 38 },  // Purple
  { x: 62, y: 28 },  // Brown
  { x: 65, y: 18 },  // Black — summit temple
]

const splashStyle = computed(() => {
  const wp = SPLASH_WAYPOINTS[beltIndex.value]
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
      src="/design/sumi-e-mountain.webp"
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
