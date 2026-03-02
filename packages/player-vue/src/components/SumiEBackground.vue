<script setup lang="ts">
/**
 * Sumi-e ink wash mountain pilgrimage — mist theme only.
 * Shows a real ink wash painting as a subtle background layer.
 * Purely decorative — no belt colour mechanics.
 */
</script>

<template>
  <div class="sumi-e-bg" aria-hidden="true">
    <img
      src="/design/sumi-e-mountain-3.webp"
      alt=""
      class="sumi-e-painting"
      loading="eager"
      draggable="false"
    >
  </div>
</template>

<style scoped>
.sumi-e-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

.sumi-e-painting {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center calc(50% - 80px);
  opacity: 0.18;
  mix-blend-mode: multiply;
}
</style>
