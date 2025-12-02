<script setup>
import { ref } from 'vue'
import LearningPlayer from './components/LearningPlayer.vue'
import ControlVariations from './components/ControlVariations.vue'

const showVariations = ref(true)
</script>

<template>
  <div class="app-container">
    <!-- Toggle between views -->
    <div class="view-toggle">
      <button
        :class="{ active: showVariations }"
        @click="showVariations = true"
      >
        Control Variations
      </button>
      <button
        :class="{ active: !showVariations }"
        @click="showVariations = false"
      >
        Full Player
      </button>
    </div>

    <!-- Content -->
    <ControlVariations v-if="showVariations" />
    <LearningPlayer v-else />
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
}

.view-toggle {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 1000;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(30, 30, 30, 0.9);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
}

.view-toggle button {
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-family: 'Source Sans 3', sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #707070;
  cursor: pointer;
  transition: all 0.2s ease;
}

.view-toggle button:hover {
  color: #b0b0b0;
}

.view-toggle button.active {
  background: #c23a3a;
  color: white;
}
</style>
