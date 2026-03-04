<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const installPrompt = inject<ReturnType<typeof ref<any>>>('installPrompt', ref(null))

// --- Platform detection ---
const isStandalone = ref(
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true
)
const ua = navigator.userAgent
const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
const isAndroid = /Android/.test(ua)
const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua)
const isChrome = /Chrome/.test(ua) && !/Edg/.test(ua)

// --- State ---
const currentStep = ref(0)
const promptReady = ref(!!installPrompt?.value)
const promptFallback = ref(false)
const redirectCountdown = ref(2)

// Wait for beforeinstallprompt on Android
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  // Already installed → countdown redirect
  if (isStandalone.value) {
    const interval = setInterval(() => {
      redirectCountdown.value--
      if (redirectCountdown.value <= 0) {
        clearInterval(interval)
        router.replace('/')
      }
    }, 1000)
    return
  }

  // Android: wait briefly for beforeinstallprompt
  if (isAndroid && !installPrompt?.value) {
    fallbackTimer = setTimeout(() => {
      if (!installPrompt?.value) {
        promptFallback.value = true
      }
    }, 3000)
  }
})

onUnmounted(() => {
  if (fallbackTimer) clearTimeout(fallbackTimer)
})

// Watch for prompt becoming available
const hasNativePrompt = computed(() => !!installPrompt?.value)

async function triggerInstall() {
  const prompt = installPrompt?.value as any
  if (!prompt) return
  prompt.prompt()
  const result = await prompt.userChoiceResult
  if (result?.outcome === 'accepted') {
    // Will become standalone on next visit
  }
}

function dismiss() {
  localStorage.setItem('ssi-install-dismissed', Date.now().toString())
  router.replace('/')
}

function nextStep() {
  if (currentStep.value < 3) currentStep.value++
}
function prevStep() {
  if (currentStep.value > 0) currentStep.value--
}

// Determine which flow to show
const flow = computed(() => {
  if (isStandalone.value) return 'installed'
  if (isAndroid && (hasNativePrompt.value || !promptFallback.value)) return 'android'
  if (isAndroid && promptFallback.value) return 'android-manual'
  if (isIOS) return 'ios'
  return 'desktop'
})

// iOS share button location hint
const shareLocation = computed(() => {
  if (isChrome) return 'top-right'
  return 'bottom-center' // Safari default
})
</script>

