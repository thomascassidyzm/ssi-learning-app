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
 *   SEC25-X-01 (low) — the 503 branch hands an anonymous caller an operator
 *   instruction naming an internal database object.
 *
 *   SEC25-X-02 (low) — a missing service-role key degrades SILENTLY to the anon
 *   key, where every comparable handler on this surface returns 500
 *   "Server misconfigured".
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

  // ── SEC25-X-01: the 503 leaks an operator instruction ──

  // SECURITY FINDING SEC25-X-01: an unauthenticated caller who asks for a
  // course whose materialised view has not been refreshed is told the name of
  // the internal object and the DDL to run against it. Every comparable
  // handler returns a fixed string and logs the detail server-side (compare
  // `api/board/snapshot/[code].ts` -> 'Internal server error'). Characterizes
  // today's behaviour, so it PASSES today and goes red when fixed.
  it('SEC25-X-01: names an internal relation and its DDL in a response body', () => {
    expect(roundMap).toContain('run REFRESH MATERIALIZED VIEW course_round_index')
    // …and it is in the response body, not only in a server-side log.
    const i = roundMap.indexOf('run REFRESH MATERIALIZED VIEW')
    const preceding = roundMap.slice(Math.max(0, i - 300), i)
    expect(preceding).toContain('res.status(503)')
  })

  it.todo(
    'SEC25-X-01 fixed: the 503 body carries a fixed caller-safe string, and the ' +
      'relation name and remedy go to console.error only'
  )

  // ── SEC25-X-02: silent degradation to the anon key ──

  // SECURITY FINDING SEC25-X-02: `supabaseServiceKey || <anon key>`. A missing
  // or mistyped SUPABASE_SERVICE_ROLE_KEY does not fail the request — it
  // silently swaps the identity the query runs as, which moves the endpoint's
  // read authority from "the handler decided" to "whatever RLS on
  // course_round_index happens to be". The failure is invisible either way:
  // if RLS permits the read the swap is undetectable, and if it denies it the
  // handler reports 503 "not yet materialised", which points an operator at
  // the wrong cause entirely.
  it('SEC25-X-02: falls back from the service key to the anon key without erroring', () => {
    expect(roundMap).toMatch(/supabaseServiceKey \|\|\s*\n?\s*\(process\.env\.VITE_SUPABASE_ANON_KEY/)
    expect(roundMap).not.toContain('Server misconfigured')
  })

  it('SEC25-X-02: the same silent fallback is in the shared audio-access client', () => {
    // `_utils/audioAccess.createServiceSupabaseClient()` is the client behind
    // BOTH `audio/[audioId].ts` and `audio/batch-urls.ts` — the two endpoints
    // that decide audio entitlement. Same shape, higher stakes, which is why
    // it is pinned here rather than left as a note.
    const audioAccess = src('../_utils/audioAccess.ts')
    expect(audioAccess).toContain('supabaseServiceKey || supabaseAnonKeyFallback')
  })

  it('the fail-CLOSED convention this diverges from is the majority behaviour', () => {
    // Named so the finding is read as a convention divergence with a quorum
    // behind it, not as one reviewer's preference.
    for (const rel of ['../access/claim.ts', '../family/remove.ts', '../groups/tree.ts']) {
      expect(src(rel), `${rel} is the convention`).toContain('Server misconfigured')
    }
  })

  it.todo(
    'SEC25-X-02 fixed: a missing SUPABASE_SERVICE_ROLE_KEY returns 500 ' +
      '"Server misconfigured" rather than silently re-identifying the query as anon'
  )
})
