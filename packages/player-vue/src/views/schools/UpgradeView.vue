<script setup lang="ts">
/**
 * UpgradeView — the ONE canonical payment page (lever-3).
 *
 * Context-aware, serves both lanes off a single surface:
 *   • school_admin → £15 per TEACHER seat / month (or £150/seat/yr), seat
 *     stepper, Paddle quantity. If already subscribed, the stepper edits seats
 *     in-place (PATCH, no double-bill); otherwise it opens the INITIAL per-seat
 *     checkout.
 *   • solo tutor   → a single £15/month (or £150/yr) seat (no picker; students
 *     pay separately).
 *
 * Checkout sizing: both lanes use Paddle's INLINE checkout rendered into a sized
 * container on this page (`.paddle-inline-frame`) rather than the default
 * overlay. The overlay is Paddle-controlled and feels cramped/scrolly on
 * desktop; inline lets us give it a comfortable, non-scrolling width/height that
 * is still responsive on mobile. On success Paddle redirects the parent window
 * to the successUrl, so success handling is identical to the overlay.
 *
 * Billing period: a monthly/annual toggle (monthly default) drives the price id
 * and the displayed figures for BOTH lanes. Annual is only offered when its
 * Paddle price id is configured (see paddleConfig); otherwise the option is
 * disabled rather than opening a broken checkout. The "Update seats" path stays
 * monthly-oriented.
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
// Per-seat annual price. There is ONE annual Paddle price underneath (a school
// is just quantity>1 of it). This constant must match the configured Paddle
// annual price so the figure shown matches what gets charged.
// ⚠️ OPERATOR NOTE: the actual annual Paddle prices + the VITE_PADDLE_*_ANNUAL
// env vars must be configured for annual checkout to charge correctly; the UI
// disables the annual option (graceful) when the annual price id is missing.
const ANNUAL_PRICE_PER_SEAT_GBP = 150
// £150/yr vs 12×£15 = £180/yr → £30 saved per seat = exactly 2 months free.
const ANNUAL_MONTHS_FREE = (12 * PRICE_PER_SEAT_GBP - ANNUAL_PRICE_PER_SEAT_GBP) / PRICE_PER_SEAT_GBP

// Where Paddle's inline checkout iframe mounts (a sized container in the template).
const INLINE_FRAME_TARGET = 'paddle-inline-frame'

// ── Billing period (monthly default) ───────────────────────────────
type Billing = 'monthly' | 'annual'
const billing = ref<Billing>('monthly')
const isAnnual = computed(() => billing.value === 'annual')

// A user administering a school buys seats; everyone else (solo tutor) buys one.
const isSchoolLane = computed(
  () => isSchoolAdmin.value || !!currentUser.value?.school_id,
)

// Annual is only offered when the relevant Paddle price id is configured.
const annualAvailable = computed(() =>
  isSchoolLane.value
    ? !!paddleConfig.schoolTeacherAnnualPriceId
    : !!paddleConfig.teacherAnnualPriceId,
)
// The Paddle price id for the currently-selected lane + period (null if unset).
const activePriceId = computed<string | undefined>(() => {
  if (isSchoolLane.value) {
    return isAnnual.value
      ? paddleConfig.schoolTeacherAnnualPriceId
      : paddleConfig.schoolTeacherMonthlyPriceId
  }
  return isAnnual.value ? paddleConfig.teacherAnnualPriceId : paddleConfig.teacherMonthlyPriceId
})
const activeQuantity = computed(() => (isSchoolLane.value ? seats.value : 1))

function setBilling(b: Billing) {
  if (b === 'annual' && !annualAvailable.value) return
  if (billing.value === b) return
  billing.value = b
  // If the inline checkout is already open, swap the price in place rather than
  // forcing the user to cancel and restart. updateItems keeps the same checkout
  // session (and its entered details) and just re-prices it.
  if (checkoutOpen.value) void repriceOpenCheckout()
}

// Swap the open inline checkout to the now-selected period's price. Prefer
// Paddle's in-place updateItems; the singleton Paddle instance is the same one
// the checkout was opened on, so this targets the live session.
async function repriceOpenCheckout() {
  const priceId = activePriceId.value
  if (!priceId) return
  try {
    const paddle = await getPaddle()
    paddle.Checkout.updateItems([{ priceId, quantity: activeQuantity.value }])
  } catch {
    // Non-fatal — the displayed total still reflects the new period; the user
    // can cancel and reopen if Paddle didn't accept the in-place update.
  }
}

const schoolId = computed<string | null>(() => currentUser.value?.school_id ?? null)

// ── Seat state (school lane) ───────────────────────────────────────
const seatCount = ref(1)
const seats = computed(() => Math.max(1, seatCount.value))
const monthlyTotalGbp = computed(() => seats.value * PRICE_PER_SEAT_GBP)
const annualTotalGbp = computed(() => seats.value * ANNUAL_PRICE_PER_SEAT_GBP)
// The headline total for the currently-selected period (school lane).
const schoolTotalGbp = computed(() => (isAnnual.value ? annualTotalGbp.value : monthlyTotalGbp.value))
const periodSuffix = computed(() => (isAnnual.value ? '/yr' : '/mo'))
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

// True once an inline checkout has been mounted into the container, so the
// template can show the sized frame (and hide the now-redundant CTA).
const checkoutOpen = ref(false)

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
    const seatsResp = data?.school?.teacher_seats
    if (typeof seatsResp === 'number' && seatsResp > 0) {
      paidSeats.value = seatsResp
      if (isSubscribed.value) seatCount.value = seatsResp
    }
  } catch {
    // Non-fatal — page just stays in its default (Subscribe) state.
  }
}

async function subscribeSchool() {
  if (!schoolId.value) return
  checkoutOpen.value = true
  await startSchoolCheckout({
    schoolId: schoolId.value,
    seats: seatCount.value,
    billing: billing.value,
    frameTarget: INLINE_FRAME_TARGET,
  })
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
const tutorTotalGbp = computed(() => (isAnnual.value ? ANNUAL_PRICE_PER_SEAT_GBP : PRICE_PER_SEAT_GBP))

// Resolved tutor teachers-row id (the webhook keys the platform subscription on
// it). Resolved up-front so the Subscribe button can be blocked until it's known
// rather than firing a checkout with a null teacher_id.
const tutorTeacherId = ref<string | null>(null)
// Whether this tutor is already platform-active — drives the double-subscribe
// guard (route to portal instead of opening a SECOND checkout = double-bill).
const tutorPlatformActive = ref(false)
// True once loadTutorSubscription() has resolved. The CTA stays in a Loading
// state until then so a fast click can't open a SECOND checkout before we know
// the tutor is already active (the guard reads tutorPlatformActive, which is
// false during the async load).
const tutorSubLoaded = ref(false)

async function resolveTutorTeacherId(): Promise<string | null> {
  if (tutorTeacherId.value) return tutorTeacherId.value
  const headers = await authHeaders()
  if (headers) {
    // Prefer the canonical resolver the rest of the tutor surface uses.
    try {
      const res = await fetch('/api/teacher/me', { headers })
      if (res.ok) {
        const data = await res.json()
        if (data?.teacher?.id) {
          tutorTeacherId.value = data.teacher.id
          return tutorTeacherId.value
        }
      }
    } catch { /* fall through to the direct lookup */ }
  }
  // Fallback: direct teachers lookup by learner_id.
  if (supabase.value && currentUser.value?.learner_id) {
    try {
      const { data } = await supabase.value
        .from('teachers')
        .select('id')
        .eq('learner_id', currentUser.value.learner_id)
        .maybeSingle()
      tutorTeacherId.value = data?.id ?? null
    } catch { /* leave null — button stays blocked */ }
  }
  return tutorTeacherId.value
}

