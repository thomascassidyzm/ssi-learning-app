<script setup lang="ts">
/**
 * PurchasePendingOverlay — what a person sees between paying and their plan
 * switching on.
 *
 * Mounted ONCE in App.vue, Teleported to <body>, driven entirely by
 * usePendingPurchase's module-level state — which is itself driven off a
 * localStorage record, so a reload lands back here rather than on the
 * not-subscribed screen.
 *
 * WHY IT COVERS THE WHOLE SCREEN. Tom paid £25 for SSi Family and the app went
 * on offering him the Upgrade row for several minutes. The single most
 * expensive inversion in the product is showing somebody the thing they have
 * just bought, for sale. This surface sits above everything until the
 * subscription is real, so that state cannot be reached; useCheckout shuts the
 * buy path underneath it as well, so neither half depends on the other.
 *
 * THREE THINGS IT WILL NOT DO: it will not spin without end, it will not show a
 * bare error, and it will not claim anything it cannot prove. The wording moves
 * from "a few seconds" to "longer than usual" to "email us, quoting this
 * reference" as the wait grows, and the payment reference is on screen from the
 * first moment we have it.
 */
import { computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from '../composables/useI18n'
import { usePendingPurchase } from '../composables/usePendingPurchase'

const { t } = useI18n()
const { pending, showOverlay, phase, checking, checkAgain, land, dismiss } = usePendingPurchase()

/** The product's own name. A brand mark, so it is not translated. */
const planLabel = computed(() => (pending.value?.plan === 'family' ? 'SSi Family' : 'SSi Premium'))

const supportEmail = 'admin@saysomethingin.com'
const supportHref = computed(() => {
  const ref = pending.value?.transactionId
  const subject = encodeURIComponent(ref ? `Subscription not switched on — ${ref}` : 'Subscription not switched on')
  return `mailto:${supportEmail}?subject=${subject}`
})

/**
 * LAND THEM, DON'T STRAND THEM. The moment the plan is real the buyer goes to
 * the thing they bought — for Family, the screen where they add their family.
 * A short beat first so the confirmation is actually read; the button below it
 * does the same thing at once for anybody who does not want to wait.
 */
let landTimer: ReturnType<typeof setTimeout> | null = null
watch(phase, (value) => {
  if (value !== 'arrived') return
  if (landTimer) clearTimeout(landTimer)
  landTimer = setTimeout(() => { landTimer = null; land() }, 2500)
})
onBeforeUnmount(() => { if (landTimer) clearTimeout(landTimer) })

function landNow(): void {
  if (landTimer) { clearTimeout(landTimer); landTimer = null }
  land()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="showOverlay" class="purchase-pending" role="dialog" aria-modal="true" aria-live="polite">
      <div class="pending-card">

        <!-- ARRIVED. The plan is live; say so, then land them in it. -->
        <template v-if="phase === 'arrived'">
          <div class="pending-mark pending-mark--done" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2 class="pending-title">{{ t('purchasePending.arrivedTitle') }}</h2>
          <p class="pending-plan">{{ planLabel }}</p>
          <p class="pending-body">
            {{ pending?.plan === 'family' ? t('purchasePending.arrivedFamilyBody') : t('purchasePending.arrivedPremiumBody') }}
          </p>
          <button type="button" class="pending-btn pending-btn--primary" @click="landNow">
            {{ pending?.plan === 'family' ? t('purchasePending.addYourFamily') : t('purchasePending.startLearning') }}
          </button>
        </template>

        <!-- WAITING. Confirmed, switching on, and honest about how it is going. -->
        <template v-else>
          <div class="pending-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2 class="pending-title">
            {{ phase === 'stalled' ? t('purchasePending.stalledTitle')
             : phase === 'slow' ? t('purchasePending.slowTitle')
             : t('purchasePending.confirmingTitle') }}
          </h2>
          <p class="pending-plan">{{ planLabel }}</p>
          <p class="pending-body">
            {{ phase === 'stalled' ? t('purchasePending.stalledBody')
             : phase === 'slow' ? t('purchasePending.slowBody')
             : t('purchasePending.confirmingBody') }}
          </p>

          <!-- The sense of progress is REAL: the bar runs while a check is in
               flight and rests between checks, so it shows work happening
               rather than decorating a wait. -->
          <div v-if="phase !== 'stalled'" class="pending-track" :class="{ 'is-checking': checking }">
            <div class="pending-bar"></div>
          </div>
          <p v-if="phase !== 'stalled'" class="pending-note">
            {{ checking ? t('purchasePending.checking') : t('purchasePending.willAppear') }}
          </p>

          <!-- The payment reference, from the first moment we have it. It is
               the one fact that makes a support message answerable. -->
          <p v-if="pending?.transactionId" class="pending-ref">
            <span class="pending-ref-label">{{ t('purchasePending.reference') }}</span>
            <span class="pending-ref-value">{{ pending.transactionId }}</span>
          </p>

          <div class="pending-actions">
            <button
              v-if="phase === 'stalled'"
              type="button"
              class="pending-btn pending-btn--primary"
              :disabled="checking"
              @click="checkAgain"
            >{{ checking ? t('purchasePending.checking') : t('purchasePending.checkAgain') }}</button>
            <a
              v-if="phase !== 'confirming'"
              class="pending-btn pending-btn--link"
              :href="supportHref"
            >{{ t('purchasePending.emailUs') }}</a>
            <button
              v-if="phase !== 'confirming'"
              type="button"
              class="pending-btn pending-btn--quiet"
              @click="dismiss"
            >{{ t('purchasePending.carryOn') }}</button>
          </div>
        </template>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.purchase-pending {
  position: fixed;
  inset: 0;
  /* Above the checkout overlay (9000) — this replaces it the moment the money
     is taken, and nothing may sit on top of the state that says so. */
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px);
  /* Never under the notch or the home indicator. */
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
  box-sizing: border-box;
}

.pending-card {
  width: 100%;
  max-width: 26rem;
  max-height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
  padding: 2rem 1.5rem 1.5rem;
  text-align: center;
  background: var(--bg-elevated, #ffffff);
  border-radius: 1.25rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}

.pending-mark {
  width: 3rem;
  height: 3rem;
  margin: 0 auto 1rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-subtle, #f1f5f9);
  color: var(--text-secondary, #64748b);
}
.pending-mark--done {
  background: var(--accent-soft, #dcfce7);
  color: var(--accent-strong, #15803d);
}
.pending-mark svg { width: 1.5rem; height: 1.5rem; }

.pending-title {
  margin: 0 0 0.25rem;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}
.pending-plan {
  margin: 0 0 0.75rem;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary, #64748b);
}
.pending-body {
  margin: 0 0 1.25rem;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--text-secondary, #475569);
}

.pending-track {
  height: 0.25rem;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bg-subtle, #f1f5f9);
}
.pending-bar {
  height: 100%;
  width: 40%;
  border-radius: 999px;
  background: var(--accent-strong, #15803d);
  opacity: 0.35;
  transform: translateX(-40%);
}
.pending-track.is-checking .pending-bar {
  opacity: 1;
  animation: pending-sweep 1.1s ease-in-out infinite;
}
@keyframes pending-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .pending-track.is-checking .pending-bar { animation: none; transform: translateX(0); width: 100%; }
}

.pending-note {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: var(--text-tertiary, #94a3b8);
}

.pending-ref {
  margin: 1rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.75rem;
}
.pending-ref-label { color: var(--text-tertiary, #94a3b8); }
.pending-ref-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
  color: var(--text-secondary, #64748b);
}

.pending-actions {
  margin-top: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pending-btn {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 0.8rem 1rem;
  border: none;
  border-radius: 0.75rem;
  font-size: 0.95rem;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}
.pending-btn--primary {
  margin-top: 1.25rem;
  background: var(--accent-strong, #15803d);
  color: #ffffff;
}
.pending-btn--primary:disabled { opacity: 0.6; cursor: default; }
.pending-btn--link {
  background: var(--bg-subtle, #f1f5f9);
  color: var(--text-primary, #1e293b);
}
.pending-btn--quiet {
  background: transparent;
  color: var(--text-tertiary, #94a3b8);
  font-weight: 500;
}
.pending-actions .pending-btn--primary { margin-top: 0; }
</style>
