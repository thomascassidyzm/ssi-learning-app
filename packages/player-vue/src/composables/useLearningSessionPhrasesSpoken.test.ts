import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useLearningSession } from './useLearningSession'

/**
 * "Phrases spoken" — the server-side home (owner ruling 2026-08-19, Activity-
 * tiles diagnosis rec 3).
 *
 * The contract these tests hold is the reason the counter moved off
 * localStorage at all: it used to be banked ONLY when endSession() ran, so a
 * session ended by CLOSING THE TAB lost its count entirely. Here it rides the
 * same delta/watermark flush as the rest of the telemetry, which is already
 * wired to visibilitychange and beforeunload.
 *
 * Also pinned: the phrases delta goes out on its OWN rpc and never disturbs
 * the opportunities / play-seconds arguments, because those belong to a
 * different concern (and, when this landed, a different branch).
 */

/** Records every rpc the composable makes. */
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

/**
 * Mount the composable inside a real component so onMounted/onUnmounted run —
 * the visibilitychange and beforeunload listeners are registered there, and
 * they are the whole point.
 */
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

const LEARNER = '11111111-2222-3333-4444-555555555555'

let sb: ReturnType<typeof makeSupabase>
const baseOpts = () => ({
  supabase: sb.client,
  learnerId: LEARNER,
  courseId: 'zho_for_eng',
})

const phraseCalls = () => sb.calls.filter((c) => c.fn === 'bump_phrases_spoken')
const oppsCalls = () => sb.calls.filter((c) => c.fn === 'bump_speaking_opportunities')

beforeEach(() => {
  sb = makeSupabase()
})

describe('phrases-spoken telemetry', () => {
  it('does not write per cycle — deltas accumulate until a flush boundary', () => {
    const { api } = mountSession(baseOpts())
    api.bumpPhraseSpoken()
    api.bumpPhraseSpoken()
    api.bumpPhraseSpoken()
    expect(phraseCalls()).toHaveLength(0)

    api.flushTelemetryDelta()
    expect(phraseCalls()).toHaveLength(1)
    expect(phraseCalls()[0].args.p_phrases_delta).toBe(3)
  })

  it('sends the learner and course with the delta', () => {
    const { api } = mountSession(baseOpts())
    api.bumpPhraseSpoken()
    api.flushTelemetryDelta()
    expect(phraseCalls()[0].args).toEqual({
      p_learner_id: LEARNER,
      p_course_code: 'zho_for_eng',
      p_phrases_delta: 1,
    })
  })

  it('never double-counts: a second flush with nothing new sends nothing', () => {
    const { api } = mountSession(baseOpts())
    api.bumpPhraseSpoken()
    api.flushTelemetryDelta()
    api.flushTelemetryDelta()
    api.flushTelemetryDelta()
    expect(phraseCalls()).toHaveLength(1)
  })

  it('picks up again after a flush — the watermark advances, it does not latch', () => {
    const { api } = mountSession(baseOpts())
    api.bumpPhraseSpoken()
    api.flushTelemetryDelta()
    api.bumpPhraseSpoken()
    api.bumpPhraseSpoken()
    api.flushTelemetryDelta()
    expect(phraseCalls().map((c) => c.args.p_phrases_delta)).toEqual([1, 2])
  })

  it('SURVIVES TAB-CLOSE — beforeunload flushes the pending count', () => {
    const { api } = mountSession(baseOpts())
    api.bumpPhraseSpoken()
    api.bumpPhraseSpoken()
    // This is the failure mode the whole change exists to fix: the old
    // localStorage counter was banked only by endSession(), so closing the
    // tab dropped it.
    window.dispatchEvent(new Event('beforeunload'))
    expect(phraseCalls()).toHaveLength(1)
    expect(phraseCalls()[0].args.p_phrases_delta).toBe(2)
  })

  it('flushes when the tab is hidden (phone locked, app backgrounded)', () => {
    const { api } = mountSession(baseOpts())
    api.bumpPhraseSpoken()
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    spy.mockRestore()
    expect(phraseCalls()).toHaveLength(1)
    expect(phraseCalls()[0].args.p_phrases_delta).toBe(1)
  })

  it('a phrases-only flush is not swallowed when there is no opps/seconds delta', () => {
    const { api } = mountSession(baseOpts())
    api.bumpPhraseSpoken()
    api.flushTelemetryDelta()
    // The opportunities rpc early-returns on zero deltas; phrases must still go.
    expect(oppsCalls()).toHaveLength(0)
    expect(phraseCalls()).toHaveLength(1)
  })

  it('rides its OWN rpc and never touches the opportunities / play-seconds args', () => {
    const { api } = mountSession(baseOpts())
    api.bumpPhraseSpoken()
    api.bumpOpportunity()
    api.flushTelemetryDelta()

    expect(phraseCalls()).toHaveLength(1)
    expect(oppsCalls()).toHaveLength(1)
    // The phrases delta appears in exactly one place and is not smuggled into
    // the opportunities call.
    expect(Object.keys(phraseCalls()[0].args)).not.toContain('p_seconds_delta')
    expect(Object.keys(oppsCalls()[0].args)).not.toContain('p_phrases_delta')
    expect(oppsCalls()[0].args.p_opps_delta).toBe(1)
  })

  it('skips guests cleanly — no write, no throw', () => {
    const { api } = mountSession({ ...baseOpts(), learnerId: `guest-${LEARNER}` })
    api.bumpPhraseSpoken()
    expect(() => api.flushTelemetryDelta()).not.toThrow()
    expect(phraseCalls()).toHaveLength(0)
  })

  it('skips the demo learner too', () => {
    const { api } = mountSession({ ...baseOpts(), learnerId: undefined })
    api.bumpPhraseSpoken()
    api.flushTelemetryDelta()
    expect(phraseCalls()).toHaveLength(0)
  })

  it('does not throw when supabase is not available yet', () => {
    const { api } = mountSession({ ...baseOpts(), supabase: ref(null) })
    api.bumpPhraseSpoken()
    expect(() => api.flushTelemetryDelta()).not.toThrow()
  })
})