async function loadTutorSubscription(): Promise<void> {
  const headers = await authHeaders()
  if (!headers) return
  try {
    const res = await fetch('/api/school/subscription', { headers })
    if (res.ok) {
      const data = await res.json()
      tutorPlatformActive.value = data?.teacher?.platform_status === 'active'
    }
  } catch { /* non-fatal — default Subscribe state */ }
  finally { tutorSubLoaded.value = true }
}

async function openTutorPortal(): Promise<void> {
  const headers = await authHeaders()
  if (!headers) { tutorError.value = 'Sign in again to manage your subscription'; return }
  try {
    const res = await fetch('/api/teacher/portal', { headers })
    if (res.ok) {
      const data = await res.json()
      if (data?.portalUrl) { window.location.href = data.portalUrl; return }
    }
  } catch { /* fall through to error */ }
  tutorError.value = 'Could not open the billing portal — try again'
}

async function subscribeTutor() {
  if (tutorBusy.value) return
  // Double-subscribe guard: an already-active tutor goes to the portal, never a
  // second checkout. Re-fetch status first if the initial load hasn't resolved
  // yet (a fast click before loadTutorSubscription returns would otherwise see a
  // stale tutorPlatformActive=false and open a SECOND checkout = double-bill).
  if (!tutorSubLoaded.value) await loadTutorSubscription()
  if (tutorPlatformActive.value) { void openTutorPortal(); return }
  const priceId = isAnnual.value
    ? paddleConfig.teacherAnnualPriceId
    : paddleConfig.teacherMonthlyPriceId
  if (!priceId) {
    tutorError.value = isAnnual.value
      ? 'Annual plan not configured — choose monthly'
      : 'Teacher plan price not configured'
    return
  }
  if (!supabase.value) { tutorError.value = 'Sign in again to start checkout'; return }
  tutorBusy.value = true
  tutorError.value = ''
  try {
    const { data: { session } } = await supabase.value.auth.getSession()
    const email = session?.user?.email
    const userId = session?.user?.id
    if (!email) { tutorError.value = 'Sign in again to start checkout'; return }
    // Resolve the tutor's teachers-row id (webhook keys the subscription on it).
    const teacherId = await resolveTutorTeacherId()
    if (!teacherId) {
      tutorError.value = 'Still loading your tutor account — try again in a moment'
      return
    }
    checkoutOpen.value = true
    const paddle = await getPaddle()
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: { email },
      // Freelance tutor platform subscription (£15 bundles dashboard + learner
      // premium). The webhook re-derives price/tier from `kind`; supabase_user_id
      // is a resolution fallback if teacher_id ever fails to map.
      customData: {
        kind: 'tutor_platform',
        teacher_id: teacherId,
        supabase_user_id: userId,
        billing: billing.value,
      },
      settings: {
        // INLINE checkout into the sized container (no cramped overlay). On
        // success Paddle redirects the parent window to successUrl.
        displayMode: 'inline',
        frameTarget: INLINE_FRAME_TARGET,
        frameInitialHeight: 450,
        frameStyle: 'width:100%; min-width:312px; background-color:transparent; border:none;',
        successUrl: window.location.href,
      },
    })
  } catch (err: any) {
    tutorError.value = err?.message || 'Failed to open checkout'
    checkoutOpen.value = false
  } finally {
    tutorBusy.value = false
  }
}

