/**
 * usePullToRefresh — the touch half of the ONE refresh protocol.
 *
 * Attach to a scroll container. When the user is at the top (scrollTop ≈ 0) and
 * drags downward past a threshold, it fires the SAME shared `refresh()` the
 * navbar RefreshButton uses — so touch and pointer devices behave identically
 * and there is exactly one refresh action in the system.
 *
 * Deliberately conservative: it only engages when already scrolled to the top,
 * only tracks a near-vertical downward drag, and never calls preventDefault
 * until it has decided this is a pull — so normal scrolling is untouched. It
 * exposes `pullDistance` / `isPulling` for an optional visual indicator, and is
 * a no-op on non-touch devices (no listeners attached).
 */
import { onBeforeUnmount, onMounted, ref, unref, type Ref } from 'vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'

const THRESHOLD_PX = 72 // pull distance that commits a refresh
const MAX_PULL_PX = 110 // clamp so the indicator can't run away
const RESISTANCE = 0.5 // finger travel → visible travel (rubber-band feel)

type ElementSource = Ref<HTMLElement | null | undefined> | (() => HTMLElement | null | undefined)

function resolveEl(source: ElementSource): HTMLElement | null {
  const el = typeof source === 'function' ? source() : unref(source)
  return el ?? null
}

export function usePullToRefresh(target: ElementSource) {
  const { refresh, isRefreshing, hasHandler } = useDashboardRefresh()

  const pullDistance = ref(0)
  const isPulling = ref(false)

  let startY = 0
  let startX = 0
  let tracking = false // vertical-down gesture from the top, candidate for pull
  let el: HTMLElement | null = null

  const isTouch = typeof window !== 'undefined' && 'ontouchstart' in window

  function atTop(): boolean {
    // Use the scroll container if it scrolls; otherwise fall back to the page.
    if (el && el.scrollHeight > el.clientHeight) return el.scrollTop <= 0
    const doc = document.scrollingElement || document.documentElement
    return (doc?.scrollTop ?? 0) <= 0
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1 || isRefreshing.value || !hasHandler.value) return
    if (!atTop()) return
    startY = e.touches[0].clientY
    startX = e.touches[0].clientX
    tracking = true
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking) return
    const dy = e.touches[0].clientY - startY
    const dx = e.touches[0].clientX - startX
    // Bail if the drag is upward or clearly horizontal — let the browser scroll.
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
      tracking = false
      reset()
      return
    }
    // Committed to a pull: dampen the travel and suppress native scroll/bounce.
    if (e.cancelable) e.preventDefault()
    isPulling.value = true
    pullDistance.value = Math.min(dy * RESISTANCE, MAX_PULL_PX)
  }

  function onTouchEnd() {
    if (!tracking) return
    tracking = false
    const commit = pullDistance.value >= THRESHOLD_PX
    reset()
    if (commit) void refresh()
  }

  function reset() {
    isPulling.value = false
    pullDistance.value = 0
  }

  function attach() {
    if (!isTouch) return
    el = resolveEl(target)
    if (!el) return
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    // non-passive so onTouchMove can preventDefault once it's a committed pull
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
  }

  function detach() {
    if (!el) return
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('touchcancel', onTouchEnd)
    el = null
  }

  onMounted(attach)
  onBeforeUnmount(detach)

  return { pullDistance, isPulling, isRefreshing, threshold: THRESHOLD_PX }
}
