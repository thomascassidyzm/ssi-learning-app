<script setup>
import { ref } from 'vue'

const isPlaying = ref(true)
const togglePlay = () => isPlaying.value = !isPlaying.value
</script>

<template>
  <div class="variations-showcase">
    <h1 class="showcase-title">Control Bar Variations</h1>
    <p class="showcase-subtitle">Exploring different design directions for SSi Learning Player</p>

    <!-- VARIATION 1: Zen Minimal -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">01</span>
        <h2>Zen Minimal</h2>
        <p>Single focus point. Tap the ring to pause. Ambient, meditation-app feel.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="zen-controls">
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
          <p class="zen-hint">tap to {{ isPlaying ? 'pause' : 'resume' }}</p>
        </div>
      </div>
    </section>

    <!-- VARIATION 2: Music Player -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">02</span>
        <h2>Music Player</h2>
        <p>Familiar controls. Previous/Play/Next pattern. Confident, polished.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="music-controls">
          <button class="music-btn music-btn--secondary">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="19 20 9 12 19 4"/>
              <rect x="5" y="4" width="2" height="16"/>
            </svg>
          </button>
          <button class="music-btn music-btn--primary" @click="togglePlay">
            <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21"/>
            </svg>
          </button>
          <button class="music-btn music-btn--secondary">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20"/>
              <rect x="17" y="4" width="2" height="16"/>
            </svg>
          </button>
        </div>
      </div>
    </section>

    <!-- VARIATION 3: Pill Bar -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">03</span>
        <h2>Pill Bar</h2>
        <p>Unified container. Segmented controls. Modern app aesthetic.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="pill-controls">
          <button class="pill-segment">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
          </button>
          <div class="pill-divider"></div>
          <button class="pill-segment pill-segment--main" @click="togglePlay">
            <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21"/>
            </svg>
          </button>
          <div class="pill-divider"></div>
          <button class="pill-segment">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20"/>
              <rect x="17" y="4" width="2" height="16"/>
            </svg>
          </button>
        </div>
      </div>
    </section>

    <!-- VARIATION 4: Floating Orbs -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">04</span>
        <h2>Floating Orbs</h2>
        <p>Playful, organic shapes. Glass morphism. Delightful micro-interactions.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="orb-controls">
          <button class="orb orb--small">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
          </button>
          <button class="orb orb--large" @click="togglePlay">
            <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21"/>
            </svg>
          </button>
          <button class="orb orb--small">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20"/>
              <rect x="17" y="4" width="2" height="16"/>
            </svg>
          </button>
        </div>
      </div>
    </section>

    <!-- VARIATION 5: Inline Text -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">05</span>
        <h2>Inline Text</h2>
        <p>Words as buttons. Editorial feel. Typographic confidence.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="text-controls">
          <button class="text-btn">Again</button>
          <span class="text-divider">·</span>
          <button class="text-btn text-btn--primary" @click="togglePlay">
            {{ isPlaying ? 'Pause' : 'Play' }}
          </button>
          <span class="text-divider">·</span>
          <button class="text-btn">Skip</button>
        </div>
      </div>
    </section>

    <!-- VARIATION 6: Bottom Dock -->
    <section class="variation">
      <div class="variation-header">
        <span class="variation-number">06</span>
        <h2>Bottom Dock</h2>
        <p>macOS-style dock. Hover to expand. Satisfying physics.</p>
      </div>
      <div class="variation-demo demo-dark">
        <div class="dock-controls">
          <button class="dock-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            <span class="dock-tooltip">Again</span>
          </button>
          <button class="dock-item dock-item--primary" @click="togglePlay">
            <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21"/>
            </svg>
            <span class="dock-tooltip">{{ isPlaying ? 'Pause' : 'Play' }}</span>
          </button>
          <button class="dock-item">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20"/>
              <rect x="17" y="4" width="2" height="16"/>
            </svg>
            <span class="dock-tooltip">Skip</span>
          </button>
          <div class="dock-separator"></div>
          <button class="dock-item dock-item--boost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <span class="dock-tooltip">Boost</span>
          </button>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
