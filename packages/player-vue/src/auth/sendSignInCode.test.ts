/**
 * The fallback is the safety property: a broken mailer must degrade to the
 * old Supabase email, never to a person who cannot sign in. The one refusal
 * we honour is a 429 — laundering a real rate limit into a second send would
 * defeat the limiter the route depends on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendSignInCode } from './sendSignInCode'

const client = () => ({ auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: null }) } })

beforeEach(() => { vi.restoreAllMocks() })

describe('sendSignInCode', () => {
  it('sends through our own route when it works, and does not touch Supabase', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const c = client()
    const r = await sendSignInCode(c, ' Rob@Example.com ')
    expect(r.error).toBeUndefined()
    expect(r.via).toBe('resend')
    expect(c.auth.signInWithOtp).not.toHaveBeenCalled()
    expect((fetch as any).mock.calls[0][1].body).toBe(JSON.stringify({ email: 'Rob@Example.com' }))
  })

  it('falls back to Supabase when the route is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }))
    const c = client()
    const r = await sendSignInCode(c, 'rob@example.com')
    expect(r.error).toBeUndefined()
    expect(r.via).toBe('supabase')
    expect(c.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'rob@example.com' })
  })

  it('falls back when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const c = client()
    const r = await sendSignInCode(c, 'rob@example.com')
    expect(r.via).toBe('supabase')
    expect(c.auth.signInWithOtp).toHaveBeenCalled()
  })

  it('honours a 429 instead of re-sending through Supabase', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ error: 'Please wait a few minutes.' }),
    }))
    const c = client()
    const r = await sendSignInCode(c, 'rob@example.com')
    expect(r.error?.message).toBe('Please wait a few minutes.')
    expect(c.auth.signInWithOtp).not.toHaveBeenCalled()
  })

  it('reports a Supabase failure in the fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }))
    const c = client()
    c.auth.signInWithOtp = vi.fn().mockResolvedValue({ error: { message: 'rate limited' } })
    const r = await sendSignInCode(c, 'rob@example.com')
    expect(r.error?.message).toBe('rate limited')
  })
})
