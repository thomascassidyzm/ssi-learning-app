/**
 * One answer to "is any audio session live right now?" for chrome outside
 * the player tree: the playing-as-yourself banner, the install banner and
 * the update prompt all gate on it.
 *
 * Job #683 had the main player alone echo its transport state on the window
 * as `ssi-play-state`. Listening Mode runs its own transport inside
 * ListeningOverlay, which that echo never saw — so a teacher listening on
 * her own account got no warning (job #693, gap 1b). Each transport now
 * reports itself here by name and the window event carries the OR, so a
 * consumer never has to know how many players there are.
 */
import { computed, reactive } from 'vue'

const live = reactive<Record<string, boolean>>({})

/** True while ANY registered transport is playing or about to. */
export const isAnyPlaybackLive = computed(() => Object.values(live).some(Boolean))

/**
 * A transport reports its own state; `source` is a short name for it
 * ('player', 'listening'). Dispatches `ssi-play-state` on the window when the
 * combined answer changes, so the existing window listeners keep working.
 */
export function setPlaybackLive(source: string, playing: boolean): void {
  const before = isAnyPlaybackLive.value
  live[source] = playing
  const after = isAnyPlaybackLive.value
  if (before !== after && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ssi-play-state', { detail: { playing: after } }))
  }
}

/** Test seam: forget every transport. */
export function resetPlaybackLiveness(): void {
  for (const k of Object.keys(live)) delete live[k]
}
