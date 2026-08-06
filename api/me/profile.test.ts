/**
 * Tests for the learner profile payload — the laws, not the plumbing.
 *
 * These pin the two things the 2026-08-03 design ruling cannot be allowed to
 * drift on: position dominates the portrait, and absence is not representable.
 */
import { describe, it, expect } from 'vitest'
import handler, { PLAN_TARGET_HOURS, estimateCefr, type LearnerProfilePayload } from './profile'

function mockRes() {
  const out: { status: number; body: any } = { status: 0, body: null }
  const res: any = {
    status(code: number) { out.status = code; return res },
    json(body: any) { out.body = body; return res },
  }
  return { res, out }
}

async function getGuestPayload(): Promise<LearnerProfilePayload> {
  const { res, out } = mockRes()
  await handler({ method: 'GET', query: {}, headers: {} } as any, res)
  return out.body
}

describe('me/profile', () => {
  it('serves a labelled sample payload to an unauthenticated caller', async () => {
    const body = await getGuestPayload()
    expect(body.adherence.source).toBe('mock')
    expect(body.mirror.source).toBe('mock')
    expect(body.portrait.source).toBe('mock')
    expect(body.plan.source).toBe('mock')
  })

  it('holds the plan unit at 30 hours', async () => {
    const body = await getGuestPayload()
    expect(body.plan.targetHours).toBe(PLAN_TARGET_HOURS)
    expect(PLAN_TARGET_HOURS).toBe(30)
  })

  /**
   * THE ACCEPTANCE TEST (the anti-gallery). Six real Duolingo shame emails are
   * the fixture this design is measured against: every one of them needs the
   * system to know about an absence. If any key here could carry a streak, a
   * gap, or a days-since count, the data model would be wrong — so no key may.
   */
  it('cannot express an absence anywhere in the payload', async () => {
    const body = await getGuestPayload()
    const keys = JSON.stringify(body).toLowerCase()
    for (const forbidden of ['streak', 'dayssince', 'missed', 'lapse', 'gap', 'lastseen', 'inactive']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  /** No incentive-points anywhere: every number is a countable descriptive insight. */
  it('carries no points, score or xp', async () => {
    const body = await getGuestPayload()
    const keys = JSON.stringify(body).toLowerCase()
    for (const forbidden of ['points', 'score', 'xp', 'rank', 'leaderboard', 'level']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  /**
   * Position is the difficulty term and it dominates. Founder ruling: brilliant
   * on the third thing you ever learned is not expert; struggling on the
   * nine-hundredth is not weak. Execution may nudge by one rung, never carry.
   */
  describe('the portrait is difficulty x execution', () => {
    it('will not call a flawless beginner advanced', () => {
      const beginner = estimateCefr(3, 1.0, 1.0)
      expect(beginner.band).toBe('A1')
    })

    it('will not call a struggling deep-course learner a beginner', () => {
      const deep = estimateCefr(900, 0.0, 1.0)
      expect(deep.band).toBe('B1+')
    })

    it('narrows the interval as confidence rises', () => {
      const early = estimateCefr(46, 0.6, 0.1)
      const settled = estimateCefr(46, 0.6, 0.9)
      expect(early.low).not.toBe(early.high)
      expect(settled.low).toBe(settled.high)
    })
  })

  it('rejects non-GET', async () => {
    const { res, out } = mockRes()
    await handler({ method: 'POST', query: {}, headers: {} } as any, res)
    expect(out.status).toBe(405)
  })
})