onMounted(() => {
  if (isSchoolLane.value) {
    loadSubscription()
  } else {
    // Tutor lane: resolve the teacher id up-front (so the button can unblock)
    // and read platform status (so we can route an active tutor to the portal).
    void resolveTutorTeacherId()
    void loadTutorSubscription()
  }
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
          £{{ PRICE_PER_SEAT_GBP }} per teacher seat / month (or £{{ ANNUAL_PRICE_PER_SEAT_GBP }}/year).
          One subscription covers every teacher seat — add or remove seats any time.
        </p>

        <!-- Monthly / annual toggle. Stays usable WHILE the inline checkout is
             open (switching re-prices it in place); only hidden for the
             already-subscribed seat-edit path. -->
        <div v-if="!isSubscribed" class="billing-toggle" role="tablist" aria-label="Billing period">
          <button
            type="button"
            class="billing-opt"
            :class="{ 'is-active': !isAnnual }"
            role="tab"
            :aria-selected="!isAnnual"
            @click="setBilling('monthly')"
          >Monthly</button>
          <button
            type="button"
            class="billing-opt"
            :class="{ 'is-active': isAnnual, 'is-disabled': !annualAvailable }"
            role="tab"
            :aria-selected="isAnnual"
            :disabled="!annualAvailable"
            :title="annualAvailable ? '' : 'Annual billing not available yet'"
            @click="setBilling('annual')"
          >
            Annual
            <span v-if="annualAvailable && ANNUAL_MONTHS_FREE > 0" class="billing-badge">{{ ANNUAL_MONTHS_FREE }} months free</span>
          </button>
        </div>

        <div class="seat-row">
          <span class="field-label">Teacher seats</span>
          <div class="seat-stepper">
            <button type="button" class="seat-btn" :disabled="seatCount <= 1 || checkoutOpen" @click="setSeats(seatCount - 1)">−</button>
            <input
              class="seat-input"
              type="number"
              min="1"
              :value="seatCount"
              :disabled="checkoutOpen"
              @input="setSeats(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="seat-btn" :disabled="checkoutOpen" @click="setSeats(seatCount + 1)">+</button>
          </div>
          <span class="seat-total">£{{ schoolTotalGbp }}<span class="seat-per">{{ periodSuffix }}</span></span>
        </div>

        <p v-if="checkoutError" class="upgrade-error">{{ checkoutError }}</p>
        <p v-if="seatsMessage" class="upgrade-note">{{ seatsMessage }}</p>

        <!-- Subscribed → edit seats in place (PATCH, monthly-oriented). -->
        <button
          v-if="isSubscribed"
          type="button"
          class="btn-play btn-play--block upgrade-cta"
          :disabled="isUpdatingSeats || seatCount === paidSeats"
          @click="updateSeats"
        >
          {{ isUpdatingSeats ? 'Updating…' : seatCount === paidSeats ? `${seatCount} seats (current)` : `Update to ${seatCount} seats — £${monthlyTotalGbp}/mo` }}
        </button>
        <!-- Else → open the INITIAL inline checkout. -->
        <button
          v-else-if="!checkoutOpen"
          type="button"
          class="btn-play btn-play--block upgrade-cta"
          :disabled="!schoolId || isOpeningCheckout"
          @click="subscribeSchool"
        >
          {{ isOpeningCheckout ? 'Opening…' : `Subscribe — £${schoolTotalGbp}${periodSuffix}` }}
        </button>
      </template>

      <!-- ── Tutor lane: single seat ── -->
      <template v-else>
        <h1 class="upgrade-title arsenal">Subscribe</h1>
        <p class="upgrade-lede">
          £{{ PRICE_PER_SEAT_GBP }} / month (or £{{ ANNUAL_PRICE_PER_SEAT_GBP }}/year) for your
          tutoring dashboard. Your students pay separately — three paying students cover your subscription.
        </p>

        <!-- Toggle stays usable while the inline checkout is open (re-prices it). -->
        <div class="billing-toggle" role="tablist" aria-label="Billing period">
          <button
            type="button"
            class="billing-opt"
            :class="{ 'is-active': !isAnnual }"
            role="tab"
            :aria-selected="!isAnnual"
            @click="setBilling('monthly')"
          >Monthly</button>
          <button
            type="button"
            class="billing-opt"
            :class="{ 'is-active': isAnnual, 'is-disabled': !annualAvailable }"
            role="tab"
            :aria-selected="isAnnual"
            :disabled="!annualAvailable"
            :title="annualAvailable ? '' : 'Annual billing not available yet'"
            @click="setBilling('annual')"
          >
            Annual
            <span v-if="annualAvailable && ANNUAL_MONTHS_FREE > 0" class="billing-badge">{{ ANNUAL_MONTHS_FREE }} months free</span>
          </button>
        </div>

        <div class="seat-row seat-row--single">
          <span class="field-label">Your subscription</span>
          <span class="seat-total">£{{ tutorTotalGbp }}<span class="seat-per">{{ periodSuffix }}</span></span>
        </div>
        <p v-if="tutorError" class="upgrade-error">{{ tutorError }}</p>
        <!-- Already active → manage (portal), never a second checkout. -->
        <button
          v-if="tutorPlatformActive"
          type="button"
          class="btn-play btn-play--block upgrade-cta"
          @click="openTutorPortal"
        >
          Manage subscription
        </button>
        <button
          v-else-if="!checkoutOpen"
          type="button"
          class="btn-play btn-play--block upgrade-cta"
          :disabled="tutorBusy || !tutorTeacherId || !tutorSubLoaded"
          @click="subscribeTutor"
        >
          {{ tutorBusy ? 'Opening…' : (!tutorTeacherId || !tutorSubLoaded) ? 'Loading…' : `Subscribe — £${tutorTotalGbp}${periodSuffix}` }}
        </button>
      </template>

      <!-- Sized, non-scrolly inline Paddle checkout. Mounts here once a lane's
           Subscribe button fires; on success Paddle redirects the parent. -->
      <!-- class MUST equal INLINE_FRAME_TARGET (Paddle frameTarget is a class name). -->
      <div v-show="checkoutOpen" class="paddle-inline-frame"></div>
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

/* Monthly / annual toggle */
.billing-toggle {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.25rem;
  margin: 0 0 1.25rem;
  background: var(--bg-subtle, #f1f5f9);
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 0.65rem;
}
.billing-opt {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.95rem;
  border: none;
  background: transparent;
  border-radius: 0.5rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.billing-opt.is-active {
  background: var(--bg-elevated, #fff);
  color: var(--text-primary, #1e293b);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.billing-opt.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.billing-badge {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.1rem 0.4rem;
  border-radius: 0.4rem;
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
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
.seat-input:disabled { opacity: 0.6; }
.seat-total { font-size: 1.25rem; font-weight: 700; }
.seat-per { font-size: 0.8rem; font-weight: 500; color: var(--text-secondary, #64748b); }
.btn-play--block { width: 100%; }

/* Primary Subscribe CTA — owns its red explicitly so it stays solid SSi red on
   this standalone route too. The shared `.btn-play` red is scoped to
   `.schools-surface` (schools-design.css), which UpgradeView is NOT always
   inside (e.g. /teach/upgrade, or embedded in a trial-expired wall), so the
   button rendered pale. These rules don't depend on that surface. */
.upgrade-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0.85rem 1rem;
  border: none;
  border-radius: 0.65rem;
  background: #db1e17; /* SSi brand red (--schools-red) */
  color: #fff;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
  transition: background 160ms ease-out;
}
.upgrade-cta:hover:not(:disabled) { background: #900600; /* --schools-red-deep */ }
.upgrade-cta:disabled {
  background: #d8b4b2; /* muted red — clearly distinct from the live red */
  color: #fff;
  opacity: 1;
  cursor: not-allowed;
}
.upgrade-error { color: #dc2626; margin: 0 0 0.75rem; font-size: 0.85rem; }
.upgrade-note { color: var(--text-secondary, #64748b); margin: 0 0 0.75rem; font-size: 0.85rem; }

/* Inline Paddle checkout container — sized so the checkout is comfortable and
   doesn't scroll on desktop; full width keeps it responsive on mobile. */
.paddle-inline-frame {
  width: 100%;
  min-height: 450px;
  margin-top: 0.5rem;
}
</style>
