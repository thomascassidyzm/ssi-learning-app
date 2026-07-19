/**
 * useDashboardRefresh — the ONE refresh protocol for every dashboard surface.
 *
 * Founder ruling (2026-07-19): NO auto-refresh anywhere on dashboard surfaces —
 * not even during a live class. Data loads on navigation and then HOLDS STILL.
 * The only way data updates is a deliberate human action through a single,
 * universal affordance:
 *   - a circular-arrow refresh button in a consistent navbar position, and/or
 *   - pull-to-refresh on touch devices.
 * A quiet "Updated HH:MM" stamp keeps staleness honest.
 *
 * How it works: this is a module-level singleton. Each dashboard page registers
 * its data-loader via `registerRefresh(fn)` (auto-cleaned on unmount). The
 * navbar RefreshButton and the container-level pull-to-refresh both call the
 * same `refresh()`, which runs the active page's loader, shows a spin state,
 * and — only on success — stamps `lastUpdated`. A failed refresh must NEVER
 * look "up to date", so the stamp is not advanced when the loader throws.
 *
 * Consistency law §1.12: same affordance, same spot, same behaviour on every
 * surface — which is exactly why the state and the action live in one place.
 */
import { computed, onScopeDispose, readonly, ref } from 'vue'

/** The active page's data-loader. Dashboard pages are exclusive within a
 *  container, so a single last-registered-wins handler is the whole model. */
let handler: (() => void | Promise<void>) | null = null

const isRefreshing = ref(false)
const lastUpdated = ref<Date | null>(null)
// Bumps whenever a handler registers/unregisters so the navbar button can
// show/hide itself reactively (a plain module-scoped `handler` isn't reactive).
const handlerVersion = ref(0)

const hasHandler = computed(() => {
  // touch the version ref so this recomputes on register/unregister
  void handlerVersion.value
  return handler !== null
})

/** "Updated 14:32" — 24h HH:MM, or empty until the first successful load. */
const updatedLabel = computed(() => {
  const d = lastUpdated.value
  if (!d) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
})

/**
 * Run the active page's loader. No-op if nothing is registered or a refresh is
 * already in flight (double-tap / button + pull-to-refresh race safe).
 * Stamps `lastUpdated` only when the loader resolves without throwing.
 */
async function refresh(): Promise<void> {
  if (!handler || isRefreshing.value) return
  isRefreshing.value = true
  try {
    await handler()
    lastUpdated.value = new Date()
  } catch (err) {
    // The page owns its own error surface; we simply don't advance the stamp,
    // so a failed refresh can't masquerade as fresh data.
    console.error('[DashboardRefresh] refresh failed:', err)
  } finally {
    isRefreshing.value = false
  }
}

/**
 * Register the current page's data-loader. Returns an unregister fn, and also
 * auto-unregisters when the calling component's scope is disposed (unmount).
 *
 * @param fn         the page's data-loading action (the same one used on mount)
 * @param opts.immediate  run it now through `refresh()` so the initial load
 *                        also shows the spinner and sets the "Updated" stamp
 *                        (default true — one code path for load and refresh).
 */
function registerRefresh(
  fn: () => void | Promise<void>,
  opts: { immediate?: boolean } = {},
): () => void {
  handler = fn
  handlerVersion.value++
  // A fresh surface hasn't loaded yet — clear any stamp inherited from the
  // previously-mounted page so the timestamp always describes THIS surface.
  lastUpdated.value = null

  const unregister = () => {
    if (handler === fn) {
      handler = null
      handlerVersion.value++
      lastUpdated.value = null
    }
  }
  onScopeDispose(unregister)

  if (opts.immediate !== false) void refresh()

  return unregister
}

export function useDashboardRefresh() {
  return {
    isRefreshing: readonly(isRefreshing),
    lastUpdated: readonly(lastUpdated),
    updatedLabel,
    hasHandler,
    registerRefresh,
    refresh,
  }
}
