<script setup>
import { ref } from 'vue'

const isPlaying = ref(true)
const turboActive = ref(false)
const listeningMode = ref(false)

const togglePlay = () => isPlaying.value = !isPlaying.value
const toggleTurbo = () => turboActive.value = !turboActive.value
const toggleListening = () => listeningMode.value = !listeningMode.value
</script>

<template>
  <div class="variations-showcase">
    <h1 class="showcase-title">Control Bar Variations</h1>
    <p class="showcase-subtitle">Play/Stop · Revisit · Skip · Turbo Boost · Listening Mode</p>

    <!-- VARIATION 1: Zen Minimal -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">01</span>
        <h2>Zen Minimal</h2>
        <p>Central ring for play/stop. Subtle secondary controls fade in on hover.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="zen-container">
          <!-- Secondary controls (left) -->
          <div class="zen-side zen-left">
            <button class="zen-secondary" title="Revisit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            </button>
            <button class="zen-secondary" :class="{ active: listeningMode }" @click="toggleListening" title="Listening Mode">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
            </button>
          </div>

          <!-- Main play/stop ring -->
          <button class="zen-ring" :class="{ playing: isPlaying }" @click="togglePlay">
            <svg class="zen-ring-svg" viewBox="0 0 120 120">
              <circle class="zen-track" cx="60" cy="60" r="54" fill="none" stroke-width="2"/>
              <circle class="zen-progress" cx="60" cy="60" r="54" fill="none" stroke-width="3"
                stroke-dasharray="339" stroke-dashoffset="85" transform="rotate(-90 60 60)"/>
            </svg>
            <div class="zen-icon">
              <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21"/>
              </svg>
            </div>
          </button>

          <!-- Secondary controls (right) -->
          <div class="zen-side zen-right">
            <button class="zen-secondary" :class="{ active: turboActive }" @click="toggleTurbo" title="Turbo Boost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </button>
            <button class="zen-secondary" title="Skip">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 4 15 12 5 20"/>
                <rect x="17" y="4" width="2" height="16"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- VARIATION 2: Dock Bar -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">02</span>
        <h2>Dock Bar</h2>
        <p>All controls in a unified floating bar. Modes on the right with separator.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="dock-controls">
          <button class="dock-item" title="Revisit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            <span class="dock-label">Revisit</span>
          </button>

          <button class="dock-item dock-item--primary" @click="togglePlay">
            <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="3" width="6" height="18" rx="1"/>
              <rect x="13" y="3" width="6" height="18" rx="1"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21"/>
            </svg>
            <span class="dock-label">{{ isPlaying ? 'Stop' : 'Play' }}</span>
          </button>

          <button class="dock-item" title="Skip">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20"/>
              <rect x="17" y="4" width="2" height="16"/>
            </svg>
            <span class="dock-label">Skip</span>
          </button>

          <div class="dock-separator"></div>

          <button class="dock-item dock-item--turbo" :class="{ active: turboActive }" @click="toggleTurbo" title="Turbo Boost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <span class="dock-label">Turbo</span>
          </button>

          <button class="dock-item dock-item--listening" :class="{ active: listeningMode }" @click="toggleListening" title="Listening Mode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
            <span class="dock-label">Listen</span>
          </button>
        </div>
      </div>
    </section>

    <!-- VARIATION 3: Split Controls -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">03</span>
        <h2>Split Controls</h2>
        <p>Main transport left, mode toggles right. Clear visual hierarchy.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="split-controls">
          <div class="split-left">
            <button class="split-btn" title="Revisit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            </button>
            <button class="split-btn split-btn--main" @click="togglePlay">
              <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="3" width="6" height="18" rx="1"/>
                <rect x="13" y="3" width="6" height="18" rx="1"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21"/>
              </svg>
            </button>
            <button class="split-btn" title="Skip">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 4 15 12 5 20"/>
                <rect x="17" y="4" width="2" height="16"/>
              </svg>
            </button>
          </div>

          <div class="split-right">
            <button class="mode-toggle" :class="{ active: turboActive }" @click="toggleTurbo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              <span>Turbo</span>
            </button>
            <button class="mode-toggle" :class="{ active: listeningMode }" @click="toggleListening">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
              <span>Listen</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- VARIATION 4: Pill Segments -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">04</span>
        <h2>Pill Segments</h2>
        <p>Compact unified bar. Modes as toggleable segments on the ends.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="pill-controls">
          <button class="pill-mode" :class="{ active: turboActive }" @click="toggleTurbo" title="Turbo Boost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </button>

          <div class="pill-main">
            <button class="pill-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            </button>
            <button class="pill-btn pill-btn--center" @click="togglePlay">
              <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="3" width="6" height="18" rx="1"/>
                <rect x="13" y="3" width="6" height="18" rx="1"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21"/>
              </svg>
            </button>
            <button class="pill-btn">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 4 15 12 5 20"/>
                <rect x="17" y="4" width="2" height="16"/>
              </svg>
            </button>
          </div>

          <button class="pill-mode pill-mode--listen" :class="{ active: listeningMode }" @click="toggleListening" title="Listening Mode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
          </button>
        </div>
      </div>
    </section>

    <!-- VARIATION 5: Floating Cards -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">05</span>
        <h2>Floating Cards</h2>
        <p>Separate floating elements. Modes as distinct toggleable cards.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="cards-controls">
          <div class="transport-card">
            <button class="card-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            </button>
            <button class="card-btn card-btn--main" @click="togglePlay">
              <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="3" width="6" height="18" rx="1"/>
                <rect x="13" y="3" width="6" height="18" rx="1"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21"/>
              </svg>
            </button>
            <button class="card-btn">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 4 15 12 5 20"/>
                <rect x="17" y="4" width="2" height="16"/>
              </svg>
            </button>
          </div>

          <div class="mode-cards">
            <button class="mode-card" :class="{ active: turboActive }" @click="toggleTurbo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              <span>Turbo</span>
            </button>
            <button class="mode-card mode-card--listen" :class="{ active: listeningMode }" @click="toggleListening">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
              <span>Listen</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- VARIATION 6: Text Minimal -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">06</span>
        <h2>Text Minimal</h2>
        <p>Typography-forward. Words as controls. Editorial confidence.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="text-controls">
          <div class="text-transport">
            <button class="text-btn">Revisit</button>
            <span class="text-sep">·</span>
            <button class="text-btn text-btn--main" @click="togglePlay">
              {{ isPlaying ? 'Stop' : 'Play' }}
            </button>
            <span class="text-sep">·</span>
            <button class="text-btn">Skip</button>
          </div>
          <div class="text-modes">
            <button class="text-mode" :class="{ active: turboActive }" @click="toggleTurbo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              Turbo
            </button>
            <button class="text-mode" :class="{ active: listeningMode }" @click="toggleListening">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
              Listen
            </button>
          </div>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
