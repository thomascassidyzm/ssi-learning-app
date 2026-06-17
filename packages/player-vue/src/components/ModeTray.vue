<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  offlineDlState,
  offlineDownloadPct,
  offlineDownloadVisible,
  offlineDownloadActive,
  offlineDownloadHeadline,
  offlineDownloadCount,
  offlineTrial,
} from '../composables/useOfflineDownloadStatus'

const props = defineProps({
  isListeningMode: { type: Boolean, default: false },
  isPronunciationMode: { type: Boolean, default: false },
  isTurboMode: { type: Boolean, default: false },
  isOfflineMode: { type: Boolean, default: false },
  showListeningBtn: { type: Boolean, default: false },
  showPronunciationBtn: { type: Boolean, default: false },
  hasRomanizedText: { type: Boolean, default: false },
  isNativeScript: { type: Boolean, default: false },
  isVisible: { type: Boolean, default: true },
})

const emit = defineEmits([
  'toggleListening', 'togglePronunciation', 'toggleTurbo', 'toggleOffline', 'toggleScript'
])

const isOpen = ref(false)

const toggleTray = () => {
  isOpen.value = !isOpen.value
}

// ── Offline-download ring around the mode button ────────────────────────────
// Offline was switched on from here, so its progress lives here too. The ring is
// a conic-gradient on a child of the button itself (anchored via inset to the
// button's own box → can NEVER drift off-centre, unlike an overlaid sibling SVG).
// Drive it with CSS vars: --dl-pct fills the green arc; --dl-color sets green
// (downloading/complete) or red (error). complete/error show a full ring.
const offlineRingVars = computed(() => {
  let pct = 0
  let color = '#16a34a'
  if (offlineDlState.value === 'complete') pct = 100
  else if (offlineDlState.value === 'error') { pct = 100; color = '#ef4444' }
  else if (offlineDlState.value === 'locked') { pct = 100; color = '#f59e0b' }  // amber: lease paused
  else if (offlineDownloadPct.value !== null) pct = offlineDownloadPct.value
  else if (offlineDlState.value === 'preparing') pct = 12   // small green arc + pulse (no total yet)
  return { '--dl-pct': pct, '--dl-color': color }
})

const closeTray = () => {
  isOpen.value = false
}

// Is any mode active?
const hasActiveMode = computed(() =>
  props.isListeningMode || props.isPronunciationMode || props.isTurboMode
)

// Is any experience mode (non-Standard) active?
const hasExperienceMode = computed(() =>
  props.isListeningMode || props.isPronunciationMode
)

// Can turbo be used? Not in listening or pronunciation
const turboAvailable = computed(() =>
  !props.isListeningMode && !props.isPronunciationMode
)

// Select an experience mode — deactivates others if a different one is active.
// Selecting ALWAYS closes the tray (Tom 2026-06-11): leaving it open forced a
// second tap (outside to dismiss, then again to start the mode you just chose).
const selectExperienceMode = (mode: 'normal' | 'listening' | 'pronunciation') => {
  closeTray()
  if (mode === 'normal') {
    if (props.isListeningMode) emit('toggleListening')
    else if (props.isPronunciationMode) emit('togglePronunciation')
    return
  }
  if (mode === 'listening' && props.isListeningMode) return emit('toggleListening')
  if (mode === 'pronunciation' && props.isPronunciationMode) return emit('togglePronunciation')
  if (props.isListeningMode) emit('toggleListening')
  if (props.isPronunciationMode) emit('togglePronunciation')
  if (mode === 'listening') emit('toggleListening')
  if (mode === 'pronunciation') emit('togglePronunciation')
}

// Active mode icon for the trigger button
const activeModeIcon = computed(() => {
  if (props.isListeningMode) return 'listening'
  if (props.isPronunciationMode) return 'pronunciation'
  if (props.isTurboMode) return 'turbo'
  return null
})

