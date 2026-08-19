<script setup lang="ts">
/**
 * WornPathFigure — "Say it before you hear it".
 *
 * Two versions of the same route: one worn into the ground by footfalls, one
 * merely read off a page and left unmarked.
 *
 * The claim is that reaching and recognising are not two grades of the same
 * thing — they are different in kind — and two routes, one trodden in and one
 * untouched, say that in one look. It is also the only figure here that reuses
 * the mountain's own material: a path, ink, ground.
 */
</script>

<template>
  <figure class="xf">
    <svg
      class="xf-svg"
      viewBox="0 0 330 112"
      fill="none"
      role="img"
      aria-label="Reaching for a phrase wears a path into the ground; recognising one on a page leaves the ground unmarked."
    >
      <!-- Left: reaching. The path is worn wide, with footfalls along it. -->
      <path d="M16 78 C 50 70, 78 84, 132 72" stroke="currentColor" opacity="0.14" stroke-width="11" stroke-linecap="round" />
      <path d="M16 78 C 50 70, 78 84, 132 72" stroke="currentColor" opacity="0.60" stroke-width="2.6" stroke-linecap="round" />
      <g fill="currentColor" opacity="0.34">
        <ellipse cx="38" cy="71" rx="2.6" ry="1.7" transform="rotate(-12 38 71)" />
        <ellipse cx="62" cy="80" rx="2.6" ry="1.7" transform="rotate(6 62 80)" />
        <ellipse cx="88" cy="82" rx="2.6" ry="1.7" transform="rotate(-4 88 82)" />
        <ellipse cx="112" cy="72" rx="2.6" ry="1.7" transform="rotate(-14 112 72)" />
      </g>
      <!-- Right: the same route, only looked at. The ground stays unmarked. -->
      <rect x="206" y="46" width="100" height="22" rx="4" stroke="currentColor" opacity="0.20" stroke-width="1.2" />
      <g stroke="currentColor" opacity="0.16" stroke-width="1.4" stroke-linecap="round">
        <path d="M214 54 L 262 54" />
        <path d="M214 61 L 288 61" />
      </g>
      <path d="M198 82 C 232 74, 260 88, 314 76" stroke="currentColor" opacity="0.18" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="3 6" />
      <text class="xf-ink1" x="74" y="22" text-anchor="middle" font-size="11.5" font-weight="600">reaching for it</text>
      <text class="xf-ink2" x="74" y="37" text-anchor="middle" font-size="10.5">wears the path in</text>
      <text class="xf-ink3" x="256" y="22" text-anchor="middle" font-size="11.5" font-weight="600">recognising it</text>
      <text class="xf-ink3" x="256" y="37" text-anchor="middle" font-size="10.5">feels easier, does less</text>
      <text class="xf-ink2" x="165" y="104" text-anchor="middle" font-size="10.5">nothing to revise, nothing to memorise</text>
    </svg>
  </figure>
</template>

<style scoped>
.xf {
  margin: 2px 0 0;
  display: flex;
  flex-direction: column;
  color: var(--ink-primary, #2c2622);
}
.xf-svg { width: 100%; height: auto; display: block; }
.xf-svg text { font-family: inherit; }
.xf-ink1 { fill: var(--ink-primary, #2c2622); }
.xf-ink2 { fill: var(--ink-secondary, #6b635c); }
/* The recognising side is set in the lightest ink on purpose: it is the weaker
   of the two, and the type weight says so before the words do. */
.xf-ink3 { fill: var(--ink-tertiary, #8a8078); }
</style>
