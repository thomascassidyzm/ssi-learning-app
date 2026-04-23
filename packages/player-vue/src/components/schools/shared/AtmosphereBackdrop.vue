<script setup lang="ts">
/**
 * AtmosphereBackdrop — fixed decorative layer for the schools dashboard.
 * Warm gold light pool top-left, red mist bottom-right, paper grain.
 * Rendered once by SchoolsContainer; views do not need to include it.
 */
</script>

<template>
  <div class="atmosphere-backdrop" aria-hidden="true"></div>
</template>

<style scoped>
.atmosphere-backdrop {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(
      ellipse 70% 55% at 12% 4%,
      rgba(212, 168, 83, 0.22) 0%,
      rgba(212, 168, 83, 0.05) 40%,
      transparent 72%
    ),
    radial-gradient(
      ellipse 60% 50% at 92% 108%,
      rgba(194, 58, 58, 0.10) 0%,
      rgba(194, 58, 58, 0.02) 45%,
      transparent 80%
    );
}

.atmosphere-backdrop::after {
  /* Paper grain — lightweight inline SVG noise */
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.28;
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.17 0 0 0 0 0.15 0 0 0 0 0.13 0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  background-size: 180px 180px;
}

@media (prefers-reduced-motion: reduce) {
  .atmosphere-backdrop::after {
    opacity: 0.2;
  }
}
</style>