const handleMode = (mode: string) => {
  closeTray() // selection closes the tray — no second tap to get going
  const eventName = `toggle${mode.charAt(0).toUpperCase() + mode.slice(1)}`
  emit(eventName as 'toggleListening' | 'togglePronunciation' | 'toggleTurbo' | 'toggleOffline')
}

// Offline is special: tapping it hands off to the full-screen depth picker
// ("how much of the course to carry"). Close the tray first so the picker is
// never left stacked behind it — the tray lives inside the bottom-nav's
// z-index:3000 layer, so a still-open tray would paint over the body-teleported
// picker. One popup at a time; the dialog requesting input stays accessible.
const handleOffline = () => {
  emit('toggleOffline')
  closeTray()
}
</script>

<template>
  <div v-show="isVisible" class="mode-tray-container">
    <!-- Trigger button. The offline-download progress ring is a child of the
         button, anchored to its own box so it stays perfectly concentric. -->
    <button
      class="mode-trigger"
      :class="{ active: hasActiveMode, open: isOpen }"
      :style="offlineDownloadVisible ? offlineRingVars : undefined"
      @click="toggleTray"
      title="Modes"
    >
      <span
        v-if="offlineDownloadVisible"
        class="mode-dl-ring"
        :class="{ 'is-preparing': offlineDlState === 'preparing' }"
        aria-hidden="true"
      ></span>
      <!-- Show active mode icon, or default sliders icon -->
      <svg v-if="activeModeIcon === 'listening'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
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
        <!-- Pronunciation guide on/off (character-based languages only).
             An on/off switch — NOT a switch between two scripts. Native script
             is always shown; this adds/removes the romanisation above it. -->
        <button
          v-if="hasRomanizedText"
          class="tray-item"
          :class="{ active: !isNativeScript }"
          @click.stop="emit('toggleScript')"
          :aria-pressed="!isNativeScript"
          aria-label="Pronunciation guide"
        >
          <div class="tray-icon">
            <span class="script-icon">Aa</span>
          </div>
          <div class="tray-label">
            <span class="tray-name">Pronunciation</span>
            <span class="tray-desc">{{ !isNativeScript ? 'Guide shown above the script' : 'Native script only' }}</span>
          </div>
          <div class="tray-toggle" :class="{ on: !isNativeScript }">
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

        <!-- Offline mode toggle — play from downloaded audio (no network) -->
        <button
          class="tray-item"
          :class="{ active: isOfflineMode }"
          @click="handleOffline"
        >
          <div class="tray-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 3v12"/>
              <path d="M7 10l5 5 5-5"/>
              <path d="M5 21h14"/>
            </svg>
          </div>
          <div class="tray-label">
            <span class="tray-name">Offline mode</span>
            <span class="tray-desc" :class="{ 'is-downloading': offlineDownloadActive || offlineDlState === 'complete', 'is-error': offlineDlState === 'error' }">
              <template v-if="offlineDownloadVisible">
                <span class="tray-desc-line">{{ offlineDownloadHeadline }}</span>
                <span v-if="offlineDownloadCount" class="tray-desc-line tray-desc-count">{{ offlineDownloadCount }}</span>
              </template>
              <template v-else-if="offlineTrial">Free offline for 30 days</template>
              <template v-else>Play from downloaded audio</template>
            </span>
          </div>
          <!-- Offline download is open to everyone (we sell the convenience, not
               the content). Non-payers get a free 30-day taste; the toggle is
               always live, the lease handles expiry. -->
          <div class="tray-toggle" :class="{ on: isOfflineMode }">
            <div class="tray-toggle-knob"></div>
          </div>
        </button>

        <div class="tray-divider"></div>

        <!-- Experience Mode (mutually exclusive radio group) -->
        <div class="tray-section-header">Mode — pick one</div>

        <button
          class="tray-item tray-item--radio"
          :class="{ active: !hasExperienceMode }"
          @click="selectExperienceMode('normal')"
        >
          <div class="tray-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </div>
          <div class="tray-label">
            <span class="tray-name">HISE</span>
            <span class="tray-desc">High Intensity Speaking Exercises</span>
          </div>
          <div class="radio-indicator" :class="{ on: !hasExperienceMode }"></div>
        </button>

        <button
          class="tray-item tray-item--radio"
          :class="{ active: isListeningMode }"
          @click="selectExperienceMode('listening')"
        >
          <div class="tray-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
          </div>
          <div class="tray-label">
            <span class="tray-name">Listening</span>
            <span class="tray-desc">Audio only, no speaking</span>
          </div>
          <div class="radio-indicator" :class="{ on: isListeningMode }"></div>
        </button>

      </div>
    </Transition>

    <!-- Full-screen backdrop to close on outside click -->
    <Teleport to="body">
      <Transition name="backdrop">
        <div v-if="isOpen" class="tray-backdrop" @click="closeTray"></div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.mode-tray-container {
  position: absolute;
  right: 16px;
  bottom: calc(100% + 12px);
  z-index: 103;
}

