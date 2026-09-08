/**
 * THE MOMENT AFTER SOMEBODY PAYS.
 *
 * Tom bought SSi Family on staging on 2026-09-07. Paddle took £25 and emailed
 * him a confirmation. The app then showed him nothing for several minutes — the
 * Settings screen still offered him the Upgrade row — and a second attempt put
 * him in an endless spinner. His words: "its a shitty process, race condition,
 * looks like nothing has happened, then spins endlessly".
 *
 * This composable is the third state the app was missing: PAID, NOT YET LANDED.
 * It owns four things and nothing else.
 *
 *   1. ACKNOWLEDGE AT ONCE. The record is written from Paddle's own
 *      checkout.completed event — in the page, the instant the payment
 *      succeeds — so the acknowledgement does not wait on our webhook, on a
 *      redirect, or on anything that can be slow. While it stands, the
 *      not-subscribed state is covered and the buy path is shut.
 *   2. RESOLVE, DON'T SPIN. It polls /api/subscription on a decaying cadence
 *      and reports honestly which phase it is in, so the screen above it can
 *      show real progress rather than a spinner with no end.
 *   3. A DEFINITE END. On arrival it lands the buyer in the thing they bought.
 *      If it has not arrived, it says something true and calm rather than
 *      spinning forever, and it keeps the payment reference to hand.
 *   4. SURVIVE A RELOAD. Every bit of that is driven off the localStorage
 *      record in checkout/pendingPurchase.ts, so a refresh — or a phone killing
 *      a backgrounded PWA — comes back to the waiting state and not to the
 *      not-subscribed state.
 *
 * Module-level state, like useCheckout next door, so the one overlay reflects
 * one truth no matter which surface is mounted.
 */

import { ref, computed, readonly } from 'vue'
import {
  readPendingPurchase,
  savePendingPurchase,
  clearPendingPurchase,
  type PendingPurchase,
} from '@/checkout/pendingPurchase'
import { useSharedSubscription } from './useSubscription'
import { openFamilyModal } from './useFamilyModal'

/**
 * When the wording changes from "this takes a few seconds" to "this is taking
 * longer than usual". It must be longer than the ordinary case and shorter than
 * a person's patience — say the honest thing before they start to worry, not
 * after.
 */
export const SLOW_AFTER_MS = 25_000

/**
 * When we stop claiming it is imminent and hand them a way to reach a human.
 * Tom waited "several minutes" and it did resolve, so this is deliberately
 * generous — the point is that the screen has a definite end, not that it gives
 * up early.
 */
export const STALLED_AFTER_MS = 10 * 60_000

/**
 * How often to ask. Tight while the answer is likely imminent, then decaying,
 * because a poll every two seconds for ten minutes is 300 requests for one
 * £25 purchase and the later ones are the least likely to be the one that
 * answers.
 */
function pollDelayFor(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 2_000
  if (elapsedMs < 2 * 60_000) return 5_000
  return 15_000
}

export type PendingPhase = 'confirming' | 'slow' | 'stalled' | 'arrived'

const record = ref<PendingPurchase | null>(readPendingPurchase())
const elapsedMs = ref(record.value ? Date.now() - record.value.paidAt : 0)
const arrived = ref(false)
/**
 * The buyer chose to carry on using the app rather than watch the wait.
 *
 * IT HIDES THE OVERLAY AND NOTHING ELSE. The purchase is still in flight, so
 * the buy path stays shut and the Settings screen still says the plan is being
 * switched on — stepping out of the waiting room must never reopen the door to
 * paying twice. In memory only, deliberately: a reload is exactly the moment
 * Tom's requirement says must land back in the waiting state.
 */
const dismissed = ref(false)
/** True while a poll is in flight — drives the "checking" beat in the UI so the
 *  progress a buyer sees is real activity rather than a decorative animation. */
const checking = ref(false)

let tickTimer: ReturnType<typeof setInterval> | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null

function stopTimers(): void {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
}

/** The subscription is live. Stop waiting and let the overlay show the good news. */
function markArrived(): void {
  stopTimers()
  arrived.value = true
  // Good news outranks having been dismissed — bring the screen back to say so
  // and to land them in what they bought.
  dismissed.value = false
}

async function pollOnce(): Promise<boolean> {
  const sub = useSharedSubscription()
  checking.value = true
  try {
    await sub.refresh()
  } catch {
    // refresh() swallows its own errors; a failed poll is just a poll that
    // told us nothing. Never surface a network blip as a failed purchase.
  } finally {
    checking.value = false
  }
  return sub.isSubscribed.value
}

function schedulePoll(): void {
  if (pollTimer) return
  const delay = pollDelayFor(elapsedMs.value)
  pollTimer = setTimeout(async () => {
    pollTimer = null
    if (!record.value || arrived.value) return
    if (await pollOnce()) {
      markArrived()
      return
    }
    if (record.value && !arrived.value) schedulePoll()
  }, delay)
}

