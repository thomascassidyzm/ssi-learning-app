<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps({
  isListeningMode: { type: Boolean, default: false },
  isDrivingMode: { type: Boolean, default: false },
  isPronunciationMode: { type: Boolean, default: false },
  isTurboMode: { type: Boolean, default: false },
  showListeningBtn: { type: Boolean, default: false },
  showDrivingBtn: { type: Boolean, default: false },
  showPronunciationBtn: { type: Boolean, default: false },
  hasRomanizedText: { type: Boolean, default: false },
  isNativeScript: { type: Boolean, default: false },
  isVisible: { type: Boolean, default: true },
})

const emit = defineEmits([
  'toggleListening', 'toggleDriving', 'togglePronunciation', 'toggleTurbo', 'toggleScript'
])

const isOpen = ref(false)

const toggleTray = () => {
  isOpen.value = !isOpen.value
}

const closeTray = () => {
  isOpen.value = false
}

// Is any mode active?
const hasActiveMode = computed(() =>
  props.isListeningMode || props.isDrivingMode || props.isPronunciationMode || props.isTurboMode
)

// Can turbo be used? Not in listening or pronunciation (driving is fine)
const turboAvailable = computed(() =>
  !props.isListeningMode && !props.isPronunciationMode
)

// Active mode icon for the trigger button
const activeModeIcon = computed(() => {
  if (props.isListeningMode) return 'listening'
  if (props.isDrivingMode) return 'driving'
  if (props.isPronunciationMode) return 'pronunciation'
  if (props.isTurboMode) return 'turbo'
  return null
})

const handleMode = (mode: string) => {
  const eventName = `toggle${mode.charAt(0).toUpperCase() + mode.slice(1)}`
  emit(eventName as 'toggleListening' | 'toggleDriving' | 'togglePronunciation' | 'toggleTurbo')
}
</script>

<template>
  <div v-show="isVisible" class="mode-tray-container">
    <!-- Trigger button -->
    <button
      class="mode-trigger"
      :class="{ active: hasActiveMode, open: isOpen }"
      @click="toggleTray"
      title="Modes"
    >
      <!-- Show active mode icon, or default sliders icon -->
      <svg v-if="activeModeIcon === 'listening'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
      </svg>
      <svg v-else-if="activeModeIcon === 'driving'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>
        <path d="M5 17H3v-6l2-5h10l4 5h2v6h-2"/><path d="M5 11h14"/><path d="M9 17h6"/>
      </svg>
      <svg v-else-if="activeModeIcon === 'pronunciation'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
      <svg v-else-if="activeModeIcon === 'turbo'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
      <!-- Default: sliders icon -->
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
        <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
        <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>
        <line x1="17" y1="16" x2="23" y2="16"/>
      </svg>
    </button>

    <!-- Tray popover -->
    <Transition name="tray">
      <div v-if="isOpen" class="mode-tray">
        <!-- Script toggle (character-based languages only) -->
        <button
          v-if="hasRomanizedText"
          class="tray-item"
          :class="{ active: isNativeScript }"
          @click="emit('toggleScript')"
        >
          <div class="tray-icon">
            <span class="script-icon">{{ isNativeScript ? 'Aa' : '文' }}</span>
          </div>
          <div class="tray-label">
            <span class="tray-name">{{ isNativeScript ? 'Show Romanized' : 'Show Native Script' }}</span>
            <span class="tray-desc">Switch between writing systems</span>
          </div>
          <div class="tray-toggle" :class="{ on: isNativeScript }">
            <div class="tray-toggle-knob"></div>
          </div>
        </button>

        <div v-if="hasRomanizedText" class="tray-divider"></div>

        <!-- Turbo toggle -->
        <button
          class="tray-item"
          :class="{ active: isTurboMode, unavailable: !turboAvailable }"
          :disabled="!turboAvailable"
          @click="handleMode('turbo')"
        >
          <div class="tray-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
          <div class="tray-label">
            <span class="tray-name">Turbo Boost</span>
            <span class="tray-desc">Faster pace, less repetition</span>
          </div>
          <div class="tray-toggle" :class="{ on: isTurboMode }">
            <div class="tray-toggle-knob"></div>
          </div>
        </button>

        <div class="tray-divider"></div>

        <!-- Listening mode -->
        <button
          class="tray-item"
          :class="{ active: isListeningMode }"
          @click="handleMode('listening')"
        >
          <div class="tray-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
          </div>
          <div class="tray-label">
            <span class="tray-name">Listening Mode</span>
            <span class="tray-desc">Audio only, no speaking</span>
          </div>
          <div v-if="isListeningMode" class="tray-active-dot"></div>
        </button>

        <!-- Driving mode -->
        <button
          class="tray-item"
          :class="{ active: isDrivingMode }"
          @click="handleMode('driving')"
        >
          <div class="tray-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>
              <path d="M5 17H3v-6l2-5h10l4 5h2v6h-2"/><path d="M5 11h14"/><path d="M9 17h6"/>
            </svg>
          </div>
          <div class="tray-label">
            <span class="tray-name">Driving Mode</span>
            <span class="tray-desc">Background-friendly playback</span>
          </div>
          <div v-if="isDrivingMode" class="tray-active-dot"></div>
        </button>

        <!-- Pronunciation mode -->
        <button
          class="tray-item"
          :class="{ active: isPronunciationMode }"
          @click="handleMode('pronunciation')"
        >
          <div class="tray-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </div>
          <div class="tray-label">
            <span class="tray-name">Pronunciation</span>
            <span class="tray-desc">Practice speaking with feedback</span>
          </div>
          <div v-if="isPronunciationMode" class="tray-active-dot"></div>
        </button>
      </div>
    </Transition>

    <!-- Backdrop to close -->
    <Transition name="backdrop">
      <div v-if="isOpen" class="tray-backdrop" @click="closeTray"></div>
    </Transition>
  </div>
