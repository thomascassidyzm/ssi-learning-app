/**
 * Paddle.js loader — lazy, singleton.
 *
 * Env (build-time, Vite):
 *   VITE_PADDLE_CLIENT_TOKEN — client-side token from Paddle
 *   VITE_PADDLE_ENV          — 'sandbox' (default) or 'production'
 *   VITE_PADDLE_STUDENT_PRICES — semicolon-delimited "tier:priceId;..." map
 *                                 e.g. "5:pri_01x;6:pri_01y;...;15:pri_01z"
 */

import { initializePaddle, type Paddle } from '@paddle/paddle-js'

let paddleInstance: Paddle | null = null
let loadingPromise: Promise<Paddle> | null = null

export async function getPaddle(): Promise<Paddle> {
  if (paddleInstance) return paddleInstance
  if (loadingPromise) return loadingPromise

  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined
  const envRaw = (import.meta.env.VITE_PADDLE_ENV as string | undefined) || 'sandbox'
  const environment = envRaw === 'production' ? 'production' : 'sandbox'

  if (!token) {
    throw new Error('VITE_PADDLE_CLIENT_TOKEN is not configured')
  }

  loadingPromise = (async () => {
    const instance = await initializePaddle({ token, environment })
    if (!instance) throw new Error('Failed to initialize Paddle.js')
    paddleInstance = instance
    return instance
  })()

  return loadingPromise
}

/**
 * Parse the VITE_PADDLE_STUDENT_PRICES env var into a tier→priceId map.
 * Returns the Paddle Price ID for a given price tier in pounds (5..15).
 */
let studentPriceMap: Record<number, string> | null = null

function getStudentPriceMap(): Record<number, string> {
  if (studentPriceMap) return studentPriceMap
  const raw = (import.meta.env.VITE_PADDLE_STUDENT_PRICES as string | undefined) || ''
  const map: Record<number, string> = {}
  for (const pair of raw.split(';')) {
    const [tierStr, id] = pair.split(':')
    const tier = parseInt(tierStr, 10)
    if (!isNaN(tier) && id) map[tier] = id.trim()
  }
  studentPriceMap = map
  return map
}

export function studentPriceIdFor(tierPounds: number): string | null {
  return getStudentPriceMap()[tierPounds] || null
}
