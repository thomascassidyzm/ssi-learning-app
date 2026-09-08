/**
 * org_enrolments must be readable by a signed-in learner and writable by nobody
 * but the server.
 *
 * Found 2026-09-08 while applying supabase/migrations/20260908e_org_enrolments.sql
 * to the live database. That migration says, in its own header, that the posture
 * is "own-row SELECT for the learner ... and NOTHING else". It revoked ALL from
 * anon and granted SELECT to authenticated — but it never revoked from
 * authenticated, so Supabase's grant-open default for new tables survived
 * underneath. Live grants read, immediately after the apply:
 *
 *   authenticated | org_enrolments | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
 *
 * INSERT, UPDATE and DELETE were already dead — RLS is on and there is no policy
 * for any of them, so row-level security refuses them whatever the grant says.
 * TRUNCATE is the one that mattered: TRUNCATE IS NOT SUBJECT TO ROW-LEVEL
 * SECURITY, so a grant of it to authenticated is a grant to empty the table with
 * no policy in the way. Nothing could reach it in practice — PostgREST does not
 * issue TRUNCATE — so this was closed as posture, not as an incident, and it is
 * RLS doctrine rule 7 (never Supabase's grant-open default) applied a few
 * minutes late.
 *
 * Closed by supabase/migrations/20260908f_org_enrolments_authenticated_select_only.sql,
 * applied live and verified by re-reading information_schema.role_table_grants:
 * authenticated read all seven privileges before and SELECT alone after, with
 * service_role unchanged and anon holding nothing throughout. This file is the
 * static lock over the dump and the migration.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(resolve(here, '../..', p), 'utf8')

const schema = read('supabase/schema.sql')
const fix = read('supabase/migrations/20260908f_org_enrolments_authenticated_select_only.sql')

const grantsFor = (table: string) =>
  schema
    .split('\n')
    .filter((l) => l.startsWith('GRANT') && l.includes(` ON TABLE public.${table} TO `))

describe('org enrolment tables carry an explicit, minimal posture', () => {
  it('the snapshot records grants for both tables at all', () => {
    expect(grantsFor('org_enrolments').length).toBeGreaterThan(0)
    expect(grantsFor('org_enrolment_policies').length).toBeGreaterThan(0)
  })

  it('authenticated may only SELECT org_enrolments — never TRUNCATE, which RLS cannot refuse', () => {
    const toAuthenticated = grantsFor('org_enrolments').filter((l) => / TO authenticated;$/.test(l))
    expect(toAuthenticated.length, 'a learner must be able to read their own enrolment').toBe(1)
    expect(toAuthenticated[0]).toMatch(/^GRANT SELECT ON TABLE/)
    for (const g of toAuthenticated) {
      expect(g, 'TRUNCATE bypasses row-level security entirely').not.toMatch(/TRUNCATE|ALL/)
      expect(g, 'every write to org_enrolments is server-mediated').not.toMatch(/INSERT|UPDATE|DELETE/)
    }
  })

  it('anon holds nothing on either table', () => {
    for (const t of ['org_enrolments', 'org_enrolment_policies']) {
      expect(grantsFor(t).filter((l) => / TO anon;$/.test(l))).toEqual([])
    }
  })

  it('org_enrolment_policies is service_role only — the enrolment page reads it through an endpoint', () => {
    const grants = grantsFor('org_enrolment_policies')
    expect(grants.every((g) => / TO service_role;$/.test(g))).toBe(true)
    expect(grants.some((g) => g.startsWith('GRANT ALL'))).toBe(true)
  })

  it('the server keeps full access to org_enrolments', () => {
    expect(grantsFor('org_enrolments').some((g) => /^GRANT ALL ON TABLE public\.org_enrolments TO service_role;$/.test(g))).toBe(true)
  })

  it('the correcting migration revokes before it grants, so the default cannot survive underneath', () => {
    const revokeAt = fix.indexOf('REVOKE ALL ON TABLE public.org_enrolments FROM authenticated;')
    const grantAt = fix.indexOf('GRANT SELECT ON TABLE public.org_enrolments TO authenticated;')
    expect(revokeAt).toBeGreaterThan(-1)
    expect(grantAt).toBeGreaterThan(revokeAt)
    expect(fix).toMatch(/NOTIFY pgrst, 'reload schema'/)
  })
})
