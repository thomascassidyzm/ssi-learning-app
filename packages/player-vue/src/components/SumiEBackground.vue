<script setup lang="ts">
/**
 * Sumi-e ink wash mountain pilgrimage — mist theme only.
 * Transparent SVG overlay showing a pilgrim's journey from foothills to summit.
 * Belt colour splash climbs the mountain as the learner progresses.
 */
import { computed } from 'vue'

const props = defineProps<{
  beltName: string
  beltColor: string
}>()

// Belt index drives position along the path (0=white at base, 7=black at summit)
const BELT_ORDER = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']
const beltIndex = computed(() => {
  const idx = BELT_ORDER.indexOf(props.beltName)
  return idx >= 0 ? idx : 0
})

// Belt progress 0–1 for splash positioning
const beltT = computed(() => beltIndex.value / (BELT_ORDER.length - 1))

// Path waypoints: bottom-center-left → top-center-right (half-diagonal)
const PATH_POINTS = [
  [155, 510], [175, 455], [205, 400], [240, 340],
  [280, 280], [315, 215], [345, 150], [370, 75],
]

const splashPos = computed(() => {
  const t = beltT.value
  const n = PATH_POINTS.length - 1
  const idx = Math.min(Math.floor(t * n), n - 1)
  const local = (t * n) - idx
  const [x1, y1] = PATH_POINTS[idx]
  const [x2, y2] = PATH_POINTS[idx + 1]
  return { x: x1 + (x2 - x1) * local, y: y1 + (y2 - y1) * local }
})

// Pilgrim position along path
const pilgrimPos = computed(() => splashPos.value)

// Ink colour for mist theme (dark strokes on light bg)
const ink = '30, 28, 24'
const inkBase = 0.7
</script>

