<script setup lang="ts">
/**
 * The drawing itself — the one picture the card and the full-screen expand
 * both show, so they can never drift apart. Everything here is already
 * computed: this file decides nothing, it only puts the ink down.
 *
 * Four layers, back to front. The pale rule is the stretch of the course on
 * the axis; the blue rule over it is how far the class's ink has reached. The
 * CLOTH is the old recombination, woven — arcs the fold has squeezed past
 * legibility, drawn as a density field instead of as lines. The ARCS are the
 * recombination still legible, and every arc that reaches the frontier, which
 * is the course picking old material back up and is the point of the whole
 * drawing.
 */
import type { Figure } from './classBrainFigure'

defineProps<{ figure: Figure; alt: string }>()
</script>

<template>
  <svg :viewBox="`0 0 ${figure.w} ${figure.h}`" :width="figure.scroll ? figure.w : undefined" role="img" :aria-label="alt">
    <!-- the past, woven -->
    <g class="cb-cloth-g" :transform="`translate(0 ${figure.y})`">
      <rect
        v-for="(b, i) in figure.cloth" :key="`c${i}`" class="cb-cloth"
        :x="b.x" :y="b.y" :width="b.w" :height="b.h"
        fill="var(--schools-blue, #60A5FA)" :fill-opacity="b.o"
      />
    </g>
    <path v-for="(a, i) in figure.arcs" :key="`a${i}`" class="cb-arc" :d="a.d" fill="none" stroke="var(--schools-blue, #60A5FA)" :stroke-opacity="a.o" :stroke-width="a.w" />
    <line :x1="figure.rule.x1" :y1="figure.y" :x2="figure.rule.x2" :y2="figure.y" stroke="#e4dfd8" stroke-width="3" />
    <line v-if="figure.ink" :x1="figure.ink.x1" :y1="figure.y" :x2="figure.ink.x2" :y2="figure.y" stroke="var(--schools-blue, #60A5FA)" stroke-opacity="0.55" stroke-width="3" />
    <g v-for="d in figure.dots" :key="d.key">
      <circle :cx="d.cx" :cy="figure.y" :r="d.r" :fill="d.lit ? 'var(--schools-blue, #60A5FA)' : '#e4dfd8'" :stroke="d.lit ? '#ffffff' : '#c9c2b8'" :stroke-width="d.r > 1.6 ? 1 : 0" />
      <text v-if="d.label" :transform="`translate(${d.cx} ${figure.y + 26}) rotate(58)`" font-size="12" :fill="d.lit ? '#2C2622' : '#c4bdb2'" :font-weight="d.lit ? 600 : 400">{{ d.text }}</text>
    </g>
    <template v-if="figure.caption">
      <text :x="figure.caption.cx" y="30" font-size="13" fill="var(--schools-blue, #60A5FA)" text-anchor="middle">{{ figure.caption.t }}</text>
      <text :x="figure.caption.cx" y="46" font-size="12" fill="#8A8078" text-anchor="middle">{{ figure.caption.k }}</text>
    </template>
  </svg>
</template>

<style scoped>
svg { width: 100%; height: auto; display: block; }
/* The unfolded line in the expand is wider than any phone: it scrolls, and
   its width is set in the markup rather than by the box. */
svg[width] { width: auto; max-width: none; }
</style>
