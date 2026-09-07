/**
 * The browser half of the squat-takeover fix (job #345).
 *
 * The server decides whether an account is claimed — these are about the two
 * things the browser must get right either side of that: adopt the replacement
 * session when there is one, and never let a failure here stop somebody
 * signing in.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { claimAccountIfNeeded, __resetClaimMemo } from './claimAccount'

const TOKEN = 'access-token-just-issued'

function makeClient() {
  return { auth: { setSession: vi.fn().mockResolvedValue({ error: null }) } }
}
function respond(body: any, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }))
}

beforeEach(() => __resetClaimMemo())
afterEach(() => vi.unstubAllGlobals())

describe('claimAccountIfNeeded', () => {
  it('adopts the replacement session when the account is claimed', async () => {
    respond({ claimed: true, session: { access_token: 'fresh-at', refresh_token: 'fresh-rt' } })
    const client = makeClient()
    const result = await claimAccountIfNeeded(client as any, TOKEN)

    expect(result.claimed).toBe(true)
    // Claiming revokes every session including the one that just signed in,
    // so failing to adopt the replacement would sign the person straight out.
    expect(client.auth.setSession).toHaveBeenCalledWith({ access_token: 'fresh-at', refresh_token: 'fresh-rt' })
    expect((fetch as any).mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('does nothing at all when there is nothing to claim', async () => {
    respond({ claimed: false })
    const client = makeClient()
    expect((await claimAccountIfNeeded(client as any, TOKEN)).claimed).toBe(false)
    expect(client.auth.setSession).not.toHaveBeenCalled()
  })

  it('asks once per token, so adopting the new session cannot loop', async () => {
    respond({ claimed: true, session: { access_token: 'fresh-at', refresh_token: 'fresh-rt' } })
    const client = makeClient()
    await claimAccountIfNeeded(client as any, TOKEN)
    await claimAccountIfNeeded(client as any, TOKEN)
    expect((fetch as any).mock.calls.length).toBe(1)
  })

  it('never throws and never blocks sign-in when the call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const client = makeClient()
    // Failing closed here would lock people out of their own accounts over a
    // network blip — a worse bug than the one this closes. The account stays
    // marked unclaimed, so the next sign-in tries again.
    await expect(claimAccountIfNeeded(client as any, TOKEN)).resolves.toEqual({ claimed: false })
    expect(client.auth.setSession).not.toHaveBeenCalled()
  })

  it('reports a claim with no replacement session rather than pretending', async () => {
    respond({ claimed: true, session: null })
    const client = makeClient()
    expect((await claimAccountIfNeeded(client as any, TOKEN)).claimed).toBe(true)
    expect(client.auth.setSession).not.toHaveBeenCalled()
  })

  it('ignores an empty token', async () => {
    respond({ claimed: true })
    expect((await claimAccountIfNeeded(makeClient() as any, '')).claimed).toBe(false)
  })
})
