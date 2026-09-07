/**
 * Four SECURITY DEFINER functions that only a server calls must not be
 * executable by `anon` or `authenticated`.
 *
 * Found 2026-09-07 while closing the find_learner_by_email email oracle, and
 * the same shape one step further out. SECURITY DEFINER runs as the owner, so
 * for these functions THE GRANT IS THE AUTHORISATION — there is no RLS behind
 * it to save anything. A blanket `GRANT ALL ... TO anon, authenticated,
 * service_role` therefore means the gate is open:
 *
 *   accrue_teacher_commission_held / reverse_teacher_commission — money writes
 *     against a teacher's commission ledger, called only by
 *     api/teacher/paddle-webhook.ts under the service-role key. Anyone holding
 *     the public anon key could accrue or reverse commission against any teacher.
 *   audit_log_prune — DELETEs content audit rows. Also carried a PUBLIC grant.
 *   analytics_learner_progress_rate — reads one learner's progress rate from a
 *     client-supplied id with no ownership gate, without signing in. No caller
 *     anywhere in the estate.
 *
 * Closed by supabase/migrations/20260907_definer_grants_service_role_only.sql,
 * applied live and verified by probing has_function_privilege as each role:
 * all four read true for anon and authenticated before, false after, with
 * service_role still true. This file is the static lock over the dump.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const schema = readFileSync(resolve(here, '../../supabase/schema.sql'), 'utf8')
const migration = readFileSync(
  resolve(here, '../../supabase/migrations/20260907_definer_grants_service_role_only.sql'),
  'utf8'
)

const SERVER_ONLY = [
  'accrue_teacher_commission_held',
  'reverse_teacher_commission',
  'audit_log_prune',
  'analytics_learner_progress_rate',
]

describe('server-only SECURITY DEFINER functions are not granted to the browser roles', () => {
  for (const fn of SERVER_ONLY) {
    it(`${fn} is not granted to anon or authenticated`, () => {
      const grants = schema
        .split('\n')
        .filter((l) => l.startsWith('GRANT') && l.includes(`ON FUNCTION public.${fn}(`))
      expect(grants.length, `expected ${fn}() to appear in the dump's ACLs`).toBeGreaterThan(0)
      for (const g of grants) {
        expect(g, `${fn} must not be executable by a browser role`).not.toMatch(/ TO (anon|authenticated);/)
      }
      // and it must still be reachable by the server that legitimately calls it
      expect(grants.some((g) => g.includes(' TO service_role;'))).toBe(true)
    })
  }

  it('audit_log_prune also loses the PUBLIC grant', () => {
    // PUBLIC covers anon and authenticated, so revoking them by name alone was
    // decorative until this line landed.
    expect(schema).toContain(
      'REVOKE ALL ON FUNCTION public.audit_log_prune(retention_days integer) FROM PUBLIC;'
    )
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.audit_log_prune\(integer\) FROM PUBLIC, anon, authenticated;/)
  })

  it('ships as a migration that keeps service_role alive', () => {
    for (const fn of SERVER_ONLY) {
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(`))
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`))
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';")
  })
})
