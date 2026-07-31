/**
 * Shared offline-download status.
 *
 * Written by LearningPlayer's downloadForOffline; read by ModeTray to draw the
 * progress ring around the mode button (where offline was switched on) and the
 * live detail inside the Offline row. Module-level shared state — same pattern
 * as usePwaUpdate — so the status reaches the mode button without prop-drilling
 * through PlayerContainer → BottomNav → ModeTray.
 */
import { ref, computed, watch } from 'vue'

// 'locked' = a 30-day offline lease expired and we couldn't re-validate online
// (offline whole time / sub lapsed past the graceful tail). Bytes are preserved;
// a reconnect re-validates and unlocks. Distinct from 'error' (download failed).
// 'partial' = READY — nearly everything cached, a straggler tail still retrying
// in the background. Offline is ON and playable; this is a green state, never a
// dead-end (founder invariant 2026-07-31: always play what you have).
export type OfflineDlState = 'idle' | 'preparing' | 'downloading' | 'complete' | 'partial' | 'error' | 'locked'

// A course with at least this fraction cached is READY offline. Readiness is a
// threshold, never complete==total: 9,732/9,742 is a playable course, and the
// missing tail is retried in the background / skipped at play time.
export const OFFLINE_READY_MIN_FRACTION = 0.98

/**
 * Decide the end-of-download status. Zero failures → complete. Anything
 * missing but coverage at/above the threshold → partial (ready, green).
 * Only genuinely-low coverage → error — and even then offline stays on and
 * plays what it has; error is a progress report, not a gate.
 */
export function resolveOfflineDlOutcome(
  done: number,
  total: number,
  failed: number,
  auxIncomplete: boolean,
): 'complete' | 'partial' | 'error' {
  if (failed === 0 && !auxIncomplete) return 'complete'
  const coverage = total > 0 ? done / total : 1
  return coverage >= OFFLINE_READY_MIN_FRACTION ? 'partial' : 'error'
}

export const offlineDlState = ref<OfflineDlState>('idle')
export const offlineDlDone = ref(0)     // audio files genuinely cached (successes only)
export const offlineDlTotal = ref(0)
export const offlineDlFailed = ref(0)   // fetches that failed (e.g. bad network)

// Straggler tail: >0 while the download is re-checking its last few clips
// (fresh URLs + growing backoff). The main pass is over, so the percentage is
// pinned near 100 and barely moves — the honest display for this phase names
// it ("Finishing up") instead of looking frozen (founder tail-pacing report,
// 2026-07-31: 0→91% quick, 91→100% a confusing crawl).
export const offlineDlStragglers = ref(0)

// Whether the current course's offline is a FREE 30-day TASTE rather than a
// renewing entitlement — i.e. the user is a non-payer (set by LearningPlayer from
// entitlement.offlineRenews). Offline download itself is open to everyone now
// ("we sell the convenience, not the content"); this just lets the Offline row in
// ModeTray nudge "Free offline for 30 days". Reaches the mode button via the same
// no-prop-drill module-level pattern.
export const offlineTrial = ref(false)

// ── Liveness ────────────────────────────────────────────────────────────────
// "Silently stuck forever" is itself a forbidden state (founder stall report,
// 2026-07-31: progress froze at 91% with no display change). If no progress
// event lands for OFFLINE_DL_STALL_MS while downloading, the display MUST
// change — the stalled copy below shows real counts and says we're retrying.
// The per-fetch timeouts (AudioCache / batch-urls) guarantee the machinery
// unsticks itself within ~30s; this covers the gap and any hang class we
// haven't met yet.
export const OFFLINE_DL_STALL_MS = 20_000

// Stamped by the watcher below on every progress event; compared against a
// clock ref ticked by an interval that only runs while downloading.
export const offlineDlLastProgressAt = ref(0)
const stallClock = ref(0)
/** Advance the stall clock (interval-driven; exported for tests). */
export function tickOfflineDlStallClock(now: number = Date.now()) {
  stallClock.value = now
}

watch([offlineDlState, offlineDlDone, offlineDlFailed, offlineDlTotal, offlineDlStragglers], () => {
  // Any state change or counter tick is a progress event.
  offlineDlLastProgressAt.value = Date.now()
  stallClock.value = Date.now()
})

let stallTimer: ReturnType<typeof setInterval> | null = null
watch(offlineDlState, (s) => {
  if (s === 'downloading') {
    if (!stallTimer) stallTimer = setInterval(() => tickOfflineDlStallClock(), 5_000)
  } else if (stallTimer) {
    clearInterval(stallTimer)
    stallTimer = null
  }
})

