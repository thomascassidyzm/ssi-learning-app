<script setup lang="ts">
// AppEscape — the shell-level "no dead ends" escape.
//
// Rendered by App.vue for any route that does NOT provide its own way out, so a
// learner/teacher is never trapped on a chrome-less page. This matters most in
// the installed PWA (standalone mode), where there is NO browser back button or
// URL bar — without an in-app escape the only exit is to force-quit the app.
// Deep-linked / shared-link arrivals (no history) are handled too.
//
// Default-ON: routes opt OUT via `meta.hideAppEscape` (the immersive player and
// the shelled containers — schools / teach / admin — which carry their own nav).
// Low-emphasis by design so it never competes with a focused page's primary
// action (e.g. "just enter your email").
import { useRouter } from 'vue-router'

// `to`: an explicit destination, for callers that know exactly where "back"
// should land (e.g. the immersive player, opted back in for schools/tutor
// staff who arrived via their dashboard's Learn button — real back-history
// isn't reliable there since a deep reload or a long play session can lose
// it). Omit it everywhere else and the default back/home behaviour applies.
const props = defineProps<{ to?: string }>()

const router = useRouter()

function escape() {
  if (props.to) {
    router.push(props.to)
    return
  }
  // Prefer real back; fall back to the app home when there's nowhere to go back
  // to (cold open of a shared/deep link).
  if (typeof window !== 'undefined' && window.history.length > 1) router.back()
  else router.push('/')
}
</script>

<template>
  <button type="button" class="app-escape" aria-label="Go back" @click="escape">
    <span class="app-escape__chev" aria-hidden="true">←</span>
    <span class="app-escape__label">Back</span>
  </button>
</template>

<style scoped>
.app-escape {
  position: fixed;
  top: max(12px, env(safe-area-inset-top, 0px));
  left: max(12px, env(safe-area-inset-left, 0px));
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px 0 12px;
  font-family: var(--font-mono, ui-monospace, "SF Mono", Menlo, monospace);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary, #5b5650);
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px) saturate(1.5);
  -webkit-backdrop-filter: blur(12px) saturate(1.5);
  border: 1px solid rgba(44, 38, 34, 0.1);
  border-radius: 999px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.8),
    0 1px 2px rgba(44, 38, 34, 0.06),
    0 6px 18px rgba(44, 38, 34, 0.1);
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
}
.app-escape:hover {
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(44, 38, 34, 0.16);
}
.app-escape:active { transform: translateY(0.5px); }
.app-escape:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.4);
}
.app-escape__chev { font-size: 14px; line-height: 1; }

@media (prefers-reduced-transparency: reduce) {
  .app-escape {
    background: #ffffff;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-escape { transition: none; }
}
</style>
