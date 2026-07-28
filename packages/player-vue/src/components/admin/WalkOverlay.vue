<script setup lang="ts">
// WalkOverlay — the ONE walkthrough overlay (docs/walkthrough-engine-scout.md
// §3), mounted once in App.vue, rendering whichever walk useWalkthrough holds.
// The install walker's grammar: learner-paced Back/Next, step dots, pulse-ring
// pointer on the anchored element, Skip always visible — but anchored to REAL
// elements by reference (getBoundingClientRect), never heuristics, and never
// a modal trap: the page underneath stays fully interactive (the overlay is
// pointer-events:none except the card itself).
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useWalkthrough, ANCHOR_TIMEOUT_MS, effectiveAdvance } from '@/walkthrough/useWalkthrough'
import { placeCard, isAnchorUsable, PAD } from '@/walkthrough/overlayPlacement'

const { activeWalk, stepIndex, showingTerminal, currentStep, stopWalk, next, back } = useWalkthrough()
const route = useRoute()

// A walk belongs to the page it was offered on — navigating away ends it.
watch(() => route.path, (to, from) => {
  if (activeWalk.value && to !== from) stopWalk()
})

// ─── Anchor resolution: live element lookup with a bounded wait ───
const anchorEl = ref<HTMLElement | null>(null)
const anchorTimedOut = ref(false)
const rect = ref<DOMRect | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null
let timeoutTimer: ReturnType<typeof setTimeout> | null = null
let clickTarget: HTMLElement | null = null

function onAnchorClick(): void {
  if (currentStep.value && effectiveAdvance(currentStep.value) === 'click') next()
}

function detachClick(): void {
  if (clickTarget) {
    clickTarget.removeEventListener('click', onAnchorClick, true)
    clickTarget = null
  }
}

function clearTimers(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null }
}

function bindAnchor(el: HTMLElement): void {
  anchorEl.value = el
  anchorTimedOut.value = false
  rect.value = el.getBoundingClientRect()
  // Oversized anchors (taller than the viewport) scroll to their top edge —
  // block:'center' on a 5000px element lands mid-nowhere.
  const oversize = rect.value.height > window.innerHeight * 0.7
  el.scrollIntoView({ block: oversize ? 'start' : 'center', behavior: 'smooth' })
  const step = currentStep.value
  // effectiveAdvance, not the raw pack value: a click-advance on a
  // destructive/minting anchor degrades to show-and-point even if a stale
  // pack slipped past the compiler's denylist gate.
  const mode = step ? effectiveAdvance(step) : 'next'
  if (mode === 'click') {
    detachClick()
    clickTarget = el
    // Capture-phase listener: the element's own handler still runs — the
    // walk observes the user's real tap, it never intercepts or performs it.
    el.addEventListener('click', onAnchorClick, true)
  } else if (mode === 'visible') {
    // A "visible" step exists to wait for this element — it has now arrived.
    next()
  }
}

function resolveAnchor(): void {
  clearTimers()
  detachClick()
  anchorEl.value = null
  anchorTimedOut.value = false
  rect.value = null
  const step = currentStep.value
  if (!activeWalk.value || showingTerminal.value || !step) return
  // An element that exists but occupies no space (v-show off, hidden
  // ancestor) is NOT a usable anchor — binding it would ring 0,0.
  const find = () => {
    const el = document.querySelector<HTMLElement>(`[data-walk="${step.anchor}"]`)
    return el && isAnchorUsable(el.getBoundingClientRect()) ? el : null
  }
  const now = find()
  if (now) { bindAnchor(now); return }
  pollTimer = setInterval(() => {
    const el = find()
    if (el) { clearTimers(); bindAnchor(el) }
  }, 150)
  timeoutTimer = setTimeout(() => {
    // Never hang: show the step's text unanchored, Next always available —
    // but keep a slow poll going so a late-arriving anchor still re-binds.
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    timeoutTimer = null
    anchorTimedOut.value = true
    pollTimer = setInterval(() => {
      const el = find()
      if (el) { clearTimers(); bindAnchor(el) }
    }, 500)
  }, ANCHOR_TIMEOUT_MS)
}

watch([activeWalk, stepIndex, showingTerminal], resolveAnchor, { immediate: true })

// Track the anchor's geometry while active (scroll, layout shifts, resize).
let trackTimer: ReturnType<typeof setInterval> | null = null
function retrack(): void {
  if (anchorEl.value?.isConnected) {
    const r = anchorEl.value.getBoundingClientRect()
    if (isAnchorUsable(r)) rect.value = r
    else resolveAnchor() // element collapsed to zero size (hidden) — re-resolve
  } else if (anchorEl.value) {
    resolveAnchor() // element unmounted (e.g. form closed)
  }
}
watch(activeWalk, (walk) => {
  if (walk && !trackTimer) {
    trackTimer = setInterval(retrack, 200)
    window.addEventListener('scroll', retrack, { passive: true, capture: true })
    window.addEventListener('resize', retrack, { passive: true })
  } else if (!walk && trackTimer) {
    clearInterval(trackTimer)
    trackTimer = null
    window.removeEventListener('scroll', retrack, true)
    window.removeEventListener('resize', retrack)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  clearTimers()
  detachClick()
  if (trackTimer) clearInterval(trackTimer)
  window.removeEventListener('scroll', retrack, true)
  window.removeEventListener('resize', retrack)
})

// ─── Geometry ───
// env(safe-area-inset-top) isn't readable from JS directly — measure it once
// per walk via a probe element (0 on desktop / non-notched devices).
const safeTop = ref(0)
function measureSafeTop(): number {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top, 0px);visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const v = parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
  return v
}
watch(activeWalk, (walk) => { if (walk) safeTop.value = measureSafeTop() }, { immediate: true })

