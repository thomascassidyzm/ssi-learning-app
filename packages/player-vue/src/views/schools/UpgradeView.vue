<script setup lang="ts">
/**
 * UpgradeView — the ONE canonical payment page (lever-3).
 *
 * WORDING (founder ruling 2026-08-02): money-facing copy speaks to
 * ORGANISATIONS, not schools. The neutral vocabulary is group / group leader /
 * learner; school / teacher / class is a vocabulary DRESSING for the education
 * preset, kept only on the school lane below. The org lane's unit is a LEARNER
 * seat — docs/PRICING.md (Popty) rules "one seat = one named learner for the
 * entire paid period", which is why the lede promises adding seats but not
 * mid-period swaps.
 * ⚠️ SEAM: when the terminology-preset layer lands, the school lane's literal
 * "teacher seat" / "Subscribe your school" strings should route through it
 * rather than being a hard-coded second lane.
 *
 * Context-aware, serves THREE lanes off a single surface:
 *   • govt_admin (org/workplace group-leader) → £15 per LEARNER seat / month
 *     (or £150/seat/yr) for the org's `groups` row (api/_utils/orgPlatform.ts).
 *     Same seat-stepper/in-place-edit/double-subscribe-guard shape as the
 *     school lane below, against /api/org/subscription + /api/org/update-seats
 *     instead of the school endpoints. Checked FIRST — a govt_admin never has
 *     a school_id of their own, so this must not fall through to the tutor lane.
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
import { ref, computed, inject, watch, type Ref } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolCheckout } from '@/composables/useSchoolCheckout'
import { useOrgCheckout } from '@/composables/useOrgCheckout'
import { useTeachersData } from '@/composables/schools/useTeachersData'
import { getPaddle, paddleConfig } from '@/lib/paddle'

const supabase = inject<Ref<any>>('supabase', ref(null))
const { currentUser, isSchoolAdmin, isGovtAdmin } = useSchoolContext()

// DECISION A (worklist 07-02): no seat-cap gating of any kind — instead make
// the display honest so admins self-correct. `joinedTeacherCount` is the
// ACTUAL joined-teacher count, shown alongside `paidSeats` (the billed count)
// so a school that's outgrown its paid seats sees it plainly.
//
// SOURCE OF TRUTH is the server's `school.teacher_count` (/api/school/subscription,
// mirroring org.member_count) — it unions the FOUNDING ADMIN in, which the
// roster-derived client list misses on every school whose admin holds no
// SCHOOL: user_tag (six live schools as of 2026-08-07, fixed in its own lane).
// The roster count stays as the fallback for the pre-load window only.
const { teachers: joinedTeachers, fetchTeachers } = useTeachersData()
const serverTeacherCount = ref<number | null>(null)
const joinedTeacherCount = computed(() => serverTeacherCount.value ?? joinedTeachers.value.length)

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

// govt_admin (org/workplace group-leader) is checked FIRST: they never carry
// a school_id of their own, so if org were checked after school it would fall
// straight through into the tutor lane instead.
const isOrgLane = computed(() => isGovtAdmin.value)
// A user administering a school buys seats; everyone else (solo tutor) buys one.
const isSchoolLane = computed(
  () => !isOrgLane.value && (isSchoolAdmin.value || !!currentUser.value?.school_id),
)

// Annual is only offered when the relevant Paddle price id is configured.
const annualAvailable = computed(() => {
  if (isOrgLane.value) return !!paddleConfig.orgSeatAnnualPriceId
  if (isSchoolLane.value) return !!paddleConfig.schoolTeacherAnnualPriceId
  return !!paddleConfig.teacherAnnualPriceId
})
// The Paddle price id for the currently-selected lane + period (null if unset).
const activePriceId = computed<string | undefined>(() => {
  if (isOrgLane.value) {
    return isAnnual.value ? paddleConfig.orgSeatAnnualPriceId : paddleConfig.orgSeatMonthlyPriceId
  }
  if (isSchoolLane.value) {
    return isAnnual.value
      ? paddleConfig.schoolTeacherAnnualPriceId
      : paddleConfig.schoolTeacherMonthlyPriceId
  }
  return isAnnual.value ? paddleConfig.teacherAnnualPriceId : paddleConfig.teacherMonthlyPriceId
})
const activeQuantity = computed(() => (isOrgLane.value ? orgSeats.value : isSchoolLane.value ? seats.value : 1))

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
// Set the moment the admin touches the stepper. The server seat-seeding below
// is a DEFAULT, and a default must never overwrite a deliberate choice: the
// subscription fetch resolves asynchronously, so without this an admin who
// stepped 1 → 6 during the load window would have their 6 silently replaced —
// on a page whose next click is a Paddle checkout. (The Subscribe CTA is
// blocked until schoolSubLoaded, so a stomp could never reach Paddle unnoticed;
// this keeps the number on screen honest as well.)
const seatCountTouched = ref(false)
const seats = computed(() => Math.max(1, seatCount.value))
const monthlyTotalGbp = computed(() => seats.value * PRICE_PER_SEAT_GBP)
const annualTotalGbp = computed(() => seats.value * ANNUAL_PRICE_PER_SEAT_GBP)
// The headline total for the currently-selected period (school lane).
const schoolTotalGbp = computed(() => (isAnnual.value ? annualTotalGbp.value : monthlyTotalGbp.value))
const periodSuffix = computed(() => (isAnnual.value ? '/yr' : '/mo'))
function setSeats(n: number) {
  seatCountTouched.value = true
  seatCount.value = Math.max(1, Math.floor(n) || 1)
}

// ── Subscription state (read from server so we never fire a SECOND
//    initial checkout on an already-subscribed school = double-bill) ──
const platformStatus = ref<string | null>(null)
const paidSeats = ref<number | null>(null)
const isSubscribed = computed(() => platformStatus.value === 'active')
const isUpdatingSeats = ref(false)
const seatsMessage = ref('')
// True once loadSubscription() has resolved — mirrors tutorSubLoaded below.
// Until then the Subscribe CTA stays blocked: an already-subscribed admin
// clicking during the load window (isSubscribed still false) would open a
// SECOND initial checkout = a second Paddle subscription = double billing.
const schoolSubLoaded = ref(false)

// True once an inline checkout has been mounted into the container, so the
// template can show the sized frame (and hide the now-redundant CTA).
const checkoutOpen = ref(false)

const { isOpeningCheckout, checkoutError, startSchoolCheckout } = useSchoolCheckout()
const {
  isOpeningCheckout: isOpeningOrgCheckout,
  checkoutError: orgCheckoutError,
  startOrgCheckout,
} = useOrgCheckout()

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
    const countResp = data?.school?.teacher_count
    if (typeof countResp === 'number' && countResp >= 0) serverTeacherCount.value = countResp
    const seatsResp = data?.school?.teacher_seats
    if (typeof seatsResp === 'number' && seatsResp > 0) {
      paidSeats.value = seatsResp
      if (isSubscribed.value) seatCount.value = seatsResp
    }
    // NOT yet subscribed → seed the stepper from the school's ACTUAL staff
    // count, so a school with three teachers is offered three seats instead of
    // the hard-coded 1 it used to open at. Strictly a smarter DEFAULT: the
    // stepper stays fully editable up AND down, nothing is capped, and an
    // already-made choice (seatCountTouched) is never overwritten. The
    // already-subscribed path above is untouched — it still seeds from
    // teacher_seats, what is actually being billed.
    if (!isSubscribed.value && !seatCountTouched.value && typeof countResp === 'number' && countResp > 1) {
      seatCount.value = countResp
    }
  } catch {
    // Non-fatal — page just stays in its default (Subscribe) state.
  } finally {
    schoolSubLoaded.value = true
  }
}

async function subscribeSchool() {
  if (!schoolId.value) return
  // Double-subscribe guard (mirrors subscribeTutor): never open an INITIAL
  // checkout until the server has confirmed the school isn't already
  // subscribed — a second checkout is a second subscription, double-billed.
  if (!schoolSubLoaded.value) await loadSubscription()
  if (isSubscribed.value) return // template now shows the seat-edit CTA
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

// ── Org lane (govt_admin — org/workplace group-leader) ──────────────
// Mirrors the school lane exactly, against /api/org/subscription +
// /api/org/update-seats instead of the school endpoints. The org is
// server-derived from the caller's own govt_admins row on every write path
// (leaderGroupId) — orgId here is only what the Paddle checkout's customData
// carries.
//
// Prefer the id the SERVER resolved (/api/org/subscription's org.id) over the
// client context's group_id. Both are the same org, but the server one is the
// authority and is guaranteed present once the subscription load resolves —
// whereas currentUser is populated by a separate sign-in-time fetch, so a
// leader landing straight on this page could otherwise sit in front of a
// permanently disabled Subscribe button with nothing explaining why. Context
// stays as the fallback for the pre-load window.
const serverOrgId = ref<string | null>(null)
const orgId = computed<string | null>(
  () => serverOrgId.value ?? currentUser.value?.group_id ?? null,
)

const orgSeatCount = ref(1)
// Same "a default must not overwrite a deliberate choice" guard as the school
// lane's seatCountTouched.
const orgSeatCountTouched = ref(false)
const orgSeats = computed(() => Math.max(1, orgSeatCount.value))
const orgMonthlyTotalGbp = computed(() => orgSeats.value * PRICE_PER_SEAT_GBP)
const orgAnnualTotalGbp = computed(() => orgSeats.value * ANNUAL_PRICE_PER_SEAT_GBP)
const orgTotalGbp = computed(() => (isAnnual.value ? orgAnnualTotalGbp.value : orgMonthlyTotalGbp.value))
function setOrgSeats(n: number) {
  orgSeatCountTouched.value = true
  orgSeatCount.value = Math.max(1, Math.floor(n) || 1)
}

const orgPlatformStatus = ref<string | null>(null)
const orgPaidSeats = ref<number | null>(null)
// DECISION A (worklist 07-02, applied here too): honest display, no seat-cap
// gating — orgMemberCount is the ACTUAL joined-member count from the server
// (/api/org/subscription's member_count), shown alongside orgPaidSeats.
const orgMemberCount = ref<number | null>(null)
const isOrgSubscribed = computed(() => orgPlatformStatus.value === 'active')
const isUpdatingOrgSeats = ref(false)
const orgSeatsMessage = ref('')
// Same double-subscribe guard as the school lane: the Subscribe CTA stays
// blocked until this resolves, so a fast click in the load window can't open
// a SECOND initial checkout on an already-subscribed org = double-bill.
const orgSubLoaded = ref(false)

async function loadOrgSubscription() {
  const headers = await authHeaders()
  if (!headers) return
  try {
    const res = await fetch('/api/org/subscription', { headers })
    if (!res.ok) return
    const data = await res.json()
    if (typeof data?.org?.id === 'string') serverOrgId.value = data.org.id
    orgPlatformStatus.value = data?.org?.platform_status ?? null
    orgMemberCount.value = typeof data?.org?.member_count === 'number' ? data.org.member_count : null
    const seatsResp = data?.org?.seats
    if (typeof seatsResp === 'number' && seatsResp > 0) {
      orgPaidSeats.value = seatsResp
      if (isOrgSubscribed.value) orgSeatCount.value = seatsResp
    }
    // Not yet subscribed → seed from the org's ACTUAL member count (already
    // fetched above), same smarter-default rule as the school lane.
    if (
      !isOrgSubscribed.value &&
      !orgSeatCountTouched.value &&
      typeof orgMemberCount.value === 'number' &&
      orgMemberCount.value > 1
    ) {
      orgSeatCount.value = orgMemberCount.value
    }
  } catch {
    // Non-fatal — page just stays in its default (Subscribe) state.
  } finally {
    orgSubLoaded.value = true
  }
}

async function subscribeOrg() {
  if (!orgId.value) return
  if (!orgSubLoaded.value) await loadOrgSubscription()
  if (isOrgSubscribed.value) return // template now shows the seat-edit CTA
  checkoutOpen.value = true
  await startOrgCheckout({
    groupId: orgId.value,
    seats: orgSeatCount.value,
    billing: billing.value,
    frameTarget: INLINE_FRAME_TARGET,
  })
}

async function updateOrgSeats() {
  if (isUpdatingOrgSeats.value) return
  isUpdatingOrgSeats.value = true
  orgSeatsMessage.value = ''
  try {
    const headers = await authHeaders()
    if (!headers) { orgSeatsMessage.value = 'Sign in again to change seats'; return }
    const res = await fetch('/api/org/update-seats', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seats: orgSeatCount.value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { orgSeatsMessage.value = data?.error || 'Could not update seats'; return }
    orgPaidSeats.value = data?.seats ?? orgSeatCount.value
    orgSeatsMessage.value = data?.unchanged ? 'No change' : `Updated to ${orgPaidSeats.value} seats`
  } catch {
    orgSeatsMessage.value = 'Could not update seats'
  } finally {
    isUpdatingOrgSeats.value = false
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
      // teacher_paid = a LIVE Paddle subscription (active OR past_due while
      // Paddle retries the card, incl. the webhook-lag backstop) — exactly the
      // "route to portal, never a second checkout" condition. A raw
      // status==='active' check missed past_due: a declined-card tutor saw
      // "Subscribe" and could open a second concurrent subscription.
      tutorPlatformActive.value = data?.teacher_paid === true
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

// Lane pick reads currentUser (school_id / educational_role), which resolves
// asynchronously from useSchoolContext. onMounted fired before that resolved
// would always see the tutor lane (currentUser still null) and never call
// loadSubscription() for a school admin — CTA stuck on "Loading…" forever.
// watch(..., {immediate:true}) re-fires once currentUser actually lands,
// mirroring the retry pattern used elsewhere (DashboardView etc).
watch(currentUser, (user) => {
  if (!user) return
  if (isOrgLane.value) {
    if (!orgSubLoaded.value) loadOrgSubscription()
  } else if (isSchoolLane.value) {
    if (!schoolSubLoaded.value) loadSubscription()
    void fetchTeachers()
  } else {
    // Tutor lane: resolve the teacher id up-front (so the button can unblock)
    // and read platform status (so we can route an active tutor to the portal).
    if (!tutorSubLoaded.value) {
      void resolveTutorTeacherId()
      void loadTutorSubscription()
    }
  }
}, { immediate: true })
</script>

<template>
  <div class="upgrade-page">
    <div class="upgrade-card schools-card">
      <span class="schools-kicker">SSi Premium</span>

      <!-- ── Org lane: per-seat (govt_admin group-leader) ── -->
      <template v-if="isOrgLane">
        <h1 class="upgrade-title arsenal">
          {{ isOrgSubscribed ? 'Manage your seats' : 'Subscribe your organisation' }}
        </h1>
        <p class="upgrade-lede">
          £{{ PRICE_PER_SEAT_GBP }} per learner seat / month (or £{{ ANNUAL_PRICE_PER_SEAT_GBP }}/year).
          One subscription covers every seat and every language. Add seats any time — each seat
          belongs to one named learner for the period you've paid for.
        </p>

        <div v-if="!isOrgSubscribed" class="billing-toggle" role="tablist" aria-label="Billing period">
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
          <span class="field-label">Learner seats</span>
          <div class="seat-stepper">
            <button type="button" class="seat-btn" :disabled="orgSeatCount <= 1 || checkoutOpen" @click="setOrgSeats(orgSeatCount - 1)">−</button>
            <input
              class="seat-input"
              type="number"
              min="1"
              :value="orgSeatCount"
              :disabled="checkoutOpen"
              @input="setOrgSeats(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="seat-btn" :disabled="checkoutOpen" @click="setOrgSeats(orgSeatCount + 1)">+</button>
          </div>
          <span class="seat-total">£{{ orgTotalGbp }}<span class="seat-per">{{ periodSuffix }}</span></span>
        </div>

        <!-- Honest seats-vs-actual display (DECISION A, no gating). -->
        <p v-if="isOrgSubscribed" class="upgrade-note seats-actual-note">
          {{ orgMemberCount ?? 0 }} learner{{ (orgMemberCount ?? 0) === 1 ? '' : 's' }} joined ·
          {{ orgPaidSeats ?? orgSeatCount }} seat{{ (orgPaidSeats ?? orgSeatCount) === 1 ? '' : 's' }} paid
          <span v-if="orgPaidSeats !== null && (orgMemberCount ?? 0) > orgPaidSeats" class="seats-over-note">
            — {{ (orgMemberCount ?? 0) - orgPaidSeats }} more learner{{ (orgMemberCount ?? 0) - orgPaidSeats === 1 ? '' : 's' }} joined than paid seats
          </span>
        </p>
        <!-- Not yet subscribed: the same honesty, against what's ABOUT to be
             billed — the stepper seeded from the real member count. -->
        <p v-else-if="(orgMemberCount ?? 0) > 0" class="upgrade-note seats-actual-note">
          {{ orgMemberCount }} learner{{ orgMemberCount === 1 ? '' : 's' }} joined ·
          subscribing for {{ orgSeats }} seat{{ orgSeats === 1 ? '' : 's' }}
          <span v-if="orgSeats < (orgMemberCount ?? 0)" class="seats-over-note">
            — {{ (orgMemberCount ?? 0) - orgSeats }} learner{{ (orgMemberCount ?? 0) - orgSeats === 1 ? '' : 's' }} without a seat
          </span>
        </p>

        <p v-if="orgCheckoutError" class="upgrade-error">{{ orgCheckoutError }}</p>
        <p v-if="orgSeatsMessage" class="upgrade-note">{{ orgSeatsMessage }}</p>

        <!-- Subscribed → edit seats in place (PATCH, monthly-oriented). -->
        <button
          v-if="isOrgSubscribed"
          type="button"
          class="btn-play btn-play--block upgrade-cta"
          :disabled="isUpdatingOrgSeats || orgSeatCount === orgPaidSeats"
          @click="updateOrgSeats"
        >
          {{ isUpdatingOrgSeats ? 'Updating…' : orgSeatCount === orgPaidSeats ? `${orgSeatCount} seats (current)` : `Update to ${orgSeatCount} seats — £${orgMonthlyTotalGbp}/mo` }}
        </button>
        <!-- Else → open the INITIAL inline checkout. -->
        <button
          v-else-if="!checkoutOpen"
          type="button"
          class="btn-play btn-play--block upgrade-cta"
          :disabled="!orgId || isOpeningOrgCheckout || !orgSubLoaded"
          @click="subscribeOrg"
        >
          {{ !orgSubLoaded ? 'Loading…' : isOpeningOrgCheckout ? 'Opening…' : `Subscribe — £${orgTotalGbp}${periodSuffix}` }}
        </button>
      </template>

      <!-- ── School lane: per-seat ── -->
      <template v-else-if="isSchoolLane">
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

        <!-- Honest seats-vs-actual display (no gating — just self-correction). -->
        <p v-if="isSubscribed" class="upgrade-note seats-actual-note">
          {{ joinedTeacherCount }} teacher{{ joinedTeacherCount === 1 ? '' : 's' }} joined ·
          {{ paidSeats ?? seatCount }} seat{{ (paidSeats ?? seatCount) === 1 ? '' : 's' }} paid
          <span v-if="paidSeats !== null && joinedTeacherCount > paidSeats" class="seats-over-note">
            — {{ joinedTeacherCount - paidSeats }} more teacher{{ joinedTeacherCount - paidSeats === 1 ? '' : 's' }} joined than paid seats
          </span>
        </p>
        <!-- Not yet subscribed: same honesty, against what's ABOUT to be billed
             — the stepper is seeded from this joined count, and the admin can
             still step it anywhere they like. -->
        <p v-else-if="joinedTeacherCount > 0" class="upgrade-note seats-actual-note">
          {{ joinedTeacherCount }} teacher{{ joinedTeacherCount === 1 ? '' : 's' }} joined ·
          subscribing for {{ seats }} seat{{ seats === 1 ? '' : 's' }}
          <span v-if="seats < joinedTeacherCount" class="seats-over-note">
            — {{ joinedTeacherCount - seats }} teacher{{ joinedTeacherCount - seats === 1 ? '' : 's' }} without a seat
          </span>
        </p>

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
          :disabled="!schoolId || isOpeningCheckout || !schoolSubLoaded"
          @click="subscribeSchool"
        >
          {{ !schoolSubLoaded ? 'Loading…' : isOpeningCheckout ? 'Opening…' : `Subscribe — £${schoolTotalGbp}${periodSuffix}` }}
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
.seats-over-note { color: #b8860b; font-weight: 600; }

/* Inline Paddle checkout container — sized so the checkout is comfortable and
   doesn't scroll on desktop; full width keeps it responsive on mobile. */
.paddle-inline-frame {
  width: 100%;
  min-height: 450px;
  margin-top: 0.5rem;
}
</style>
