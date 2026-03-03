<script setup lang="ts">
/**
 * Cultural journey background — mist theme only.
 *
 * Three layers (back to front):
 *   1. Dawn glow — radial warmth that grows with belt progression
 *   2. Journey painting — monochrome cultural landscape
 *   3. Colour accents — "Schindler's List" style tiny belt-coloured
 *      highlights at meaningful spots (a lantern, a window, a flower)
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

// Schindler accents: tiny coloured spots at meaningful positions per painting.
// Coordinates are % of the container. Each accent = one small element of life
// in the monochrome landscape: a lantern, a lit window, a flower.
const ACCENTS: Record<string, { x: number; y: number; size: number; label: string }[]> = {
  jpn: [
    { x: 50, y: 19, size: 8, label: 'temple lantern' },
    { x: 43, y: 55, size: 6, label: 'path marker' },
  ],
  zho: [
    { x: 50, y: 20, size: 8, label: 'pavilion lantern' },
    { x: 46, y: 58, size: 6, label: 'pine blossom' },
  ],
  cmn: [
    { x: 50, y: 20, size: 8, label: 'pavilion lantern' },
    { x: 46, y: 58, size: 6, label: 'pine blossom' },
  ],
  ita: [
    { x: 55, y: 24, size: 8, label: 'bell tower window' },
    { x: 35, y: 76, size: 6, label: 'wildflower' },
  ],
}

const DEFAULT_JOURNEY = '/design/journey-jpn.webp'

const imageSrc = computed(() => JOURNEY_MAP[props.lang] || DEFAULT_JOURNEY)
const accents = computed(() => ACCENTS[props.lang] || ACCENTS.jpn)

const glowStyle = computed(() => {
  const glow = DAWN_GLOW[props.beltName] || DAWN_GLOW.white
  return {
    '--glow-color': glow.color,
    '--glow-opacity': glow.opacity,
    '--accent-color': props.beltColor,
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
    <!-- Schindler accents — tiny belt-coloured highlights -->
    <span
      v-for="(a, i) in accents"
      :key="i"
      class="accent"
      :style="{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.size}px`, height: `${a.size}px` }"
    />
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
  background: radial-gradient(
    ellipse 80% 60% at 50% 25%,
    rgba(var(--glow-color, 200, 200, 215), var(--glow-opacity, 0.06)) 0%,
    transparent 70%
  );
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

/* Schindler accent — a tiny dot of belt colour, softly glowing */
.accent {
  position: absolute;
  border-radius: 50%;
  background: var(--accent-color, #f5f5f5);
  box-shadow: 0 0 12px 4px var(--accent-color, #f5f5f5);
  opacity: 0.6;
  transform: translate(-50%, -50%);
  transition: background 1.5s ease, box-shadow 1.5s ease;
}
</style>
