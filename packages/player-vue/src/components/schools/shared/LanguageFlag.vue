<script setup>
import { computed } from 'vue'
import { getLanguageFlag } from '@/composables/useI18n'

import cymFlag from '@/assets/flags/cym.svg'
import spaFlag from '@/assets/flags/spa.svg'
import fraFlag from '@/assets/flags/fra.svg'
import deuFlag from '@/assets/flags/deu.svg'
import nldFlag from '@/assets/flags/nld.svg'
import gleFlag from '@/assets/flags/gle.svg'
import jpnFlag from '@/assets/flags/jpn.svg'
import engFlag from '@/assets/flags/eng.svg'
import zhoFlag from '@/assets/flags/zho.svg'
import araFlag from '@/assets/flags/ara.svg'
import korFlag from '@/assets/flags/kor.svg'
import itaFlag from '@/assets/flags/ita.svg'
import porFlag from '@/assets/flags/por.svg'
import breFlag from '@/assets/flags/bre.svg'
import corFlag from '@/assets/flags/cor.svg'
import glvFlag from '@/assets/flags/glv.svg'
import eusFlag from '@/assets/flags/eus.svg'
import catFlag from '@/assets/flags/cat.svg'
import rusFlag from '@/assets/flags/rus.svg'
import polFlag from '@/assets/flags/pol.svg'
import glaFlag from '@/assets/flags/gla.svg'

const flagMap = {
  cym: cymFlag,
  spa: spaFlag,
  fra: fraFlag,
  deu: deuFlag,
  nld: nldFlag,
  gle: gleFlag,
  jpn: jpnFlag,
  eng: engFlag,
  zho: zhoFlag,
  cmn: zhoFlag,
  ara: araFlag,
  kor: korFlag,
  ita: itaFlag,
  por: porFlag,
  bre: breFlag,
  cor: corFlag,
  glv: glvFlag,
  eus: eusFlag,
  cat: catFlag,
  rus: rusFlag,
  pol: polFlag,
  gla: glaFlag,
}

const props = defineProps({
  code: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    default: 24
  }
})

/**
 * Extract the language code from a course code.
 * Examples: 'cym_s_for_eng' -> 'cym', 'eng_for_spa' -> 'eng', 'fra' -> 'fra'
 */
function extractLanguageCode(code) {
  if (!code) return ''
  // If it's already a bare language code, return it
  if (flagMap[code]) return code
  // Extract the first segment before '_for_' or '_n_for_' or '_s_for_'
  const forIndex = code.indexOf('_for_')
  if (forIndex === -1) return code
  // The language code is everything before '_for_', minus any dialect suffix
  const prefix = code.substring(0, forIndex)
  // Strip dialect suffixes like '_n', '_s', '_north', '_south', '_latam'
  const langCode = prefix.replace(/_(n|s|north|south|latam)$/, '')
  return langCode
}

const langCode = computed(() => extractLanguageCode(props.code))

const flagSrc = computed(() => {
  return flagMap[langCode.value] || null
})

// Emoji fallback for languages without SVG flags
const emojiFlag = computed(() => {
  if (flagSrc.value) return null
  const emoji = getLanguageFlag(langCode.value)
  return emoji !== '🌐' ? emoji : null
})

const dimensions = computed(() => ({
  width: props.size + 'px',
  height: props.size + 'px'
}))
</script>

<template>
  <span
    v-if="flagSrc"
    class="language-flag"
    :style="{ width: dimensions.width, height: dimensions.height }"
  >
    <img :src="flagSrc" :alt="code + ' flag'" :width="size" :height="size" />
  </span>
  <span
    v-else-if="emojiFlag"
    class="language-flag language-flag--emoji"
    :style="{ width: dimensions.width, height: dimensions.height, fontSize: (size * 0.75) + 'px' }"
  >{{ emojiFlag }}</span>
  <span
    v-else
    class="language-flag language-flag--fallback"
    :style="{ width: dimensions.width, height: dimensions.height, fontSize: (size * 0.7) + 'px' }"
  >&#x1F310;</span>
</template>

<style scoped>
.language-flag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  vertical-align: middle;
}

.language-flag img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.language-flag--fallback {
  line-height: 1;
}
</style>
