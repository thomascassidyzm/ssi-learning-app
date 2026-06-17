<script setup lang="ts">
/**
 * UpgradeView — the ONE canonical payment page (lever-3).
 *
 * Context-aware, serves both lanes off a single surface:
 *   • school_admin → £15 per TEACHER seat / month, seat stepper, Paddle quantity.
 *     If already subscribed, the stepper edits seats in-place (PATCH, no
 *     double-bill); otherwise it opens the INITIAL per-seat checkout.
 *   • solo tutor   → a single £15/month seat (no picker; students pay separately).
 *
 * Reachable two ways, both rendering this same component:
 *   1. As a route (/schools/upgrade, /teach/upgrade) — the always-visible
 *      "Upgrade" button during an active trial.
 *   2. Embedded in the containers' trial-expired wall — so a locked-out teacher
 *      can pay IN-APP instead of hitting a mailto dead-end.
 */
import { ref, computed, inject, onMounted, type Ref } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolCheckout } from '@/composables/useSchoolCheckout'
import { getPaddle, paddleConfig } from '@/lib/paddle'

const supabase = inject<Ref<any>>('supabase', ref(null))
const { currentUser, isSchoolAdmin } = useSchoolContext()

const PRICE_PER_SEAT_GBP = 15

// A user administering a school buys seats; everyone else (solo tutor) buys one.
const isSchoolLane = computed(
  () => isSchoolAdmin.value || !!currentUser.value?.school_id,
)

const schoolId = computed<string | null>(() => currentUser.value?.school_id ?? null)

// ── Seat state (school lane) ───────────────────────────────────────
const seatCount = ref(1)
const monthlyTotalGbp = computed(() => Math.max(1, seatCount.value) * PRICE_PER_SEAT_GBP)
function setSeats(n: number) {
  seatCount.value = Math.max(1, Math.floor(n) || 1)
}

// ── Subscription state (read from server so we never fire a SECOND
//    initial checkout on an already-subscribed school = double-bill) ──
const platformStatus = ref<string | null>(null)
const paidSeats = ref<number | null>(null)
const isSubscribed = computed(() => platformStatus.value === 'active')
const isUpdatingSeats = ref(false)
const seatsMessage = ref('')

const { isOpeningCheckout, checkoutError, startSchoolCheckout } = useSchoolCheckout()

async function authHeaders(): Promise<Record<string, string> | null> {
  if (!supabase.value) return null
  const { data: { session } } = await supabase.value.auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

async function loadSubscription() {
  const headers = await authHeaders()
  if (!headers) return
  try {
    const res = await fetch('/api/school/subscription', { headers })
    if (!res.ok) return
    const data = await res.json()
    platformStatus.value = data?.school?.platform_status ?? null
    const seats = data?.school?.teacher_seats
    if (typeof seats === 'number' && seats > 0) {
      paidSeats.value = seats
      if (isSubscribed.value) seatCount.value = seats
    }
  } catch {
    // Non-fatal — page just stays in its default (Subscribe) state.
  }
}

async function subscribeSchool() {
  if (!schoolId.value) return
  await startSchoolCheckout({ schoolId: schoolId.value, seats: seatCount.value })
}

async function updateSeats() {
  if (isUpdatingSeats.value) return
  isUpdatingSeats.value = true
  seatsMessage.value = ''
  try {
    const headers = await authHeaders()
    if (!headers) { seatsMessage.value = 'Sign in again to change seats'; return }
    const res = await fetch('/api/school/update-seats', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seats: seatCount.value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { seatsMessage.value = data?.error || 'Could not update seats'; return }
    paidSeats.value = data?.seats ?? seatCount.value
    seatsMessage.value = data?.unchanged ? 'No change' : `Updated to ${paidSeats.value} seats`
  } catch {
    seatsMessage.value = 'Could not update seats'
  } finally {
    isUpdatingSeats.value = false
  }
}

// ── Tutor lane (single seat) ───────────────────────────────────────
const tutorBusy = ref(false)
const tutorError = ref('')
async function subscribeTutor() {
  if (tutorBusy.value) return
  const priceId = paddleConfig.teacherMonthlyPriceId
  if (!priceId) { tutorError.value = 'Teacher plan price not configured'; return }
  if (!supabase.value) { tutorError.value = 'Sign in again to start checkout'; return }
  tutorBusy.value = true
  tutorError.value = ''
  try {
    const { data: { session } } = await supabase.value.auth.getSession()
    const email = session?.user?.email
    if (!email) { tutorError.value = 'Sign in again to start checkout'; return }
    // Resolve the tutor's teachers-row id (webhook keys the subscription on it).
    let teacherId: string | null = null
    if (currentUser.value?.learner_id) {
      const { data } = await supabase.value
        .from('teachers')
        .select('id')
        .eq('learner_id', currentUser.value.learner_id)
        .maybeSingle()
      teacherId = data?.id ?? null
    }
    const paddle = await getPaddle()
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: { email },
      customData: { teacher_id: teacherId, kind: 'premium' },
      settings: { successUrl: window.location.href },
    })
  } catch (err: any) {
    tutorError.value = err?.message || 'Failed to open checkout'
  } finally {
    tutorBusy.value = false
  }
}

