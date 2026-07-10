<script setup lang="ts">
/**
 * CheckoutOverlay — the app-controlled host for the consumer Premium checkout.
 *
 * Mounted ONCE in App.vue, Teleported to <body>, driven entirely by
 * useCheckout's module-level `overlayOpen` state. It renders Paddle's INLINE
 * checkout (frameTarget = CHECKOUT_FRAME_TARGET) inside a full-screen,
 * safe-area-aware surface.
 *
 * WHY THIS EXISTS: Paddle's own overlay puts its close "X" at the top of the
 * iframe, which on an installed iOS PWA can render UNDER the safe-area inset —
 * trapping the user with no way out. This overlay owns the chrome instead, so
 * the close control is always inside the safe area, and there are multiple
 * GUARANTEED exits that work even if Paddle never finished loading:
 *   • the Close button (pinned top-right, within the safe area)
 *   • the Escape key
 *   • tapping the backdrop outside the checkout card
 * All three call useCheckout().closeCheckout(), which closes Paddle (guarded)
 * and tears down this overlay + resets state.
 */
import { watch, onBeforeUnmount, computed } from 'vue'
import { useCheckout, CHECKOUT_FRAME_TARGET } from '@/composables/useCheckout'

const { overlayOpen, overlayPlan, closeCheckout } = useCheckout()
const overlayTitle = computed(() => (overlayPlan.value === 'family' ? 'SSi Family' : 'SSi Premium'))

// The static host class below MUST equal the frameTarget Paddle renders into.
// Guard it so a rename can't silently break the mount in production.
if (import.meta.env.DEV && CHECKOUT_FRAME_TARGET !== 'consumer-checkout-frame') {
  console.error('[CheckoutOverlay] host class out of sync with CHECKOUT_FRAME_TARGET')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeCheckout()
}

// Only listen for Escape while open; lock body scroll so the page behind can't
// move under the fixed overlay.
watch(overlayOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="overlayOpen"
      class="checkout-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="`Subscribe to ${overlayTitle}`"
      @click.self="closeCheckout"
    >
      <div class="checkout-card" @click.stop>
        <header class="checkout-bar">
          <span class="checkout-title">{{ overlayTitle }}</span>
          <button
            type="button"
            class="checkout-close"
            aria-label="Close checkout"
            @click="closeCheckout"
          >✕</button>
        </header>

        <!-- Inline Paddle frame mounts here. Class MUST equal CHECKOUT_FRAME_TARGET.
             Scrollable so the checkout always fits, however tall Paddle makes it. -->
        <div class="checkout-scroll">
          <div class="consumer-checkout-frame"></div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.checkout-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000; /* above player chrome, below nothing the user needs */
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
  /* Respect the device safe area so nothing lands under the notch / home bar. */
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
  box-sizing: border-box;
}

.checkout-card {
  width: 100%;
  max-width: 460px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated, #ffffff);
  border-radius: 1rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.checkout-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle, #e2e8f0);
}
.checkout-title {
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
  color: var(--text-primary, #1e293b);
}
.checkout-close {
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 0.6rem;
  background: var(--bg-subtle, #f1f5f9);
  color: var(--text-primary, #1e293b);
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.checkout-close:hover { background: var(--border-subtle, #e2e8f0); }

.checkout-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0.5rem 0.75rem 0.75rem;
}
.consumer-checkout-frame {
  width: 100%;
  min-height: 450px;
}
</style>
