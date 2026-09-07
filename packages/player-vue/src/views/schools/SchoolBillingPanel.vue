<script setup lang="ts">
/**
 * SchoolBillingPanel — the schools Settings "Billing" tab, extracted for ONE
 * reason: seat purchase must be ABSENT from a store build, not hidden inside
 * it. A `v-if` on the build constant stops it rendering but still ships its
 * markup, which was measured in the bundle rather than assumed.
 *
 * Pure presentation. SettingsView keeps the billing logic and imports this
 * only on the web rail (platform/paymentRoute).
 */
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

defineProps<{
  planLine: string
  PRICE_PER_SEAT_GBP: number
  isSubscribed: boolean
  isOpeningPortal: boolean
  portalError: string
}>()

const emit = defineEmits<{ (e: 'open-portal'): void }>()
</script>

<template>
  <section class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">{{ t('schools.billing.title', 'Billing') }}</h2>
          <!-- HANDBOOK See what your school pays
               section: your-school
               roles: school_admin
               place: settings
               keywords: billing, plan, pay, cost, price, seats, invoice, invoices, subscription, card, cancel
               What it's for. The plain statement of your school's plan — its name,
               how many teacher seats it is paying for, and whether the subscription
               is live.
               Where it is. Settings, then Billing.
               How you do it.
               1. Open Settings and choose Billing.
               2. Read the current plan line: your school, its seat count, and active
                  if the subscription is running.
               3. Tap **Manage subscription & seats** to change how many seats you
                  pay for.
               4. Tap **Billing & invoices** to reach invoices, change the card, or
                  cancel.
               Worth knowing. Every payment change happens on the one Upgrade page,
               so there is a single place to go and no second checkout to get
               confused with. The invoices button appears once a subscription is
               running.
               checked: 565562e0.6d43376c
          -->
          <div class="plan-card" data-walk="settings-billing-plan">
            <div class="schools-kicker plan-kicker">{{ t('schools.billing.currentPlan', 'Current plan') }}</div>
            <div class="arsenal plan-title">{{ planLine }}</div>
            <div class="plan-meta">{{ t('schools.billing.pricePerSeat', '£{price} per teacher seat / month.').replace('{price}', String(PRICE_PER_SEAT_GBP)) }}</div>
          </div>

          <!-- Subscription + seats are managed on the canonical Upgrade page so
               there's a single payment surface (no duplicated checkout logic). -->
          <div class="panel-actions">
            <router-link to="/schools/upgrade" class="btn-play">
              {{ isSubscribed ? t('schools.billing.manageSubscription', 'Manage subscription & seats →') : t('schools.billing.subscribeChooseSeats', 'Subscribe / choose seats →') }}
            </router-link>
            <!-- Paddle portal: invoices, card updates, cancellation. -->
            <button
              v-if="isSubscribed"
              type="button"
              class="btn-ghost"
              :disabled="isOpeningPortal"
              @click="emit('open-portal')"
            >
              {{ isOpeningPortal ? t('schools.billing.opening', 'Opening…') : t('schools.billing.billingAndInvoices', 'Billing & invoices') }}
            </button>
          </div>
          <p v-if="portalError" class="portal-error" role="alert">{{ portalError }}</p>
        </section>
</template>

<style scoped>
/* Copied verbatim from SettingsView.vue — scoped styles cannot reach into a
   child component, so the panel carries the rules it was lifted with. */
.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
}

.panel-title {
  font-size: 22px;
  margin: 0;
}

.plan-card {
  padding: 14px;
  background: #fdf6df;
  border: 1px solid #f0d97a;
  border-radius: 8px;
}

.plan-kicker {
  color: #7a5418;
}

.plan-title {
  font-size: 24px;
  margin-top: 4px;
  color: #4a3308;
}

.plan-meta {
  font-size: 12.5px;
  color: #5a3e10;
  margin-top: 4px;
}

.panel-actions {
  display: flex;
  gap: 8px;
  padding-top: 6px;
}

.portal-error {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--ssi-red, #c23a3a);
}
</style>
