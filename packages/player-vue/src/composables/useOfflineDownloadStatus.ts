/**
 * Shared offline-download status.
 *
 * Written by LearningPlayer's downloadForOffline; read by ModeTray to draw the
 * progress ring around the mode button (where offline was switched on) and the
 * live detail inside the Offline row. Module-level shared state — same pattern
 * as usePwaUpdate — so the status reaches the mode button without prop-drilling
 * through PlayerContainer → BottomNav → ModeTray.
 */
import { ref, computed } from 'vue'

// 'locked' = a 30-day offline lease expired and we couldn't re-validate online
// (offline whole time / sub lapsed past the graceful tail). Bytes are preserved;
// a reconnect re-validates and unlocks. Distinct from 'error' (download failed).
export type OfflineDlState = 'idle' | 'preparing' | 'downloading' | 'complete' | 'error' | 'locked'

export const offlineDlState = ref<OfflineDlState>('idle')
export const offlineDlDone = ref(0)     // audio files genuinely cached (successes only)
export const offlineDlTotal = ref(0)
export const offlineDlFailed = ref(0)   // fetches that failed (e.g. bad network)

// Whether the current course's offline is a FREE 30-day TASTE rather than a
// renewing entitlement — i.e. the user is a non-payer (set by LearningPlayer from
// entitlement.offlineRenews). Offline download itself is open to everyone now
// ("we sell the convenience, not the content"); this just lets the Offline row in
// ModeTray nudge "Free offline for 30 days". Reaches the mode button via the same
// no-prop-drill module-level pattern.
export const offlineTrial = ref(false)

// The ring is shown whenever a download isn't idle (preparing/downloading =
// in-progress; complete/error = the brief result colour before it resets).
export const offlineDownloadVisible = computed(() => offlineDlState.value !== 'idle')
export const offlineDownloadActive = computed(
  () => offlineDlState.value === 'preparing' || offlineDlState.value === 'downloading',
)

// % complete (0–100) while downloading; null while preparing (no total yet →
// the ring spins indeterminately).
export const offlineDownloadPct = computed(() =>
  offlineDlState.value === 'downloading' && offlineDlTotal.value > 0
    ? Math.round((offlineDlDone.value / offlineDlTotal.value) * 100)
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
}

// Live one-line detail for the Offline row in the tray. `done` counts ONLY files
// that actually landed in IndexedDB, so "Ready" can't lie.
export const offlineDownloadLabel = computed(() => {
  switch (offlineDlState.value) {
    case 'preparing':
      return 'Preparing download…'
    case 'downloading': {
      const pct = offlineDlTotal.value > 0 ? Math.round((offlineDlDone.value / offlineDlTotal.value) * 100) : 0
      return `Downloading… ${pct}% (${offlineDlDone.value}/${offlineDlTotal.value})`
    }
    case 'complete':
      return 'Ready to play offline ✓'
    case 'error':
      return `Download incomplete — ${offlineDlFailed.value} failed, needs better signal`
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
      const pct = offlineDlTotal.value > 0 ? Math.round((offlineDlDone.value / offlineDlTotal.value) * 100) : 0
      return `Downloading… ${pct}%`
    }
    case 'complete':
      return 'Ready to play offline ✓'
    case 'error':
      return 'Download incomplete — needs better signal'
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