<template>
  <div class="sumi-e-bg" aria-hidden="true">
    <svg viewBox="0 0 500 600" preserveAspectRatio="xMidYMax slice">
      <defs>
        <!-- Ink wash: organic displacement for mountain fills -->
        <filter id="se-wash" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" seed="42" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <!-- Soft blur for distant elements -->
        <filter id="se-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5"/>
        </filter>
        <!-- Brush edge: subtle wobble for stroke work -->
        <filter id="se-brush" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="7" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <!-- Mist: gentle blur -->
        <filter id="se-mist" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="10"/>
        </filter>
        <!-- Splash bleed: soft organic spread for belt colour -->
        <filter id="se-bleed" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="3" seed="31" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" xChannelSelector="R" yChannelSelector="G" result="bled"/>
          <feGaussianBlur in="bled" stdDeviation="4"/>
        </filter>

        <!-- Belt colour splash gradient -->
        <radialGradient
          id="se-splash"
          :cx="splashPos.x / 500"
          :cy="splashPos.y / 600"
          r="0.16"
        >
          <stop offset="0%" :stop-color="beltColor" stop-opacity="0.7"/>
          <stop offset="35%" :stop-color="beltColor" stop-opacity="0.35"/>
          <stop offset="100%" :stop-color="beltColor" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <!-- LAYER 1: DISTANT MOUNTAINS -->
      <path
        d="M 0 380 Q 80 355, 160 320 Q 240 280, 310 240 Q 360 210, 400 160 Q 430 120, 450 85 Q 465 60, 480 50 L 500 42 L 500 620 L 0 620 Z"
        :fill="`rgba(${ink}, ${inkBase * 0.15})`"
        filter="url(#se-soft)"
      />

      <!-- LAYER 2: MIDDLE RANGE -->
      <path
        d="M 0 440 Q 60 415, 130 385 Q 200 352, 260 310 Q 310 275, 350 235 Q 380 200, 400 165 Q 418 135, 435 105 Q 450 80, 465 60 L 500 45 L 500 620 L 0 620 Z"
        :fill="`rgba(${ink}, ${inkBase * 0.25})`"
        filter="url(#se-wash)"
      />

      <!-- SUMMIT PEAK -->
      <path
        d="M 340 175 Q 355 130, 365 90 Q 372 60, 380 42 Q 385 30, 392 38 Q 398 48, 402 75 Q 408 110, 415 160"
        fill="none"
        :stroke="`rgba(${ink}, ${inkBase * 0.5})`"
        stroke-width="2"
        filter="url(#se-brush)"
      />
      <path
        d="M 348 160 Q 358 110, 370 70 Q 378 42, 388 45 Q 396 55, 402 85 Q 408 120, 412 155 Z"
        :fill="`rgba(${ink}, ${inkBase * 0.18})`"
        filter="url(#se-wash)"
      />

      <!-- MIST LAYERS -->
      <ellipse cx="130" cy="415" rx="160" ry="16" :fill="`rgba(${ink}, ${inkBase * 0.06})`" filter="url(#se-mist)"/>
      <ellipse cx="250" cy="330" rx="180" ry="14" :fill="`rgba(${ink}, ${inkBase * 0.05})`" filter="url(#se-mist)"/>
      <ellipse cx="340" cy="240" rx="130" ry="12" :fill="`rgba(${ink}, ${inkBase * 0.04})`" filter="url(#se-mist)"/>
      <ellipse cx="395" cy="150" rx="80" ry="9" :fill="`rgba(${ink}, ${inkBase * 0.035})`" filter="url(#se-mist)"/>

      <!-- FOREGROUND HILLS -->
      <path
        d="M 0 520 Q 50 495, 100 500 Q 160 488, 220 495 Q 280 482, 340 490 Q 400 480, 450 488 Q 480 484, 500 478 L 500 620 L 0 620 Z"
        :fill="`rgba(${ink}, ${inkBase * 0.35})`"
        filter="url(#se-wash)"
      />

      <!-- PATH — winding trail -->
      <path
        d="M 155 510 Q 165 485, 178 455 Q 192 425, 208 395 Q 222 368, 240 340 Q 255 315, 272 288 Q 288 262, 305 235 Q 320 210, 335 182 Q 348 158, 358 130 Q 365 108, 370 75"
        fill="none"
        :stroke="`rgba(${ink}, ${inkBase * 0.22})`"
        stroke-width="1.5"
        stroke-dasharray="4 3"
        filter="url(#se-brush)"
      />

      <!-- BELT COLOUR SPLASH -->
      <rect x="0" y="0" width="500" height="600" fill="url(#se-splash)" filter="url(#se-bleed)"/>

      <!-- TEMPLE — ninja dojo with curved roof, open underneath -->
      <g :transform="`translate(385, 25)`" filter="url(#se-brush)" :opacity="inkBase * 1.2">
        <rect x="-14" y="22" width="28" height="2" :fill="`rgba(${ink}, 0.4)`" rx="0.5"/>
        <line x1="-9" y1="22" x2="-9" y2="10" :stroke="`rgba(${ink}, 0.5)`" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="9" y1="22" x2="9" y2="10" :stroke="`rgba(${ink}, 0.5)`" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="-10" y1="10" x2="10" y2="10" :stroke="`rgba(${ink}, 0.45)`" stroke-width="1.2"/>
        <path d="M -20 11 Q -14 5, -6 3 Q 0 0.5, 6 3 Q 14 5, 20 11" fill="none" :stroke="`rgba(${ink}, 0.55)`" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M -18 10.5 Q -10 4, 0 2 Q 10 4, 18 10.5 Z" :fill="`rgba(${ink}, 0.12)`"/>
        <line x1="0" y1="1" x2="0" y2="-5" :stroke="`rgba(${ink}, 0.5)`" stroke-width="1" stroke-linecap="round"/>
        <circle cx="0" cy="-6" r="1.2" :fill="`rgba(${ink}, 0.35)`"/>
      </g>

      <!-- PILGRIM -->
      <g :transform="`translate(${pilgrimPos.x - 3}, ${pilgrimPos.y - 12})`" filter="url(#se-brush)" :opacity="inkBase * 1.0">
        <line x1="3" y1="4" x2="3" y2="11" :stroke="`rgba(${ink}, 0.6)`" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="3" cy="2.5" r="2" :fill="`rgba(${ink}, 0.5)`"/>
        <ellipse cx="3" cy="1.5" rx="3.5" ry="1" :fill="`rgba(${ink}, 0.4)`"/>
        <line x1="6" y1="3" x2="7" y2="12" :stroke="`rgba(${ink}, 0.4)`" stroke-width="0.8" stroke-linecap="round"/>
      </g>

      <!-- FOREGROUND GRASS -->
      <g filter="url(#se-brush)" :opacity="inkBase * 0.3">
        <line x1="25" y1="600" x2="20" y2="565" :stroke="`rgba(${ink}, 0.5)`" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="35" y1="600" x2="38" y2="558" :stroke="`rgba(${ink}, 0.4)`" stroke-width="1" stroke-linecap="round"/>
        <line x1="44" y1="600" x2="40" y2="570" :stroke="`rgba(${ink}, 0.3)`" stroke-width="1" stroke-linecap="round"/>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.sumi-e-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  opacity: 0.2;
  overflow: hidden;
}
.sumi-e-bg svg {
  width: 100%;
  height: 100%;
}
</style>
