<script setup>
// Build info injected at build time by Vite
const buildNumber = __BUILD_NUMBER__
const buildTime = __BUILD_TIME__

// Format build time as short date
const formattedTime = new Date(buildTime).toLocaleDateString('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})
</script>

<template>
  <div class="build-badge" :title="`Built: ${formattedTime}`">
    {{ buildNumber }}
  </div>
</template>

<style scoped>
.build-badge {
  position: fixed;
  bottom: 100px;
  right: 12px;
  padding: 4px 8px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: #0ff;
  background: rgba(0, 255, 255, 0.1);
  border: 1px solid rgba(0, 255, 255, 0.3);
  border-radius: 4px;
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
  box-shadow: 0 0 12px rgba(0, 255, 255, 0.15);
  z-index: 9999;
  pointer-events: none;
  opacity: 0.7;
}

/* Hide during active learning to avoid distraction */
.app-container:has(.learning-player) .build-badge {
  display: none;
}
</style>
