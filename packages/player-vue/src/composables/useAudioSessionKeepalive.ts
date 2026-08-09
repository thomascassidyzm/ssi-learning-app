/**
 * useAudioSessionKeepalive — session-wide AudioContext that keeps the iOS
 * audio session alive across gaps between separate audio elements.
 *
 * The problem this solves: iOS Safari drops the audio session (and revokes
 * the play() unlock) when no audio is sounding for a few seconds, especially
 * when the tab is backgrounded. The 4-phase cycle has multi-second PAUSE
 * phases, and inter-round handoffs to pod laps / commentary use a different
 * audio element entirely — both moments where the session would otherwise
 * drop.
 *
 * Why AudioContext (and not a silent <audio loop>):
 *
 * The previous implementation ran a looping silent HTMLAudioElement. That
 * approach competes with the main `<audio>` element for iOS's single
 * audio-session slot: when main cycle audio plays, iOS pauses the silent
 * loop → silent loop's pause handler restarts it → iOS steals focus back
 * from main → main pauses → repeat. Disabled 2026-05-23 for exactly that
 * reason.
 *
 * AudioContext sits one layer down — it's the audio-session holder that
 * HTMLAudioElements ride on top of, not a competitor for the same slot. A
 * running AudioContext keeps the session warm without grabbing focus from
 * any playing <audio>. We feed it a silent oscillator just to keep the
 * graph active so iOS doesn't auto-suspend it for idleness.
 *
 * Usage:
 *   const sessionAudioActive = computed(() =>
 *     simplePlayer.isPlaying.value ||
 *     playingPodLapAudio.value ||
 *     playingCommentaryAudio.value
 *   )
 *   useAudioSessionKeepalive(sessionAudioActive)
 *
 * iOS gesture preservation: AudioContext.resume() must be called inside a
 * user gesture the first time. When `active` flips true inside a click
 * handler (which is the only way it CAN flip true the first time — the
 * session is started by a tap), Vue's watcher microtask runs in the same
 * task as the gesture, and iOS treats the resume() call as gestured. That
 * unlocks audio for every subsequent element on the page.
 */

