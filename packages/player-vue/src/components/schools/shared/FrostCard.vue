<script setup lang="ts">
/**
 * FrostCard — the Frostwell Courtyard frost-glass surface primitive.
 *
 * Variants:
 *   panel  (default)  — standard frosted cassette for sections.
 *   stone              — compact metric tile with belt-tone rim glow.
 *   tile               — lighter frost tile for grids (schools grid, lists).
 *
 * Tones (blue | gold | red | green) drive the rim glow on stone + hover
 * accent on tile. Ignored on panel unless `hoverable` is set.
 *
 * Render element: div by default, or <a> / <button> via `as` when the
 * card is itself interactive.
 */
import { computed } from 'vue'

type Tone = 'blue' | 'gold' | 'red' | 'green'
type Variant = 'panel' | 'stone' | 'tile'
type As = 'div' | 'a' | 'button'

interface Props {
  variant?: Variant
  tone?: Tone
  hoverable?: boolean
  as?: As
  href?: string
  to?: string | object
  ariaLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'panel',
  hoverable: false,
  as: 'div',
})

const classes = computed(() => [
  'frost-card',
  `frost-card-${props.variant}`,
  {
    'is-hoverable': props.hoverable || props.as !== 'div',
    [`is-tone-${props.tone}`]: !!props.tone,
  },
])

const tag = computed(() => props.as)
</script>

<template>
  <component
    :is="tag"
    :class="classes"
    :href="as === 'a' ? href : undefined"
    :aria-label="ariaLabel"
  >
    <slot />
  </component>
</template>

<style scoped>
.frost-card {
  position: relative;
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  box-shadow: var(--glass-shadow);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  transition:
    transform var(--transition-base),
    box-shadow var(--transition-base),
    background var(--transition-base);
}

/* Top inner sheen — present on every variant */
.frost-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, var(--glass-sheen) 0%, rgba(255, 255, 255, 0) 40%);
  opacity: 0.5;
}

.frost-card > :deep(*) {
  position: relative;
  z-index: 1;
}

/* ------------------------------------------------------------
 * Variant: panel — bigger padding, slightly stronger fill
 * ------------------------------------------------------------ */
.frost-card-panel {
  background: var(--glass-bg);
}

/* ------------------------------------------------------------
 * Variant: stone — compact metric tile with belt-tone rim
 * ------------------------------------------------------------ */
.frost-card-stone {
  border-radius: 22px;
  min-height: 140px;
}

.frost-card-stone::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    inset 0 0 0 1px rgba(var(--stone-tone, 44, 38, 34), 0.18),
    0 0 0 1px rgba(var(--stone-tone, 44, 38, 34), 0.05);
  transition: box-shadow var(--transition-base);
}

.frost-card-stone.is-tone-blue  { --stone-tone: var(--tone-blue); }
.frost-card-stone.is-tone-gold  { --stone-tone: var(--tone-gold); }
.frost-card-stone.is-tone-red   { --stone-tone: var(--tone-red); }
.frost-card-stone.is-tone-green { --stone-tone: var(--tone-green); }

/* ------------------------------------------------------------
 * Variant: tile — softer fill, smaller radius, for grid items
 * ------------------------------------------------------------ */
.frost-card-tile {
  background: rgba(255, 255, 255, 0.52);
  -webkit-backdrop-filter: blur(18px) saturate(170%);
  backdrop-filter: blur(18px) saturate(170%);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: 18px;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.04);
}

/* ------------------------------------------------------------
 * Hover states — lift + sheen upgrade
 * ------------------------------------------------------------ */
.frost-card.is-hoverable {
  cursor: pointer;
}

.frost-card.is-hoverable:hover {
  background: var(--glass-bg-hover);
  transform: translateY(-2px);
  box-shadow: var(--glass-shadow-hover);
}

.frost-card-stone.is-hoverable:hover::after {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 0 0 1px rgba(var(--stone-tone, 44, 38, 34), 0.32),
    0 0 0 1px rgba(var(--stone-tone, 44, 38, 34), 0.12),
    0 0 22px rgba(var(--stone-tone, 44, 38, 34), 0.22);
}

.frost-card-tile.is-hoverable:hover {
  background: rgba(255, 255, 255, 0.78);
  border-color: rgba(194, 58, 58, 0.22);
  box-shadow:
    0 1px 2px rgba(44, 38, 34, 0.06),
    0 8px 24px rgba(44, 38, 34, 0.08),
    0 0 0 1px rgba(194, 58, 58, 0.08);
}

.frost-card.is-hoverable:focus-visible {
  outline: none;
}

.frost-card-stone.is-hoverable:focus-visible::after {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 0 0 2px rgba(var(--stone-tone, 44, 38, 34), 0.55);
}

/* Button reset when rendered as a <button> */
button.frost-card {
  border: 1px solid var(--glass-border);
  font: inherit;
  text-align: left;
  width: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .frost-card,
  .frost-card.is-hoverable:hover {
    transform: none;
  }
}
</style>
