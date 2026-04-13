<script setup>
import { computed } from 'vue'
import { getLanguageFlag } from '@/composables/useI18n'

// Circle-flags (MIT licensed, https://github.com/HatScripts/circle-flags)
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
import ronFlag from '@/assets/flags/ron.svg'
import glgFlag from '@/assets/flags/glg.svg'
import sweFlag from '@/assets/flags/swe.svg'
import norFlag from '@/assets/flags/nor.svg'
import nobFlag from '@/assets/flags/nob.svg'
import nnoFlag from '@/assets/flags/nno.svg'
import danFlag from '@/assets/flags/dan.svg'
import finFlag from '@/assets/flags/fin.svg'
import islFlag from '@/assets/flags/isl.svg'
import hrvFlag from '@/assets/flags/hrv.svg'
import srpFlag from '@/assets/flags/srp.svg'
import bosFlag from '@/assets/flags/bos.svg'
import slvFlag from '@/assets/flags/slv.svg'
import cesFlag from '@/assets/flags/ces.svg'
import slkFlag from '@/assets/flags/slk.svg'
import ukrFlag from '@/assets/flags/ukr.svg'
import bulFlag from '@/assets/flags/bul.svg'
import mkdFlag from '@/assets/flags/mkd.svg'
import ellFlag from '@/assets/flags/ell.svg'
import hunFlag from '@/assets/flags/hun.svg'
import hebFlag from '@/assets/flags/heb.svg'
import sqiFlag from '@/assets/flags/sqi.svg'
import litFlag from '@/assets/flags/lit.svg'
import lavFlag from '@/assets/flags/lav.svg'
import estFlag from '@/assets/flags/est.svg'
import thaFlag from '@/assets/flags/tha.svg'
import vieFlag from '@/assets/flags/vie.svg'
import indFlag from '@/assets/flags/ind.svg'
import filFlag from '@/assets/flags/fil.svg'
import benFlag from '@/assets/flags/ben.svg'
import urdFlag from '@/assets/flags/urd.svg'
import tamFlag from '@/assets/flags/tam.svg'
import telFlag from '@/assets/flags/tel.svg'
import msaFlag from '@/assets/flags/msa.svg'
import yueFlag from '@/assets/flags/yue.svg'
import fasFlag from '@/assets/flags/fas.svg'
import kurFlag from '@/assets/flags/kur.svg'
import swaFlag from '@/assets/flags/swa.svg'
import amhFlag from '@/assets/flags/amh.svg'
import hauFlag from '@/assets/flags/hau.svg'
import yorFlag from '@/assets/flags/yor.svg'
import zulFlag from '@/assets/flags/zul.svg'
import katFlag from '@/assets/flags/kat.svg'
import hyeFlag from '@/assets/flags/hye.svg'
import turFlag from '@/assets/flags/tur.svg'
import hinFlag from '@/assets/flags/hin.svg'
import sinFlag from '@/assets/flags/sin.svg'
import nepFlag from '@/assets/flags/nep.svg'

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
  ron: ronFlag,
  glg: glgFlag,
  swe: sweFlag,
  nor: norFlag,
  nob: nobFlag,
  nno: nnoFlag,
  dan: danFlag,
  fin: finFlag,
  isl: islFlag,
  hrv: hrvFlag,
  srp: srpFlag,
  bos: bosFlag,
  slv: slvFlag,
  ces: cesFlag,
  slk: slkFlag,
  ukr: ukrFlag,
  bul: bulFlag,
  mkd: mkdFlag,
  ell: ellFlag,
  hun: hunFlag,
  heb: hebFlag,
  sqi: sqiFlag,
  lit: litFlag,
  lav: lavFlag,
  est: estFlag,
  tha: thaFlag,
  vie: vieFlag,
  ind: indFlag,
  fil: filFlag,
  ben: benFlag,
  urd: urdFlag,
  tam: tamFlag,
  tel: telFlag,
  msa: msaFlag,
  yue: yueFlag,
  fas: fasFlag,
  kur: kurFlag,
  swa: swaFlag,
  amh: amhFlag,
  hau: hauFlag,
  yor: yorFlag,
  zul: zulFlag,
  kat: katFlag,
  hye: hyeFlag,
  tur: turFlag,
  hin: hinFlag,
  sin: sinFlag,
  nep: nepFlag,
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
  border-radius: 50%;
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
