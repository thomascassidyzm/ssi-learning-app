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
 * TWO STEPS, one overlay. A signed-out buyer who has chosen a plan gets the
 * DETAILS step here rather than the sign-in modal: email, confirm, an optional
 * password, and on to Paddle. Tom walked the old flow on 2026-09-07 and was
 * sent to his mailbox for a six-digit code before he was allowed to reach a
 * card field — "they shouldn't have to verify their email account yet - that's
 * messy". Verification is not a gate in front of a purchase; it happens after,
 * through the needs_verification nudge the account is stamped with.
 *
 * Same overlay shell as CheckoutOverlay (safe-area padding, close button,
 * Escape, backdrop tap) so the steps feel like one flow.
 */
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useCheckout } from '@/composables/useCheckout'
import { useI18n } from '@/composables/useI18n'
import { paddleConfig } from '@/lib/paddle'
import { FAMILY_SEAT_CAP } from '@/constants/family'

const {
  plansOpen,
  closePlans,
  choosePlan,
  isOpeningCheckout,
  detailsOpen,
  detailsBusy,
  detailsError,
  detailsExistingAccount,
  submitBuyerDetails,
  signInAndPay,
  emailMeACodeInstead,
  closeDetails,
  openPlans,
} = useCheckout()
const { t } = useI18n()

// ── The details step ──
const email = ref('')
const emailConfirm = ref('')
const wantsPassword = ref(false)
const password = ref('')
const passwordConfirm = ref('')
// Local, form-level complaint (mismatches). Server-side problems come back on
// detailsError so the two never fight over the same line.
const formError = ref('')

// Reset every time the step opens, so a second run of the flow never starts
// half-filled with the first one's typing.
watch(detailsOpen, (open) => {
  if (!open) return
  email.value = ''
  emailConfirm.value = ''
  wantsPassword.value = false
  password.value = ''
  passwordConfirm.value = ''
  formError.value = ''
})

const emailLooksValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))

const canSubmitDetails = computed(() => {
  if (detailsBusy.value) return false
  if (!emailLooksValid.value) return false
  if (detailsExistingAccount.value) return password.value.length > 0
  if (email.value.trim().toLowerCase() !== emailConfirm.value.trim().toLowerCase()) return false
  if (wantsPassword.value && (password.value.length < 6 || password.value !== passwordConfirm.value)) return false
  return true
})

async function onDetailsSubmit() {
  formError.value = ''
  // The already-registered branch: they are signing IN, so only the password
  // matters and the confirm fields are gone from the form.
  if (detailsExistingAccount.value) {
    await signInAndPay({ email: email.value.trim(), password: password.value })
    return
  }
  if (email.value.trim().toLowerCase() !== emailConfirm.value.trim().toLowerCase()) {
    formError.value = t('plans.emailsMustMatch')
    return
  }
  if (wantsPassword.value && password.value !== passwordConfirm.value) {
    formError.value = t('plans.passwordsMustMatch')
    return
  }
  await submitBuyerDetails({
    email: email.value.trim(),
    password: wantsPassword.value ? password.value : undefined,
  })
}

function backToPlans() {
  closeDetails()
  openPlans(null)
}

// Family only appears once its Paddle prices are configured — hidden, not a
// broken button, exactly as the Settings row already does it.
const familyMonthly = computed(() => !!paddleConfig.familyMonthlyPriceId)
const familyAnnual = computed(() => !!paddleConfig.familyAnnualPriceId)
const showFamily = computed(() => familyMonthly.value || familyAnnual.value)

// The seat cap is a number in code, not a word in a sentence — so the sentence
// is one translated string with a {seats} slot, the same idiom SettingsScreen
// already uses for `{date}`.
const familyDesc = computed(() =>
  t('plans.familyDesc').replace('{seats}', String(FAMILY_SEAT_CAP)),
)

// One overlay, two steps — so the Escape/scroll-lock wiring keys off "either
// step is open" rather than off the plans list alone.
const anyStepOpen = computed(() => plansOpen.value || detailsOpen.value)

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (detailsOpen.value) closeDetails()
  else closePlans()
}

