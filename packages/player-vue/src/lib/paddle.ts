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

export const paddleConfig = {
  clientToken: trimEnv(import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined),
  env: trimEnv(import.meta.env.VITE_PADDLE_ENV as string | undefined) || 'sandbox',
  teacherMonthlyPriceId: trimEnv(import.meta.env.VITE_PADDLE_TEACHER_PRICE_MONTHLY as string | undefined),
  teacherAnnualPriceId: trimEnv(import.meta.env.VITE_PADDLE_TEACHER_PRICE_ANNUAL as string | undefined),
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
  extraClassMonthlyPriceId: trimEnv(import.meta.env.VITE_PADDLE_EXTRA_CLASS_MONTHLY as string | undefined),
  extraClassAnnualPriceId: trimEnv(import.meta.env.VITE_PADDLE_EXTRA_CLASS_ANNUAL as string | undefined),
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

  return loadingPromise
}