<template>
  <div class="install-root">
    <div class="install-container">

      <!-- CLOSE / SKIP -->
      <button class="close-btn" @click="dismiss" aria-label="Close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      <!-- A) Already installed -->
      <div v-if="flow === 'installed'" class="flow-section">
        <img src="/icons/icon-192.png" alt="SSi" class="app-icon" width="96" height="96" />
        <h1>You're all set!</h1>
        <p class="subtitle">SaySomethingin is already installed.</p>
        <p class="muted">Redirecting in {{ redirectCountdown }}s...</p>
      </div>

      <!-- B) Android with native prompt -->
      <div v-else-if="flow === 'android'" class="flow-section">
        <img src="/icons/icon-192.png" alt="SSi" class="app-icon" width="96" height="96" />
        <h1>Install SaySomethingin</h1>
        <ul class="value-props">
          <li>Faster loading</li>
          <li>Works offline</li>
          <li>Home screen shortcut</li>
        </ul>
        <button v-if="hasNativePrompt" class="install-btn" @click="triggerInstall">
          Install
        </button>
        <div v-else class="loading-dots">
          <span></span><span></span><span></span>
        </div>
        <button class="skip-link" @click="dismiss">Not now</button>
      </div>

      <!-- B2) Android fallback (no prompt) -->
      <div v-else-if="flow === 'android-manual'" class="flow-section">
        <img src="/icons/icon-192.png" alt="SSi" class="app-icon" width="80" height="80" />
        <h1>Install SaySomethingin</h1>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-text">
              Tap the <strong>menu</strong>
              <svg class="inline-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
              in Chrome
            </div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-text">Tap <strong>"Add to Home screen"</strong></div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-text">Tap <strong>"Add"</strong></div>
          </div>
        </div>
        <button class="skip-link" @click="dismiss">Not now</button>
      </div>

      <!-- C) iOS walkthrough -->
      <div v-else-if="flow === 'ios'" class="flow-section">
        <img src="/icons/icon-192.png" alt="SSi" class="app-icon app-icon-small" width="64" height="64" />
        <h1 class="ios-title">Install SaySomethingin</h1>

        <!-- Step indicators -->
        <div class="step-dots">
          <span v-for="i in 4" :key="i" :class="['dot', { active: currentStep === i - 1 }]"></span>
        </div>

        <div class="ios-step-area">
          <!-- Step 0: Tap Share -->
          <Transition name="fade" mode="out-in">
            <div v-if="currentStep === 0" key="s0" class="ios-step">
              <div class="step-instruction">
                Tap the <strong>Share</strong> button
                <svg class="share-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
                  <polyline points="16 6 12 2 8 6"/>
                  <line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
              </div>
              <div :class="['share-pointer', shareLocation]">
                <div class="pulse-ring"></div>
                <svg class="arrow-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ssi-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <polyline points="19 12 12 19 5 12"/>
                </svg>
              </div>
            </div>

            <!-- Step 1: Add to Home Screen -->
            <div v-else-if="currentStep === 1" key="s1" class="ios-step">
              <div class="step-instruction">
                Tap <strong>"Add to Home Screen"</strong>
              </div>
              <div class="mock-share-sheet">
                <div class="mock-option">
                  <div class="mock-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  </div>
                  <span class="mock-label highlight">Add to Home Screen</span>
                </div>
              </div>
            </div>

            <!-- Step 2: Tap Add -->
            <div v-else-if="currentStep === 2" key="s2" class="ios-step">
              <div class="step-instruction">
                Tap <strong>"Add"</strong> in the top right
              </div>
              <div class="mock-confirm">
                <div class="mock-confirm-header">
                  <span class="mock-cancel">Cancel</span>
                  <span class="mock-title-text">Add to Home Screen</span>
                  <span class="mock-add highlight">Add</span>
                </div>
                <div class="mock-confirm-preview">
                  <img src="/icons/icon-192.png" alt="" width="48" height="48" class="mock-preview-icon" />
                  <span class="mock-preview-name">SaySomethingin</span>
                </div>
              </div>
            </div>

            <!-- Step 3: Done -->
            <div v-else key="s3" class="ios-step">
              <div class="step-instruction done-text">
                Now open <strong>SaySomethingin</strong> from your home screen!
              </div>
              <img src="/icons/icon-192.png" alt="SSi" class="bounce-icon" width="80" height="80" />
            </div>
          </Transition>
        </div>

        <!-- Navigation -->
        <div class="ios-nav">
          <button v-if="currentStep > 0" class="nav-btn" @click="prevStep">Back</button>
          <span v-else></span>
          <button v-if="currentStep < 3" class="nav-btn primary" @click="nextStep">Next</button>
          <button v-else class="nav-btn primary" @click="dismiss">Done</button>
        </div>
      </div>

      <!-- D) Desktop fallback -->
      <div v-else class="flow-section">
        <img src="/icons/icon-192.png" alt="SSi" class="app-icon" width="96" height="96" />
        <h1>SaySomethingin</h1>
        <p class="subtitle">For the best experience, open this link on your phone.</p>
        <template v-if="hasNativePrompt">
          <p class="muted">Or install directly in Chrome:</p>
          <button class="install-btn" @click="triggerInstall">Install</button>
        </template>
        <button class="skip-link" @click="dismiss">Continue in browser</button>
      </div>

    </div>
  </div>
</template>

<style scoped>
.install-root {
  position: fixed;
  inset: 0;
  overflow-y: auto;
  background: var(--bg-primary, #050508);
  color: var(--text-primary, #e8e3dd);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  z-index: 9999;
  -webkit-overflow-scrolling: touch;
}

.install-container {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 24px calc(24px + env(safe-area-inset-bottom, 0px));
  position: relative;
}

.close-btn {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top, 0px));
  right: 16px;
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  transition: color 0.2s;
}
.close-btn:hover {
  color: var(--text-primary, #e8e3dd);
}

/* Flow sections */
.flow-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 360px;
  width: 100%;
  gap: 16px;
}

