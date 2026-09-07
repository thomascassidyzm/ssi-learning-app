/**
 * Regression test for tools/definer-grant-standing-check.mjs — the mechanical rule that
 * would have caught all eight #317/#324 findings (find_learner_by_email, the two teacher-
 * commission writes, audit_log_prune, analytics_learner_progress_rate, the two AI course-
 * generation version-activators, and admin_practice_minutes_by_course).
 *
 * This runs DB-free and network-free — it feeds a fixture "dump" (the same textual shape
 * `pg_dump --schema-only` produces) through the real parser and rule, so a change that
 * weakens the rule (or breaks the dump parser) fails THIS suite, not just the nightly job.
 * Full live-catalog calibration against the actual pre-fix/post-fix database is a one-off,
 * done by hand when the check was built — see tools/definer-grant-standing-check.mjs header.
 */
import { describe, it, expect } from 'vitest'
import {
  parseDumpFunctions,
  evaluate,
  runCheck,
} from '../../tools/definer-grant-standing-check.mjs'

function fn({
  name,
  args,
  returns = 'boolean',
  body,
  grants = ['anon', 'authenticated', 'service_role'],
  securityDefiner = true,
}: {
  name: string
  args: string
  returns?: string
  body: string
  grants?: string[]
  securityDefiner?: boolean
}) {
  const def = `
--
-- Name: ${name}(${args}); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.${name}(${args}) RETURNS ${returns}
    LANGUAGE plpgsql${securityDefiner ? ' SECURITY DEFINER' : ''}
    SET search_path TO 'public', 'pg_temp'
    AS $$
${body}
$$;

`
  const acl = grants
    .map((r) => `GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO ${r};`)
    .join('\n')
  return def + '\n' + acl + '\n'
}

// One fixture standing in for each of the eight real shapes, plus the legitimately-gated
// and non-invokable shapes that must NOT be flagged.
const FIXTURE_DUMP = [
  // 1. email-oracle shape (find_learner_by_email): identifier arg, no auth check.
  fn({
    name: 'fx_find_learner_by_email',
    args: 'lookup_email text',
    body: 'SELECT 1 FROM learners WHERE lookup_email = ANY(verified_emails);',
  }),
  // 2. money-write shape (accrue/reverse_teacher_commission): identifier arg + write, no auth check.
  fn({
    name: 'fx_accrue_commission',
    args: 'p_teacher_id uuid, p_pence integer',
    body: 'INSERT INTO commission_ledger (teacher_id, pence) VALUES (p_teacher_id, p_pence);',
  }),
  // 3. audit-delete shape (audit_log_prune): write only, no identifier arg, no auth check.
  fn({
    name: 'fx_audit_log_prune',
    args: 'retention_days integer',
    body: 'DELETE FROM content_audit_log WHERE created_at < now() - make_interval(days => retention_days);',
  }),
  // 4. progress-reader shape (analytics_learner_progress_rate): identifier arg, read only, no auth check.
  fn({
    name: 'fx_progress_rate',
    args: 'p_learner_id uuid',
    returns: 'numeric',
    body: 'SELECT rate FROM learner_progress_rate WHERE learner_id = p_learner_id;',
  }),
  // 5. repoint-generation shape (activate_brief_version): write, text keys, no identifier-shaped
  // arg by our heuristic, no auth check — must still trip on the write limb alone.
  fn({
    name: 'fx_activate_brief_version',
    args: 'p_known_code text, p_version text',
    body: 'UPDATE briefs SET is_active = (version = p_version) WHERE known_code = p_known_code;',
  }),
  // A genuinely SAFE self-lookup shape (post-fix find_learner_by_email): identifier arg, but
  // the caller's own identity gates it. Must NOT be flagged.
  fn({
    name: 'fx_find_learner_self_only',
    args: 'lookup_email text',
    body: "SELECT 1 FROM learners WHERE lookup_email = ANY(verified_emails) AND lookup_email = auth.jwt()->>'email';",
  }),
  // An admin-gated read (admin_user_course_stats shape): identifier arg, gated by a helper
  // that itself checks auth.uid() — literal check flags it; it belongs on the allowlist, not
  // silently passed. Confirms the rule stays literal (no transitive closure).
  fn({
    name: 'fx_admin_gated_read',
    args: 'p_learner_id uuid',
    body: "IF NOT public.fx_is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;\nSELECT 1 FROM learner_stats WHERE learner_id = p_learner_id;",
  }),
  fn({
    name: 'fx_is_admin',
    args: '',
    body: "SELECT EXISTS (SELECT 1 FROM learners WHERE user_id = auth.uid()::text AND platform_role = 'ssi_admin');",
  }),
  // A trigger function granted to anon/authenticated: uninvokable directly regardless of
  // grants — must NOT be flagged even though it writes and has no auth check.
  fn({
    name: 'fx_trigger_writer',
    args: '',
    returns: 'trigger',
    body: 'BEGIN UPDATE stamped_table SET updated_at = now(); RETURN NEW; END;',
  }),
  // A function reachable only by service_role: must NOT be flagged regardless of shape.
  fn({
    name: 'fx_service_role_only_write',
    args: 'p_id uuid',
    body: 'DELETE FROM internal_table WHERE id = p_id;',
    grants: ['service_role'],
  }),
  // A read with no identifier arg and no write: must NOT be flagged (neither limb trips).
  fn({
    name: 'fx_public_course_list',
    args: '',
    body: 'SELECT * FROM published_courses;',
  }),
].join('\n')

