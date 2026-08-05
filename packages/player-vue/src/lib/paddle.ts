/**
 * Paddle.js loader + env config — lazy, singleton.
 *
 * Env (build-time, Vite):
 *   VITE_PADDLE_CLIENT_TOKEN          — client-side token from Paddle
 *   VITE_PADDLE_ENV                   — 'sandbox' (default) or 'production'
 *   VITE_PADDLE_TEACHER_PRICE_MONTHLY — pri_… for £15/mo SSi Premium
 *   VITE_PADDLE_TEACHER_PRICE_ANNUAL  — pri_… for £150/yr SSi Premium (tutor + school annual)
 *   VITE_PADDLE_SCHOOL_TEACHER_PRICE_ANNUAL — pri_… for £150/yr/teacher SCHOOL PLATFORM
 *                                              (per-seat; quantity = seats). Falls back to
 *                                              the tutor annual price when unset.
 *   VITE_PADDLE_STUDENT_PRICE_MONTHLY        — pri_… for £10/mo student-via-TUTOR (ACT)
 *   VITE_PADDLE_STUDENT_SCHOOL_PRICE_MONTHLY — pri_… for £5/mo student-via-SCHOOL (no commission)
 *   VITE_PADDLE_STUDENT_PRICE_ANNUAL         — pri_… for £100/yr student-via-TUTOR (ACT)
 *   VITE_PADDLE_STUDENT_SCHOOL_PRICE_ANNUAL  — pri_… for £50/yr student-via-SCHOOL (no commission)
 *   VITE_PADDLE_SCHOOL_TEACHER_PRICE_MONTHLY — pri_… for £15/teacher/mo SCHOOL PLATFORM
 *                                              (per-seat; checkout sends quantity = teacher seats).
 *                                              ⚠️ Tom must create this price in Paddle + set the env.
 *   VITE_PADDLE_EXTRA_CLASS_MONTHLY   — pri_… (optional, future)
 *   VITE_PADDLE_EXTRA_CLASS_ANNUAL    — pri_… (optional, future)
 *   VITE_PADDLE_FAMILY_PRICE_MONTHLY  — pri_… for £25/mo SSi Family (up to 6 accounts)
 *   VITE_PADDLE_FAMILY_PRICE_ANNUAL   — pri_… for £250/yr SSi Family
 *                                        ⚠️ NO FALLBACK — Tom creates this product by
 *                                        hand (FAMILY-PLAN-SPEC.md §2.1); until both
 *                                        env vars are set the Family paywall option
 *                                        stays hidden (graceful, same pattern as the
 *                                        annual-price-unset case above).
 *   VITE_PADDLE_ORG_SEAT_PRICE_MONTHLY — pri_… for £15/seat/mo ORG PLATFORM (workplace/
 *                                        group-leader lane, api/_utils/orgPlatform.ts).
 *                                        Founder ruling 2026-08-02: no separate org-seat
 *                                        Paddle product exists or should exist — the org
 *                                        lane always resolves to the existing SSi Premium
 *                                        product. Falls through schoolTeacherMonthlyPriceId
 *                                        and teacherMonthlyPriceId's env vars first, then
 *                                        lands on the in-repo SSI_PREMIUM_MONTHLY_PRICE_ID
 *                                        constant — so it resolves correctly even with zero
 *                                        Vercel env config. The webhook tells the lanes
 *                                        apart by customData.kind ('org_platform' vs
 *                                        'school_platform'), never by price id.
 *   VITE_PADDLE_ORG_SEAT_PRICE_ANNUAL  — pri_… for £150/seat/yr ORG PLATFORM. Same
 *                                        fallback reasoning — ends on
 *                                        SSI_PREMIUM_ANNUAL_PRICE_ID when unset.
 *
 * Every value is trimmed at read — Vercel's env-var entry flow can capture
 * trailing newlines, and an untrimmed "pri_…\n" makes Paddle 400 with
 * entity_not_found on checkout.
 */

import { initializePaddle, type Paddle } from '@paddle/paddle-js'

function trimEnv(v: string | undefined): string | undefined {
  const t = v?.trim()
  return t ? t : undefined
}

// The live SSi Premium (consumer) Paddle prices — the ONE product every
// per-seat/per-tutor lane ultimately falls back to when its own env var is
// unset. Named here so the org lane (below) can fall back to them directly
// in-repo, rather than only through a chain of raw env-var reads that go
// undefined if Vercel env isn't configured (founder ruling 2026-08-02: the
// org lane must use the existing SSi Premium product, never a separate one).
const SSI_PREMIUM_MONTHLY_PRICE_ID = 'pri_01kqq85gvncyasfmfvvpcv1xfg'
const SSI_PREMIUM_ANNUAL_PRICE_ID = 'pri_01kqq86ymc3yhm8be3w7f7kgr1'

