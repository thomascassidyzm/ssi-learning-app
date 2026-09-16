/**
 * GET /api/org/vad — THE INSIGHTS PATH CARRIES NO PUPIL.
 *
 * Tom, 2026-09-16 16:31Z: "nothing in Insights names a pupil, on the glance or
 * behind a tap." Hiding the rows in the component does not satisfy that — the
 * page must not RECEIVE them. Verified live on staging 2026-09-16 before this
 * test was written: the leader's Insights page pulled 86 learner names and 537
 * learner-keyed metric rows for Sunrise Public School, Pune.
 *
 * So the pin is the NEGATIVE one: with `aggregate=1` — the only way the
 * Insights page calls this endpoint — no learner name and no learner id
 * appears anywhere in the serialised body, while the aggregate figures the
 * panel draws survive intact. The admin board's named path (no aggregate flag)
 * is asserted alongside, because a fix that starved it would be a regression.
 *
 * Seen RED on the pre-fix handler (names and metrics returned regardless of
 * the flag) and GREEN after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

const LEARNERS = [
  { id: 'learner-aaa', display_name: 'Ira Shah' },
  { id: 'learner-bbb', display_name: 'Sanya Reddy' },
  { id: 'learner-ccc', display_name: 'Meera Patil' },
]

const METRICS = [
  { learner_id: 'learner-aaa', lego_id: 'S0001L01', course_code: 'eng_for_hin', mastery_state: 'mastered', mean_latency_ms: 120, n_samples: 4, last_seen_at: '2026-09-14T10:00:00Z' },
  { learner_id: 'learner-aaa', lego_id: 'S0002L01', course_code: 'eng_for_hin', mastery_state: 'confident', mean_latency_ms: 160, n_samples: 3, last_seen_at: '2026-09-14T10:05:00Z' },
  { learner_id: 'learner-bbb', lego_id: 'S0001L01', course_code: 'eng_for_hin', mastery_state: 'acquisition', mean_latency_ms: 240, n_samples: 2, last_seen_at: '2026-09-13T10:00:00Z' },
]

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({
          data: table === 'learners'
            ? LEARNERS.filter((l) => ids.includes(l.id))
            : METRICS.filter((m) => ids.includes(m.learner_id)),
          error: null,
        }),
      }),
    }),
  }),
}))

vi.mock('../_utils/vadVisibility', () => ({
  resolveVadCaller: async () => ({ userId: 'leader-1', isAdmin: false }),
  isDenied: (s: unknown) => !!(s as { denied?: boolean })?.denied,
  resolveVadScope: async () => ({
    kind: 'group',
    id: 'school-node',
    label: 'Sunrise Public School, Pune',
    learnerIds: LEARNERS.map((l) => l.id),
    classes: [
      { classId: 'class-1', className: 'Grade 7A', courseCode: 'eng_for_hin', learnerIds: ['learner-aaa', 'learner-bbb'] },
      { classId: 'class-2', className: 'Grade 8A', courseCode: 'eng_for_mar', learnerIds: ['learner-ccc'] },
    ],
  }),
}))

vi.mock('../_utils/vadProsody', () => ({
  fetchProsodyAggs: async () => ({
    events: 0,
    learners: 0,
    truncated: false,
    byLearner: {
      'learner-aaa': {
        events: 6,
        peakEnergyDbSum: -60, peakEnergyDbBase: 6,
        averageEnergyDbSum: -120, averageEnergyDbBase: 6,
        peakCountSum: 12, peakCountBase: 6,
        startedDuringPrompt: 1, startedDuringPromptBase: 6,
        stillSpeakingAtVoice1: 2, stillSpeakingAtVoice1Base: 6,
      },
    },
  }),
}))

const handler = (await import('./vad')).default

function makeRes(): VercelResponse & { _status: number; _json: any } {
  const res: any = { _status: 0, _json: null }
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._json = body; return res }
  res.setHeader = () => res
  res.end = () => res
  return res
}

const req = (query: Record<string, string>): VercelRequest =>
  ({ method: 'GET', query, headers: { authorization: 'Bearer token' } } as unknown as VercelRequest)

describe('GET /api/org/vad — the Insights path', () => {
  let res: ReturnType<typeof makeRes>
  beforeEach(() => { res = makeRes() })

  it('returns aggregates only: no learner name and no learner id crosses the wire', async () => {
    await handler(req({ groupId: 'school-node', aggregate: '1' }), res)
    expect(res._status).toBe(200)

    const wire = JSON.stringify(res._json)
    for (const l of LEARNERS) {
      expect(wire).not.toContain(l.display_name)
      expect(wire).not.toContain(l.id)
    }

    // …and the panel still has everything it draws.
    expect(res._json.aggregate).toBe(true)
    expect(res._json.scope.total).toBe(3)
    expect(res._json.summary.total).toBe(3)
    expect(res._json.summary.withData).toBe(2)
    expect(res._json.summary.legoSeries).toBe(3)
    expect(res._json.summary.learners).toEqual([])
    expect(res._json.summary.mastery.mastered).toBe(1)
    expect(res._json.summary.prosody.events).toBe(6)
    expect(res._json.classUptake).toEqual([
      expect.objectContaining({ classId: 'class-1', className: 'Grade 7A', total: 2, withData: 2 }),
      expect.objectContaining({ classId: 'class-2', className: 'Grade 8A', total: 1, withData: 0 }),
    ])
  })

  it('scopes to the card’s course when one is named', async () => {
    await handler(req({ groupId: 'school-node', aggregate: '1', courseCode: 'eng_for_mar' }), res)
    expect(res._status).toBe(200)
    expect(res._json.scope.classes.map((c: any) => c.classId)).toEqual(['class-2'])
    expect(res._json.scope.total).toBe(1)
    expect(res._json.summary.withData).toBe(0)
  })

  it('still names learners for the admin board, which is not the Insights page', async () => {
    await handler(req({ groupId: 'school-node' }), res)
    expect(res._status).toBe(200)
    expect(Object.values(res._json.names)).toContain('Ira Shah')
    expect(res._json.metrics).toHaveLength(3)
  })
})
