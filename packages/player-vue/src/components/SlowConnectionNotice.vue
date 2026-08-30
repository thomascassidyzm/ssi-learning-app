<script setup>
import { t } from '@/composables/useI18n'

defineEmits(['retry'])
</script>

<template>
  <!--
    Shown only when the no-fallback wait expired with nothing to show: no
    catalogue, no cached script for the course being opened, so no player and
    no audio. The alternative is a blank screen, which reads as broken.

    Deliberately the same shape as the pre-mount boot floor in index.html — one
    plain line, one button, no explanation of caches or connections. The
    original request is still running behind this: if it lands, the boot
    completes and this disappears without the button ever being pressed.
  -->
  <div class="slow-connection" role="status" aria-live="polite">
    <p class="slow-connection-message">
      {{ t('boot.slowConnection', 'Your connection looks slow.') }}
    </p>
    <p class="slow-connection-detail">
      {{ t('boot.slowConnectionDetail', 'Still trying — this will start on its own if it gets through.') }}
    </p>
    <button type="button" class="slow-connection-retry" @click="$emit('retry')">
      {{ t('boot.slowConnectionRetry', 'Try again') }}
    </button>
  </div>
</template>

<style scoped>
.slow-connection {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  padding-top: calc(24px + env(safe-area-inset-top, 0px));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  text-align: center;
  background: var(--bg-primary);
}

.slow-connection-message {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.slow-connection-detail {
  margin: 0 0 12px;
  max-width: 320px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.slow-connection-retry {
  font-family: inherit;
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
  background: var(--ssi-red);
  border: none;
  border-radius: 12px;
  padding: 14px 28px;
  min-height: 48px;
  cursor: pointer;
}
</style>
