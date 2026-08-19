<script setup lang="ts">
/**
 * SpacingReturnsFigure — "What a session feels like".
 *
 * New things arrive along the session line; each one comes back below at
 * visibly widening intervals. The widening IS the content of "just as they
 * start to slip", and it is the one bit of the method a learner otherwise has
 * to take on trust, because it happens too slowly to feel inside one session.
 *
 * Two things deliberately NOT drawn, both drawn once and both cut:
 * · No calendar, no grid, no days. A spacing picture with days on it is a
 *   streak picture in a disguise, and streaks are a founder content law.
 * · No "you are here" marker. The line is the shape of a session, not a
 *   position in one — the app has deliberately refused to have a position.
 */
</script>

<template>
  <figure class="xf">
    <svg
      class="xf-svg"
      viewBox="0 0 330 98"
      fill="none"
      role="img"
      aria-label="A line through a session: new things arrive along the top, and each one comes back below at widening intervals."
    >
      <path d="M10 34 L 320 34" stroke="currentColor" opacity="0.28" stroke-width="1.4" stroke-linecap="round" />
      <!-- New arrivals. -->
      <g fill="currentColor" opacity="0.66">
        <circle cx="34" cy="34" r="4" />
        <circle cx="96" cy="34" r="4" />
        <circle cx="176" cy="34" r="4" />
        <circle cx="268" cy="34" r="4" />
      </g>
      <!-- The returns of the first arrival, at widening gaps. -->
      <g fill="currentColor" opacity="0.34">
        <circle cx="62" cy="62" r="3" />
        <circle cx="110" cy="62" r="3" />
        <circle cx="186" cy="62" r="3" />
        <circle cx="298" cy="62" r="3" />
      </g>
      <g stroke="currentColor" opacity="0.20" stroke-width="1.2" fill="none">
        <path d="M34 40 C 40 54, 52 58, 60 60" />
        <path d="M64 64 C 78 72, 96 70, 108 64" />
        <path d="M112 64 C 134 76, 166 74, 184 64" />
        <path d="M188 64 C 218 80, 268 78, 296 64" />
      </g>
      <text class="xf-ink2" x="34" y="20" text-anchor="middle" font-size="10.5">new</text>
      <text class="xf-ink2" x="176" y="20" text-anchor="middle" font-size="10.5">new</text>
      <text class="xf-ink2" x="165" y="92" text-anchor="middle" font-size="10.5">and it comes back, further apart each time</text>
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
.xf-ink2 { fill: var(--ink-secondary, #6b635c); }
</style>
