<script setup lang="ts">
/**
 * Cultural journey background — mist theme only.
 *
 * Two layers:
 *   1. Dawn glow — radial warmth that grows with belt progression
 *   2. Journey painting — monochrome cultural landscape
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  lang?: string
  beltName?: string
  beltColor?: string
}>(), {
  lang: 'jpn',
  beltName: 'white',
  beltColor: '#f5f5f5',
})

const JOURNEY_MAP: Record<string, string> = {
  jpn: '/design/journey-jpn.webp',
  zho: '/design/journey-cmn.webp',
  cmn: '/design/journey-cmn.webp',
  ita: '/design/journey-ita.webp',
  gle: '/design/journey-gle.webp',
  nld: '/design/journey-nld.webp',
  por: '/design/journey-por.webp',
}

// Dawn glow per belt: colour warms and intensifies as learner progresses
const DAWN_GLOW: Record<string, { color: string; opacity: number }> = {
  white:  { color: '200, 200, 215', opacity: 0.06 },
  yellow: { color: '225, 205, 140', opacity: 0.12 },
  orange: { color: '225, 175, 120', opacity: 0.16 },
  green:  { color: '170, 205, 155', opacity: 0.18 },
  blue:   { color: '150, 185, 225', opacity: 0.20 },
  purple: { color: '185, 155, 210', opacity: 0.22 },
  brown:  { color: '210, 175, 130', opacity: 0.24 },
  black:  { color: '230, 195, 110', opacity: 0.28 },
}

const DEFAULT_JOURNEY = '/design/journey-jpn.webp'

const imageSrc = computed(() => JOURNEY_MAP[props.lang] || DEFAULT_JOURNEY)

const glowStyle = computed(() => {
  const glow = DAWN_GLOW[props.beltName] || DAWN_GLOW.white
  return {
    '--glow-color': glow.color,
    '--glow-opacity': glow.opacity,
  }
})
</script>

<template>
  <div class="journey-bg" :style="glowStyle" aria-hidden="true">
    <!-- Dawn glow layer (behind the painting) -->
    <div class="dawn-glow"></div>
    <!-- The painting -->
    <img
      :src="imageSrc"
      alt=""
      class="journey-painting"
      loading="eager"
      draggable="false"
    >
  </div>
</template>

<style scoped>
.journey-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

.dawn-glow {
  position: absolute;
  inset: 0;
  background: transparent;
  transition: background 2s ease;
}

.journey-painting {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  opacity: 0.18;
  mix-blend-mode: multiply;
}

@media (min-aspect-ratio: 3/4) {
  .journey-painting {
    object-fit: contain;
  }
}
</style>
