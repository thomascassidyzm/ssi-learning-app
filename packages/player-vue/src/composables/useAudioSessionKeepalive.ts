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

  const cancelPendingRelease = (): void => {
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
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
      } catch (err) {
        console.warn('[audioSessionKeepalive] AudioContext init failed:', err)
        ctx = null
        source = null
        return
      }
    }

    if (ctx.state === 'suspended') {
      ctx.resume().catch((err) => {
        console.warn('[audioSessionKeepalive] resume failed:', err)
      })
    }
  }

  const release = (): void => {
    shouldBeRunning = false
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
  // re-resume. iOS Safari can suspend the context while hidden even
  // if we never asked it to — visibility change is the cleanest moment
  // to restore.
  const handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible' && shouldBeRunning) {
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => { /* best-effort */ })
      }
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
