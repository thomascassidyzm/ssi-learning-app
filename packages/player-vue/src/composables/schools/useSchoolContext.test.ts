import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('useSchoolContext — platform gate (past_due dunning grace)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function withUser(overrides: Record<string, unknown>) {
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ;(ctx.currentUser as any).value = {
      user_id: 'u1',
      learner_id: 'l1',
      display_name: 'Test',
      educational_role: 'school_admin',
      platform_role: null,
      ...overrides,
    }
    return ctx
  }

  it('past_due RETAINS access (dunning grace)', async () => {
    const ctx = await withUser({ platform_status: 'past_due' })
    expect(ctx.platformActive.value).toBe(true)
    expect(ctx.platformPastDue.value).toBe(true)
  })

  it('active has no past-due banner', async () => {
    const ctx = await withUser({ platform_status: 'active' })
    expect(ctx.platformActive.value).toBe(true)
    expect(ctx.platformPastDue.value).toBe(false)
  })

  it('expired locks and has no past-due banner', async () => {
    const ctx = await withUser({ platform_status: 'expired' })
    expect(ctx.platformActive.value).toBe(false)
    expect(ctx.platformPastDue.value).toBe(false)
  })

  it('cancelled locks', async () => {
    const ctx = await withUser({ platform_status: 'cancelled' })
    expect(ctx.platformActive.value).toBe(false)
  })

  it('an elapsed trial locks', async () => {
    const ctx = await withUser({
      platform_status: 'trial',
      platform_expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    expect(ctx.platformActive.value).toBe(false)
  })

  it('an open trial (future expiry) is active', async () => {
    const ctx = await withUser({
      platform_status: 'trial',
      platform_expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    })
    expect(ctx.platformActive.value).toBe(true)
  })

  it('a null status fails open', async () => {
    const ctx = await withUser({ platform_status: null })
    expect(ctx.platformActive.value).toBe(true)
    expect(ctx.platformPastDue.value).toBe(false)
  })

  it('govt_admin is never gated, even past_due', async () => {
    const ctx = await withUser({ educational_role: 'govt_admin', platform_status: 'past_due' })
    expect(ctx.platformActive.value).toBe(true)
  })
})