.variations-showcase {
  min-height: 100vh;
  background: #0a0a0b;
  padding: 3rem 1.5rem 6rem;
  font-family: 'Source Sans 3', -apple-system, sans-serif;
}

.showcase-title {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 2.5rem;
  font-weight: 700;
  color: #fff;
  text-align: center;
  margin-bottom: 0.5rem;
}

.showcase-subtitle {
  font-size: 1rem;
  color: #707070;
  text-align: center;
  margin-bottom: 3rem;
}

.variation {
  max-width: 700px;
  margin: 0 auto 4rem;
}

.variation-header {
  margin-bottom: 1.5rem;
}

.variation-number {
  display: inline-block;
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  color: #c23a3a;
  letter-spacing: 0.1em;
  margin-bottom: 0.5rem;
}

.variation-header h2 {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 1.5rem;
  font-weight: 600;
  color: #fff;
  margin-bottom: 0.25rem;
}

.variation-header p {
  font-size: 0.9rem;
  color: #707070;
}

.variation-demo {
  border-radius: 20px;
  padding: 3rem 2rem;
  display: flex;
  justify-content: center;
  align-items: center;
}

.demo-dark {
  background: #121212;
  border: 1px solid rgba(255,255,255,0.08);
}

/* ============ VARIATION 1: Zen Minimal ============ */
.zen-container {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.zen-side {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  opacity: 0.5;
  transition: opacity 0.3s ease;
}

.zen-container:hover .zen-side {
  opacity: 1;
}

.zen-secondary {
  width: 44px;
  height: 44px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  color: #707070;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.zen-secondary:hover {
  background: rgba(255,255,255,0.1);
  color: #fff;
  transform: scale(1.05);
}

.zen-secondary.active {
  background: rgba(212, 168, 83, 0.2);
  border-color: #d4a853;
  color: #d4a853;
}

.zen-secondary svg {
  width: 20px;
  height: 20px;
}

.zen-ring {
  position: relative;
  width: 120px;
  height: 120px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.zen-ring:hover {
  transform: scale(1.05);
}

.zen-ring-svg {
  width: 100%;
  height: 100%;
}

.zen-track {
  stroke: rgba(255,255,255,0.1);
}

.zen-progress {
  stroke: #c23a3a;
  stroke-linecap: round;
}

.zen-ring.playing .zen-progress {
  filter: drop-shadow(0 0 8px rgba(194, 58, 58, 0.5));
}

.zen-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 32px;
  color: #808080;
  transition: color 0.3s ease;
}

.zen-ring:hover .zen-icon {
  color: #fff;
}

.zen-ring.playing .zen-icon {
  color: #c23a3a;
}

/* ============ VARIATION 2: Dock Bar ============ */
.dock-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(26, 26, 26, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.1);
}

