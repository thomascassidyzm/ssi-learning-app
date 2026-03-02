<script setup lang="ts">
/**
 * Cultural journey background — mist theme only.
 * Shows a language-specific ink/sketch painting as a subtle background layer.
 * Each target language gets its own cultural art style:
 *   jpn = sumi-e mountain temple pilgrimage
 *   zho = Chinese shanshui vertical cliff stairway
 *   ita = Tuscan sepia sketch, hilltop monastery
 *   (more languages to come)
 * Falls back to Japanese sumi-e for unmapped languages.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  lang?: string
}>(), {
  lang: 'jpn',
})

const JOURNEY_MAP: Record<string, string> = {
  jpn: '/design/journey-jpn.webp',
  zho: '/design/journey-cmn.webp',
  cmn: '/design/journey-cmn.webp',
  ita: '/design/journey-ita.webp',
}

const DEFAULT_JOURNEY = '/design/journey-jpn.webp'

const imageSrc = computed(() => JOURNEY_MAP[props.lang] || DEFAULT_JOURNEY)
</script>

<template>
  <div class="journey-bg" aria-hidden="true">
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
