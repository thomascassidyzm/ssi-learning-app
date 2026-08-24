/**
 * loginCode — the failed-login-code audit trail and the idempotent
 * already-signed-in check (2026-08-10).
 *
 * The hard constraint under test: the submitted code NEVER reaches telemetry.
 * The payload is email + screen + a normalised error type, and nothing else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { events, flush } = vi.hoisted(() => ({ events: [] as any[], flush: vi.fn() }))

vi.mock('../composables/usePlayerLog', () => ({
  usePlayerLog: () => ({
    sessionId: 'test-session',
    event: (type: string, payload: any) => { events.push({ type, payload }) },
    flush,
  }),
}))

import {
  classifyOtpError,
  hasLiveSessionFor,
  useLoginCodeAudit,
  LOGIN_CODE_FAILED,
  LOGIN_CODE_ALREADY_SIGNED_IN,
} from './loginCode'

describe('classifyOtpError', () => {
  it('folds Supabase\'s one generic message into expired_or_invalid', () => {
    // Wrong, expired and already-used all arrive as this single string — the
    // reason the EVENT matters more than the text.
    expect(classifyOtpError('Token has expired or is invalid')).toBe('expired_or_invalid')
  })

  it('separates the causes it genuinely can', () => {
    expect(classifyOtpError('Email rate limit exceeded')).toBe('rate_limited')
    expect(classifyOtpError('For security purposes, you can only request this after 51 seconds')).toBe('rate_limited')
    expect(classifyOtpError('Failed to fetch')).toBe('network')
    expect(classifyOtpError('unexpected_failure')).toBe('server')
    expect(classifyOtpError('something else entirely')).toBe('other')
    expect(classifyOtpError(undefined)).toBe('other')
  })
})

describe('hasLiveSessionFor', () => {
  const client = (user: any) => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: user ? { user } : null } }) } })

  it('is true when the live session belongs to the address being verified', async () => {
    expect(await hasLiveSessionFor(client({ email: 'Aran@Hey.com' }), 'aran@hey.com ')).toBe(true)
  })

  it('is false when there is no session, a different address, or no client', async () => {
    expect(await hasLiveSessionFor(client(null), 'aran@hey.com')).toBe(false)
    expect(await hasLiveSessionFor(client({ email: 'someone@else.com' }), 'aran@hey.com')).toBe(false)
    expect(await hasLiveSessionFor(null, 'aran@hey.com')).toBe(false)
  })

  it('answers "no session" rather than throwing when the client blows up — the pre-existing error behaviour is left exactly as it was', async () => {
    const angry = { auth: { getSession: vi.fn().mockRejectedValue(new Error('offline')) } }
    expect(await hasLiveSessionFor(angry, 'aran@hey.com')).toBe(false)
  })
})

describe('useLoginCodeAudit', () => {
  beforeEach(() => { events.length = 0; flush.mockClear() })

  it('emits exactly one login_code_failed carrying email, screen and error type — and NOTHING resembling the code', () => {
    const audit = useLoginCodeAudit('redeem-code')
    audit.failed(' Aran@Hey.com ', 'Token has expired or is invalid')

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(LOGIN_CODE_FAILED)
    expect(events[0].payload).toEqual({
      screen: 'redeem-code',
      email: 'aran@hey.com',
      error_type: 'expired_or_invalid',
    })
    // THE PIN: no submitted token, no raw error text, no session tokens.
    expect(JSON.stringify(events[0].payload)).not.toMatch(/\d{6}/)
    expect(flush).toHaveBeenCalled()
  })

  it('records an already-live-session resubmit as its OWN event, never as a failure', () => {
    const audit = useLoginCodeAudit('sign-in-modal')
    audit.alreadySignedIn('aran@hey.com')

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(LOGIN_CODE_ALREADY_SIGNED_IN)
    expect(events[0].type).not.toBe(LOGIN_CODE_FAILED)
    expect(events[0].payload).toEqual({ screen: 'sign-in-modal', email: 'aran@hey.com' })
  })

  it('never lets a logging failure become a login failure', () => {
    flush.mockImplementationOnce(() => { throw new Error('network is on fire') })
    const audit = useLoginCodeAudit('onboarding')
    expect(() => audit.failed('aran@hey.com', 'Token has expired or is invalid')).not.toThrow()
  })
})
