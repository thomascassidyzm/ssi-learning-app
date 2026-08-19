<script setup lang="ts">
/**
 * PlayerScreenFigure — the player screen itself, small and tappable in the
 * explainer card, opening full-screen with its four things named.
 *
 * Founder ruling 2026-08-19, after the foldout mockup: the picture is legible,
 * the LABELS are what will not fit. Beside the phone they need gutters — the
 * whole composite wants 760 across and the explainer card is 302, which squeezes
 * the phone to a smudge. So the card carries a small honest thumbnail with a
 * "show me the screen" affordance, and the labelled version gets a full-width
 * surface of its own.
 *
 * The labels are LIVE TEXT, not pixels baked into a wide picture. A 760-wide
 * annotated composite halves itself on a 390-wide phone, which is exactly the
 * smudge the ruling was avoiding — and a phone is where learners read this. As
 * text they stay readable at any width, get read out by a screen reader, and a
 * copy change never needs the shot taken again.
 *
 * The shot: production, guest, phone viewport, captured mid-turn so the gap
 * segment is part-filled — the same moment the pill figure draws. Nothing
 * dev-only is in it: the DEV badge, the dev reset, the Save Progress nudge and
 * the debug fab were all hidden before the shutter, because no learner ever
 * sees them. Re-shoot with e2e/explainer/shoot-player-screen.mjs.
 *
 * Callout text lives here rather than in the content module because each line
 * is bound to a coordinate on the picture — splitting the words from the point
 * they land on would make both harder to keep true.
 *
 * The sheet copies the InAppBrowser idiom rather than inventing one: fixed
 * full-screen, safe-area-padded header, one close, Escape closes, body scroll
 * locked while open.
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import playerScreen from '@/assets/explainer/player-screen.jpg'

/**
 * Each callout: where its pin sits, as a percentage of the picture, and what it
 * says. The pins touch the edge of the thing they name rather than sitting on
 * its middle — dead centre buries the icon the learner is being pointed at.
 */
const CALLOUTS = [
  { x: 54, y: 27.9, text: 'One go: you hear it, then your turn, then twice properly.' },
  { x: 81, y: 83, text: 'Offline downloads live here.' },
  { x: 11, y: 90.5, text: 'Every course you have.' },
  { x: 43.5, y: 90, text: 'The only button that matters.' },
]

const open = ref(false)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    window.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="psf">
    <button type="button" class="psf-thumb" @click="open = true">
      <img class="psf-thumb-img" :src="playerScreen" alt="" aria-hidden="true" width="640" height="1385" />
      <span class="psf-thumb-label">Show me the screen</span>
    </button>

    <Teleport to="body">
      <div v-if="open" class="psf-sheet" role="dialog" aria-modal="true" aria-label="The player screen">
        <header class="psf-header">
          <span class="psf-title">The player screen</span>
          <button type="button" class="psf-close" aria-label="Close" @click="open = false">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div class="psf-body">
          <figure class="psf-figure">
            <div class="psf-shot">
              <img class="psf-shot-img" :src="playerScreen" alt="" aria-hidden="true" width="640" height="1385" />
              <span
                v-for="(callout, i) in CALLOUTS"
                :key="callout.text"
                class="psf-pin"
                aria-hidden="true"
                :style="{ left: callout.x + '%', top: callout.y + '%' }"
              >{{ i + 1 }}</span>
            </div>
            <figcaption class="psf-legend">
              <span v-for="(callout, i) in CALLOUTS" :key="callout.text" class="psf-legend-row">
                <span class="psf-legend-num" aria-hidden="true">{{ i + 1 }}</span>
                <span class="psf-legend-text">{{ callout.text }}</span>
              </span>
            </figcaption>
          </figure>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.psf { display: flex; }

/* Small on purpose: a thumbnail that says "this is the screen you know", not a
   picture pretending to be readable. The words next to it are the affordance. */
.psf-thumb {
  display: flex;
  align-items: center;
  gap: var(--space-3, 12px);
  width: 100%;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.psf-thumb-img {
  flex: 0 0 auto;
  width: 84px;
  height: auto;
  border-radius: 10px;
  border: 1px solid var(--border-subtle, rgba(44, 38, 34, 0.12));
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.08);
}
.psf-thumb-label {
  font-size: var(--text-sm, 13px);
  line-height: 1.6;
  color: var(--ink-secondary, #6B635C);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgba(44, 38, 34, 0.25);
}
.psf-thumb:hover .psf-thumb-label { color: var(--ink-primary, #2C2622); }

/* The full-width surface. Same shape as the in-app browser sheet. */
.psf-sheet {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #e8e3dd);
}
/* Edge-anchored top chrome: the inset is EXTRA height, not eaten height. */
.psf-header {
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
}
.psf-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ink-primary, #2C2622);
}
.psf-close {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full, 9999px);
  background: transparent;
  color: var(--ink-secondary, #6B635C);
  cursor: pointer;
}
.psf-close:active { background: var(--border-subtle, rgba(0, 0, 0, 0.1)); }

.psf-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding:
    var(--space-5, 20px)
    max(var(--space-4, 16px), env(safe-area-inset-right, 0px))
    calc(var(--space-6, 24px) + env(safe-area-inset-bottom, 0px))
    max(var(--space-4, 16px), env(safe-area-inset-left, 0px));
}
.psf-figure {
  margin: 0 auto;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 16px);
}
.psf-shot {
  position: relative;
  line-height: 0;
}
.psf-shot-img {
  width: 100%;
  height: auto;
  border-radius: 14px;
  border: 1px solid var(--border-subtle, rgba(44, 38, 34, 0.12));
  box-shadow: 0 4px 14px rgba(44, 38, 34, 0.10);
}
/* The pin sits ON the thing it names, and the words for it are underneath —
   which keeps the picture uncrowded and the words readable at any width. */
.psf-pin {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--ssi-red, #c23a3a);
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(44, 38, 34, 0.35);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.psf-legend {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
}
.psf-legend-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.psf-legend-num {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--ssi-red, #c23a3a);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.psf-legend-text {
  font-size: var(--text-sm, 13px);
  line-height: 1.6;
  color: var(--ink-secondary, #6B635C);
}
</style>
