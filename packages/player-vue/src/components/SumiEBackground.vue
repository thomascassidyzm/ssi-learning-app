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
      src="/design/sumi-e-mountain-2.webp"
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
  left: 0;
  right: 0;
  top: 10%;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  opacity: 0.18;
  mix-blend-mode: multiply;
}
</style>
