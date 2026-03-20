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
  spa: '/design/journey-spa.webp',
  deu: '/design/journey-deu.webp',
  kor: '/design/journey-kor.webp',
  fra: '/design/journey-fra.webp',
  ara: '/design/journey-ara.webp',
  cym: '/design/journey-cym.webp',
  cym_n: '/design/journey-cym.webp',
  cym_s: '/design/journey-cym.webp',
  eng: '/design/journey-eng.webp',
  ron: '/design/journey-ron.webp',
  eus: '/design/journey-eus.webp',
  hrv: '/design/journey-hrv.webp',
  pol: '/design/journey-pol.webp',
  ell: '/design/journey-ell.webp',
  ukr: '/design/journey-ukr.webp',
  tur: '/design/journey-tur.webp',
  bre: '/design/journey-bre.webp',
  cat: '/design/journey-cat.webp',
  fin: '/design/journey-fin.webp',
  hye: '/design/journey-hye.webp',
  isl: '/design/journey-isl.webp',
  swe: '/design/journey-swe.webp',
  tha: '/design/journey-tha.webp',
  gla: '/design/journey-gla.webp',
  gsw: '/design/journey-gsw.webp',
  fas: '/design/journey-fas.webp',
  prs: '/design/journey-prs.webp',
  pus: '/design/journey-pus.webp',
  nor: '/design/journey-nor.webp',
  nob: '/design/journey-nor.webp',
  nno: '/design/journey-nor.webp',
  bul: '/design/journey-bul.webp',
  hin: '/design/journey-hin.webp',
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

const DEFAULT_JOURNEY = '/design/journey-default.webp'

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
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center bottom;
  opacity: 0.18;
  mix-blend-mode: multiply;
}
</style>
