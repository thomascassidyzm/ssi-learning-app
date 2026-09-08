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
 * THREE STEPS, one overlay: choose a plan, create your account, type the code.
 * A signed-out buyer who has chosen a plan stays right here rather than being
 * handed to the sign-in modal.
 *
 * VERIFY, THEN PAY (Tom's ruling, 2026-09-07). For a few hours this step
 * created the account outright from a typed address and an optional password.
 * That was a confirmed account takeover — anyone could type a stranger's
 * address, plant a password and hold a session for it (job #345). His ruling:
 * ask for the account first, SAY WHY, and hand them straight back to the
 * payment page they clicked once the code checks out. The plan they chose is
 * written to storage before the round-trip so it survives reading an email on
 * a phone; see src/checkout/pendingIntent.ts.
 *
 * Same overlay shell as CheckoutOverlay (safe-area padding, close button,
 * Escape, backdrop tap) so the steps feel like one flow.
 */
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useCheckout } from '@/composables/useCheckout'
import { useI18n } from '@/composables/useI18n'
import { paddleConfig } from '@/lib/paddle'
import { paddleBillingAvailable } from '@/platform/paymentRoute'
import { FAMILY_SEAT_CAP } from '@/constants/family'

const {
  plansOpen,
  closePlans,
  choosePlan,
  isOpeningCheckout,
  detailsOpen,
  detailsBusy,
  detailsError,
  detailsStep,
  detailsEmail,
  sendBuyerCode,
  verifyBuyerCode,
  resendBuyerCode,
  editBuyerEmail,
  signInInstead,
  closeDetails,
  openPlans,
  alreadySubscribedOpen,
  closeAlreadySubscribed,
  childAccountOpen,
  closeChildAccount,
  openSubscriptionPortal,
} = useCheckout()
const { t } = useI18n()

// ── The account step ──
const email = ref('')
const emailConfirm = ref('')
const code = ref('')
// Local, form-level complaint (mismatches). Server-side problems come back on
// detailsError so the two never fight over the same line.
const formError = ref('')

// Reset every time the step opens, so a second run of the flow never starts
// half-filled with the first one's typing.
watch(detailsOpen, (open) => {
  if (!open) return
  email.value = ''
  emailConfirm.value = ''
  code.value = ''
  formError.value = ''
})

// Coming back to the address step to fix a typo keeps the address, and drops
// the code that was typed against the old one.
watch(detailsStep, (step) => {
  formError.value = ''
  if (step === 'email') code.value = ''
})

const emailLooksValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))

const canSubmitDetails = computed(() => {
  if (detailsBusy.value) return false
  if (detailsStep.value === 'code') return code.value.trim().length >= 6
  if (!emailLooksValid.value) return false
  return email.value.trim().toLowerCase() === emailConfirm.value.trim().toLowerCase()
})

