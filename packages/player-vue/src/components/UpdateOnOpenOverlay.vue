<script setup lang="ts">
/**
 * UpdateOnOpenOverlay — what the learner sees while the app takes an update
 * on open.
 *
 * It exists because the alternative was nothing: the app checked for updates
 * on open, reloaded or didn't, and never said a word (Tom, 2026-09-18). One
 * screen, its own voice and languages, holding the surface so no tap lands on
 * a document that is about to be replaced.
 *
 * It paints ONLY when useOpenUpdateGate decides there is a proven newer build
 * to take — offline, current, or mid-play, this renders nothing at all.
 *
 * After SLOW_MS the screen stops pretending and offers a way out. "Reload" is
 * a real user gesture, which is the one thing that unsticks an iOS standalone
 * webview whose programmatic reload silently didn't take — the same escape as
 * the boot watchdog's "tap to relaunch".
 */
import { useI18n } from '../composables/useI18n'
import { updateHolding, updateSlow, keepWaiting } from '../composables/useOpenUpdateGate'

const { t } = useI18n()

function onReload() {
  window.location.reload()
}
</script>

<template>
  <!-- Teleported to body so no parent's transform/filter can trap the one
       screen that has to be above everything. -->
  <Teleport to="body">
    <div v-if="updateHolding" class="ssi-open-update" role="status" aria-live="polite">
      <div class="ssi-open-update-card">
        <div class="ssi-open-update-spinner" aria-hidden="true"></div>
        <p class="ssi-open-update-title">{{ t('update.updatingTitle') }}</p>
        <p class="ssi-open-update-body">
          {{ updateSlow ? t('update.updatingSlow') : t('update.updatingBody') }}
        </p>
        <div v-if="updateSlow" class="ssi-open-update-actions">
          <button type="button" class="ssi-open-update-secondary" @click="keepWaiting">
            {{ t('update.keepWaiting') }}
          </button>
          <button type="button" class="ssi-open-update-primary" @click="onReload">
            {{ t('update.reloadNow') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Full-screen and opaque on purpose: holding interaction IS the feature. A
   translucent scrim would let a tap look available while the document under
   it is seconds from being replaced. */
.ssi-open-update {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, env(safe-area-inset-left, 0px)) 24px;
  padding-top: calc(24px + env(safe-area-inset-top, 0px));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  background: var(--bg-primary, #e8e3dd);
  color: var(--text-primary, #2c2622);
}

.ssi-open-update-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
  max-width: 340px;
}

.ssi-open-update-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(44, 38, 34, 0.15);
  border-top-color: var(--accent, #c23a3a);
  border-radius: 50%;
  animation: ssi-open-update-spin 1s linear infinite;
}

@keyframes ssi-open-update-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ssi-open-update-spinner { animation-duration: 3s; }
}

.ssi-open-update-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.ssi-open-update-body {
  margin: 0;
  font-size: 15px;
  opacity: 0.75;
}

.ssi-open-update-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.ssi-open-update-secondary,
.ssi-open-update-primary {
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
  padding: 11px 20px;
  min-height: 44px;
  cursor: pointer;
}

.ssi-open-update-secondary {
  background: transparent;
  border: 1px solid rgba(44, 38, 34, 0.25);
  color: inherit;
}

.ssi-open-update-primary {
  background: var(--accent, #c23a3a);
  border: none;
  color: #ffffff;
}
</style>