export const offlineDownloadStalled = computed(
  () =>
    offlineDlState.value === 'downloading' &&
    offlineDlLastProgressAt.value > 0 &&
    stallClock.value - offlineDlLastProgressAt.value >= OFFLINE_DL_STALL_MS,
)

// The ring is shown whenever a download isn't idle (preparing/downloading =
// in-progress; complete/error = the brief result colour before it resets).
export const offlineDownloadVisible = computed(() => offlineDlState.value !== 'idle')
export const offlineDownloadActive = computed(
  () => offlineDlState.value === 'preparing' || offlineDlState.value === 'downloading',
)

// % complete (0–100) while downloading; null while preparing (no total yet →
// the ring spins indeterminately). Math.floor, never round: 9,732/9,742 must
// read 99%, not claim 100% and then report a failure.
export const offlineDownloadPct = computed(() =>
  offlineDlState.value === 'downloading' && offlineDlTotal.value > 0
    ? Math.floor((offlineDlDone.value / offlineDlTotal.value) * 100)
    : null,
)

// Reset to idle. These refs are page-lifetime singletons shared with the
// mode-button ring, so a fresh player instance (remount on course change) must
// clear them — otherwise a leftover 'error'/'complete' state would draw a ring
// for a download that isn't running on the new course.
export function resetOfflineDownloadStatus() {
  offlineDlState.value = 'idle'
  offlineDlDone.value = 0
  offlineDlTotal.value = 0
  offlineDlFailed.value = 0
  offlineDlStragglers.value = 0
}

// Live one-line detail for the Offline row in the tray. `done` counts ONLY files
// that actually landed in IndexedDB, so "Ready" can't lie.
export const offlineDownloadLabel = computed(() => {
  switch (offlineDlState.value) {
    case 'preparing':
      return 'Preparing download…'
    case 'downloading': {
      const pct = offlineDlTotal.value > 0 ? Math.floor((offlineDlDone.value / offlineDlTotal.value) * 100) : 0
      if (offlineDownloadStalled.value)
        return `Stalled at ${pct}% (${offlineDlDone.value}/${offlineDlTotal.value}) — retrying…`
      if (offlineDlStragglers.value > 0)
        return `Finishing up — checking the last ${offlineDlStragglers.value} clip${offlineDlStragglers.value === 1 ? '' : 's'}…`
      return `Downloading… ${pct}% (${offlineDlDone.value}/${offlineDlTotal.value})`
    }
    case 'complete':
      return 'Ready to play offline ✓'
    case 'partial':
      return offlineDlFailed.value > 0
        ? `Ready offline (${offlineDlFailed.value} clips retrying)`
        : 'Ready offline (extras still fetching)'
    case 'error':
      return `Download incomplete — ${offlineDlDone.value}/${offlineDlTotal.value} cached, retrying in background`
    case 'locked':
      return 'Offline paused — reconnect to renew'
    default:
      return ''
  }
})

// Two STABLE pieces for the tray's Offline row, rendered as fixed separate lines
// so the layout never reflows between 1 and 2 lines as the numbers tick (that
// reflow was the flicker). Headline carries the state; count is its own line.
export const offlineDownloadHeadline = computed(() => {
  switch (offlineDlState.value) {
    case 'preparing':
      return 'Preparing download…'
    case 'downloading': {
      const pct = offlineDlTotal.value > 0 ? Math.floor((offlineDlDone.value / offlineDlTotal.value) * 100) : 0
      if (offlineDownloadStalled.value) return `Stalled at ${pct}% — retrying…`
      if (offlineDlStragglers.value > 0) return 'Finishing up — checking the last clips…'
      return `Downloading… ${pct}%`
    }
    case 'complete':
      return 'Ready to play offline ✓'
    case 'partial':
      return offlineDlFailed.value > 0
        ? `Ready offline ✓ (${offlineDlFailed.value} clips retrying)`
        : 'Ready offline ✓ (extras still fetching)'
    case 'error':
      return 'Download incomplete — retrying in background'
    case 'locked':
      return 'Offline paused — reconnect to renew'
    default:
      return ''
  }
})
export const offlineDownloadCount = computed(() =>
  offlineDlState.value === 'downloading' && offlineDlTotal.value > 0
    ? `${offlineDlDone.value} / ${offlineDlTotal.value}`
    : '',
)