describe('definer-grant-standing-check: parser', () => {
  it('extracts every function with its args, body, grants and trigger-ness', () => {
    const functions = parseDumpFunctions(FIXTURE_DUMP)
    const names = functions.map((f) => f.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'fx_find_learner_by_email',
        'fx_accrue_commission',
        'fx_audit_log_prune',
        'fx_progress_rate',
        'fx_activate_brief_version',
        'fx_find_learner_self_only',
        'fx_admin_gated_read',
        'fx_is_admin',
        'fx_trigger_writer',
        'fx_service_role_only_write',
        'fx_public_course_list',
      ])
    )

    const trigger = functions.find((f) => f.name === 'fx_trigger_writer')
    expect(trigger?.isTrigger).toBe(true)

    const commission = functions.find((f) => f.name === 'fx_accrue_commission')
    expect(commission?.grantedTo).toMatchObject({ anon: true, authenticated: true, service_role: true })

    const serviceOnly = functions.find((f) => f.name === 'fx_service_role_only_write')
    expect(serviceOnly?.grantedTo).toMatchObject({ anon: false, authenticated: false, service_role: true })
  })
})

describe('definer-grant-standing-check: the rule catches every #317/#324 shape', () => {
  const functions = parseDumpFunctions(FIXTURE_DUMP)
  const byName = Object.fromEntries(functions.map((f) => [f.name, f]))

  const shouldFlag = [
    'fx_find_learner_by_email',
    'fx_accrue_commission',
    'fx_audit_log_prune',
    'fx_progress_rate',
    'fx_activate_brief_version',
    'fx_admin_gated_read', // literal rule: flags it, allowlist is where judgement lives
  ]
  for (const name of shouldFlag) {
    it(`flags ${name}`, () => {
      expect(evaluate(byName[name])).not.toBeNull()
    })
  }

  const shouldNotFlag = [
    'fx_find_learner_self_only', // gated on the caller's own identity
    'fx_is_admin', // no identifier arg, no write
    'fx_trigger_writer', // uninvokable directly regardless of grants
    'fx_service_role_only_write', // not reachable by anon/authenticated
    'fx_public_course_list', // no identifier arg, no write
  ]
  for (const name of shouldNotFlag) {
    it(`does not flag ${name}`, () => {
      expect(evaluate(byName[name])).toBeNull()
    })
  }
})

describe('definer-grant-standing-check: allowlist requires a real reason', () => {
  it('runCheck separates allowlisted from unallowlisted findings', () => {
    const functions = parseDumpFunctions(FIXTURE_DUMP)
    const allowlist = [{ name: 'fx_admin_gated_read', reason: 'gated by fx_is_admin(), which checks auth.uid()' }]
    const result = runCheck(functions, allowlist)
    expect(result.allowlisted.map((f) => f.name)).toContain('fx_admin_gated_read')
    expect(result.unallowlisted.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'fx_find_learner_by_email',
        'fx_accrue_commission',
        'fx_audit_log_prune',
        'fx_progress_rate',
        'fx_activate_brief_version',
      ])
    )
    expect(result.unallowlisted.map((f) => f.name)).not.toContain('fx_admin_gated_read')
  })
})
