/**
 * SEC25-X-01 / SEC25-X-02 — the two properties of `api/courses/[code]/round-map.ts`
 * that the 2026-08-25 audit records.
 *
 * `round-map` is one of only seven handlers on this surface that reference no
 * auth helper at all, and it is the one of those seven that the 2026-08-11
 * audit left as an open question ("they hold the *whole course*, which is the
 * paid product; entitlement checking is worth confirming against the business
 * model"). Its three siblings — bundle, cycles, infplay-cycles — have since
 * been gated with `resolveServerCourseAccess`. This one was not.
 *
 * The audit's verdict is that leaving it ungated is DEFENSIBLE: the response
 * carries round indices, lego ids and seed numbers, and no teachable content —
 * no known text, no target text, no audio id, no presigned URL. What it does
 * carry is two things that are worth pinning:
 *
 *   SEC25-X-01 (low) — the 503 branch handed an anonymous caller an operator
 *   instruction naming an internal database object. FIXED 2026-08-25: the body
 *   is now a fixed 'Course temporarily unavailable', the remedy is logged.
 *
 *   SEC25-X-02 (low) — a missing service-role key degraded SILENTLY to the anon
 *   key, where every comparable handler on this surface returns 500
 *   "Server misconfigured". FIXED 2026-08-25 in BOTH places: round-map guards
 *   before constructing its client, and `_utils/audioAccess`'s shared factory
 *   throws rather than swapping identity under the two audio-entitlement
 *   endpoints.
 *
 * The characterisation assertions for both have been flipped to the secure
 * shape; they are now the regression locks.
 *
 * Nothing here touches a database or a network. Every assertion reads the
 * handler's own source text, resolved from this file rather than from cwd so
 * the suite runs from the repo root or from api/ alike.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

const roundMap = src('[code]/round-map.ts')
const bundle = src('[code]/bundle.ts')
const cycles = src('[code]/cycles.ts')
const infplay = src('[code]/infplay-cycles.ts')

describe('SEC25-X: round-map — the ungated course-content sibling', () => {
  // ── Controls that hold ──

  it('validates the course code before it reaches the database', () => {
    // A learner-supplied path segment reaching a service-role query. The
    // pre-filter is what keeps malformed input out of PostgREST.
    expect(roundMap).toMatch(/COURSE_CODE_RE\s*=\s*\/\^\[a-z0-9_\]\+\$\//)
    expect(roundMap).toMatch(/COURSE_CODE_RE\.test\(code\)/)
  })

  it('rejects every method except GET', () => {
    expect(roundMap).toMatch(/req\.method !== 'GET'/)
    expect(roundMap).toContain('405')
  })

  it('projects only structural columns — no course text, no audio id', () => {
    // This is the whole reason leaving the endpoint ungated is defensible.
    // If a future change adds known_text/target_text/audio_id to this select,
    // the endpoint becomes an anonymous read of the paid product and this
    // test is the tripwire.
    expect(roundMap).toContain("select('round_index, lego_id, seed_number')")
    for (const leaked of ['known_text', 'target_text', 'audio_id', 's3_key', 'phrase_text']) {
      expect(roundMap, `round-map must not project ${leaked}`).not.toContain(leaked)
    }
  })

  it('its three content siblings ARE entitlement-gated', () => {
    // The 2026-08-11 audit could not confirm this; it is now true, and this
    // test is what keeps it true.
    for (const [name, s] of [['bundle', bundle], ['cycles', cycles], ['infplay-cycles', infplay]] as const) {
      expect(s, `${name} must resolve course access server-side`).toContain('resolveServerCourseAccess')
      expect(s, `${name} must deny unentitled callers`).toContain("error: 'Subscription required'")
    }
  })

  // ── SEC25-X-01: the 503 no longer leaks an operator instruction ──

  // SECURITY FINDING SEC25-X-01 — FIXED 2026-08-25. An unauthenticated caller
  // who asked for a course whose materialised view had not been refreshed was
  // told the name of the internal object and the DDL to run against it. The
  // 503 body now carries a fixed caller-safe string and the relation name +
  // remedy go to console.error only, matching the convention every comparable
  // handler follows (compare `api/board/snapshot/[code].ts`).
  it('SEC25-X-01 FIXED: the 503 body carries a fixed caller-safe string, not a relation name', () => {
    expect(roundMap).toContain("res.status(503).json({ error: 'Course temporarily unavailable' })")
    // The remedy still exists — but only in a server-side log.
    const i = roundMap.indexOf('run REFRESH MATERIALIZED VIEW')
    expect(i, 'the operator remedy should still be logged for whoever has to fix it').toBeGreaterThan(0)
    const preceding = roundMap.slice(Math.max(0, i - 300), i)
    expect(preceding, 'the remedy must be inside a console.error, not a response body').toContain(
      'console.error'
    )
    expect(preceding).not.toContain('res.status(503)')
  })

  // ── SEC25-X-02: silent degradation to the anon key ──

  // SECURITY FINDING SEC25-X-02 — FIXED 2026-08-25. `supabaseServiceKey ||
  // <anon key>` meant a missing or mistyped SUPABASE_SERVICE_ROLE_KEY did not
  // fail the request — it silently swapped the identity the query ran as,
  // moving the endpoint's read authority from "the handler decided" to
  // "whatever RLS on course_round_index happens to be". Both places now fail
  // CLOSED on a missing key: round-map returns 500 'Server misconfigured'
  // before it builds a client, and audioAccess's shared factory throws with
  // the same words (its two callers already 500 from their catch).
  it('SEC25-X-02 FIXED: round-map refuses to serve without a service-role key', () => {
    expect(roundMap).not.toMatch(/supabaseServiceKey \|\|/)
    expect(roundMap).not.toContain('SUPABASE_ANON_KEY')
    expect(roundMap).toContain("res.status(500).json({ error: 'Server misconfigured' })")
    // …and it refuses BEFORE constructing the client, not after a failed query.
    const guard = roundMap.indexOf("error: 'Server misconfigured'")
    const construct = roundMap.indexOf('createClient(supabaseUrl')
    expect(guard).toBeGreaterThan(0)
    expect(construct).toBeGreaterThan(guard)
  })

  it('SEC25-X-02: the swap this closed would have been UNDETECTABLE, because anon can read the view', () => {
    // This is what makes the silent fallback a real observation rather than a
    // style note. `anon` holds a grant on `course_round_index`, so a service
    // key that has gone missing produces byte-identical responses — the
    // misconfiguration cannot be noticed from outside, and nothing in the
    // handler notices it from inside either. (The grant is `ALL` rather than
    // `SELECT`; on a materialised view that is close to `SELECT` in practice,
    // since REFRESH requires ownership — recorded for the grant sweep in
    // area D rather than claimed as an exploit here.)
    const schema = readFileSync(resolve(here, '../../supabase/schema.sql'), 'utf8')
    expect(schema).toContain('ON TABLE public.course_round_index TO anon')
  })

  it('SEC25-X-02 FIXED: the shared audio-access client fails closed too', () => {
    // `_utils/audioAccess.createServiceSupabaseClient()` is the client behind
    // BOTH `audio/[audioId].ts` and `audio/batch-urls.ts` — the two endpoints
    // that decide audio entitlement. Same shape, higher stakes, which is why
    // it is pinned here rather than left as a note.
    const audioAccess = src('../_utils/audioAccess.ts')
    expect(audioAccess).not.toMatch(/createClient\(supabaseUrl, supabaseServiceKey \|\|/)
    expect(audioAccess).toContain('createClient(supabaseUrl, supabaseServiceKey)')
    expect(audioAccess).toMatch(
      /if \(!supabaseServiceKey\) \{\s*\n\s*throw new Error\('Server misconfigured/
    )
    // The anon fallback is gone entirely, not merely bypassed.
    expect(audioAccess).not.toContain('SUPABASE_ANON_KEY')
  })

  it('the fail-CLOSED convention both now follow is the majority behaviour', () => {
    // Named so the finding is read as a convention divergence with a quorum
    // behind it, not as one reviewer's preference.
    for (const rel of ['../access/claim.ts', '../family/remove.ts', '../groups/tree.ts']) {
      expect(src(rel), `${rel} is the convention`).toContain('Server misconfigured')
    }
  })

})