.variations-showcase {
  min-height: 100vh;
  background: #0a0a0b;
  padding: 3rem 1.5rem;
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
  max-width: 600px;
  margin: 0 auto 3rem;
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
.zen-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
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

.zen-ring:active {
  transform: scale(0.98);
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
  transition: stroke-dashoffset 0.5s ease;
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
  color: #b0b0b0;
  transition: color 0.3s ease;
}

.zen-ring:hover .zen-icon {
  color: #fff;
}

.zen-ring.playing .zen-icon {
  color: #c23a3a;
}

.zen-hint {
  font-size: 0.75rem;
  color: #505050;
  letter-spacing: 0.1em;
  text-transform: lowercase;
}

/* ============ VARIATION 2: Music Player ============ */
.music-controls {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.music-btn {
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.music-btn--secondary {
  width: 48px;
  height: 48px;
  background: rgba(255,255,255,0.05);
  border-radius: 50%;
  color: #707070;
}

.music-btn--secondary:hover {
  background: rgba(255,255,255,0.1);
  color: #b0b0b0;
  transform: scale(1.05);
}

.music-btn--secondary svg {
  width: 20px;
  height: 20px;
}

.music-btn--primary {
  width: 72px;
  height: 72px;
  background: linear-gradient(135deg, #c23a3a 0%, #9a2e2e 100%);
  border-radius: 50%;
  color: white;
  box-shadow: 0 4px 24px rgba(194, 58, 58, 0.4);
}

.music-btn--primary:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 32px rgba(194, 58, 58, 0.5);
}

.music-btn--primary:active {
  transform: scale(1.02);
}

.music-btn--primary svg {
  width: 28px;
  height: 28px;
}

/* ============ VARIATION 3: Pill Bar ============ */
.pill-controls {
  display: flex;
  align-items: center;
  background: #1a1a1a;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 100px;
  padding: 6px;
}

.pill-segment {
  width: 52px;
  height: 52px;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: #707070;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.pill-segment svg {
  width: 20px;
  height: 20px;
}

.pill-segment:hover {
  background: rgba(255,255,255,0.05);
  color: #b0b0b0;
}

.pill-segment--main {
  width: 64px;
  height: 64px;
  background: #c23a3a;
  color: white;
}

.pill-segment--main:hover {
  background: #d44;
  color: white;
}

.pill-segment--main svg {
  width: 24px;
  height: 24px;
}

.pill-divider {
  width: 1px;
  height: 24px;
  background: rgba(255,255,255,0.1);
  margin: 0 4px;
}

/* ============ VARIATION 4: Floating Orbs ============ */
.orb-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.orb {
  border: none;
  cursor: pointer;
  backdrop-filter: blur(20px);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.orb--small {
  width: 56px;
  height: 56px;
  background: rgba(255,255,255,0.08);
  border-radius: 20px;
  color: #707070;
}

.orb--small:hover {
  background: rgba(255,255,255,0.12);
  color: #b0b0b0;
  transform: translateY(-4px) scale(1.05);
}

.orb--small svg {
  width: 22px;
  height: 22px;
}

.orb--large {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, rgba(194, 58, 58, 0.9), rgba(154, 46, 46, 0.9));
  border-radius: 28px;
  color: white;
  box-shadow:
    0 8px 32px rgba(194, 58, 58, 0.3),
    inset 0 1px 0 rgba(255,255,255,0.2);
}

.orb--large:hover {
  transform: translateY(-6px) scale(1.05);
  box-shadow:
    0 12px 40px rgba(194, 58, 58, 0.4),
    inset 0 1px 0 rgba(255,255,255,0.2);
}

.orb--large svg {
  width: 32px;
  height: 32px;
}

/* ============ VARIATION 5: Inline Text ============ */
.text-controls {
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
  transition: all 0.2s ease;
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

.text-btn--primary {
  font-size: 1.25rem;
  font-weight: 600;
  color: #c23a3a;
}

.text-btn--primary:hover {
  color: #e54545;
}

.text-divider {
  color: #333;
  font-size: 1.5rem;
}

/* ============ VARIATION 6: Bottom Dock ============ */
.dock-controls {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(30, 30, 30, 0.9);
  backdrop-filter: blur(20px);
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.1);
}

.dock-item {
  position: relative;
  width: 48px;
  height: 48px;
  background: rgba(255,255,255,0.05);
  border: none;
  border-radius: 14px;
  color: #808080;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dock-item svg {
  width: 20px;
  height: 20px;
}

.dock-item:hover {
  background: rgba(255,255,255,0.1);
  color: #fff;
  transform: translateY(-8px) scale(1.15);
}

.dock-item--primary {
  width: 56px;
  height: 56px;
  background: #c23a3a;
  color: white;
  border-radius: 16px;
}

.dock-item--primary:hover {
  background: #d44;
  transform: translateY(-12px) scale(1.2);
}

.dock-item--primary svg {
  width: 24px;
  height: 24px;
}

.dock-item--boost {
  color: #d4a853;
}

.dock-item--boost:hover {
  background: rgba(212, 168, 83, 0.2);
  color: #d4a853;
}

.dock-separator {
  width: 1px;
  height: 32px;
  background: rgba(255,255,255,0.1);
  margin: 0 4px;
  align-self: center;
}

.dock-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(8px);
  background: #242424;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 8px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: all 0.2s ease;
}

.dock-item:hover .dock-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
</style>
