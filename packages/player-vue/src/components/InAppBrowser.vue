<script setup lang="ts">
/**
 * InAppBrowser — the full-screen sheet that shows a saysomethingin.com page
 * over the app, so the learner never leaves the PWA and never loses their
 * place. Mounted once, globally, in App.vue; it renders nothing at all until
 * some call site calls openInApp().
 *
 * The whole framing story — why the decision is an allowlist and not a runtime
 * probe, and which hosts frame — lives in composables/useInAppBrowser.ts. Read
 * that first. This file is just the sheet.
 *
 * Safe areas: this is fixed, edge-anchored chrome, so per CLAUDE.md the header
 * grows by env(safe-area-inset-top) and pads its contents down by the same, or
 * the close button lands under the iOS status bar where it cannot be tapped.
 * That has been a real shipped bug in this repo.
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import {
  useInAppBrowser,
  FRAME_LOAD_TIMEOUT_MS,
  hostLabel,
} from '../composables/useInAppBrowser'

const { target, loadFailed, closeInApp, markLoadFailed, escapeToBrowser } = useInAppBrowser()

const frameLoaded = ref(false)
let loadTimer: ReturnType<typeof setTimeout> | null = null

function clearLoadTimer() {
  if (loadTimer) {
    clearTimeout(loadTimer)
    loadTimer = null
  }
}

function onFrameLoad() {
  frameLoaded.value = true
  clearLoadTimer()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeInApp()
}

// Arm a timeout whenever a page opens. A frameable host that has not painted
// within the window is treated as broken, and the learner gets an honest way
// out rather than a white sheet.
watch(target, (next) => {
  clearLoadTimer()
  frameLoaded.value = false
  if (next) {
    loadTimer = setTimeout(() => markLoadFailed(), FRAME_LOAD_TIMEOUT_MS)
    window.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    window.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
})

onBeforeUnmount(() => {
  clearLoadTimer()
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div v-if="target" class="iab-sheet" role="dialog" aria-modal="true" :aria-label="target.title">
    <header class="iab-header">
      <div class="iab-titles">
        <span class="iab-title">{{ target.title }}</span>
        <span class="iab-host">{{ hostLabel(target.url) }}</span>
      </div>
      <button type="button" class="iab-close" aria-label="Close" @click="closeInApp">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>

    <div class="iab-body">
      <!-- The honest degradation. Never a silent blank sheet. -->
      <div v-if="loadFailed && !frameLoaded" class="iab-fallback">
        <p class="iab-fallback-line">This one opens in your browser.</p>
        <button type="button" class="iab-fallback-btn" @click="escapeToBrowser">
          Open {{ hostLabel(target.url) }}
        </button>
      </div>

      <iframe
        v-show="!(loadFailed && !frameLoaded)"
        class="iab-frame"
        :src="target.url"
        :title="target.title"
        referrerpolicy="no-referrer-when-downgrade"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        @load="onFrameLoad"
      />
    </div>
  </div>
</template>

<style scoped>
.iab-sheet {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #e8e3dd);
}

/* Edge-anchored top chrome: the inset is EXTRA height, not eaten height —
   global box-sizing is border-box, so it has to be added to both. */
.iab-header {
  flex: 0 0 auto;
  height: calc(54px + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  padding-left: max(1rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.5rem, env(safe-area-inset-right, 0px));
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-elevated, #ffffff);
  border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.1));
  box-shadow: var(--shadow-sm);
}

.iab-titles {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.iab-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary, #2c2622);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.iab-host {
  font-size: 0.72rem;
  color: var(--text-secondary, #4a4440);
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.iab-close {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full, 9999px);
  background: transparent;
  color: var(--text-secondary, #4a4440);
  cursor: pointer;
}

.iab-close:active {
  background: var(--border-subtle, rgba(0, 0, 0, 0.1));
}

.iab-body {
  flex: 1 1 auto;
  position: relative;
  min-height: 0;
  /* Bottom inset so the page's own footer clears the home indicator. */
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.iab-frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--bg-elevated, #ffffff);
}

.iab-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem max(1.5rem, env(safe-area-inset-left, 0px));
  text-align: center;
}

.iab-fallback-line {
  margin: 0;
  font-size: 1rem;
  color: var(--text-secondary, #4a4440);
}

.iab-fallback-btn {
  padding: 0.7rem 1.4rem;
  border: none;
  border-radius: var(--radius-full, 9999px);
  background: var(--accent, #c23a3a);
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}
</style>