/* Trigger button + offline-download ring */
/* Offline-download progress ring — a conic-gradient masked into a ring, as a
   CHILD of the button anchored to its own box (inset). It can never drift
   off-centre the way the old overlaid SVG did. --dl-pct (0–100) fills the green
   arc clockwise from 12 o'clock; --dl-color is green (downloading/complete) or
   red (error). complete/error pass pct=100 → full ring. */
.mode-dl-ring {
  position: absolute;
  inset: -5px;                 /* a halo just OUTSIDE the 44px button */
  border-radius: 50%;
  pointer-events: none;
  background: conic-gradient(var(--dl-color, #16a34a) calc(var(--dl-pct, 0) * 1%), rgba(0, 0, 0, 0.13) 0);
  /* cut a 4px ring out of the conic disc (Safari needs -webkit-mask). No
     filter:drop-shadow here — drop-shadow + CSS mask is a known iOS Safari
     rendering quirk; the green + 4px thickness carry the visibility. */
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
  transition: background 0.3s ease;
}
.mode-dl-ring.is-preparing {
  animation: mode-dl-pulse 1s ease-in-out infinite;   /* no total yet → gentle pulse */
}
@keyframes mode-dl-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .mode-dl-ring.is-preparing { animation: none; }
}

.mode-trigger {
  position: relative;          /* positioning context for .mode-dl-ring */
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
  width: 280px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1.5px solid rgba(0, 0, 0, 0.12);
  border-radius: 16px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15), 0 12px 32px rgba(0, 0, 0, 0.1);
  z-index: 103;
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
/* While a download is in progress, the Offline row's desc shows the live detail
   in the accent colour, as TWO fixed lines (headline + count) so the layout
   never reflows between 1 and 2 lines as the numbers tick — that reflow was the
   flicker. tabular-nums keeps digit width steady so the count doesn't jitter. */
.tray-desc.is-downloading {
  color: #16a34a;
  font-weight: 600;
}
.tray-desc-line {
  display: block;
}
/* Only the count stays on one line (numbers shouldn't wrap mid-value); the
   headline may wrap so the long 'Download incomplete…' error doesn't overflow. */
.tray-desc-count {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.tray-desc.is-error {
  color: #ef4444;
  font-weight: 600;
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

/* Radio indicator for mutually exclusive modes */
.radio-indicator {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.2);
  background: transparent;
  flex-shrink: 0;
  position: relative;
  transition: border-color 0.15s ease;
}

.radio-indicator.on {
  border-color: #16a34a;
}

.radio-indicator.on::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #16a34a;
  box-shadow: 0 0 6px rgba(22, 163, 74, 0.4);
}

.tray-item--radio {
  padding: 8px 12px;
}

/* Section header */
.tray-section-header {
  padding: 8px 14px 4px;
  font-size: 10px;
  font-weight: 600;
  color: #A09A94;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Backdrop */
.tray-backdrop {
  position: fixed;
  inset: 0;
  z-index: 102;
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
