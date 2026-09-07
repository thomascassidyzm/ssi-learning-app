import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { paddleConfig } from './paddle'

// The live SSi Premium prices — the ONE product every adult per-seat lane
// resolves to. Duplicated here deliberately: if someone changes the constants
// in paddle.ts, this test should notice rather than follow along.
const SSI_PREMIUM_MONTHLY = 'pri_01kqq85gvncyasfmfvvpcv1xfg'
const SSI_PREMIUM_ANNUAL = 'pri_01kqq86ymc3yhm8be3w7f7kgr1'

// Vitest runs with the package root as cwd; import.meta.url is not a file URL
// under its transform, so resolve from cwd instead.
const source = readFileSync(resolve(process.cwd(), 'src/lib/paddle.ts'), 'utf8')

/** The doc-comment entry for one env var, up to the next `VITE_PADDLE_` entry. */
function docEntry(varName: string): string {
  const start = source.indexOf(` *   ${varName}`)
  expect(start, `${varName} should be documented in the paddle.ts header comment`).toBeGreaterThan(-1)
  const rest = source.slice(start + varName.length)
  const next = rest.indexOf(' *   VITE_PADDLE_')
  return rest.slice(0, next === -1 ? rest.indexOf('\n */') : next)
}

// Tom's ruling 2026-09-07: "Teacher prices are in there. Teachers are just
// regular users" — there is no separate school-teacher Paddle product and
// there never will be. A school is quantity>1 of the same £15/£150 SSi
// Premium per-seat price; the webhook tells the lanes apart by
// customData.kind, never by price id. This mirrors the founder ruling of
// 2026-08-02 that governs the org-seat lane.
describe('school-teacher seat = the ordinary SSi Premium price (Tom 2026-09-07)', () => {
  // No .env files exist in this package, so no VITE_PADDLE_* var is set under
  // Vitest — this is the zero-config case, exactly what Vercel looks like
  // before anyone pastes a school-specific env var in (and nobody needs to).
  it('resolves the school MONTHLY seat to SSi Premium with no env configured', () => {
    expect(paddleConfig.schoolTeacherMonthlyPriceId).toBe(SSI_PREMIUM_MONTHLY)
  })

  it('resolves the school ANNUAL seat to SSi Premium with no env configured', () => {
    expect(paddleConfig.schoolTeacherAnnualPriceId).toBe(SSI_PREMIUM_ANNUAL)
  })

  it('does not tell anyone to create a school-teacher price in Paddle', () => {
    for (const v of ['VITE_PADDLE_SCHOOL_TEACHER_PRICE_MONTHLY', 'VITE_PADDLE_SCHOOL_TEACHER_PRICE_ANNUAL']) {
      expect(docEntry(v), `${v} must not claim a Paddle product has to be created`).not.toMatch(
        /must create|creates? (this|the) price|create .* in Paddle/i,
      )
    }
  })
})

// Guard on the OTHER half of Tom's ruling: the Family product genuinely does
// not exist yet, so its price ids must stay fallback-free and its warning must
// stay put. A well-meaning "consistency" pass that gave Family a fallback would
// silently unhide the Family paywall against a product that may not be there.
describe('SSi Family prices stay fallback-free (Tom 2026-09-07: "leave the FAMILY prices alone")', () => {
  it('leaves the family price ids undefined when their env vars are unset', () => {
    expect(paddleConfig.familyMonthlyPriceId).toBeUndefined()
    expect(paddleConfig.familyAnnualPriceId).toBeUndefined()
  })

  it('keeps the NO FALLBACK warning on the family env docs', () => {
    expect(docEntry('VITE_PADDLE_FAMILY_PRICE_ANNUAL')).toMatch(/NO FALLBACK/)
  })
})
