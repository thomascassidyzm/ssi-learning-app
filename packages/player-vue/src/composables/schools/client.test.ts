import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('schools/client', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('throws if getSchoolsClient called before setSchoolsClient', async () => {
    const { getSchoolsClient } = await import('./client')
    expect(() => getSchoolsClient()).toThrow('[schools] Supabase client not set')
  })

  it('returns client after setSchoolsClient', async () => {
    const { setSchoolsClient, getSchoolsClient } = await import('./client')
    const fakeClient = { from: vi.fn() } as any
    setSchoolsClient(fakeClient)
    expect(getSchoolsClient()).toBe(fakeClient)
  })

  it('replaces client on re-set', async () => {
    const { setSchoolsClient, getSchoolsClient } = await import('./client')
    const client1 = { from: vi.fn() } as any
    const client2 = { from: vi.fn() } as any
    setSchoolsClient(client1)
    setSchoolsClient(client2)
    expect(getSchoolsClient()).toBe(client2)
  })
})