export const paddleConfig = {
  clientToken: trimEnv(import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined),
  env: trimEnv(import.meta.env.VITE_PADDLE_ENV as string | undefined) || 'sandbox',
  // Env wins, but fall back to the live SSi Premium price IDs so checkout works
  // without per-environment config (matches the student-price pattern). Prices
  // change rarely; regional variation is Paddle country-specific prices ON THE
  // SAME price ID, so no extra IDs/env vars are needed for regions.
  teacherMonthlyPriceId:
    trimEnv(import.meta.env.VITE_PADDLE_TEACHER_PRICE_MONTHLY as string | undefined) ||
    SSI_PREMIUM_MONTHLY_PRICE_ID, // £15/mo SSi Premium
  teacherAnnualPriceId:
    trimEnv(import.meta.env.VITE_PADDLE_TEACHER_PRICE_ANNUAL as string | undefined) ||
    SSI_PREMIUM_ANNUAL_PRICE_ID, // £150/yr SSi Premium
  studentMonthlyPriceId: trimEnv(import.meta.env.VITE_PADDLE_STUDENT_PRICE_MONTHLY as string | undefined),
  studentSchoolMonthlyPriceId: trimEnv(import.meta.env.VITE_PADDLE_STUDENT_SCHOOL_PRICE_MONTHLY as string | undefined),
  studentAnnualPriceId: trimEnv(import.meta.env.VITE_PADDLE_STUDENT_PRICE_ANNUAL as string | undefined),
  studentSchoolAnnualPriceId: trimEnv(import.meta.env.VITE_PADDLE_STUDENT_SCHOOL_PRICE_ANNUAL as string | undefined),
  // School platform — £15/teacher/mo, per-seat. There is only ONE £15 Paddle
  // price underneath: a school is just quantity>1 of the same per-unit price as
  // the tutor plan (the webhook tells them apart by customData.kind, NOT by
  // price). So this falls back to the teacher price when its own env var isn't
  // set — no separate Paddle product/price needed. The school checkout sends
  // quantity = teacher seats; the webhook (kind:'school_platform') reads it back.
  schoolTeacherMonthlyPriceId:
    trimEnv(import.meta.env.VITE_PADDLE_SCHOOL_TEACHER_PRICE_MONTHLY as string | undefined) ||
    trimEnv(import.meta.env.VITE_PADDLE_TEACHER_PRICE_MONTHLY as string | undefined),
  // School ANNUAL platform price — same single-product reasoning as the monthly
  // fallback above: there is ONE per-seat annual Paddle price (a school is just
  // quantity>1 of the same per-unit price as the tutor annual plan). Falls back
  // to the tutor annual price when its own env var isn't set, so no separate
  // Paddle product is required.
  // ⚠️ OPERATOR NOTE: for annual checkout to charge correctly the actual annual
  // Paddle prices + env vars (VITE_PADDLE_TEACHER_PRICE_ANNUAL /
  // VITE_PADDLE_SCHOOL_TEACHER_PRICE_ANNUAL) must be configured. When unset the
  // UI disables the annual option (graceful) rather than opening a broken checkout.
  schoolTeacherAnnualPriceId:
    trimEnv(import.meta.env.VITE_PADDLE_SCHOOL_TEACHER_PRICE_ANNUAL as string | undefined) ||
    trimEnv(import.meta.env.VITE_PADDLE_TEACHER_PRICE_ANNUAL as string | undefined),
  // Org / workplace platform — founder ruling 2026-08-02: no separate org-seat
  // Paddle product exists or should exist. The org lane uses the EXISTING SSi
  // Premium product, same £15/seat/mo, £150/seat/yr as the school teacher
  // seat. Falls through env overrides first, then lands on the in-repo SSi
  // Premium constants (not just a further env-var read) so checkout resolves
  // correctly even when none of the Vercel env vars are configured.
  orgSeatMonthlyPriceId:
    trimEnv(import.meta.env.VITE_PADDLE_ORG_SEAT_PRICE_MONTHLY as string | undefined) ||
    trimEnv(import.meta.env.VITE_PADDLE_SCHOOL_TEACHER_PRICE_MONTHLY as string | undefined) ||
    trimEnv(import.meta.env.VITE_PADDLE_TEACHER_PRICE_MONTHLY as string | undefined) ||
    SSI_PREMIUM_MONTHLY_PRICE_ID,
  orgSeatAnnualPriceId:
    trimEnv(import.meta.env.VITE_PADDLE_ORG_SEAT_PRICE_ANNUAL as string | undefined) ||
    trimEnv(import.meta.env.VITE_PADDLE_SCHOOL_TEACHER_PRICE_ANNUAL as string | undefined) ||
    trimEnv(import.meta.env.VITE_PADDLE_TEACHER_PRICE_ANNUAL as string | undefined) ||
    SSI_PREMIUM_ANNUAL_PRICE_ID,
  extraClassMonthlyPriceId: trimEnv(import.meta.env.VITE_PADDLE_EXTRA_CLASS_MONTHLY as string | undefined),
  extraClassAnnualPriceId: trimEnv(import.meta.env.VITE_PADDLE_EXTRA_CLASS_ANNUAL as string | undefined),
  familyMonthlyPriceId: trimEnv(import.meta.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY as string | undefined),
  familyAnnualPriceId: trimEnv(import.meta.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL as string | undefined),
} as const

let paddleInstance: Paddle | null = null
let loadingPromise: Promise<Paddle> | null = null

export async function getPaddle(): Promise<Paddle> {
  if (paddleInstance) return paddleInstance
  if (loadingPromise) return loadingPromise

  const token = paddleConfig.clientToken
  if (!token) {
    throw new Error('VITE_PADDLE_CLIENT_TOKEN is not configured')
  }

  const environment = paddleConfig.env === 'production' ? 'production' : 'sandbox'

  loadingPromise = (async () => {
    const instance = await initializePaddle({ token, environment })
    if (!instance) throw new Error('Failed to initialize Paddle.js')
    paddleInstance = instance
    return instance
  })()

  try {
    return await loadingPromise
  } catch (err) {
    // Don't cache a rejected promise: a transient init failure would otherwise
    // be handed to every future getPaddle() caller, permanently breaking
    // checkout for the whole session. Reset so the next call can retry.
    loadingPromise = null
    throw err
  }
}