import { watch, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'

/**
 * Window in which a transient release request is ignored. The race we're
 * defending against: handleRoundBoundary awaits a Supabase write
 * (markLapCompleted) between playPodLap returning (clears
 * playingPodLapAudio) and simplePlayer.resume() (sets isPlaying). For
 * those few hundred ms `active` reads false, but the session is still
 * logically alive — suspending the context here is what loses the iOS
 * unlock. 2s comfortably covers Supabase round-trips while still
 * releasing promptly when the user actually stops.
 */
const RELEASE_DEBOUNCE_MS = 2000

/**
 * How long we wait before trying the context again after a resume() that iOS
 * rejected. While another app still holds the audio session, resume() fails
 * outright — the retry is what carries us over a short interruption (a
 * notification chime) with no visibilitychange to lean on.
 */
const INTERRUPTION_RETRY_MS = 1500

/**
 * How many times a single interruption is retried before we stop. The context
 * is also re-resumed on every return to the foreground and on every
 * statechange, so giving up here is never the last word — it only stops an
 * unbounded timer chain on a device that will not hand the session back.
 */
const MAX_INTERRUPTION_RETRIES = 4

export function useAudioSessionKeepalive(
  active: Ref<boolean> | ComputedRef<boolean>
): void {
  let ctx: AudioContext | null = null
  let source: OscillatorNode | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  // True while we *want* the context running. Distinct from
  // `ctx.state === 'running'` so visibilitychange handling can tell
  // intentional suspends (release()) apart from iOS-induced ones
  // (backgrounding, system memory pressure).
  let shouldBeRunning = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retriesLeft = MAX_INTERRUPTION_RETRIES
  let onStateChange: (() => void) | null = null

  const cancelPendingRelease = (): void => {
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
  }

  const cancelPendingRetry = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  /**
   * Put the context back into `running` whenever we still want it running.
   *
   * The state we are really here for is iOS Safari's non-standard
   * **`interrupted`** — WebKit's own name for "another app took the audio
   * session" (a WhatsApp notification chime, a maps prompt, a call). It is NOT
   * `suspended`, so the old `state === 'suspended'` checks skipped straight
   * past it and the keepalive stayed dead for the rest of the session: the
   * thing whose whole job is holding the iOS audio session quietly stopped
   * holding it, which is why a later element play() could find no session and
   * never come back. Anything that is not `running` and not `closed` gets a
   * resume().
   *
   * resume() is rejected while the interrupting app still holds the session,
   * hence the bounded retry.
   */
  const resumeContext = (): void => {
    if (!ctx || !shouldBeRunning) return
    // 'interrupted' is iOS-only and absent from the DOM typings.
    const state = ctx.state as AudioContextState | 'interrupted'
    if (state === 'running' || state === 'closed') return
    ctx.resume().then(() => {
      retriesLeft = MAX_INTERRUPTION_RETRIES
    }).catch(() => {
      if (retryTimer || retriesLeft <= 0 || !shouldBeRunning) return
      retriesLeft--
      retryTimer = setTimeout(() => {
        retryTimer = null
        resumeContext()
      }, INTERRUPTION_RETRY_MS)
    })
  }

  const ensure = (): void => {
    cancelPendingRelease()
    shouldBeRunning = true

    if (!ctx) {
      const Ctx = (typeof window !== 'undefined')
        ? ((window as any).AudioContext || (window as any).webkitAudioContext)
        : null
      if (!Ctx) return  // SSR / very old browser — no-op
      try {
        ctx = new Ctx() as AudioContext
        // Silent oscillator → zero gain → destination. The oscillator
        // keeps the audio graph "active" so iOS doesn't auto-suspend
        // the context for idleness. Frequency at 0 Hz and gain at 0
        // produces no audible output. The graph alone is enough to
        // hold the audio session.
        const gain = ctx.createGain()
        gain.gain.value = 0
        gain.connect(ctx.destination)
        source = ctx.createOscillator()
        source.frequency.value = 0
        source.connect(gain)
        source.start()
        // iOS announces an interruption (and its end) as a statechange, with
        // no visibilitychange to go with it when the interrupting sound plays
        // over the top of an open app. This is the only signal in that case.
        onStateChange = () => {
          const state = ctx?.state as AudioContextState | 'interrupted' | undefined
          if (state === 'running') retriesLeft = MAX_INTERRUPTION_RETRIES
          else resumeContext()
        }
        ctx.addEventListener('statechange', onStateChange)
      } catch (err) {
        console.warn('[audioSessionKeepalive] AudioContext init failed:', err)
        ctx = null
        source = null
        return
      }
    }

    retriesLeft = MAX_INTERRUPTION_RETRIES
    resumeContext()
  }

  const release = (): void => {
    shouldBeRunning = false
    cancelPendingRetry()
    if (ctx && ctx.state === 'running') {
      ctx.suspend().catch(() => { /* best-effort */ })
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
  // re-resume. iOS Safari can suspend the context while hidden even if we
  // never asked it to, and an interruption by another app leaves it
  // `interrupted` — visibility change is the cleanest moment to restore
  // either, because that is when the session is ours again.
  const handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible' && shouldBeRunning) {
      retriesLeft = MAX_INTERRUPTION_RETRIES
      resumeContext()
    }
  }

  onMounted(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  onUnmounted(() => {
    cancelPendingRelease()
    cancelPendingRetry()
    shouldBeRunning = false
    if (ctx && onStateChange) {
      ctx.removeEventListener('statechange', onStateChange)
      onStateChange = null
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    if (source) {
      try { source.stop() } catch { /* already stopped */ }
      try { source.disconnect() } catch { /* already disconnected */ }
      source = null
    }
    if (ctx) {
      ctx.close().catch(() => { /* best-effort */ })
      ctx = null
    }
  })
}