onMounted(() => {
  if (isSchoolLane.value) loadSubscription()
})
</script>

<template>
  <div class="upgrade-page">
    <div class="upgrade-card schools-card">
      <span class="schools-kicker">SSi Premium</span>

      <!-- ── School lane: per-seat ── -->
      <template v-if="isSchoolLane">
        <h1 class="upgrade-title arsenal">
          {{ isSubscribed ? 'Manage your seats' : 'Subscribe your school' }}
        </h1>
        <p class="upgrade-lede">
          £{{ PRICE_PER_SEAT_GBP }} per teacher seat / month. One subscription
          covers every teacher seat — add or remove seats any time.
        </p>

        <div class="seat-row">
          <span class="field-label">Teacher seats</span>
          <div class="seat-stepper">
            <button type="button" class="seat-btn" :disabled="seatCount <= 1" @click="setSeats(seatCount - 1)">−</button>
            <input
              class="seat-input"
              type="number"
              min="1"
              :value="seatCount"
              @input="setSeats(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="seat-btn" @click="setSeats(seatCount + 1)">+</button>
          </div>
          <span class="seat-total">£{{ monthlyTotalGbp }}<span class="seat-per">/mo</span></span>
        </div>

        <p v-if="checkoutError" class="upgrade-error">{{ checkoutError }}</p>
        <p v-if="seatsMessage" class="upgrade-note">{{ seatsMessage }}</p>

        <!-- Subscribed → edit seats in place (PATCH). Else → initial checkout. -->
        <button
          v-if="isSubscribed"
          type="button"
          class="btn-play btn-play--block"
          :disabled="isUpdatingSeats || seatCount === paidSeats"
          @click="updateSeats"
        >
          {{ isUpdatingSeats ? 'Updating…' : seatCount === paidSeats ? `${seatCount} seats (current)` : `Update to ${seatCount} seats — £${monthlyTotalGbp}/mo` }}
        </button>
        <button
          v-else
          type="button"
          class="btn-play btn-play--block"
          :disabled="!schoolId || isOpeningCheckout"
          @click="subscribeSchool"
        >
          {{ isOpeningCheckout ? 'Opening…' : `Subscribe — £${monthlyTotalGbp}/mo` }}
        </button>
      </template>

      <!-- ── Tutor lane: single seat ── -->
      <template v-else>
        <h1 class="upgrade-title arsenal">Subscribe</h1>
        <p class="upgrade-lede">
          £{{ PRICE_PER_SEAT_GBP }} / month for your tutoring dashboard. Your
          students pay separately — two paying students cover your subscription.
        </p>
        <div class="seat-row seat-row--single">
          <span class="field-label">Your subscription</span>
          <span class="seat-total">£{{ PRICE_PER_SEAT_GBP }}<span class="seat-per">/mo</span></span>
        </div>
        <p v-if="tutorError" class="upgrade-error">{{ tutorError }}</p>
        <button
          type="button"
          class="btn-play btn-play--block"
          :disabled="tutorBusy"
          @click="subscribeTutor"
        >
          {{ tutorBusy ? 'Opening…' : `Subscribe — £${PRICE_PER_SEAT_GBP}/month` }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.upgrade-page {
  display: flex;
  justify-content: center;
  padding: 2rem 1.25rem;
}
.upgrade-card {
  width: 100%;
  max-width: 460px;
  padding: 1.75rem;
}
.upgrade-title {
  margin: 0.5rem 0 0.5rem;
  font-size: 1.6rem;
}
.upgrade-lede {
  margin: 0 0 1.25rem;
  color: var(--text-secondary, #64748b);
  line-height: 1.45;
}
.seat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--border-subtle, #e2e8f0);
  border-bottom: 1px solid var(--border-subtle, #e2e8f0);
  margin-bottom: 1.25rem;
}
.field-label { font-weight: 600; }
.seat-stepper { display: flex; align-items: center; gap: 0.5rem; }
.seat-btn {
  width: 2rem; height: 2rem; border-radius: 0.5rem;
  border: 1px solid var(--border-subtle, #cbd5e1);
  background: var(--bg-elevated, #fff); cursor: pointer; font-size: 1.1rem;
}
.seat-btn:disabled { opacity: 0.4; cursor: default; }
.seat-input {
  width: 3.5rem; text-align: center; padding: 0.35rem;
  border: 1px solid var(--border-subtle, #cbd5e1); border-radius: 0.5rem;
}
.seat-total { font-size: 1.25rem; font-weight: 700; }
.seat-per { font-size: 0.8rem; font-weight: 500; color: var(--text-secondary, #64748b); }
.btn-play--block { width: 100%; }
.upgrade-error { color: #dc2626; margin: 0 0 0.75rem; font-size: 0.85rem; }
.upgrade-note { color: var(--text-secondary, #64748b); margin: 0 0 0.75rem; font-size: 0.85rem; }
</style>
