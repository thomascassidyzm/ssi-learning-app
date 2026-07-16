import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { useResolvedSession } from './useResolvedSession'
import { useUserRole } from './useUserRole'

describe('useResolvedSession', () => {
  beforeEach(() => {
    localStorage.clear()
    useUserRole().clear()
    useResolvedSession().reset()
  })

  it('starts pending — nobody has called resolve() yet', () => {
    const { isResolved, status } = useResolvedSession()
    expect(status.value).toBe('pending')
    expect(isResolved.value).toBe(false)
  })

  it('a guest resolves immediately — nothing else to wait for', () => {
    const { resolve, isResolved, status } = useResolvedSession()
    resolve(false)
    expect(status.value).toBe('guest')
    expect(isResolved.value).toBe(true)
  })

  it('an authenticated session is NOT resolved until the role row also loads', () => {
    const { resolve, isResolved } = useResolvedSession()
    resolve(true)
    expect(isResolved.value).toBe(false) // role not synced yet — the exact race this gate exists to close

    useUserRole().initialize('ssi_admin', null)
    expect(isResolved.value).toBe(true)
  })

  it('whenResolved() resolves immediately when already resolved', async () => {
    const { resolve, whenResolved } = useResolvedSession()
    resolve(false)
    let settled = false
    whenResolved().then(() => { settled = true })
    await nextTick()
    expect(settled).toBe(true)
  })

  it('whenResolved() waits for a later resolve() + role sync, in either order', async () => {
    const { resolve, whenResolved } = useResolvedSession()
    let settled = false
    whenResolved().then(() => { settled = true })

    resolve(true)
    await nextTick()
    expect(settled).toBe(false) // role still unknown

    useUserRole().initialize('ssi_admin', 'teacher')
    await nextTick()
    expect(settled).toBe(true)
  })

  it('whenResolved() waits when the role syncs before resolve() is called', async () => {
    const { resolve, whenResolved } = useResolvedSession()
    // A caller could in principle observe roleInitialized flip first
    // (defensive ordering) — the gate must still require BOTH signals.
    useUserRole().initialize('ssi_admin', 'teacher')
    let settled = false
    whenResolved().then(() => { settled = true })
    await nextTick()
    expect(settled).toBe(false)

    resolve(true)
    await nextTick()
    expect(settled).toBe(true)
  })

  it('reset() returns the gate to pending for a fresh sign-out / test run', () => {
    const { resolve, reset, isResolved, status } = useResolvedSession()
    resolve(false)
    expect(isResolved.value).toBe(true)

    reset()
    expect(status.value).toBe('pending')
    expect(isResolved.value).toBe(false)
  })
})