</template>

<style scoped>
.mode-tray-container {
  position: absolute;
  right: 16px;
  bottom: calc(100% + 12px);
  z-index: 103;
}

/* Trigger button */
.mode-trigger {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  color: #6B6560;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.mode-trigger svg {
  width: 20px;
  height: 20px;
}

.mode-trigger:active {
  transform: scale(0.9);
}

.mode-trigger.active {
  background: rgba(240, 255, 245, 0.95);
  border-color: rgba(22, 163, 74, 0.4);
  color: #16a34a;
}

.mode-trigger.open {
  background: rgba(0, 0, 0, 0.08);
  border-color: rgba(0, 0, 0, 0.35);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.15),
    0 0 0 3px rgba(0, 0, 0, 0.06);
}

/* Tray popover */
.mode-tray {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 260px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1.5px solid rgba(0, 0, 0, 0.12);
  border-radius: 16px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15), 0 12px 32px rgba(0, 0, 0, 0.1);
}

.tray-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
  margin: 2px 12px;
}

/* Tray items */
.tray-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
  color: #6B6560;
}

.tray-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.tray-item:active {
  background: rgba(0, 0, 0, 0.08);
}

.tray-item.active {
  color: #16a34a;
}

.tray-item.unavailable {
  opacity: 0.35;
  cursor: not-allowed;
}

.tray-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}

.tray-item.active .tray-icon {
  background: rgba(22, 163, 74, 0.08);
}

.tray-icon svg {
  width: 18px;
  height: 18px;
}

.script-icon {
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}

.tray-label {
  flex: 1;
  min-width: 0;
}

.tray-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  line-height: 1.2;
}

.tray-desc {
  display: block;
  font-size: 11px;
  color: #A09A94;
  line-height: 1.3;
  margin-top: 1px;
}

/* Toggle switch for Turbo */
.tray-toggle {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.12);
  position: relative;
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.tray-toggle.on {
  background: #16a34a;
}

.tray-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.tray-toggle.on .tray-toggle-knob {
  transform: translateX(16px);
}

/* Active dot for exclusive modes */
.tray-active-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #16a34a;
  flex-shrink: 0;
  box-shadow: 0 0 6px rgba(22, 163, 74, 0.4);
}

/* Backdrop */
.tray-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  background: rgba(0, 0, 0, 0.15);
}

/* Transitions */
.tray-enter-active,
.tray-leave-active {
  transition: all 0.2s ease;
}

.tray-enter-from,
.tray-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.95);
}

.backdrop-enter-active,
.backdrop-leave-active {
  transition: opacity 0.2s ease;
}

.backdrop-enter-from,
.backdrop-leave-to {
  opacity: 0;
}
</style>
