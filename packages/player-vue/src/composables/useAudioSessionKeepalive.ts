/**
 * useAudioSessionKeepalive — session-wide silent audio loop that keeps the iOS
 * audio session alive across gaps between separate audio elements.
 *
 * The problem this solves: iOS Safari drops the audio session (and revokes
 * the play() unlock) when no audio is sounding for a few seconds in a
 * backgrounded tab. The 4-phase cycle has multi-second PAUSE phases, and
 * inter-round handoffs to pod laps / commentary use a different audio
 * element entirely — both moments where the session would otherwise drop.
 *
 * Previously each playback path managed its own silent bridge (SimplePlayer,
 * useDrivingMode, ListeningOverlay), so adding a new path meant
 * rediscovering this bug. This composable centralizes the keepalive: any
 * playback path just contributes a boolean to the `active` signal.
 *
 * Usage:
 *   const sessionAudioActive = computed(() =>
 *     simplePlayer.isPlaying.value ||
 *     playingPodLapAudio.value ||
 *     playingCommentaryAudio.value
 *   )
 *   useAudioSessionKeepalive(sessionAudioActive)
 *
 * iOS gesture preservation: the silent audio's first play() is triggered by
 * a Vue watcher (default flush 'pre' = microtask). When `active` flips true
 * inside a click handler — which is the only way it CAN flip true the first
 * time, since the session is started by a tap — the microtask runs in the
 * same task as the gesture, and iOS treats the silent.play() as gestured.
 * That unlocks audio for every subsequent element on the page.
 */

import { watch, onUnmounted, type Ref, type ComputedRef } from 'vue'
import { getSilentAudioUrl } from '../utils/silentAudio'

/**
 * Window in which a transient release request is ignored. The race we're
 * defending against: handleRoundBoundary awaits a Supabase write
 * (markLapCompleted) between playPodLap returning (clears
 * playingPodLapAudio) and simplePlayer.resume() (sets isPlaying). For
 * those few hundred ms `active` reads false, but the session is still
 * logically alive — pausing the silent loop here is what loses the iOS
 * unlock. 2s comfortably covers Supabase round-trips while still
 * releasing promptly when the user actually stops.
 */
const RELEASE_DEBOUNCE_MS = 2000

export function useAudioSessionKeepalive(
  active: Ref<boolean> | ComputedRef<boolean>
): void {
  let silentAudio: HTMLAudioElement | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null

  const cancelPendingRelease = (): void => {
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
  }

  const ensure = (): void => {
    cancelPendingRelease()
    if (!silentAudio) {
      silentAudio = new Audio()
      silentAudio.src = getSilentAudioUrl()
      silentAudio.loop = true
      silentAudio.volume = 0
      silentAudio.setAttribute('playsinline', 'true')
      silentAudio.setAttribute('webkit-playsinline', 'true')
    }
    if (silentAudio.paused) {
      silentAudio.play().catch((err) => {
        console.warn('[audioSessionKeepalive] play failed:', err)
      })
    }
  }

  const release = (): void => {
    if (silentAudio && !silentAudio.paused) {
      silentAudio.pause()
    }
  }

  watch(active, (isActive) => {
    if (isActive) {
      ensure()
    } else {
      cancelPendingRelease()
      releaseTimer = setTimeout(() => {
        releaseTimer = null
        release()
      }, RELEASE_DEBOUNCE_MS)
    }
  })

  onUnmounted(() => {
    cancelPendingRelease()
    if (silentAudio) {
      silentAudio.pause()
      silentAudio.src = ''
      silentAudio = null
    }
  })
}
