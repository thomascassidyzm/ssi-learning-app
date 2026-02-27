<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  currentMode: {
    type: String,
    default: 'focusing' // 'focusing' | 'listening' | 'driving'
  }
})

const emit = defineEmits(['selectMode', 'close'])

const modes = [
  {
    id: 'focusing',
    label: 'Focusing',
    description: 'Full 4-phase cycle with text',
    icon: 'focus'
  },
  {
    id: 'listening',
    label: 'Listening',
    description: 'Audio-forward, teleprompter text',
    icon: 'headphones'
  },
  {
    id: 'driving',
    label: 'Driving',
    description: 'Minimal UI, large controls',
    icon: 'car'
  }
]

const handleSelect = (modeId) => {
  emit('selectMode', modeId)
  emit('close')
}

const handleOutsideClick = (e) => {
  if (!e.target.closest('.mode-switcher')) {
    emit('close')
  }
}

onMounted(() => {
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick, true)
  }, 10)
})

onUnmounted(() => {
  document.removeEventListener('click', handleOutsideClick, true)
})
</script>

<template>
  <Transition name="popover">
    <div class="mode-switcher">
      <button
        v-for="mode in modes"
        :key="mode.id"
        class="mode-option"
        :class="{ active: currentMode === mode.id }"
        @click="handleSelect(mode.id)"
      >
        <div class="mode-icon">
          <!-- Focus icon -->
          <svg v-if="mode.icon === 'focus'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20v-6M6 20v-4M18 20v-2"/>
            <circle cx="12" cy="10" r="2"/>
            <path d="M8 12a4 4 0 0 1 8 0"/>
            <path d="M5 14a7 7 0 0 1 14 0"/>
          </svg>
          <!-- Headphones icon -->
          <svg v-else-if="mode.icon === 'headphones'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
          </svg>
          <!-- Car icon -->
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>
            <path d="M5 17H3v-6l2-5h10l4 5h2v6h-2"/>
            <path d="M5 11h14"/>
            <path d="M9 17h6"/>
          </svg>
        </div>
        <div class="mode-text">
          <span class="mode-label">{{ mode.label }}</span>
          <span class="mode-desc">{{ mode.description }}</span>
        </div>
        <div v-if="currentMode === mode.id" class="mode-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.mode-switcher {
  position: fixed;
  bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 3100;
  min-width: 220px;
  padding: 6px;
  border-radius: 16px;
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  background: rgba(30, 30, 34, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.mode-option:hover {
  background: rgba(255, 255, 255, 0.06);
}

.mode-option.active {
  background: rgba(255, 255, 255, 0.08);
}

.mode-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.5);
}

.mode-option.active .mode-icon {
  color: var(--belt-color, var(--ssi-red));
}

.mode-icon svg {
  width: 100%;
  height: 100%;
}

.mode-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
}

.mode-label {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

.mode-desc {
  font-family: var(--font-body);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.mode-check {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--belt-color, var(--ssi-red));
}

.mode-check svg {
  width: 100%;
  height: 100%;
}

/* Popover transition */
.popover-enter-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.popover-leave-active {
  transition: all 0.15s ease-in;
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px) scale(0.95);
}

/* Mist theme */
:root[data-theme="mist"] .mode-switcher {
  background: rgba(26, 22, 20, 0.85);
  border-color: color-mix(in srgb, var(--belt-color) 20%, rgba(168, 156, 142, 0.1));
}

:root[data-theme="mist"] .mode-label {
  color: #F2F0ED;
}

:root[data-theme="mist"] .mode-desc {
  color: #A89C8E;
}

:root[data-theme="mist"] .mode-icon {
  color: #A89C8E;
}
</style>
