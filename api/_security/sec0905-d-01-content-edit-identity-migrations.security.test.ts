/**
 * SEC0905-D-01 / SEC0905-D-02 / SEC0905-D-03 — the 2026-09-01 editor-identity
 * migrations (supabase/migrations/20260901_content_edit_identity.sql,
 * 20260901b_audit_trigger_ignores_edit_event_stamp.sql,
 * 20260901c_content_edit_identity_ENFORCE.sql.UNAPPLIED).
 *
 * Read-only source review, per the audit's own rule: no DB connection was
 * made and none of these files were applied, edited or reverted by this
 * suite. All three findings are pinned as CHARACTERIZATIONS of the migration
 * files as they read today; each documents the exact change that would flip
 * it green.
 *
 * SEC0905-D-01 (MEDIUM) — content_edit_events has NO own-row scoping on
 * SELECT. `CREATE POLICY "Authenticated users can view content_edit_events"
 * ... FOR SELECT TO authenticated USING (true)` grants every signed-in
 * caller — which in this shared-DB estate includes every ordinary learner
 * signed into ssi-learning-app, not just Popty/dashboard staff — read access
 * to the WHOLE table: actor_id (a real Supabase auth uid), actor_label (the
 * human name behind it), scope and detail (jsonb — course edit payloads,
 * potentially pre-publish content). CLAUDE.md's RLS doctrine rule 1 is "is
 * this my row? only; hierarchy authz = endpoints" — this policy has no row
 * predicate at all. content_edit_events is not a "content table" under the
 * doctrine's own "content tables stay permissive by design" carve-out (that
 * carve-out is about course_seeds/legos/phrases, i.e. the LEARNING content
 * itself) — it is an internal editorial audit log, and this migration is the
 * first thing to make staff identities and edit history queryable by anyone
 * with an anon key and a login, which is every learner.
 * Fix sketch: either drop the authenticated-SELECT policy and read this table
 * only through a server endpoint that knows what the caller is allowed to
 * see, or scope it to `actor_id = auth.uid()` (an editor seeing their own
 * history) plus a service-side admin path — never USING (true).
 *
 * SEC0905-D-02 (MEDIUM) — the attribution requirement is DB-unenforced today.
 * 20260901_content_edit_identity.sql added `last_edit_event_id` as NULLABLE
 * with no CHECK. The migration that would enforce it —
 * 20260901c_content_edit_identity_ENFORCE.sql — carries the literal
 * `.UNAPPLIED` filename suffix and is not a real migration on this
 * timestamp-ordered path, so as of today NOTHING at the database layer stops
 * a write to course_seeds/course_legos/course_practice_phrases from leaving
 * last_edit_event_id NULL — indistinguishable from a legitimate
 * pre-2026-09-01 legacy row, which is precisely the ambiguity the whole
 * feature exists to remove.
 * CALIBRATION (checked in the sibling ssi-dashboard-v7-clean repo, outside
 * this audit's scope, only to size the residual honestly): the primary
 * editing surface is already gated at the APPLICATION layer —
 * services/shared/content-edit-gate.cjs (that repo's commit dd2c69fa4,
 * 2026-09-01, on its main) sits in front of all 36 HTTP write routes across
 * course-builder-api.cjs and production-api.cjs and refuses unauthenticated,
 * spoofed and garbage-token writes before they reach the DB. So this residual
 * is specifically for writers that bypass that HTTP surface entirely —
 * pipeline services, phase8 batch jobs, tools/ sweeps connecting straight to
 * Postgres with the service-role key — exactly the population the ENFORCE
 * migration's own precondition query is written to check for
 * ("actor_id = 'undeclared-loopback'") before it is safe to flip on. Until it
 * is applied, that population can write unattributed with nothing to detect
 * it, which is a non-repudiation/forensic gap rather than a new access
 * grant (those writers already hold the service-role key).
 * Fix sketch: run the two precondition queries the file already documents,
 * flip CONTENT_EDIT_IDENTITY_MODE=enforce, wait, then rename off `.UNAPPLIED`
 * and apply.
 *
 * SEC0905-D-03 (LOW, doctrine/process) — 20260901_content_edit_identity.sql
 * creates a new table, two new policies and three new columns, and never
 * calls `NOTIFY pgrst, 'reload schema'`. CLAUDE.md's RLS doctrine rule 6 is
 * explicit: "every policy/grant migration ends with NOTIFY pgrst". The
 * sibling migration in this same window (20260901_sector_helix.sql) does this
 * correctly and is pinned below as a secure-assertion/regression-guard for
 * contrast. This is not an access-control hole (a stale PostgREST schema
 * cache fails toward "the new table/column isn't visible yet", not toward
 * over-exposure) but it is a plain doctrine violation worth catching before
 * it becomes a habit.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '../../supabase/migrations')

function read(name: string): string {
  return readFileSync(join(migrationsDir, name), 'utf-8')
}

describe('SEC0905-D-01: content_edit_events SELECT policy has no own-row scoping', () => {
  const src = read('20260901_content_edit_identity.sql')

  it('creates content_edit_events with RLS enabled (the table is not left wide open)', () => {
    expect(src).toMatch(/ALTER TABLE public\.content_edit_events ENABLE ROW LEVEL SECURITY/)
  })

  it('CHARACTERIZATION: grants every authenticated caller USING (true) — no row predicate at all', () => {
    const policyMatch = src.match(
      /CREATE POLICY "Authenticated users can view content_edit_events"\s*\n\s*ON public\.content_edit_events FOR SELECT TO authenticated USING \((true)\)/
    )
    expect(
      policyMatch,
      'expected the broad USING (true) SELECT policy this finding is about — if this no longer matches, the policy was likely narrowed and SEC0905-D-01 can close',
    ).not.toBeNull()
  })

  it('the SELECT policy carries no actor_id / own-row comparison anywhere in its definition', () => {
    const policyStart = src.indexOf('CREATE POLICY "Authenticated users can view content_edit_events"')
    const policyBlock = src.slice(policyStart, policyStart + 200)
    expect(policyBlock).not.toMatch(/actor_id\s*=\s*auth\.uid/)
  })
})

describe('SEC0905-D-02: attribution is required by comment, not yet by constraint', () => {
  it('the base migration adds last_edit_event_id as NULLABLE with no CHECK constraint', () => {
    const base = read('20260901_content_edit_identity.sql')
    expect(base).toMatch(/ADD COLUMN IF NOT EXISTS last_edit_event_id uuid/)
    expect(base).not.toMatch(/CHECK\s*\(last_edit_event_id IS NOT NULL\)/)
  })

  it('CHARACTERIZATION: the enforcing migration exists only under the .UNAPPLIED filename', () => {
    // A real, timestamp-ordered migration would be named
    // 20260901c_content_edit_identity_ENFORCE.sql (no suffix) and would run
    // automatically with the rest of supabase/migrations/. This asserts it
    // is NOT that — it is parked under a name the migration runner will
    // never pick up. If this test starts failing because the plain .sql
    // name now exists, SEC0905-D-02 has been applied and should be closed
    // (after confirming with the coordinator that it was intentional).
    let unappliedExists = false
    let appliedExists = false
    try {
      read('20260901c_content_edit_identity_ENFORCE.sql.UNAPPLIED')
      unappliedExists = true
    } catch { /* not found */ }
    try {
      read('20260901c_content_edit_identity_ENFORCE.sql')
      appliedExists = true
    } catch { /* not found, expected today */ }

    expect(unappliedExists, 'expected the parked .UNAPPLIED file to exist').toBe(true)
    expect(appliedExists, 'expected NO applied ENFORCE migration yet — this is the finding').toBe(false)
  })

  it('the parked migration, once applied, would use NOT VALID (new-row-only enforcement, no existing-row scan)', () => {
    const enforce = read('20260901c_content_edit_identity_ENFORCE.sql.UNAPPLIED')
    expect(enforce).toMatch(/CHECK \(last_edit_event_id IS NOT NULL\) NOT VALID/g)
    // The file discusses VALIDATE CONSTRAINT only to say it deliberately
    // never runs one — assert there is no actual executable statement doing it.
    expect(enforce).not.toMatch(/^\s*ALTER TABLE.*VALIDATE CONSTRAINT/m)
  })
})

