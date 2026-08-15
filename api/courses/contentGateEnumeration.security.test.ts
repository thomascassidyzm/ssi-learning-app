/**
 * SECURITY AUDIT 2026-08-15 — the course-content surface, and SEC15-05 (info).
 *
 * The 2026-08-11 audit's headline lesson was not any single finding, it was a
 * shape: "a deliberate hardening pass that migrated the helpers and missed one
 * caller", found three times. Its own recommendation was that the cheapest
 * durable win is "making a hardening pass enumerate its callers".
 *
 * This file is that enumeration, made executable, for the one surface where a
 * missed caller gives away the paid product itself: the course-content
 * endpoints. `api/courses/[code]/*` are unauthenticated service-role reads of
 * the whole course — the thing subscribers pay for. Three of them consult
 * `resolveServerCourseAccess` (api/_utils/courseAccess.ts) and slice or refuse;
 * one is deliberately exempt because it carries no learner-facing text.
 *
 * The audit found no gap here today. The test exists so that a fourth content
 * endpoint added next month cannot ship ungated in silence — it goes red on the
 * commit that adds the file, not on the day someone notices the leak.
 *
 * Also recorded here: SEC15-05, the one header inconsistency the sweep turned
 * up in vercel.json, and the mockup directory it applies to.
 *
 * NOTE ON SCOPE: read-only. These tests change nothing.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const contentDir = join(here, '[code]')

/**
 * Endpoints under api/courses/[code]/ that legitimately have no entitlement
 * gate, each with the reason it is exempt. Anything NOT on this list must
 * consult the shared gate — that is what the enumeration test asserts.
 */
const EXEMPT: Record<string, string> = {
  'round-map.ts':
    'Returns only structural ids — round_index, lego_id, seed_number. No known_text, ' +
    'no target_text, no audio id. Reveals the shape of a course, never its content.',
}

function contentHandlers(): string[] {
  return readdirSync(contentDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
}

describe('course-content endpoints — every one is gated or explicitly exempt', () => {
  it('CONTROL: the enumeration is not empty (a moved directory must not silently pass)', () => {
    expect(contentHandlers().length).toBeGreaterThan(0)
  })

  it.each(contentHandlers())(
    'CONTROL: %s consults resolveServerCourseAccess, or is on the exempt list with a reason',
    (file) => {
      const src = readFileSync(join(contentDir, file), 'utf8')
      const gated = src.includes('resolveServerCourseAccess')

      if (!gated) {
        // A new ungated endpoint lands here. The message is the finding.
        expect(
          EXEMPT[file],
          `${file} serves course content with no entitlement gate and is not on the exempt ` +
            `list. Either call resolveServerCourseAccess (see bundle.ts / cycles.ts / ` +
            `infplay-cycles.ts) or add it to EXEMPT in this file with the reason it carries ` +
            `no paid content.`,
        ).toBeDefined()
        return
      }
      expect(gated).toBe(true)
    },
  )

  it('CONTROL: round-map really does expose no learner-facing text', () => {
    const src = readFileSync(join(contentDir, 'round-map.ts'), 'utf8')
    // The response body is built from exactly these three projected columns.
    expect(src).toContain("select('round_index, lego_id, seed_number')")
    for (const leaky of ['known_text', 'target_text', 'target1_audio_id', 'known_audio_id']) {
      expect(src, `round-map must not project ${leaky}`).not.toContain(leaky)
    }
  })

  it('CONTROL: the gate refuses to unlock on an unverifiable token rather than failing open', () => {
    const src = readFileSync(join(repoRoot, 'api', '_utils', 'courseAccess.ts'), 'utf8')
    // An absent/invalid bearer must fall to the preview branch, never to a full
    // unlock — the difference between a paywall and a suggestion.
    expect(src).toContain("checkCourseAccess(courseWithPricing, { isActive: false, tier: 'free' })")
  })

  it('CONTROL: the cascade-entitlement RPC is reachable only by the service role', () => {
    const schema = readFileSync(join(repoRoot, 'supabase', 'schema.sql'), 'utf8')
    const grants = schema
      .split('\n')
      .filter((l) => l.includes('get_cascade_courses') && l.startsWith('GRANT'))
    // SECURITY DEFINER + a caller-supplied p_user_id would be an enumeration
    // oracle for anyone else's cascaded courses if `authenticated` held it.
    expect(grants.length).toBeGreaterThan(0)
    expect(grants.every((g) => g.includes('service_role'))).toBe(true)
    expect(grants.some((g) => /TO (anon|authenticated)/.test(g))).toBe(false)
  })
})

describe('SEC15-05 — conflicting X-Frame-Options on the public mockup directory', () => {
  const vercelJson = JSON.parse(readFileSync(join(repoRoot, 'vercel.json'), 'utf8'))
  const rules: Array<{ source: string; headers: Array<{ key: string; value: string }> }> =
    vercelJson.headers

  const valueFor = (source: string, key: string): string | undefined =>
    rules.find((r) => r.source === source)?.headers.find((h) => h.key === key)?.value

  // SECURITY FINDING SEC15-05 (info, UNVERIFIED): `/(.*)` sets
  // X-Frame-Options: DENY and CSP frame-ancestors 'none'; `/_schools-mockups/(.*)`
  // sets SAMEORIGIN and frame-ancestors 'self'. Both rules match a mockup URL.
  // Which wins is Vercel's merge behaviour, which this audit did not verify
  // against a live response — so the risk is not that the mockups are framable
  // (they are static HTML with no session and no secrets, verified below), it
  // is that the file reads as if the narrower rule is authoritative when nobody
  // has checked that it is. If the intent is a framable gallery, the global rule
  // should exclude the path rather than be overridden by a second rule.
  it('SEC15-05: two rules set contradictory frame policies for the same path (characterized)', () => {
    expect(valueFor('/(.*)', 'X-Frame-Options')).toBe('DENY')
    expect(valueFor('/_schools-mockups/(.*)', 'X-Frame-Options')).toBe('SAMEORIGIN')
    expect(valueFor('/(.*)', 'Content-Security-Policy')).toBe("frame-ancestors 'none'")
    expect(valueFor('/_schools-mockups/(.*)', 'Content-Security-Policy')).toBe("frame-ancestors 'self'")
  })

  it('CONTROL: the frame-policy conflict is low-stakes — the mockups carry no key and no session', () => {
    const dir = join(repoRoot, 'packages', 'player-vue', 'public', '_schools-mockups')
    if (!existsSync(dir)) return // not built in this checkout — nothing to assert

    const files: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name))
        else if (e.name.endsWith('.html')) files.push(join(d, e.name))
      }
    }
    walk(dir)
    expect(files.length).toBeGreaterThan(0)

    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      // A JWT-shaped literal, a Supabase secret key, or a service-role mention
      // would each be a real leak on a publicly served, framable page.
      expect(src, `${f} contains a JWT-shaped literal`).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/)
      expect(src, `${f} contains a Supabase secret key`).not.toMatch(/sb_secret[A-Za-z0-9_-]+/)
      expect(src, `${f} mentions service_role`).not.toMatch(/service_role/)
    }
  })

  it.todo('SEC15-05: confirm Vercel’s header merge against a live response, then keep one frame rule per path')
})
