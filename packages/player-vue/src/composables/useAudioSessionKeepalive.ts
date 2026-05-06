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

export function useAudioSessionKeepalive(
  active: Ref<boolean> | ComputedRef<boolean>
): void {
  let silentAudio: HTMLAudioElement | null = null

  const ensure = (): void => {
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

  // Default flush ('pre' = microtask) batches synchronous flips so a
  // pause-then-resume in the same tick (e.g. simplePlayer.pause() followed
  // by playingPodLapAudio.value = true) collapses into a single watcher
  // call with the final value, avoiding a momentary release that would
  // drop the iOS session.
  watch(active, (isActive) => {
    if (isActive) ensure()
    else release()
  })

  onUnmounted(() => {
    if (silentAudio) {
      silentAudio.pause()
      silentAudio.src = ''
      silentAudio = null
    }
  })
}