describe('SEC0905-D-03: 20260901_content_edit_identity.sql never reloads the PostgREST schema cache', () => {
  it('CHARACTERIZATION: no NOTIFY pgrst call anywhere in the file, despite adding a table, policies and columns', () => {
    const src = read('20260901_content_edit_identity.sql')
    expect(src).not.toMatch(/NOTIFY pgrst/)
  })

  it('SECURE-ASSERTION / contrast: the sibling migration in the same window (sector_helix) does call NOTIFY pgrst', () => {
    const src = read('20260901_sector_helix.sql')
    expect(src).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })
})

describe('SEC0905-D-03 (secure-assertion): 20260901_sector_helix.sql follows the RLS doctrine cleanly', () => {
  const src = read('20260901_sector_helix.sql')

  it('both new tables get RLS enabled at creation', () => {
    expect(src).toMatch(/ALTER TABLE course_sectors\s+ENABLE ROW LEVEL SECURITY/)
    expect(src).toMatch(/ALTER TABLE enrollment_threads ENABLE ROW LEVEL SECURITY/)
  })

  it('both new tables are service-role-only: explicit REVOKE from anon/authenticated in the same file as the GRANT', () => {
    expect(src).toMatch(/REVOKE ALL ON course_sectors\s+FROM anon, authenticated/)
    expect(src).toMatch(/REVOKE ALL ON enrollment_threads FROM anon, authenticated/)
    expect(src).toMatch(/GRANT ALL ON course_sectors\s+TO service_role/)
    expect(src).toMatch(/GRANT ALL ON enrollment_threads TO service_role/)
  })

  it('neither table has a single CREATE POLICY — deny-by-default via RLS-on-with-no-policies, not clever policies', () => {
    expect(src).not.toMatch(/CREATE POLICY/)
  })
})

describe('SEC0905-D (secure-assertion): the trigger-function edit in 20260901b keeps its search_path pin', () => {
  it('audit_content_change() replacement still pins SET search_path (SEC25-D-01 regression guard)', () => {
    const src = read('20260901b_audit_trigger_ignores_edit_event_stamp.sql')
    expect(src).toMatch(/SECURITY DEFINER/)
    expect(src).toMatch(/SET search_path = public, pg_temp/)
  })

  it('only functional change from the deployed body is adding last_edit_event_id to ignore_cols', () => {
    const src = read('20260901b_audit_trigger_ignores_edit_event_stamp.sql')
    expect(src).toMatch(/ignore_cols TEXT\[\] := ARRAY\['version','updated_at','created_at','last_edit_event_id'\]/)
  })
})
