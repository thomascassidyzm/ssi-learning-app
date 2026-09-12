/**
 * classPractice7d — a failure never resolves null: it throws with the status
 * and the server's message, after one retry for the transient kinds (job #301).
 */
import { describe, it, expect, vi } from 'vitest'
import { fetchClassPractice7d, ClassPracticeFetchError } from './classPractice7d'

const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } as any
const user = { user_id: 'a', learner_id: 'l', display_name: 'A', educational_role: 'school_admin', platform_role: null, school_id: 's1', _scopeSource: 'admin-view' } as any

describe('fetchClassPractice7d failure handling', () => {
  it('throws ClassPracticeFetchError with the status and message on a 403, without retrying', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'coverage_expired', message: 'This school’s platform coverage has expired.' }) }))
    globalThis.fetch = fetchMock as any
    await expect(fetchClassPractice7d(['c1'], user, client)).rejects.toMatchObject({ name: 'ClassPracticeFetchError', status: 403, message: 'This school’s platform coverage has expired.' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String((fetchMock.mock.calls as unknown as unknown[][])[0][0])).toContain('school_id=s1')
  })

  it('retries once on a 5xx and returns the payload when the retry lands', async () => {
    let n = 0
    globalThis.fetch = vi.fn(async () => {
      n += 1
      if (n === 1) return { ok: false, status: 504, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ practiceByClass: { c1: 60 }, activeDaysByClass: { c1: 1 }, classAccountByClass: { c1: { started: true } } }) }
    }) as any
    const data = await fetchClassPractice7d(['c1'], user, client)
    expect(n).toBe(2)
    expect(data.practiceByClass.c1).toBe(60)
  })

  it('a network error that persists surfaces as status 0 after the retry', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Load failed') })
    globalThis.fetch = fetchMock as any
    const err = await fetchClassPractice7d(['c1'], user, client).catch((e) => e)
    expect(err).toBeInstanceOf(ClassPracticeFetchError)
    expect(err.status).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('no session throws 401 without touching the network', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as any
    const noSession = { auth: { getSession: async () => ({ data: { session: null } }) } } as any
    await expect(fetchClassPractice7d(['c1'], user, noSession)).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
