<script setup lang="ts">
/**
 * ThreeGapsFigure — "What a go is".
 *
 * Three gaps side by side: one where the answer arrives, one where it gives
 * out halfway, one where it comes out wrong. All three carry the SAME tick.
 *
 * That sameness is the whole figure. The block's job is one counterintuitive
 * claim — getting it wrong still counts — and prose has to argue it while three
 * identical ticks simply state it. It is the same trick as the mountain's
 * shared summit dot: geometry does the reassuring instead of a sentence.
 *
 * Static SVG, no animation. Ink comes from currentColor at varying opacity, so
 * every stroke is the one Mist ink weight rather than a new colour.
 *
 * The viewBox carries five units of bleed each side: "it comes out wrong" is
 * the widest label in the set and sat a whisker off the right edge at 390px.
 */
</script>

<template>
  <figure class="xf">
    <svg
      class="xf-svg"
      viewBox="-5 0 340 104"
      fill="none"
      role="img"
      aria-label="Three gaps: one where the answer arrives, one where it half arrives, one where it comes out wrong. All three carry the same tick."
    >
      <!-- The three gaps, bracketed to the same width: nothing about the shape
           of the gap changes according to how it went. -->
      <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.28">
        <path d="M14 30 L14 66 M14 30 L20 30 M14 66 L20 66" />
        <path d="M104 30 L104 66 M104 30 L98 30 M104 66 L98 66" />
        <path d="M124 30 L124 66 M124 30 L130 30 M124 66 L130 66" />
        <path d="M214 30 L214 66 M214 30 L208 30 M214 66 L208 66" />
        <path d="M234 30 L234 66 M234 30 L240 30 M234 66 L240 66" />
        <path d="M324 30 L324 66 M324 30 L318 30 M324 66 L318 66" />
      </g>
      <!-- 1: it arrives — a full confident stroke. -->
      <path d="M28 50 C 44 40, 60 58, 78 44 C 84 39, 88 42, 92 46" stroke="currentColor" opacity="0.62" stroke-width="2.4" stroke-linecap="round" />
      <!-- 2: it half arrives — the stroke gives out into dots. -->
      <path d="M138 50 C 152 41, 164 56, 176 46" stroke="currentColor" opacity="0.55" stroke-width="2.4" stroke-linecap="round" />
      <path d="M176 46 C 182 43, 188 48, 194 47" stroke="currentColor" opacity="0.20" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="1 5" />
      <!-- 3: it comes out wrong — a stroke with a line through it. -->
      <path d="M248 50 C 262 40, 274 58, 288 44 C 294 38, 300 45, 306 48" stroke="currentColor" opacity="0.48" stroke-width="2.4" stroke-linecap="round" />
      <path d="M256 58 L 300 36" stroke="currentColor" opacity="0.22" stroke-width="1.4" stroke-linecap="round" />
      <!-- Three identical ticks. -->
      <g stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.78">
        <path d="M52 82 l5 6 l10 -13" />
        <path d="M162 82 l5 6 l10 -13" />
        <path d="M272 82 l5 6 l10 -13" />
      </g>
      <text class="xf-ink2" x="59" y="18" text-anchor="middle" font-size="10.5">it arrives</text>
      <text class="xf-ink2" x="169" y="18" text-anchor="middle" font-size="10.5">it half arrives</text>
      <text class="xf-ink2" x="279" y="18" text-anchor="middle" font-size="10.5">it comes out wrong</text>
    </svg>
    <figcaption class="xf-claim">All three are a go.</figcaption>
  </figure>
</template>

<style scoped>
.xf {
  margin: 2px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--ink-primary, #2c2622);
}
.xf-svg { width: 100%; height: auto; display: block; }
/* Text inherits the app's own face rather than naming one. */
.xf-svg text { font-family: inherit; }
.xf-ink2 { fill: var(--ink-secondary, #6b635c); }
.xf-claim {
  margin: 0;
  font-size: var(--text-sm, 13px);
  line-height: 1.6;
  font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2c2622);
}
</style>