.dock-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 56px;
  padding: 10px 8px;
  background: transparent;
  border: none;
  border-radius: 12px;
  color: #707070;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dock-item svg {
  width: 22px;
  height: 22px;
}

.dock-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dock-item:hover {
  background: rgba(255,255,255,0.08);
  color: #fff;
}

.dock-item--primary {
  background: #c23a3a;
  color: white;
  border-radius: 14px;
}

.dock-item--primary:hover {
  background: #d44;
}

.dock-separator {
  width: 1px;
  height: 36px;
  background: rgba(255,255,255,0.15);
  margin: 0 6px;
}

.dock-item--turbo:hover,
.dock-item--turbo.active {
  background: rgba(212, 168, 83, 0.2);
  color: #d4a853;
}

.dock-item--listening:hover,
.dock-item--listening.active {
  background: rgba(74, 222, 128, 0.15);
  color: #4ade80;
}

/* ============ VARIATION 3: Split Controls ============ */
.split-controls {
  display: flex;
  align-items: center;
  gap: 2rem;
  width: 100%;
  justify-content: center;
}

.split-left {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #1a1a1a;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.08);
}

.split-btn {
  width: 48px;
  height: 48px;
  background: transparent;
  border: none;
  border-radius: 12px;
  color: #707070;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.split-btn svg {
  width: 20px;
  height: 20px;
}

.split-btn:hover {
  background: rgba(255,255,255,0.08);
  color: #fff;
}

.split-btn--main {
  width: 56px;
  height: 56px;
  background: #c23a3a;
  color: white;
  border-radius: 14px;
}

.split-btn--main:hover {
  background: #d44;
}

.split-btn--main svg {
  width: 24px;
  height: 24px;
}

.split-right {
  display: flex;
  gap: 8px;
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: #1a1a1a;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  color: #606060;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-toggle svg {
  width: 18px;
  height: 18px;
}

.mode-toggle:hover {
  border-color: rgba(255,255,255,0.2);
  color: #909090;
}

.mode-toggle.active {
  background: rgba(212, 168, 83, 0.15);
  border-color: #d4a853;
  color: #d4a853;
}

