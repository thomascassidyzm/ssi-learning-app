<script setup lang="ts">
/**
 * Cultural journey background — mist theme only.
 *
 * Three layers, back-to-front:
 *   1. Dawn glow — radial warmth that grows with belt progression
 *   2. Default journey painting — blurred, shows immediately on launch
 *      so we never start with a Japanese landscape for a Spanish user
 *   3. Course-specific journey painting — fades in over the default
 *      once its asset has decoded; absent when lang isn't yet known
 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  lang?: string
  beltName?: string
  beltColor?: string
}>(), {
  // Intentionally NO default for `lang` — we want it to stay
  // undefined during the brief window before activeCourse resolves
  // so the course-specific layer doesn't render at all (and the
  // blurred default carries the whole backdrop). Defaulting to any
  // real lang code would flash that country's landscape first.
  beltName: 'white',
  beltColor: '#f5f5f5',
})

const JOURNEY_MAP: Record<string, string> = {
  jpn: '/design/journey-jpn.webp',
  zho: '/design/journey-zho.webp',
  cmn: '/design/journey-zho.webp',
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
  dan: '/design/journey-dan.webp',
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
  sin: '/design/journey-sin.webp',
  tam: '/design/journey-tam.webp',
  est: '/design/journey-est.webp',
  heb: '/design/journey-heb.webp',
  lav: '/design/journey-lav.webp',
  lit: '/design/journey-lit.webp',
  nep: '/design/journey-nep.webp',
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

// Course-specific image — only defined when we know the language and
// the catalogue has art for it. If null, only the blurred default
// layer is rendered.
const courseImageSrc = computed<string | null>(() => {
  if (!props.lang) return null
  return JOURNEY_MAP[props.lang] ?? null
})

// Tracks whether the course image has decoded so we can crossfade it
// in. Reset whenever the src changes so the next swap also animates.
const courseLoaded = ref(false)
watch(courseImageSrc, () => {
  courseLoaded.value = false
})

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
    <!-- Default blurred painting — shows during the brief window
         before course-specific lands, then fades out so the final
         backdrop is only the sharp course painting (otherwise the
         two paintings stack at multiply blend and the result looks
         blurry even after the real image arrives). -->
    <img
      :src="DEFAULT_JOURNEY"
      :class="['journey-painting', 'journey-painting--default', { 'is-fading': courseLoaded }]"
      alt=""
      loading="eager"
      draggable="false"
    >
    <!-- Course-specific painting — fades in over the default once
         its asset has decoded. Keyed on src so the @load handler
         fires for each new language the user switches to. -->
    <img
      v-if="courseImageSrc"
      :key="courseImageSrc"
      :src="courseImageSrc"
      :class="['journey-painting', 'journey-painting--course', { 'is-loaded': courseLoaded }]"
      alt=""
      loading="eager"
      draggable="false"
      @load="courseLoaded = true"
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

/* Blurred ambient placeholder — same paint style, no country
   identity. Sits underneath the course-specific layer so the page
   never starts empty (and never starts with somebody else's
   landscape). Once the course-specific image has decoded, this
   fades out so the final backdrop is only the sharp painting —
   otherwise both layers stay multiply-blended and the result looks
   blurry even after the real image arrives. */
.journey-painting--default {
  filter: blur(8px);
  /* Slight scale to hide the blur halo at the edges. */
  transform: translateX(-50%) scale(1.06);
  transition: opacity 600ms ease;
}
.journey-painting--default.is-fading {
  opacity: 0;
}

/* Course-specific painting fades in over the default once decoded. */
.journey-painting--course {
  opacity: 0;
  transition: opacity 600ms ease;
}
.journey-painting--course.is-loaded {
  opacity: 0.18;
}
</style>