watch(anyStepOpen, (open) => {
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
      :aria-label="t('plans.chooseAPlan')"
      @click.self="closePlans"
    >
      <div class="plans-card" @click.stop>
        <header class="plans-bar">
          <span class="plans-title">{{ t('plans.chooseAPlan') }}</span>
          <button type="button" class="plans-close" :aria-label="t('plans.close')" @click="closePlans">✕</button>
        </header>

        <div class="plans-scroll">
          <section class="plan">
            <h3 class="plan-name">{{ t('plans.premiumName') }}</h3>
            <p class="plan-desc">{{ t('plans.premiumDesc') }}</p>
            <div class="plan-prices">
              <button
                type="button"
                class="plan-btn"
                :disabled="isOpeningCheckout"
                @click="choosePlan('premium', 'monthly')"
              >{{ t('plans.premiumMonthly') }}</button>
              <button
                type="button"
                class="plan-btn"
                :disabled="isOpeningCheckout"
                @click="choosePlan('premium', 'annual')"
              >{{ t('plans.premiumAnnual') }}</button>
            </div>
          </section>

          <section v-if="showFamily" class="plan">
            <h3 class="plan-name">{{ t('plans.familyName') }}</h3>
            <p class="plan-desc">{{ familyDesc }}</p>
            <div class="plan-prices">
              <button
                v-if="familyMonthly"
                type="button"
                class="plan-btn"
                :disabled="isOpeningCheckout"
                @click="choosePlan('family', 'monthly')"
              >{{ t('plans.familyMonthly') }}</button>
              <button
                v-if="familyAnnual"
                type="button"
                class="plan-btn"
                :disabled="isOpeningCheckout"
                @click="choosePlan('family', 'annual')"
              >{{ t('plans.familyAnnual') }}</button>
            </div>
          </section>

          <p class="plans-note">{{ t('plans.cancelAnytime') }}</p>
        </div>
      </div>
    </div>

    <!-- STEP 2 — the buyer's details. No email round-trip stands between
         this form and the card field. -->
    <div
      v-if="detailsOpen"
      class="plans-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="t('plans.yourDetails')"
      @click.self="closeDetails"
    >
      <div class="plans-card" @click.stop>
        <header class="plans-bar">
          <span class="plans-title">{{ t('plans.yourDetails') }}</span>
          <button type="button" class="plans-close" :aria-label="t('plans.close')" @click="closeDetails">✕</button>
        </header>

        <form class="plans-scroll" @submit.prevent="onDetailsSubmit">
          <label class="field">
            <span class="field-label">{{ t('auth.email') }}</span>
            <input
              v-model="email"
              type="email"
              class="field-input"
              autocomplete="email"
              inputmode="email"
              required
            />
          </label>

          <!-- The confirm fields disappear once we know the account exists:
               at that point they are signing IN, not creating anything. -->
          <label v-if="!detailsExistingAccount" class="field">
            <span class="field-label">{{ t('plans.confirmEmail') }}</span>
            <input
              v-model="emailConfirm"
              type="email"
              class="field-input"
              autocomplete="email"
              inputmode="email"
              required
            />
          </label>

          <label v-if="!detailsExistingAccount" class="opt-row">
            <input v-model="wantsPassword" type="checkbox" />
            <span>{{ t('plans.setPasswordOptional') }}</span>
          </label>

          <label v-if="wantsPassword || detailsExistingAccount" class="field">
            <span class="field-label">{{ t('auth.password') }}</span>
            <input
              v-model="password"
              type="password"
              class="field-input"
              :autocomplete="detailsExistingAccount ? 'current-password' : 'new-password'"
            />
          </label>

          <label v-if="wantsPassword && !detailsExistingAccount" class="field">
            <span class="field-label">{{ t('plans.confirmPassword') }}</span>
            <input v-model="passwordConfirm" type="password" class="field-input" autocomplete="new-password" />
          </label>

          <p v-if="formError || detailsError" class="field-error">{{ formError || detailsError }}</p>

          <button type="submit" class="plan-btn submit-btn" :disabled="!canSubmitDetails">
            {{ detailsExistingAccount ? t('plans.signInAndContinue') : t('plans.continueToPayment') }}
          </button>

          <button
            v-if="detailsExistingAccount"
            type="button"
            class="text-btn"
            @click="emailMeACodeInstead"
          >{{ t('plans.emailMeACode') }}</button>

          <p v-if="!detailsExistingAccount" class="plans-note">{{ t('plans.receiptNote') }}</p>

          <button type="button" class="text-btn" @click="backToPlans">{{ t('plans.backToPlans') }}</button>
        </form>
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

.field {
  display: block;
  margin-bottom: 0.85rem;
}
.field-label {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
}
.field-input {
  width: 100%;
  min-height: 2.75rem;
  padding: 0.6rem 0.75rem;
  box-sizing: border-box;
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 0.7rem;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1e293b);
  font-family: var(--font-body);
  font-size: 1rem; /* 16px — anything smaller makes iOS Safari zoom on focus */
}
.opt-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
  font-size: 0.875rem;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
}
.field-error {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--accent, #c23a3a);
}
.submit-btn {
  width: 100%;
}
.text-btn {
  display: block;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.5rem;
  border: none;
  background: none;
  color: var(--text-secondary, #64748b);
  font-family: var(--font-body);
  font-size: 0.875rem;
  text-decoration: underline;
  cursor: pointer;
}

.plans-note {
  margin: 0.9rem 0 0;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-muted, #94a3b8);
}
</style>