function startTimers(): void {
  if (!record.value || arrived.value) return
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      if (!record.value) return
      elapsedMs.value = Date.now() - record.value.paidAt
    }, 1_000)
  }
  schedulePoll()
}

/**
 * The money has been taken. Called from Paddle's checkout.completed event, and
 * again — harmlessly — from the success landing, because on any given purchase
 * either one of those may be the only signal we get.
 */
export function beginPendingPurchase(input: {
  plan: 'premium' | 'family'
  billingPeriod: 'monthly' | 'annual'
  transactionId?: string | null
}): void {
  savePendingPurchase({
    plan: input.plan,
    billingPeriod: input.billingPeriod,
    transactionId: input.transactionId ?? null,
  })
  const stored = readPendingPurchase()
  if (!stored) return
  record.value = stored
  arrived.value = false
  dismissed.value = false
  elapsedMs.value = Date.now() - stored.paidAt
  startTimers()
  // Ask immediately as well as on the schedule: the webhook may already have
  // landed by the time a redirect finishes, and a buyer should never sit
  // through a first delay we could have skipped.
  void (async () => { if (await pollOnce()) markArrived() })()
}

/**
 * Boot-time pick-up. Two jobs, both about surviving things that destroy memory:
 *
 *   • a record written before the Paddle success redirect is still on disk, so
 *     re-arm its timers and carry on waiting;
 *   • a success landing (?just_subscribed=1) that arrives with NO record —
 *     because checkout.completed never reached us — still gets one, inferred
 *     from the redirect Paddle was given. Belt and braces on the one moment
 *     that must not be missed.
 */
export function resumePendingPurchase(search: string = window.location.search): void {
  const existing = readPendingPurchase()
  if (existing) {
    record.value = existing
    // A reload lands back in the waiting state — that is the requirement, and
    // it is why "carry on without waiting" is memory-only.
    dismissed.value = false
    elapsedMs.value = Date.now() - existing.paidAt
    if (useSharedSubscription().isSubscribed.value) {
      // It landed while we were away. Nothing to wait for.
      markArrived()
      return
    }
    startTimers()
    return
  }
  try {
    const params = new URLSearchParams(search)
    if (params.get('just_subscribed') !== '1') return
    if (useSharedSubscription().isSubscribed.value) return
    beginPendingPurchase({
      plan: params.get('family') === '1' ? 'family' : 'premium',
      billingPeriod: 'monthly',
      transactionId: null,
    })
  } catch {
    // A URL we cannot parse is not a purchase. Nothing to do.
  }
}

/** Ask again, now. The one control on the stalled screen — so the end of the
 *  wait is still the buyer's to push on, rather than a dead page. */
export async function checkAgain(): Promise<void> {
  if (!record.value || checking.value) return
  if (await pollOnce()) markArrived()
}

/**
 * The end of the wait. Clears the record and puts the buyer in the thing they
 * bought — for Family that is the screen where they add their family, which is
 * the second half of what Tom hit when six seats appeared with nowhere to use
 * them.
 */
export function landPendingPurchase(): void {
  const plan = record.value?.plan
  stopTimers()
  clearPendingPurchase()
  record.value = null
  arrived.value = false
  dismissed.value = false
  elapsedMs.value = 0
  if (plan === 'family') openFamilyModal()
}

/**
 * Step out of the waiting room. The purchase carries on settling behind them
 * and the app carries on knowing about it — this only takes the overlay down.
 */
export function dismissPendingPurchase(): void {
  dismissed.value = true
}

export function usePendingPurchase() {
  const phase = computed<PendingPhase>(() => {
    if (arrived.value) return 'arrived'
    if (elapsedMs.value >= STALLED_AFTER_MS) return 'stalled'
    if (elapsedMs.value >= SLOW_AFTER_MS) return 'slow'
    return 'confirming'
  })

  return {
    /** The purchase in flight, or null. */
    pending: readonly(record),
    /** True whenever a purchase is paid for and not yet resolved — the state
     *  in which the app must never render the not-subscribed UI or offer to
     *  sell the thing that has just been bought. Unaffected by dismissing the
     *  overlay: stepping out of the waiting room does not un-buy anything. */
    isPending: computed(() => record.value !== null),
    /** Should the waiting overlay be on screen right now? */
    showOverlay: computed(() => record.value !== null && !dismissed.value),
    phase,
    elapsedMs: readonly(elapsedMs),
    checking: readonly(checking),
    begin: beginPendingPurchase,
    resume: resumePendingPurchase,
    checkAgain,
    land: landPendingPurchase,
    dismiss: dismissPendingPurchase,
  }
}
