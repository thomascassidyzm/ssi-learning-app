/**
 * SEC25-D-02 — `admin_practice_minutes(_by_course)` are SECURITY DEFINER,
 * granted to `anon`, carry NO internal auth check, and are called directly
 * from browser code with the anon/authenticated Supabase client.
 *
 * Area D of the 2026-08-25 audit (docs/security-audit-2026-08-25/area-d-db-and-hygiene.md).
 * Same shape as SEC22-01 (generate_join_code): a DEFINER function reachable
 * by an unauthenticated client via `supabase.rpc(...)`, this time exposing
 * learner practice-time data rather than minting a credential.
 *
 * The twin function `admin_user_course_stats` — same "admin_" name prefix,
 * same SECURITY DEFINER, same table it draws from (course_enrollments /
 * sessions) — DOES gate itself with `IF NOT public.is_ssi_admin() THEN RAISE
 * EXCEPTION`. `admin_practice_minutes` and `admin_practice_minutes_by_course`
 * do not. That asymmetry between two functions with the same naming
 * convention, written to look like siblings, is the tell that this is a
 * missed check rather than an intentional public endpoint.
 *
 * CONCRETE ATTACK: an unauthenticated caller with only the repo's public
 * anon key (shipped in the client bundle) calls
 *   supabase.rpc('admin_practice_minutes', { p_learner_ids: [<any UUID>] })
 * and receives that learner's practice-minutes-by-course for every course —
 * no session, no learner-ownership check, no admin check. Calling
 * `admin_practice_minutes_by_course` with NO argument (its default is
 * `NULL`) returns platform-wide practice-minute totals grouped by course,
 * aggregated across every learner — a business metric with no PII, but with
 * no gate either.
 *
 * FIXED 2026-08-25 by supabase/migrations/20260825_sec25_d02_practice_minutes_gate.sql.
 * The characterisations below have been flipped to the SECURE assertions the
 * paired it.todo()s named:
 *   - EXECUTE revoked from PUBLIC/anon on both. `admin_practice_minutes` is now
 *     service_role only (its only callers are service-role server handlers
 *     behind verifyAdmin).
 *   - `admin_practice_minutes_by_course` kept `authenticated` at that point,
 *     because four browser callers depended on it, and gated only its
 *     NULL-argument (platform-wide aggregate) path on is_ssi_admin().
 *
 * RESIDUAL CLOSED 2026-09-07 by 20260907_practice_minutes_scope_repoint_revoke.sql.
 * The August pass left the NAMED-LEARNER path open to any signed-in caller who
 * knew a learner UUID — reproduced live that day against a stranger's row, 33
 * courses returned. All four browser callers were repointed at
 * POST /api/school/practice-by-course (resolveVisibleScope, loud 403 on an
 * out-of-scope id) FIRST, and only then was `authenticated` revoked: the
 * function is now service_role only.
 * It reads supabase/schema.sql and the calling source files only — no DB or
 * network contact.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(here, '../../supabase/schema.sql')
const schema = readFileSync(schemaPath, 'utf8')

function functionBody(name: string): string {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  expect(start, `expected ${name}() to exist in schema.sql`).toBeGreaterThan(-1)
  const end = schema.indexOf('$$;', start)
  expect(end, `expected a terminated body for ${name}()`).toBeGreaterThan(start)
  return schema.slice(start, end)
}

const AUTH_CHECK = /is_ssi_admin|is_god_user|is_school_admin_of|is_govt_admin_over_group|auth\.uid\(\)|RAISE EXCEPTION/i

describe('SEC25-D-02: admin_practice_minutes(_by_course) — DEFINER, anon-granted, unchecked', () => {
  // ── the finding, pinned ──

  it('SECURE: admin_practice_minutes() is service_role only — anon and authenticated cannot execute it', () => {
    expect(schema).toContain(
      'REVOKE ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) FROM PUBLIC;',
    )
    expect(schema).toContain(
      'GRANT ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) TO service_role;',
    )
    expect(schema).not.toContain(
      'GRANT ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) TO anon;',
    )
    expect(schema).not.toContain(
      'GRANT ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) TO authenticated;',
    )
  })

  it('SECURE: admin_practice_minutes_by_course() is service_role only — no anon, and no authenticated either', () => {
    expect(schema).toContain(
      'REVOKE ALL ON FUNCTION public.admin_practice_minutes_by_course(p_learner_ids uuid[]) FROM PUBLIC;',
    )
    expect(schema).not.toContain(
      'GRANT ALL ON FUNCTION public.admin_practice_minutes_by_course(p_learner_ids uuid[]) TO anon;',
    )
    // The named-learner oracle: an `authenticated` grant is what let any
    // signed-in caller read a stranger's practice history by UUID.
    expect(schema).not.toContain(
      'GRANT ALL ON FUNCTION public.admin_practice_minutes_by_course(p_learner_ids uuid[]) TO authenticated;',
    )
    expect(schema).toContain(
      'GRANT ALL ON FUNCTION public.admin_practice_minutes_by_course(p_learner_ids uuid[]) TO service_role;',
    )
  })

  it('SECURE: the platform-wide (NULL-argument) path of _by_course gates on is_ssi_admin()', () => {
    const body = functionBody('admin_practice_minutes_by_course')
    expect(body).toContain('SECURITY DEFINER')
    expect(body).toMatch(AUTH_CHECK)
    expect(body).toMatch(/IF p_learner_ids IS NULL[\s\S]*NOT public\.is_ssi_admin\(\)/)
    expect(body).toMatch(/RAISE EXCEPTION 'Forbidden/)
    // The optional-null shape still exists — it is now guarded, not removed.
    expect(body).toContain('p_learner_ids uuid[] DEFAULT NULL')
  })

  it('SECURE: the fix ships as a migration that reloads the PostgREST schema cache', () => {
    const migration = readFileSync(
      resolve(here, '../../supabase/migrations/20260825_sec25_d02_practice_minutes_gate.sql'),
      'utf8',
    )
    expect(migration).toContain('revoke all on function public.admin_practice_minutes(uuid[]) from anon;')
    expect(migration).toContain(
      'revoke all on function public.admin_practice_minutes_by_course(uuid[]) from anon;',
    )
    expect(migration).toContain("notify pgrst, 'reload schema';")
  })

  // ── the control that DOES hold on the twin function ──
  // Same admin_* prefix, same DEFINER, same underlying data — proves the
  // gate pattern was known and applied to a sibling, so this is a missed
  // caller, not an unsolved design problem (same posture as SEC22-01's fix).
  it('the sibling admin_user_course_stats() DOES gate on is_ssi_admin()', () => {
    const body = functionBody('admin_user_course_stats')
    expect(body).toContain('SECURITY DEFINER')
    expect(body).toMatch(/IF NOT public\.is_ssi_admin\(\) THEN/)
  })

  // ── the blast radius: called from BROWSER code with the anon/authenticated key ──

  it('NO browser caller of the RPC remains — every one was repointed before the revoke', () => {
    const srcRoot = resolve(here, '../../packages/player-vue/src')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|vue|js)$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8')
          if (text.includes(".rpc('admin_practice_minutes")) offenders.push(full)
        }
      }
    }
    walk(srcRoot)
    expect(offenders, 'browser code must go through /api/school/practice-by-course').toEqual([])
  })

  it('the repointed callers all go through the scoped endpoint helper', () => {
    const files = [
      '../../packages/player-vue/src/composables/admin/useAdminCourses.ts',
      '../../packages/player-vue/src/composables/admin/useAdminUserDetail.ts',
      '../../packages/player-vue/src/composables/schools/useAnalyticsData.ts',
      '../../packages/player-vue/src/views/schools/StudentProgressView.vue',
    ]
    for (const f of files) {
      expect(readFileSync(resolve(here, f), 'utf8'), f).toContain('fetchPracticeByCourse')
    }
    const helper = readFileSync(resolve(here, '../../packages/player-vue/src/composables/practiceByCourse.ts'), 'utf8')
    expect(helper).toContain('/api/school/practice-by-course')
  })

  it('the revoke ships as its own migration, after the repoint, and reloads the schema cache', () => {
    const migration = readFileSync(
      resolve(here, '../../supabase/migrations/20260907_practice_minutes_scope_repoint_revoke.sql'),
      'utf8',
    )
    expect(migration).toContain('revoke all on function public.admin_practice_minutes_by_course(uuid[]) from authenticated;')
    expect(migration).toContain("notify pgrst, 'reload schema';")
  })

  it('the server-side caller (api/admin/attention.ts) is not the only path — RPC has no gate of its own', () => {
    const attention = readFileSync(resolve(here, '../admin/attention.ts'), 'utf8')
    expect(attention).toContain(".rpc('admin_practice_minutes'")
    // Whatever admin check attention.ts performs before this line protects
    // ONLY this call site — the RPC itself remains reachable by anon from any
    // other caller, browser or otherwise, per the grant above.
  })
})
