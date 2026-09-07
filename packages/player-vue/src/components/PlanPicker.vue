<script setup lang="ts">
/**
 * PlanPicker — the plan-selection step in front of Paddle.
 *
 * Mounted ONCE in App.vue, Teleported to <body>, driven by useCheckout's
 * module-level `plansOpen`. Every upgrade tap in the consumer app (in-player
 * paywall, course picker, Settings) opens this; the user taps a price and only
 * then does Paddle open, on the price they chose.
 *
 * WHY IT EXISTS: until 2026-09-07 every one of those taps went straight into a
 * hardcoded £15/mo Premium checkout. SSi Family was live in Paddle and fully
 * wired in code, and no customer could reach it.
 *
 * Same overlay shell as CheckoutOverlay (safe-area padding, close button,
 * Escape, backdrop tap) so the two steps feel like one flow. Tap is the only
 * affordance.
 */
import { computed, watch, onBeforeUnmount } from 'vue'
import { useCheckout } from '@/composables/useCheckout'
import { paddleConfig } from '@/lib/paddle'
import { FAMILY_SEAT_CAP } from '@/constants/family'

const { plansOpen, closePlans, choosePlan, isOpeningCheckout } = useCheckout()

// Family only appears once its Paddle prices are configured — hidden, not a
// broken button, exactly as the Settings row already does it.
const familyMonthly = computed(() => !!paddleConfig.familyMonthlyPriceId)
const familyAnnual = computed(() => !!paddleConfig.familyAnnualPriceId)
const showFamily = computed(() => familyMonthly.value || familyAnnual.value)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closePlans()
}

watch(plansOpen, (open) => {
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
      v-if="plansOpen"
      class="plans-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a plan"
      @click.self="closePlans"
    >
      <div class="plans-card" @click.stop>
        <header class="plans-bar">
          <span class="plans-title">Choose a plan</span>
          <button type="button" class="plans-close" aria-label="Close" @click="closePlans">✕</button>
        </header>

        <div class="plans-scroll">
          <section class="plan">
            <h3 class="plan-name">SSi Premium</h3>
            <p class="plan-desc">One account. Every course and language, and downloads for offline.</p>
            <div class="plan-prices">
              <button
                type="button"
                class="plan-btn"
                :disabled="isOpeningCheckout"
                @click="choosePlan('premium', 'monthly')"
              >£15/month</button>
              <button
                type="button"
                class="plan-btn"
                :disabled="isOpeningCheckout"
                @click="choosePlan('premium', 'annual')"
              >£150/year</button>
            </div>
          </section>

          <section v-if="showFamily" class="plan">
            <h3 class="plan-name">SSi Family</h3>
            <p class="plan-desc">
              Everything in Premium, for up to {{ FAMILY_SEAT_CAP }} accounts including yours.
              Everyone keeps their own progress.
            </p>
            <div class="plan-prices">
              <button
                v-if="familyMonthly"
                type="button"
                class="plan-btn"
                :disabled="isOpeningCheckout"
                @click="choosePlan('family', 'monthly')"
              >£25/month</button>
              <button
                v-if="familyAnnual"
                type="button"
                class="plan-btn"
                :disabled="isOpeningCheckout"
                @click="choosePlan('family', 'annual')"
              >£250/year</button>
            </div>
          </section>

          <p class="plans-note">Cancel anytime.</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.plans-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000; /* same layer as the checkout overlay it hands off to */
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
  box-sizing: border-box;
}

.plans-card {
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

.plans-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle, #e2e8f0);
}
.plans-title {
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
  color: var(--text-primary, #1e293b);
}
.plans-close {
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
.plans-close:hover { background: var(--border-subtle, #e2e8f0); }

.plans-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 1rem;
}

.plan + .plan { margin-top: 1rem; }
.plan {
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 0.9rem;
  padding: 1rem;
}
.plan-name {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}
.plan-desc {
  margin: 0 0 0.85rem;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--text-secondary, #64748b);
}
.plan-prices {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.plan-btn {
  flex: 1 1 auto;
  min-width: 8rem;
  min-height: 2.75rem;
  padding: 0.7rem 1rem;
  border: none;
  border-radius: 0.75rem;
  background: var(--accent, #c23a3a);
  color: #fff;
  font-family: var(--font-body);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
}
.plan-btn:hover { filter: brightness(1.08); }
.plan-btn:disabled { opacity: 0.65; cursor: progress; }

.plans-note {
  margin: 0.9rem 0 0;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-muted, #94a3b8);
}
</style>