async function onDetailsSubmit() {
  formError.value = ''
  if (detailsStep.value === 'code') {
    await verifyBuyerCode({ code: code.value })
    return
  }
  if (email.value.trim().toLowerCase() !== emailConfirm.value.trim().toLowerCase()) {
    formError.value = t('plans.emailsMustMatch')
    return
  }
  await sendBuyerCode({ email: email.value.trim() })
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

// t()'s second argument is a FALLBACK STRING, not interpolation params — so a
// slot has to be filled here, the same way familyDesc fills {seats}. Passing
// `{ email }` to t() reads like it works and silently renders the literal
// "{email}" at somebody mid-purchase.
const codeSentLine = computed(() =>
  t('plans.codeSentTo').replace('{email}', detailsEmail.value),
)

// One overlay, two steps — so the Escape/scroll-lock wiring keys off "either
// step is open" rather than off the plans list alone.
const anyStepOpen = computed(() => plansOpen.value || detailsOpen.value || alreadySubscribedOpen.value || childAccountOpen.value)

// The manage-subscription route offered alongside the block, so an existing
// subscriber is told something true AND has somewhere to go. Hidden in a store
// shell, where Paddle's hosted portal is not theirs to open.
const canManageBilling = computed(() => paddleBillingAvailable())
const portalBusy = ref(false)
async function onManageSubscription() {
  portalBusy.value = true
  try {
    await openSubscriptionPortal()
  } finally {
    portalBusy.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (childAccountOpen.value) closeChildAccount()
  else if (alreadySubscribedOpen.value) closeAlreadySubscribed()
  else if (detailsOpen.value) closeDetails()
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

    <!-- STEP 2 — the account. It SAYS WHY it is asking, because being sent to
         your mailbox without a reason is the bit that feels like a wall. -->
    <div
      v-if="detailsOpen"
      class="plans-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="t('plans.createAccount')"
      @click.self="closeDetails"
    >
      <div class="plans-card" @click.stop>
        <header class="plans-bar">
          <span class="plans-title">
            {{ detailsStep === 'code' ? t('plans.checkYourEmail') : t('plans.createAccount') }}
          </span>
          <button type="button" class="plans-close" :aria-label="t('plans.close')" @click="closeDetails">✕</button>
        </header>

        <form class="plans-scroll" @submit.prevent="onDetailsSubmit">
          <!-- ── Face one: the address ── -->
          <template v-if="detailsStep === 'email'">
            <p class="plans-why">{{ t('plans.whyAccountFirst') }}</p>

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

            <label class="field">
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

            <p v-if="formError || detailsError" class="field-error">{{ formError || detailsError }}</p>

            <button type="submit" class="plan-btn submit-btn" :disabled="!canSubmitDetails">
              {{ detailsBusy ? t('plans.sending') : t('plans.emailMyCode') }}
            </button>

            <!-- The door for somebody who already has an account. On screen for
                 everybody, in the same words, so it cannot be read as an answer
                 about the address they typed. -->
            <button type="button" class="text-btn" @click="signInInstead">{{ t('plans.alreadyHaveAccount') }}</button>
            <button type="button" class="text-btn" @click="backToPlans">{{ t('plans.backToPlans') }}</button>
          </template>

          <!-- ── Face two: the code. Nothing here mentions whether the address
               already had an account: both cases look and behave the same, so
               the form cannot be used to ask who banks with us. ── -->
          <template v-else>
            <p class="plans-why">{{ codeSentLine }}</p>

            <label class="field">
              <span class="field-label">{{ t('plans.yourCode') }}</span>
              <input
                v-model="code"
                type="text"
                class="field-input"
                autocomplete="one-time-code"
                inputmode="numeric"
                maxlength="8"
                required
              />
            </label>

            <p v-if="formError || detailsError" class="field-error">{{ formError || detailsError }}</p>

            <button type="submit" class="plan-btn submit-btn" :disabled="!canSubmitDetails">
              {{ detailsBusy ? t('plans.checking') : t('plans.verifyAndPay') }}
            </button>

            <p class="plans-note">{{ t('plans.planIsHeld') }}</p>

            <button type="button" class="text-btn" :disabled="detailsBusy" @click="resendBuyerCode">
              {{ t('plans.sendAnotherCode') }}
            </button>
            <button type="button" class="text-btn" @click="editBuyerEmail">{{ t('plans.useADifferentEmail') }}</button>
          </template>
        </form>
      </div>
    </div>

    <!-- STEP 3 — ALREADY SUBSCRIBED (#255). Not a step forward: a stop. This
         person is already paying, so opening a second Paddle subscription
         would charge them twice and give them nothing. Say that plainly, and
         leave the manage-subscription route open so it is not a dead end. -->
    <div
      v-if="alreadySubscribedOpen"
      class="plans-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="t('plans.alreadySubscribedTitle')"
      @click.self="closeAlreadySubscribed"
    >
      <div class="plans-card" @click.stop>
        <header class="plans-bar">
          <span class="plans-title">{{ t('plans.alreadySubscribedTitle') }}</span>
          <button
            type="button"
            class="plans-close"
            :aria-label="t('plans.close')"
            @click="closeAlreadySubscribed"
          >✕</button>
        </header>

        <div class="plans-scroll">
          <p class="plan-desc">{{ t('plans.alreadySubscribedBody') }}</p>
          <p class="plan-desc">{{ t('plans.alreadySubscribedChangeComing') }}</p>

          <button
            v-if="canManageBilling"
            type="button"
            class="plan-btn"
            :disabled="portalBusy"
            @click="onManageSubscription"
          >{{ portalBusy ? t('plans.opening') : t('plans.manageSubscription') }}</button>

          <button type="button" class="text-btn" @click="closeAlreadySubscribed">{{ t('plans.close') }}</button>
        </div>
      </div>
    </div>

    <!-- A child account is never offered a checkout (job #376·F, D7). They have
         no email of their own and no way to pay; the plan is their grown-up's
         to buy. One sentence, and a way out. -->
    <div
      v-if="childAccountOpen"
      class="plans-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="t('plans.childAccountTitle')"
      @click.self="closeChildAccount"
    >
      <div class="plans-card" @click.stop>
        <header class="plans-bar">
          <span class="plans-title">{{ t('plans.childAccountTitle') }}</span>
          <button
            type="button"
            class="plans-close"
            :aria-label="t('plans.close')"
            @click="closeChildAccount"
          >✕</button>
        </header>

        <div class="plans-scroll">
          <p class="plan-desc">{{ t('plans.childAccountBody') }}</p>
          <button type="button" class="text-btn" @click="closeChildAccount">{{ t('plans.close') }}</button>
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
/* The line that says WHY we are asking for an account before a card. It reads
   before the first field rather than under the button, because a reason given
   after the ask is an excuse. */
.plans-why {
  margin: 0 0 1rem;
  font-size: 0.9375rem;
  line-height: 1.45;
  color: var(--text-secondary, #64748b);
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
