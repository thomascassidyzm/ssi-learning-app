<script setup lang="ts">
/**
 * Cultural journey background — mist theme only.
 * Shows a language-specific painting as a subtle background layer,
 * with a "dawn glow" that evolves with belt progression:
 *   white belt  = barely-perceptible cool moonlight
 *   yellow belt = pale gold dawn
 *   ...progressing through warmer, richer light...
 *   black belt  = golden hour, sky alive
 * The painting sits ON TOP of the glow, creating a silhouette effect.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  lang?: string
  beltName?: string
}>(), {
  lang: 'jpn',
  beltName: 'white',
})

const JOURNEY_MAP: Record<string, string> = {
  jpn: '/design/journey-jpn.webp',
  zho: '/design/journey-cmn.webp',
  cmn: '/design/journey-cmn.webp',
  ita: '/design/journey-ita.webp',
}

// Dawn glow: colour and intensity grow with belt progression
// Each entry: [glow colour (rgb), opacity of glow]
const DAWN_GLOW: Record<string, { color: string; opacity: number }> = {
  white:  { color: '200, 200, 215', opacity: 0.06 },  // cool moonlight
  yellow: { color: '225, 205, 140', opacity: 0.12 },  // pale gold dawn
  orange: { color: '225, 175, 120', opacity: 0.16 },  // warm amber sunrise
  green:  { color: '170, 205, 155', opacity: 0.18 },  // verdant morning
  blue:   { color: '150, 185, 225', opacity: 0.20 },  // clear sky
  purple: { color: '185, 155, 210', opacity: 0.22 },  // rich twilight
  brown:  { color: '210, 175, 130', opacity: 0.24 },  // deep warm earth
  black:  { color: '230, 195, 110', opacity: 0.28 },  // golden hour
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
    <!-- The painting (silhouette against the glow) -->
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

/* Dawn glow — radial warmth emanating from behind the mountain top */
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
</style>
