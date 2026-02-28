<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  currentScreen: {
    type: String,
    default: 'player'
  },
  isPlaying: {
    type: Boolean,
    default: false
  },
  isListeningMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['navigate', 'openModeSwitcher', 'exitListeningMode'])

const tappedItem = ref(null)

const handleNavTap = (itemId) => {
  tappedItem.value = itemId
  setTimeout(() => { tappedItem.value = null }, 150)

  if (navigator.vibrate) {
    navigator.vibrate(10)
  }

  if (props.isListeningMode) {
    emit('exitListeningMode')
  }

  emit('navigate', itemId)
}

const handleModeTap = () => {
  tappedItem.value = 'mode'
  setTimeout(() => { tappedItem.value = null }, 150)

  if (navigator.vibrate) {
    navigator.vibrate(10)
  }

  emit('openModeSwitcher')
}
</script>

<template>
  <nav class="nav-pill">
    <!-- Library -->
    <button
      class="pill-btn"
      :class="{
        active: currentScreen === 'library',
        tapped: tappedItem === 'library'
      }"
      @click="handleNavTap('library')"
      aria-label="Library"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    </button>

    <!-- Mode -->
    <button
      class="pill-btn"
      :class="{
        active: isListeningMode,
        tapped: tappedItem === 'mode'
      }"
      @click="handleModeTap"
      aria-label="Mode"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20v-6M6 20v-4M18 20v-2"/>
        <circle cx="12" cy="10" r="2"/>
        <path d="M8 12a4 4 0 0 1 8 0"/>
        <path d="M5 14a7 7 0 0 1 14 0"/>
      </svg>
    </button>

    <!-- Progress / Account -->
    <button
      class="pill-btn"
      :class="{
        active: currentScreen === 'progress',
        tapped: tappedItem === 'progress'
      }"
      @click="handleNavTap('progress')"
      aria-label="Progress"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M12 2C9.5 2 7.5 3.5 7 5.5C5.5 5.5 4 7 4 9c0 1.5.8 2.8 2 3.5-.2.5-.3 1-.3 1.5 0 2 1.5 3.5 3.3 3.8.5 1.3 1.8 2.2 3 2.2s2.5-.9 3-2.2c1.8-.3 3.3-1.8 3.3-3.8 0-.5-.1-1-.3-1.5 1.2-.7 2-2 2-3.5 0-2-1.5-3.5-3-3.5C16.5 3.5 14.5 2 12 2z"/>
        <path d="M12 2v18" opacity="0.3"/>
        <path d="M7 9h10" opacity="0.3"/>
      </svg>
    </button>
  </nav>
</template>

<style scoped>
.nav-pill {
  position: fixed;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 2900;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 28px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: rgba(30, 30, 34, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), 0 1px 4px rgba(0, 0, 0, 0.2);
}

.pill-btn {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.pill-btn svg {
  width: 20px;
  height: 20px;
}

.pill-btn:active,
.pill-btn.tapped {
  transform: scale(0.88);
}

.pill-btn.active {
  color: var(--belt-color, var(--ssi-red));
  background: rgba(255, 255, 255, 0.08);
}

@media (hover: hover) {
  .pill-btn:hover:not(.active) {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.05);
  }
}

/* Light theme override */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="mist"]) .nav-pill {
    background: rgba(255, 255, 255, 0.7);
    border-color: rgba(0, 0, 0, 0.06);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1), 0 1px 4px rgba(0, 0, 0, 0.06);
  }

  :root:not([data-theme="mist"]) .pill-btn {
    color: rgba(0, 0, 0, 0.35);
  }

  :root:not([data-theme="mist"]) .pill-btn.active {
    background: rgba(0, 0, 0, 0.06);
  }

  :root:not([data-theme="mist"]) .pill-btn:hover:not(.active) {
    color: rgba(0, 0, 0, 0.6);
  }
}

/* Mist theme — white frosted pill */
:root[data-theme="mist"] .nav-pill {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(0, 0, 0, 0.04);
  box-shadow: 0 4px 16px rgba(44, 38, 34, 0.08),
              0 1px 4px rgba(44, 38, 34, 0.04);
}

:root[data-theme="mist"] .pill-btn {
  color: #8A8078;
}

:root[data-theme="mist"] .pill-btn.active {
  color: var(--belt-color, var(--ssi-red));
  background: rgba(0, 0, 0, 0.04);
  filter: none;
}

@media (hover: hover) {
  :root[data-theme="mist"] .pill-btn:hover:not(.active) {
    color: var(--text-secondary);
    background: rgba(0, 0, 0, 0.03);
  }
}
</style>
