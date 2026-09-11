/**
 * The k-floor is the one thing on this page that must never quietly soften.
 *
 * With 87 real people spread across 53 courses, most courses genuinely cannot
 * support a per-LEGO number, and the page saying so is the correct output. A
 * regression here would not look like a crash — it would look like a lively
 * page full of numbers made of one or two people, which is the worst failure
 * available to this particular page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => ({ userId: 'admin-1' })),
}))
vi.mock('../_utils/cors', () => ({ applyCors: () => false }))

let learners: { id: string; is_class_entity: boolean | null; platform_role: string | null }[] = []
let events: any[] = []

function chain(table: string) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    not: () => builder,
    in: () => builder,
    order: () => builder,
    range: (from: number, to: number) =>
      Promise.resolve({ data: table === 'player_events' ? events.slice(from, to + 1) : [], error: null }),
    then: (onF: any, onR: any) => {
      const data =
        table === 'learners' ? learners
        : table === 'course_legos' ? [{ lego_id: 'S0001L01', known_text: 'I want', target_text: 'quiero' }]
        : []
      return Promise.resolve({ data, error: null }).then(onF, onR)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => chain(table),
    rpc: async () => ({ data: [], error: null }),
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((c: number) => { res._status = c; return res })
  res.json = vi.fn((b: unknown) => { res._json = b; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function event(learner: string, type: string, lego: string) {
  return { learner_id: learner, event_type: type, payload: { legoId: lego }, ip_country: 'GB', occurred_at: '2026-09-01T00:00:00Z' }
}

describe('GET /api/intel/weak-points — the k-floor', () => {
  let handler: typeof import('./weak-points').default

  beforeEach(async () => {
    vi.resetModules()
    learners = []
    events = []
    handler = (await import('./weak-points')).default
  })

  it('says too few to say, and shows NO rows, when four real people are in the course', async () => {
    for (let i = 1; i <= 4; i++) {
      learners.push({ id: `p${i}`, is_class_entity: false, platform_role: null })
      events.push(event(`p${i}`, 'audio_play', 'S0001L01'), event(`p${i}`, 'lego_skip', 'S0001L01'))
    }
    const res = makeRes()
    await handler({ method: 'GET', query: { course: 'spa_for_eng' }, headers: {} } as unknown as VercelRequest, res)

    expect(res._status).toBe(200)
    expect(res._json.tooFewToSay).toBe(true)
    expect(res._json.rows).toEqual([])
    expect(res._json.learners).toBe(4)
    expect(res._json.kFloor).toBe(5)
  })

  it('answers with rows once five real people are in the course', async () => {
    for (let i = 1; i <= 5; i++) {
      learners.push({ id: `p${i}`, is_class_entity: false, platform_role: null })
      events.push(event(`p${i}`, 'audio_play', 'S0001L01'), event(`p${i}`, 'lego_skip', 'S0001L01'))
    }
    const res = makeRes()
    await handler({ method: 'GET', query: { course: 'spa_for_eng' }, headers: {} } as unknown as VercelRequest, res)

    expect(res._json.tooFewToSay).toBe(false)
    expect(res._json.rows).toHaveLength(1)
    const row = res._json.rows[0]
    expect(row.legoId).toBe('S0001L01')
    expect(row.learnersReached).toBe(5)
    expect(row.skips).toBe(5)
    // Everybody's last event in the course was on this LEGO.
    expect(row.stoppedShare).toBe(1)
    // Position is a LEGO and the row carries both languages.
    expect(row.knownText).toBe('I want')
    expect(row.targetText).toBe('quiero')
  })

  it('does not count a tester towards the floor', async () => {
    for (let i = 1; i <= 4; i++) {
      learners.push({ id: `p${i}`, is_class_entity: false, platform_role: null })
      events.push(event(`p${i}`, 'audio_play', 'S0001L01'))
    }
    learners.push({ id: 'tester-1', is_class_entity: false, platform_role: 'tester' })
    events.push(event('tester-1', 'audio_play', 'S0001L01'))

    const res = makeRes()
    await handler({ method: 'GET', query: { course: 'spa_for_eng' }, headers: {} } as unknown as VercelRequest, res)

    expect(res._json.learners).toBe(4)
    expect(res._json.tooFewToSay).toBe(true)
  })

  it('does not count machine traffic towards the floor', async () => {
    for (let i = 1; i <= 4; i++) {
      learners.push({ id: `p${i}`, is_class_entity: false, platform_role: null })
      events.push(event(`p${i}`, 'audio_play', 'S0001L01'))
    }
    learners.push({ id: 'jp-1', is_class_entity: false, platform_role: null })
    events.push({ ...event('jp-1', 'audio_play', 'S0001L01'), ip_country: 'JP' })

    const res = makeRes()
    await handler({ method: 'GET', query: { course: 'spa_for_eng' }, headers: {} } as unknown as VercelRequest, res)

    expect(res._json.learners).toBe(4)
    expect(res._json.tooFewToSay).toBe(true)
  })
})
