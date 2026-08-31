/**
 * The grant is the SERVER's, and a failure to ask is not an answer.
 *
 * Two things are being pinned. First, that a client cannot talk itself into the
 * test doors — no token, a 401 or a 403 all leave the grant closed, which is the
 * whole reason this exists (the client's own `isSsiAdmin` comes back out of
 * localStorage and is forgeable). Second, that nothing is persisted: a stored
 * grant would put the answer back in the hands of the person being checked.
 *
 * And the case that is easy to get backwards: a 500 or a dropped connection is
 * the question not having been PUT, not a denial. Treating it as a denial would
 * take a real admin's controls away mid-session on a blip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTestDoorPermission } from './useTestDoorPermission'

const ADMIN_TOKEN = async () => 'a-real-session-token'
const NO_TOKEN = async () => null

function respond(status: number) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ status })))
}

describe('useTestDoorPermission', () => {
  beforeEach(() => {
    useTestDoorPermission().reset()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('is closed until the server has said otherwise', () => {
    const { allowed, checked } = useTestDoorPermission()
    expect(allowed.value).toBe(false)
    expect(checked.value).toBe(false)
  })

  it('opens on a 200', async () => {
    respond(200)
    const { allowed, check, checked } = useTestDoorPermission()
    expect(await check(ADMIN_TOKEN)).toBe(true)
    expect(allowed.value).toBe(true)
    expect(checked.value).toBe(true)
  })

  it('stays closed for a learner the server refuses (403)', async () => {
    // This is the forged-localStorage-role case arriving at the only check that
    // the forger does not control.
    respond(403)
    const { allowed, check } = useTestDoorPermission()
    expect(await check(ADMIN_TOKEN)).toBe(false)
    expect(allowed.value).toBe(false)
  })

  it('stays closed for an unauthenticated caller (401)', async () => {
    respond(401)
    const { allowed, check } = useTestDoorPermission()
    expect(await check(ADMIN_TOKEN)).toBe(false)
    expect(allowed.value).toBe(false)
  })

  it('never spends a request when there is no session at all', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const { allowed, check } = useTestDoorPermission()
    expect(await check(NO_TOKEN)).toBe(false)
    expect(allowed.value).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('does not revoke a live grant on a 500 — that is a blip, not a demotion', async () => {
    respond(200)
    const { allowed, check } = useTestDoorPermission()
    await check(ADMIN_TOKEN)
    expect(allowed.value).toBe(true)

    respond(500)
    expect(await check(ADMIN_TOKEN)).toBe(true)
    expect(allowed.value).toBe(true)
  })

  it('does not revoke a live grant when the request cannot be made at all', async () => {
    respond(200)
    const { allowed, check } = useTestDoorPermission()
    await check(ADMIN_TOKEN)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await check(ADMIN_TOKEN)).toBe(true)
    expect(allowed.value).toBe(true)
  })

  it('never grants on a 500 that arrives before any grant exists', async () => {
    respond(500)
    const { allowed, check } = useTestDoorPermission()
    expect(await check(ADMIN_TOKEN)).toBe(false)
    expect(allowed.value).toBe(false)
  })

  it('persists nothing — a stored grant would be forgeable, which is the hole', async () => {
    respond(200)
    await useTestDoorPermission().check(ADMIN_TOKEN)
    expect(Object.keys(localStorage)).toEqual([])
    expect(Object.keys(sessionStorage)).toEqual([])
  })

  it('de-dupes concurrent asks into one request', async () => {
    const f = vi.fn(async () => ({ status: 200 }))
    vi.stubGlobal('fetch', f)
    const { check } = useTestDoorPermission()
    const [a, b, c] = await Promise.all([
      check(ADMIN_TOKEN), check(ADMIN_TOKEN), check(ADMIN_TOKEN),
    ])
    expect([a, b, c]).toEqual([true, true, true])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('sends the bearer token to the admin route', async () => {
    const f = vi.fn(async () => ({ status: 200 }))
    vi.stubGlobal('fetch', f)
    await useTestDoorPermission().check(ADMIN_TOKEN)
    expect(f).toHaveBeenCalledWith('/api/admin/test-doors', {
      headers: { Authorization: 'Bearer a-real-session-token' },
    })
  })
})
