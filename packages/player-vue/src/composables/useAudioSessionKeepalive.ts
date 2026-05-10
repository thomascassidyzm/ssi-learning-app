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

import { watch, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'
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
  // True while we *want* the silent loop running. Distinct from
  // silentAudio.paused so the auto-restart logic can tell intentional
  // pauses (release()) apart from iOS-induced ones (interruption,
  // backgrounding, suspended-tab quirks).
  let shouldBePlaying = false

  const cancelPendingRelease = (): void => {
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
  }

  const startSilent = (): void => {
    if (!silentAudio || !silentAudio.paused) return
    silentAudio.play().catch((err) => {
      console.warn('[audioSessionKeepalive] play failed:', err)
    })
  }

  const ensure = (): void => {
    cancelPendingRelease()
    shouldBePlaying = true
    if (!silentAudio) {
      silentAudio = new Audio()
      silentAudio.src = getSilentAudioUrl()
      silentAudio.loop = true
      silentAudio.volume = 0
      silentAudio.setAttribute('playsinline', 'true')
      silentAudio.setAttribute('webkit-playsinline', 'true')

      // iOS occasionally pauses our silent loop on its own (long
      // backgrounding, audio interruptions, system memory pressure).
      // Without auto-restart the next gap in cycle / pod-lap audio
      // finds no silent loop to bridge it, the session unlock is lost,
      // and subsequent main audio plays internally without sound. The
      // 'pause' handler kicks it back on whenever we still want it
      // running. Guard with `shouldBePlaying` so deliberate release()
      // calls don't loop.
      silentAudio.addEventListener('pause', () => {
        if (shouldBePlaying) startSilent()
      })
    }
    startSilent()
  }

  const release = (): void => {
    shouldBePlaying = false
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

  // When a backgrounded tab returns to the foreground, defensively
  // re-ensure. iOS Safari can suspend the silent loop while hidden
  // even if it didn't fire a 'pause' event we caught — visibility
  // change is the cleanest moment to restore.
  const handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible' && shouldBePlaying) {
      startSilent()
    }
  }

  onMounted(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  onUnmounted(() => {
    cancelPendingRelease()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    if (silentAudio) {
      silentAudio.pause()
      silentAudio.src = ''
      silentAudio = null
    }
  })
}