const ringStyle = computed(() => {
  const r = rect.value
  if (!r) return null
  return {
    top: `${r.top - PAD}px`,
    left: `${r.left - PAD}px`,
    width: `${r.width + PAD * 2}px`,
    height: `${r.height + PAD * 2}px`,
  }
})

// placeCard (walkthrough/overlayPlacement.ts) owns the numbers — including
// the back-to-player invariant: the card never covers the top chrome where
// the Learn escape lives, and bottom-center clears the home indicator.
const cardStyle = computed(() => {
  const unanchored = !rect.value || showingTerminal.value || anchorTimedOut.value
  return placeCard(unanchored ? null : rect.value, window.innerWidth, window.innerHeight, safeTop.value)
})

// Markdown-lite: **bold** only, escaped first (same rule as HowThisWorks).
function renderSay(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

const cardText = computed(() => {
  if (showingTerminal.value) return activeWalk.value?.steps[activeWalk.value.steps.length - 1]?.terminal ?? ''
  return currentStep.value?.say ?? ''
})
const isClickStep = computed(() =>
  !showingTerminal.value && !anchorTimedOut.value &&
  !!currentStep.value && effectiveAdvance(currentStep.value) === 'click')
const isLastStep = computed(() => !!activeWalk.value && stepIndex.value === activeWalk.value.steps.length - 1)
const nextLabel = computed(() => {
  if (showingTerminal.value) return 'Done'
  if (isLastStep.value && !activeWalk.value?.steps[stepIndex.value]?.terminal) return 'Done'
  return 'Next'
})
</script>

<template>
  <div v-if="activeWalk" class="walk-overlay" data-walk-overlay>
    <!-- Pulse ring on the real element — pointer-events:none, page stays live -->
    <div v-if="ringStyle && !showingTerminal" class="walk-ring" :style="ringStyle">
      <div class="walk-pulse"></div>
    </div>

    <div class="walk-card" :style="cardStyle" data-walk-card>
      <div class="walk-card-head">
        <span class="walk-kicker">{{ activeWalk.title }}</span>
        <button type="button" class="walk-close" aria-label="Skip tour" @click="stopWalk">×</button>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html — compiled repo pack content, escaped in renderSay -->
      <p class="walk-say" v-html="renderSay(cardText)"></p>
      <p v-if="isClickStep" class="walk-hint">Tap the highlighted button to continue — or skip.</p>
      <div class="walk-foot">
        <div class="walk-dots">
          <span
            v-for="(s, i) in activeWalk.steps" :key="s.anchor + i"
            class="walk-dot" :class="{ 'is-active': !showingTerminal && i === stepIndex, 'is-done': showingTerminal || i < stepIndex }"
          ></span>
        </div>
        <div class="walk-nav">
          <button v-if="stepIndex > 0 || showingTerminal" type="button" class="walk-btn" @click="back">Back</button>
          <button v-if="!isClickStep" type="button" class="walk-btn walk-btn-primary" @click="next">{{ nextLabel }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.walk-overlay { position: fixed; inset: 0; z-index: 9500; pointer-events: none; }

.walk-ring {
  position: fixed;
  border: 2px solid var(--schools-red, #DB1E17);
  border-radius: 10px;
  box-shadow: 0 0 0 4px rgba(219, 30, 23, 0.12);
  transition: top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease;
}
.walk-pulse {
  position: absolute; inset: -2px;
  border: 2px solid var(--schools-red, #DB1E17);
  border-radius: 10px;
  animation: walkPulse 1.6s ease-out infinite;
}
@keyframes walkPulse {
  0% { transform: scale(1); opacity: 0.7; }
  100% { transform: scale(1.12); opacity: 0; }
}

.walk-card {
  position: fixed;
  pointer-events: auto;
  background: #fff;
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 8px 30px rgba(44, 38, 34, 0.18);
  padding: 14px 16px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.walk-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.walk-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.walk-close {
  background: none; border: none; cursor: pointer; padding: 0 2px; line-height: 1;
  font-size: 18px; color: var(--schools-fg-3, #8A8078);
}
.walk-close:hover { color: var(--schools-fg, #0F1212); }
.walk-say { margin: 0; font-size: var(--text-sm, 14px); line-height: 1.55; color: var(--schools-fg-2, #555); }
.walk-say :deep(strong) { color: var(--ink-primary, #2C2622); font-weight: 600; }
.walk-hint { margin: 0; font-size: var(--text-xs, 12px); color: var(--schools-fg-3, #8A8078); font-style: italic; }

.walk-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.walk-dots { display: flex; gap: 5px; }
.walk-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(44, 38, 34, 0.18);
  transition: all 0.2s ease;
}
.walk-dot.is-active { background: var(--schools-red, #DB1E17); transform: scale(1.35); }
.walk-dot.is-done { background: rgba(219, 30, 23, 0.45); }

.walk-nav { display: flex; gap: 6px; }
.walk-btn {
  padding: 6px 14px; font: inherit; font-size: var(--text-xs, 12px); font-weight: 600;
  border-radius: var(--radius-full, 999px); border: 1px solid rgba(44, 38, 34, 0.14);
  background: rgba(44, 38, 34, 0.04); color: var(--schools-fg-2, #555); cursor: pointer;
}
.walk-btn:hover { background: rgba(44, 38, 34, 0.10); }
.walk-btn-primary { background: var(--schools-red, #DB1E17); border-color: transparent; color: #fff; }
.walk-btn-primary:hover { background: #c01812; }
</style>
