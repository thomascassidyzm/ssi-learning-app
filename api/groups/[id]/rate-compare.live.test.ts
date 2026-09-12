// @vitest-environment node
/**
 * LIVE PROBE of the node insights reads against the real database — read-only,
 * opt-in, skipped unless INSIGHTS_LIVE=1 and a service-role key are in the
 * environment (pattern: api/intel/intel.live.test.ts).
 *
 * The question: does a real school that plays from the front (Ysgol Cas-gwent,
 * 34 classes, no pupil accounts) get the same insight set a demo programme
 * gets, from the same endpoints, as an ssi_admin? Before 2026-09-11 the rate
 * comparison read "no practice" for it and the voice roster was empty.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../_utils/auth', () => ({
  verifyAdmin: async () => ({ userId: 'live-probe', learnerId: 'live-probe' }),
  verifyAuthToken: async () => ({ valid: true, userId: 'live-probe' }),
}))

const live = process.env.INSIGHTS_LIVE === '1' && !!process.env.SUPABASE_SERVICE_ROLE_KEY
const CHEPSTOW = '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255'
const IME = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a'

type Json = Record<string, any>
async function call(mod: { default: (req: unknown, res: unknown) => Promise<void> }, query: Record<string, string>): Promise<{ status: number; body: Json }> {
  let status = 0
  let body: Json = {}
  const res = {
    status(s: number) { status = s; return this },
    json(b: Json) { body = b; return this },
    setHeader() { return this },
    end() { return this },
  }
  await mod.default({ method: 'GET', query, headers: { authorization: 'Bearer live' } }, res)
  return { status, body }
}

describe.skipIf(!live)('node insights, live and read-only: a real school beside the demo programme', () => {
  for (const [name, id] of [['Chepstow', CHEPSTOW], ['IME Demo', IME]] as const) {
    it(`${name}: rate compare draws from whole-class play`, async () => {
      const mod = await import('./rate-compare')
      for (const measure of ['rate', 'minutes_per_class', 'active_classes']) {
        const { status, body } = await call(mod, { id, window: '7d', measure })
        expect(status).toBe(200)
        console.log(`[${name} ${measure}]`, JSON.stringify({
          course: body.applied?.course_code, compare: body.applied?.compare_to, insufficient: body.insufficientData, reason: body.reason,
          entity: body.entity, average: body.average, cohortSize: body.cohortSize, contextLine: body.contextLine,
        }))
        if (name === 'Chepstow' && measure !== 'active_classes') expect(body.entity?.value ?? 0).toBeGreaterThan(0)
      }
    }, 120_000)

    it(`${name}: voice roster counts every class`, async () => {
      const mod = await import('../../org/vad')
      const { status, body } = await call(mod, { groupId: id })
      expect(status).toBe(200)
      console.log(`[${name} vad]`, JSON.stringify({ learners: body.scope?.learnerIds?.length, classes: body.scope?.classes?.length, metrics: body.metrics?.length, sampleNames: Object.values(body.names ?? {}).slice(0, 3) }))
      if (name === 'Chepstow') expect(body.scope.classes.length).toBeGreaterThan(30)
    }, 120_000)
  }
})
