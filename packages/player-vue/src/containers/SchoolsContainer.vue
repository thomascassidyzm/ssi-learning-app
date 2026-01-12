<script setup lang="ts">
import TopNav from '@/components/schools/shared/TopNav.vue'
import DevRoleSwitcher from '@/components/schools/DevRoleSwitcher.vue'
</script>

<template>
  <div class="schools-container">
    <TopNav />

    <!-- Dev Role Switcher (bottom right corner) -->
    <DevRoleSwitcher />

    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- Background Mountains (decorative) -->
    <div class="bg-mountains" aria-hidden="true">
      <svg class="mountain-layer back" viewBox="0 0 1440 300" preserveAspectRatio="none">
        <path d="M0,300 L0,150 Q180,80 360,150 T720,120 T1080,160 T1440,140 L1440,300 Z"/>
      </svg>
      <svg class="mountain-layer mid" viewBox="0 0 1440 300" preserveAspectRatio="none">
        <path d="M0,300 L0,180 Q240,100 480,180 T960,150 T1440,170 L1440,300 Z"/>
      </svg>
      <svg class="mountain-layer front" viewBox="0 0 1440 300" preserveAspectRatio="none">
        <path d="M0,300 L0,220 Q360,160 720,220 T1440,200 L1440,300 Z"/>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.schools-container {
  min-height: 100vh;
  position: relative;
  background: var(--bg-primary);
}

.main-content {
  margin-top: 64px;
  min-height: calc(100vh - 64px);
  position: relative;
  z-index: 1;
  padding: 32px;
  max-width: 1400px;
  margin-left: auto;
  margin-right: auto;
}

/* Background Mountains */
.bg-mountains {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 300px;
  pointer-events: none;
  z-index: 0;
  opacity: var(--mountain-opacity, 0.5);
  transition: opacity 0.3s ease;
}

.mountain-layer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  fill: var(--bg-secondary);
}

.mountain-layer.back {
  opacity: 0.3;
}

.mountain-layer.mid {
  opacity: 0.5;
}

.mountain-layer.front {
  opacity: 0.8;
}

/* Page transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .main-content {
    padding: 16px;
  }
}
</style>
