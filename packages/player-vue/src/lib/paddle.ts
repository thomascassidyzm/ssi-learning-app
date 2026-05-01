/**
 * Paddle.js loader + env config — lazy, singleton.
 *
 * Env (build-time, Vite):
 *   VITE_PADDLE_CLIENT_TOKEN          — client-side token from Paddle
 *   VITE_PADDLE_ENV                   — 'sandbox' (default) or 'production'
 *   VITE_PADDLE_TEACHER_PRICE_MONTHLY — pri_… for £15/mo SSi Premium
 *   VITE_PADDLE_TEACHER_PRICE_ANNUAL  — pri_… for £150/yr SSi Premium (unwired)
 *   VITE_PADDLE_STUDENT_PRICE_MONTHLY — pri_… for £10/mo student-via-teacher
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
