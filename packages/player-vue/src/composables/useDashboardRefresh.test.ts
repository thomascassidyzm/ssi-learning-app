/**
 * useDashboardRefresh — the ONE refresh protocol.
 *
 * Pins the founder ruling (2026-07-19): a single, deliberate, human-driven
 * refresh; a failed refresh must never look "up to date"; the button only
 * appears where a loader is registered; no auto-refresh anywhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

// The composable is a module-level singleton — reset the module between tests
// so each gets fresh handler/timestamp state.
async function fresh() {
  vi.resetModules()
  return (await import('./useDashboardRefresh')).useDashboardRefresh()
}

afterEach(() => { vi.restoreAllMocks() })

describe('useDashboardRefresh', () => {
  it('exposes no handler until one registers, and drops it on scope dispose', async () => {
    const api = await fresh()
    expect(api.hasHandler.value).toBe(false)

    const scope = effectScope()
    scope.run(() => api.registerRefresh(async () => {}, { immediate: false }))
    expect(api.hasHandler.value).toBe(true)

    scope.stop() // simulates the page unmounting
    expect(api.hasHandler.value).toBe(false)
  })

  it('refresh runs the registered loader and stamps "Updated HH:MM" on success', async () => {
    const api = await fresh()
    const loader = vi.fn(async () => {})
    const scope = effectScope()
    scope.run(() => api.registerRefresh(loader, { immediate: false }))

    expect(api.updatedLabel.value).toBe('')
    await api.refresh()

    expect(loader).toHaveBeenCalledTimes(1)
    expect(api.updatedLabel.value).toMatch(/^\d{2}:\d{2}$/)
    scope.stop()
  })

  it('does NOT stamp when the loader throws — a failed refresh never looks fresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = await fresh()
    const scope = effectScope()
    scope.run(() =>
      api.registerRefresh(async () => { throw new Error('network down') }, { immediate: false }),
    )

    await api.refresh()
    expect(api.updatedLabel.value).toBe('') // still no timestamp
    expect(api.isRefreshing.value).toBe(false) // spinner released
    scope.stop()
  })

  it('is a no-op when nothing is registered', async () => {
    const api = await fresh()
    await api.refresh()
    expect(api.updatedLabel.value).toBe('')
    expect(api.isRefreshing.value).toBe(false)
  })

  it('immediate:true loads once through refresh (initial load shows spinner + stamp)', async () => {
    const api = await fresh()
    const loader = vi.fn(async () => {})
    const scope = effectScope()
    scope.run(() => api.registerRefresh(loader, { immediate: true }))

    // registerRefresh fires `void refresh()` — flush past the async handler
    // and the post-await stamp assignment.
    await new Promise((r) => setTimeout(r))
    expect(loader).toHaveBeenCalledTimes(1)
    expect(api.updatedLabel.value).toMatch(/^\d{2}:\d{2}$/)
    scope.stop()
  })

  it('guards against overlapping refreshes (double-tap / button + pull race)', async () => {
    const api = await fresh()
    let resolveLoader: () => void = () => {}
    const loader = vi.fn(() => new Promise<void>((r) => { resolveLoader = r }))

    const scope = effectScope()
    scope.run(() => api.registerRefresh(loader, { immediate: false }))

    const first = api.refresh() // starts, stays pending
    expect(api.isRefreshing.value).toBe(true)
    await api.refresh() // second call is a no-op while the first is in flight
    expect(loader).toHaveBeenCalledTimes(1)

    resolveLoader()
    await first
    expect(api.isRefreshing.value).toBe(false)
    scope.stop()
  })

  it('clears the stamp when a new surface registers (timestamp always describes THIS page)', async () => {
    const api = await fresh()
    const scopeA = effectScope()
    scopeA.run(() => api.registerRefresh(async () => {}, { immediate: false }))
    await api.refresh()
    expect(api.updatedLabel.value).toMatch(/^\d{2}:\d{2}$/)

    // A different page mounts and registers — the inherited stamp must reset.
    const scopeB = effectScope()
    scopeB.run(() => api.registerRefresh(async () => {}, { immediate: false }))
    expect(api.updatedLabel.value).toBe('')
    scopeA.stop()
    scopeB.stop()
  })
})