.app-icon {
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
.app-icon-small {
  margin-bottom: -8px;
}

h1 {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  line-height: 1.2;
}
.ios-title {
  font-size: 20px;
}

.subtitle {
  font-size: 16px;
  color: var(--text-secondary, #aaa);
  margin: 0;
}
.muted {
  font-size: 14px;
  color: var(--text-secondary, #888);
  margin: 0;
}

/* Value props */
.value-props {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.value-props li {
  font-size: 15px;
  color: var(--text-secondary, #ccc);
}
.value-props li::before {
  content: '\2713\00a0';
  color: var(--ssi-red, #c23a3a);
  font-weight: 700;
}

/* Install button */
.install-btn {
  background: var(--ssi-red, #c23a3a);
  color: #fff;
  border: none;
  padding: 14px 48px;
  border-radius: var(--radius-lg, 12px);
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  font-family: inherit;
}
.install-btn:hover {
  background: var(--ssi-red-light, #e54545);
}
.install-btn:active {
  transform: scale(0.97);
}

.skip-link {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  font-size: 14px;
  cursor: pointer;
  padding: 8px;
  text-decoration: underline;
  text-underline-offset: 2px;
  font-family: inherit;
}

/* Loading dots */
.loading-dots {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 14px 0;
}
.loading-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ssi-red, #c23a3a);
  animation: dotPulse 1.2s ease-in-out infinite;
}
.loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.loading-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

/* Manual steps (Android fallback) */
.steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  text-align: left;
}
.step {
  display: flex;
  align-items: center;
  gap: 12px;
}
.step-num {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--ssi-red, #c23a3a);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}
.step-text {
  font-size: 15px;
  line-height: 1.4;
}
.inline-icon {
  vertical-align: middle;
  margin: 0 2px;
  opacity: 0.8;
}

/* iOS walkthrough */
.step-dots {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary, #444);
  transition: background 0.3s, transform 0.3s;
}
.dot.active {
  background: var(--ssi-red, #c23a3a);
  transform: scale(1.3);
}

.ios-step-area {
  width: 100%;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ios-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  width: 100%;
}

.step-instruction {
  font-size: 18px;
  line-height: 1.4;
}
.done-text {
  font-size: 20px;
}

.share-icon {
  vertical-align: middle;
  margin-left: 4px;
  color: var(--ssi-red, #c23a3a);
}

/* Animated pointer for share button */
.share-pointer {
  position: relative;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.share-pointer.bottom-center {
  animation: bounceDown 1.5s ease-in-out infinite;
}
.share-pointer.top-right {
  animation: bounceUp 1.5s ease-in-out infinite;
}
.share-pointer.top-right .arrow-icon {
  transform: rotate(180deg);
}

.pulse-ring {
  position: absolute;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid var(--ssi-red, #c23a3a);
  animation: pulseRing 1.5s ease-out infinite;
}

@keyframes bounceDown {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(10px); }
}
@keyframes bounceUp {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
@keyframes pulseRing {
  0% { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(1.6); opacity: 0; }
}

/* Mock share sheet */
.mock-share-sheet {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-lg, 12px);
  padding: 12px 16px;
  width: 100%;
}
.mock-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}
.mock-icon-box {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #aaa);
}
.mock-label {
  font-size: 16px;
}
.highlight {
  color: var(--ssi-red, #c23a3a);
  font-weight: 600;
}

/* Mock confirm dialog */
.mock-confirm {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-lg, 12px);
  width: 100%;
  overflow: hidden;
}
.mock-confirm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 14px;
}
.mock-cancel { color: var(--text-secondary, #888); }
.mock-title-text { font-weight: 600; font-size: 13px; }
.mock-add {
  font-weight: 700;
  font-size: 15px;
}
.mock-confirm-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
}
.mock-preview-icon {
  border-radius: 12px;
}
.mock-preview-name {
  font-size: 15px;
  font-weight: 500;
}

/* Bounce icon on done step */
.bounce-icon {
  border-radius: var(--radius-lg, 12px);
  animation: iconBounce 2s ease-in-out infinite;
}
@keyframes iconBounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

/* iOS nav */
.ios-nav {
  display: flex;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
  margin-top: 8px;
}
.nav-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary, #e8e3dd);
  padding: 12px 24px;
  border-radius: var(--radius-lg, 12px);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  font-family: inherit;
}
.nav-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.nav-btn.primary {
  background: var(--ssi-red, #c23a3a);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}
.nav-btn.primary:hover {
  background: var(--ssi-red-light, #e54545);
}

/* Fade transition */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
