/**
 * The plan has to be waiting when they come back from their mailbox.
 *
 * Tom's ruling (2026-09-07) put an emailed code back in front of the card
 * field, on the condition that verifying "should take them straight back to the
 * payment page they previously clicked on". Every case here is a way that
 * journey can go wrong.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  savePendingIntent,
  readPendingIntent,
  clearPendingIntent,
  rememberIntentEmail,
  INTENT_TTL_MS,
} from './pendingIntent'

const FAMILY = { plan: 'family', billingPeriod: 'monthly', courseCode: 'cym_for_eng', email: null } as const

beforeEach(() => {
  localStorage.clear()
})

describe('the chosen plan survives the email round-trip', () => {
  it('comes back exactly as it went in', () => {
    savePendingIntent({ ...FAMILY })
    const back = readPendingIntent()
    expect(back?.plan).toBe('family')
    expect(back?.billingPeriod).toBe('monthly')
    expect(back?.courseCode).toBe('cym_for_eng')
  })

  it('SURVIVES A COLD START — which in-memory refs did not', () => {
    savePendingIntent({ ...FAMILY })
    // A phone tearing the PWA down while somebody reads their email loses every
    // ref in the module. Storage is the only thing left, and it is the whole
    // reason this file exists.
    expect(readPendingIntent()?.plan).toBe('family')
  })

  it('remembers the address the code went to, so the code step survives a reload too', () => {
    savePendingIntent({ ...FAMILY })
    rememberIntentEmail('buyer@example.test')
    expect(readPendingIntent()?.email).toBe('buyer@example.test')
  })

  it('does not age the intent when the address is added', () => {
    const t0 = Date.now() - INTENT_TTL_MS + 5_000
    savePendingIntent({ ...FAMILY }, t0)
    rememberIntentEmail('buyer@example.test')
    // The clock must still be the ORIGINAL choice's clock; refreshing it here
    // would let an intent live for ever by being touched.
    expect(readPendingIntent()?.savedAt).toBe(t0)
  })

  it('is spent once, so a resume cannot fire twice for one decision', () => {
    savePendingIntent({ ...FAMILY })
    clearPendingIntent()
    expect(readPendingIntent()).toBeNull()
  })

  it('expires — a plan chosen last week is litter, not an intention', () => {
    savePendingIntent({ ...FAMILY }, Date.now() - INTENT_TTL_MS - 1)
    expect(readPendingIntent()).toBeNull()
  })

  it('is still live just inside the window', () => {
    savePendingIntent({ ...FAMILY }, Date.now() - INTENT_TTL_MS + 10_000)
    expect(readPendingIntent()?.plan).toBe('family')
  })

  it('refuses a future-dated intent — that is a moved clock, not a choice', () => {
    savePendingIntent({ ...FAMILY }, Date.now() + 60_000)
    expect(readPendingIntent()).toBeNull()
  })

  it('refuses anything it cannot read cleanly, because the wrong plan takes real money', () => {
    localStorage.setItem('ssi_checkout_intent_v1', 'not json')
    expect(readPendingIntent()).toBeNull()
    localStorage.setItem('ssi_checkout_intent_v1', JSON.stringify({ plan: 'enterprise', billingPeriod: 'monthly', savedAt: Date.now() }))
    expect(readPendingIntent()).toBeNull()
    localStorage.setItem('ssi_checkout_intent_v1', JSON.stringify({ plan: 'family', billingPeriod: 'weekly', savedAt: Date.now() }))
    expect(readPendingIntent()).toBeNull()
    localStorage.setItem('ssi_checkout_intent_v1', JSON.stringify({ plan: 'family', billingPeriod: 'monthly' }))
    expect(readPendingIntent()).toBeNull()
  })

  it('reads nothing when nothing was ever chosen', () => {
    expect(readPendingIntent()).toBeNull()
  })
})
