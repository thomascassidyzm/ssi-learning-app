import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useLearningSession } from './useLearningSession'

/**
 * THE PLAY TIMER MUST SURVIVE A BACKGROUND.
 *
 * The play timer is the app's definition of a minute — a minute in which the
 * app was actually playing. The only thing that OPENS a timing segment is the
 * player's watcher on "is any audio sounding", and a watcher fires on CHANGE.
 * Backgrounding the app closes the segment (visibilitychange → hidden) without
 * changing that flag, because on a locked phone playback carries on. So the
 * flag never went false, never came back true, and the segment stayed shut for
 * the rest of the session. Every second after the first background was banked
 * nowhere.
 *
 * Measured against production on 2026-09-08: of the 222 learner-days since the
 * 2026-08-20 accumulator fix that carry real audio, 49 banked LESS play time
 * than the raw duration of the audio files they demonstrably played — which an
 * accurate counter cannot do. On real learners: 511 minutes of audio, 221
 * minutes banked.
 *
 * The contract pinned here is deliberately one-sided. Coming BACK to the
 * foreground with audio sounding re-arms the timer. Time spent listening while
 * still backgrounded is NOT recovered — the app cannot tell listening from a
 * suspended tab, and the founder ruling of 2026-08-19 allows the number to be
 * a floor but never to inflate.
 */

function makeSupabase() {
  const calls: Array<{ fn: string; args: any }> = []
  const client = {
    rpc: (fn: string, args: any) => {
      calls.push({ fn, args })
      return Promise.resolve({ error: null })
    },
  }
  return { calls, client: ref(client) as any }
}

function mountSession(opts: any = {}) {
  let api: ReturnType<typeof useLearningSession>
  const wrapper = mount(defineComponent({
    setup() {
      api = useLearningSession(opts)
      return () => h('div')
    },
  }))
  return { api: api!, wrapper }
}

/** Drive document.visibilityState and fire the event the composable listens to. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

const LEARNER = '11111111-2222-3333-4444-555555555555'

let sb: ReturnType<typeof makeSupabase>

/** Total play seconds this session has banked to the server. */
const bankedSeconds = () =>
  sb.calls
    .filter((c) => c.fn === 'bump_speaking_opportunities')
    .reduce((n, c) => n + Number(c.args.p_seconds_delta || 0), 0)

beforeEach(() => {
  sb = makeSupabase()
  vi.useFakeTimers()
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('play timer across a background', () => {
  const opts = (audible: () => boolean) => ({
    supabase: sb.client,
    learnerId: LEARNER,
    courseId: 'cym_s_for_eng',
    isAudioActive: audible,
  })

  it('banks the playing time that follows a return to the foreground', () => {
    // Audio is sounding throughout — a locked phone playing on the lock screen.
    const { api } = mountSession(opts(() => true))

    api.markPlayStart()
    vi.advanceTimersByTime(60_000) // a minute of playing, in the foreground

    setVisibility('hidden')        // phone locked: segment closed, minute banked
    vi.advanceTimersByTime(300_000) // five minutes on the lock screen
    setVisibility('visible')       // unlocked, audio never stopped

    vi.advanceTimersByTime(120_000) // two more minutes of playing
    api.markPlayStop()

    // The first minute and the last two are banked. The five backgrounded
    // minutes are deliberately not.
    expect(bankedSeconds()).toBe(180)
  })

  it('does not re-arm when audio is genuinely not sounding', () => {
    // Learner paused, then backgrounded. Coming back must bank nothing.
    const { api } = mountSession(opts(() => false))

    api.markPlayStart()
    vi.advanceTimersByTime(30_000)
    api.markPlayStop()             // paused: 30s banked

    setVisibility('hidden')
    setVisibility('visible')
    vi.advanceTimersByTime(600_000) // ten idle minutes with nothing playing
    api.markPlayStop()

    expect(bankedSeconds()).toBe(30)
  })
})
