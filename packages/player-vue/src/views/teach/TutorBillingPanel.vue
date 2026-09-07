<script setup lang="ts">
/**
 * TutorBillingPanel — the tutor's "Teacher plan" card, extracted for ONE reason:
 * a seat purchase must be ABSENT from a store build, not hidden inside it.
 *
 * A `v-if` on the build constant stops the panel rendering but still ships its
 * markup — measured in the bundle, not assumed. Living in its own file lets
 * TeachDashboard import it only on the web rail (platform/paymentRoute), so a
 * webview build has no purchase markup to reach at all.
 *
 * Pure presentation: every value is a prop, every action an emit. The billing
 * logic stays in TeachDashboard, which is the only thing that knows Paddle.
 */
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

defineProps<{
  hasSubscription: boolean
  teacher: { id?: string | null; platform_status?: string | null } | null
  subscriptionStatus: string | null
  nextChargeDate: string | null
  checkoutError: string
  isStartingTrial: boolean
  isOpeningPortal: boolean
  TEACHER_MONTHLY_PRICE: number
  COMMISSION_PER_STUDENT: number
  MAX_CLASSES: number
  MAX_STUDENTS_PER_CLASS: number
}>()

const emit = defineEmits<{
  (e: 'start-trial'): void
  (e: 'open-portal'): void
}>()
</script>

<template>
  <FrostCard variant="panel" class="section-panel">
    <div class="section-head">
      <span class="frost-section-title">{{ t('teach.billing.title', 'Teacher plan') }}</span>
      <p v-if="!hasSubscription" class="section-sub">
        {{ t('teach.billing.trialBlurb', "You're on your 1 month free trial. Then it's £{price}/month — your dashboard pauses if the trial lapses. Cancel anytime.").replace('{price}', String(TEACHER_MONTHLY_PRICE)) }}
      </p>
      <p v-else class="section-sub">
        {{ t('teach.billing.activeBlurb', '£{price}/month — up to {classes} classes, unlimited students per class up to {students} each.').replace('{price}', String(TEACHER_MONTHLY_PRICE)).replace('{classes}', String(MAX_CLASSES)).replace('{students}', String(MAX_STUDENTS_PER_CLASS)) }}
      </p>
    </div>

    <div v-if="checkoutError" class="error">{{ checkoutError }}</div>

    <div v-if="!hasSubscription" class="subscription-cta">
      <div class="price-block">
        <span class="price-amount frost-mono-nums">£{{ TEACHER_MONTHLY_PRICE }}</span>
        <span class="price-period">{{ t('teach.billing.perMonth', '/ month') }}</span>
      </div>
      <p class="sub-blurb">
        {{ t('teach.billing.commissionBlurb', 'You earn £{commission} per student — three paying students cover your £{price} subscription. Every student after that is profit.').replace('{commission}', String(COMMISSION_PER_STUDENT)).replace('{price}', String(TEACHER_MONTHLY_PRICE)) }}
      </p>
      <Button variant="primary" :loading="isStartingTrial" :disabled="!teacher?.id" @click="emit('start-trial')">
        {{ t('teach.billing.subscribeButton', 'Subscribe — £{price}/month').replace('{price}', String(TEACHER_MONTHLY_PRICE)) }}
      </Button>
    </div>

    <!-- Payment trouble first (platform column is authoritative; the generic
         row is a fallback), then cancelled, then a catch-all Active/manage
         row — a paying tutor must ALWAYS have a manage control here. -->
    <div
      v-else-if="teacher?.platform_status === 'past_due' || subscriptionStatus === 'past_due'"
      class="sub-status-row past-due"
    >
      <div>
        <p class="sub-status-label">{{ t('teach.billing.paymentFailed', 'Payment failed') }}</p>
        <p class="sub-status-sub">{{ t('teach.billing.paymentFailedBlurb', 'Your card was declined. Please update your payment method.') }}</p>
      </div>
      <Button variant="primary" :loading="isOpeningPortal" @click="emit('open-portal')">
        {{ t('teach.billing.updatePaymentMethod', 'Update payment method') }}
      </Button>
    </div>

    <div v-else-if="subscriptionStatus === 'cancelled'" class="sub-status-row">
      <div>
        <p class="sub-status-label">{{ t('teach.billing.cancelled', 'Cancelled') }}</p>
        <p v-if="nextChargeDate" class="sub-status-sub">
          {{ t('teach.billing.accessContinuesUntil', 'Access continues until') }} <strong>{{ nextChargeDate }}</strong>.
        </p>
      </div>
      <Button variant="ghost" :loading="isOpeningPortal" @click="emit('open-portal')">
        {{ t('teach.billing.manageSubscription', 'Manage subscription') }}
      </Button>
    </div>

    <div v-else class="sub-status-row">
      <div>
        <p class="sub-status-label">{{ t('teach.billing.active', 'Active') }}</p>
        <p v-if="nextChargeDate" class="sub-status-sub">
          {{ t('teach.billing.nextCharge', 'Next charge:') }} <strong>{{ nextChargeDate }}</strong>
        </p>
      </div>
      <Button variant="ghost" :loading="isOpeningPortal" @click="emit('open-portal')">
        {{ t('teach.billing.manageSubscription', 'Manage subscription') }}
      </Button>
    </div>
  </FrostCard>
</template>

<style scoped>
/* Copied verbatim from TeachDashboard.vue, whose scoped styles cannot reach
   into a child component. Same selectors, same values — the card looks
   identical to the one it was lifted out of. */
.section-panel {
  padding: var(--space-6) var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.section-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.section-head .frost-section-title {
  font-size: var(--text-lg);
  margin: 0;
}

.section-sub {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.subscription-cta {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  align-items: flex-start;
}

.price-block {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.price-amount {
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  color: var(--ssi-red);
  line-height: 1;
}

.price-period {
  color: var(--ink-muted);
  font-size: var(--text-base);
}

.sub-blurb {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;
  max-width: 520px;
}

.sub-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(44, 38, 34, 0.06);
  border-radius: var(--radius-lg);
}

.sub-status-row.past-due {
  background: rgba(var(--tone-red), 0.06);
  border-color: rgba(var(--tone-red), 0.22);
}

.sub-status-label {
  margin: 0 0 var(--space-1);
  font-size: var(--text-base);
  font-weight: var(--font-bold);
  color: var(--ink-primary);
}

.sub-status-row.past-due .sub-status-label {
  color: var(--ssi-red);
}

.sub-status-sub {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-muted);
}

.error {
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.22);
  border-radius: var(--radius-lg);
  color: var(--ssi-red);
  font-size: var(--text-sm);
}
</style>