/* ============ VARIATION 4: Pill Segments ============ */
.pill-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pill-mode {
  width: 48px;
  height: 48px;
  background: #1a1a1a;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  color: #505050;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.pill-mode svg {
  width: 20px;
  height: 20px;
}

.pill-mode:hover {
  border-color: rgba(255,255,255,0.2);
  color: #808080;
}

.pill-mode.active {
  background: rgba(212, 168, 83, 0.2);
  border-color: #d4a853;
  color: #d4a853;
}

.pill-mode--listen.active {
  background: rgba(74, 222, 128, 0.15);
  border-color: #4ade80;
  color: #4ade80;
}

.pill-main {
  display: flex;
  align-items: center;
  background: #1a1a1a;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 18px;
  padding: 6px;
}

.pill-btn {
  width: 44px;
  height: 44px;
  background: transparent;
  border: none;
  border-radius: 12px;
  color: #606060;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.pill-btn svg {
  width: 18px;
  height: 18px;
}

.pill-btn:hover {
  background: rgba(255,255,255,0.08);
  color: #b0b0b0;
}

.pill-btn--center {
  width: 52px;
  height: 52px;
  background: #c23a3a;
  color: white;
  margin: 0 4px;
  border-radius: 14px;
}

.pill-btn--center:hover {
  background: #d44;
}

.pill-btn--center svg {
  width: 22px;
  height: 22px;
}

/* ============ VARIATION 5: Floating Cards ============ */
.cards-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.transport-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: #1a1a1a;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 18px;
}

.card-btn {
  width: 48px;
  height: 48px;
  background: transparent;
  border: none;
  border-radius: 12px;
  color: #606060;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.card-btn svg {
  width: 20px;
  height: 20px;
}

.card-btn:hover {
  background: rgba(255,255,255,0.08);
  color: #b0b0b0;
}

.card-btn--main {
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, #c23a3a, #9a2e2e);
  color: white;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(194, 58, 58, 0.35);
}

.card-btn--main:hover {
  transform: scale(1.05);
}

.card-btn--main svg {
  width: 26px;
  height: 26px;
}

.mode-cards {
  display: flex;
  gap: 10px;
}

.mode-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: #1a1a1a;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  color: #505050;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-card svg {
  width: 18px;
  height: 18px;
}

.mode-card:hover {
  border-color: rgba(255,255,255,0.2);
  color: #808080;
}

.mode-card.active {
  background: rgba(212, 168, 83, 0.15);
  border-color: #d4a853;
  color: #d4a853;
}

.mode-card--listen.active {
  background: rgba(74, 222, 128, 0.12);
  border-color: #4ade80;
  color: #4ade80;
}

/* ============ VARIATION 6: Text Minimal ============ */
.text-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.text-transport {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.text-btn {
  background: none;
  border: none;
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 1rem;
  font-weight: 500;
  color: #505050;
  cursor: pointer;
  padding: 0.5rem 0;
  position: relative;
  transition: color 0.2s ease;
}

.text-btn::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #c23a3a;
  transform: scaleX(0);
  transition: transform 0.2s ease;
}

.text-btn:hover {
  color: #b0b0b0;
}

.text-btn:hover::after {
  transform: scaleX(1);
}

.text-btn--main {
  font-size: 1.5rem;
  font-weight: 700;
  color: #c23a3a;
}

.text-btn--main:hover {
  color: #e54545;
}

.text-sep {
  color: #333;
  font-size: 1.5rem;
}

.text-modes {
  display: flex;
  gap: 1.5rem;
}

.text-mode {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  font-family: 'Source Sans 3', sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  color: #404040;
  cursor: pointer;
  padding: 8px 0;
  transition: color 0.2s ease;
}

.text-mode svg {
  width: 16px;
  height: 16px;
}

.text-mode:hover {
  color: #707070;
}

.text-mode.active {
  color: #d4a853;
}
</style>
