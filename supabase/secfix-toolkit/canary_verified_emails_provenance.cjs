#!/usr/bin/env node
/**
 * Canary for supabase/migrations/20260811_lock_learner_identity_columns.sql
 *
 * One transaction against the live shared DB:
 *   0. build a throwaway auth.users fixture (rolled back either way) so the
 *      "legit" probes have a real attested address to work with
 *   1. BEFORE — prove both escalation paths are live today
 *   2. apply the migration
 *   3. AFTER — leak-closed assertions:
 *        - authenticated UPDATE(verified_emails) denied at the grant layer
 *        - authenticated INSERT of platform_role denied at the grant layer
 *        - authenticated INSERT planting a third party's address rejected by
 *          the provenance trigger
 *      every-legit-path-alive assertions:
 *        - browser signup insert (user_id, display_name, preferences,
 *          verified_emails=own address, needs_verification) still works
 *        - WithTeacher.vue's minimal insert still works
 *        - display_name / preferences updates (SettingsScreen.vue, App.vue) still work
 *        - sync_my_verified_emails() back-fills the session's own address
 *        - service_role UPDATE of verified_emails (api/email/verify.ts OTP path) works
 *        - service_role INSERT with platform_role (api/admin/create-staff.ts,
 *          api/code/redeem.ts, provisionPersona.ts) works
 *        - get_my_verified_emails() / claim_learner() unaffected
 *   4. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_verified_emails_provenance.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH_CANDIDATES = [
  '/home/tomcassidy/SSi/ssi-dashboard-v7-clean',
  '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean',
];
const DASH = DASH_CANDIDATES.find((d) => fs.existsSync(path.join(d, '.env.psql')));
if (!DASH) { console.error('No .env.psql found in', DASH_CANDIDATES.join(' or ')); process.exit(1); }
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));
const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260811_lock_learner_identity_columns.sql');
const COMMIT = process.argv.includes('--commit');

// Fixture identities — deterministic, never real, rolled back unless --commit
// (and even with --commit the fixture rows are deleted before COMMIT).
const UID_A = '00000000-0000-4000-8000-00000000ca01'; // "attacker" / ordinary learner
const UID_B = '00000000-0000-4000-8000-00000000ca02'; // fresh signup
const UID_C = '00000000-0000-4000-8000-00000000ca03'; // WithTeacher.vue minimal insert
const UID_D = '00000000-0000-4000-8000-00000000ca04'; // service-role provisioned staff
const UID_E = '00000000-0000-4000-8000-00000000ca05'; // claim_learner caller (no learner row of its own)
const EMAIL_A = 'canary-a@example.invalid';
const EMAIL_B = 'canary-b@example.invalid';
const VICTIM = 'canary-victim@ssi.example.invalid';

let pass = 0, fail = 0;
const ok = (name, extra) => { pass++; console.log(`  OK   ${name}${extra ? ` — ${extra}` : ''}`); };
const bad = (name, detail) => { fail++; console.log(`  FAIL ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  async function probe(role, sql, params, claims) {
    await q('SAVEPOINT p');
    try {
      if (claims) await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql, params);
      await q('RESET ROLE');
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e.message };
    }
  }
  const claimsFor = (uid, email) => ({ sub: uid, role: 'authenticated', email });
  const asAuth = (uid, email, sql, params) => probe('authenticated', sql, params, claimsFor(uid, email));
  const asService = (sql, params) => probe('service_role', sql, params);

  const expectOk = async (name, r) => { r.error ? bad(name, r.error) : ok(name, `${r.rowCount} row(s)`); return r; };
  const expectDenied = async (name, r, pattern) => {
    if (!r.error) return bad(name, `NOT DENIED (${r.rowCount} row(s), ${JSON.stringify(r.rows)})`);
    if (pattern && !pattern.test(r.error)) return bad(name, `denied but wrong error: ${r.error}`);
    return ok(name, r.error.split('\n')[0]);
  };

  try {
    await q('BEGIN');

    // ── 0. fixtures ─────────────────────────────────────────────────────────
    // Every fixture needs a non-null auth.users.email: public.handle_new_user()
    // fires on insert and derives display_name from it (NOT NULL).
    for (const [uid, email] of [[UID_A, EMAIL_A], [UID_B, EMAIL_B], [UID_C, 'canary-c@example.invalid'], [UID_D, 'canary-d@example.invalid'], [UID_E, 'canary-second@example.invalid']]) {
      await q(
        `INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at)
         VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now())`,
        [uid, email]
      );
    }
    // auth.users insert auto-provisions a learner row via public.handle_new_user()
    // — normalise UID_A to the shape a real learner has, and clear the others so
    // the insert probes below exercise a genuine first insert.
    await q(`DELETE FROM public.learners WHERE user_id = ANY($1)`, [[UID_B, UID_C, UID_D, UID_E]]);
    const existingA = await q(`SELECT id FROM public.learners WHERE user_id = $1`, [UID_A]);
    if (existingA.rowCount === 0) {
      await q(`INSERT INTO public.learners (user_id, display_name, verified_emails) VALUES ($1,'canary-a',ARRAY[$2])`, [UID_A, EMAIL_A]);
    } else {
      await q(`UPDATE public.learners SET verified_emails = ARRAY[$2] WHERE user_id = $1`, [UID_A, EMAIL_A]);
    }
    console.log('— fixtures ready');

    // ── 1. BEFORE: both paths live ──────────────────────────────────────────
    console.log('\n— BEFORE the migration (proving the holes are real)');
    const before1 = await asAuth(UID_A, EMAIL_A,
      `UPDATE public.learners SET verified_emails = verified_emails || $2::text WHERE user_id = $1 RETURNING verified_emails`,
      [UID_A, VICTIM]);
    before1.error
      ? bad('BEFORE: planting a victim address via UPDATE succeeds', before1.error)
      : ok('BEFORE: planting a victim address via UPDATE succeeds', JSON.stringify(before1.rows[0]));

    await asAuth(UID_A, EMAIL_A, `DELETE FROM public.learners WHERE user_id = $1`, [UID_A]);
    const before2 = await asAuth(UID_A, EMAIL_A,
      `INSERT INTO public.learners (user_id, display_name, platform_role) VALUES ($1,'canary-a','ssi_admin') RETURNING platform_role`,
      [UID_A]);
    before2.error
      ? bad('BEFORE: self-insert as ssi_admin succeeds', before2.error)
      : ok('BEFORE: self-insert as ssi_admin succeeds', JSON.stringify(before2.rows[0]));
    const before3 = await asAuth(UID_A, EMAIL_A, `SELECT public.is_ssi_admin() AS admin`);
    before3.rows?.[0]?.admin === true
      ? ok('BEFORE: is_ssi_admin() returns true for that session')
      : bad('BEFORE: is_ssi_admin() returns true for that session', JSON.stringify(before3));

    // reset UID_A to an ordinary learner before applying the fix
    await q(`UPDATE public.learners SET platform_role = NULL, verified_emails = ARRAY[$2] WHERE user_id = $1`, [UID_A, EMAIL_A]);

    // ── 2. apply ────────────────────────────────────────────────────────────
    console.log('\n— applying 20260811_lock_learner_identity_columns.sql (in txn)');
    await q(fs.readFileSync(MIGRATION, 'utf8'));

    // ── 3a. leak closed ─────────────────────────────────────────────────────
    console.log('\n— AFTER: closed paths deny');
    await expectDenied('authenticated UPDATE(verified_emails) [grant layer]',
      await asAuth(UID_A, EMAIL_A,
        `UPDATE public.learners SET verified_emails = ARRAY[$2] WHERE user_id = $1`, [UID_A, VICTIM]),
      /permission denied/i);

    await expectDenied('authenticated INSERT of platform_role [grant layer]',
      await asAuth(UID_B, EMAIL_B,
        `INSERT INTO public.learners (user_id, display_name, platform_role) VALUES ($1,'x','ssi_admin')`, [UID_B]),
      /permission denied/i);

    await expectDenied('authenticated INSERT of educational_role [grant layer]',
      await asAuth(UID_B, EMAIL_B,
        `INSERT INTO public.learners (user_id, display_name, educational_role) VALUES ($1,'x','god')`, [UID_B]),
      /permission denied/i);

    await expectDenied('authenticated INSERT planting a third party address [trigger]',
      await asAuth(UID_B, EMAIL_B,
        `INSERT INTO public.learners (user_id, display_name, verified_emails) VALUES ($1,'x',ARRAY[$2])`, [UID_B, VICTIM]),
      /not attested/i);

    const stillNotAdmin = await asAuth(UID_A, EMAIL_A, `SELECT public.is_ssi_admin() AS admin`);
    stillNotAdmin.rows?.[0]?.admin === false
      ? ok('AFTER: is_ssi_admin() false for an ordinary session')
      : bad('AFTER: is_ssi_admin() false for an ordinary session', JSON.stringify(stillNotAdmin));

    // ── 3b. every legit path alive ──────────────────────────────────────────
    console.log('\n— AFTER: legitimate paths stay alive');
    await expectOk('browser signup insert with own address (useAuth.ts:346)',
      await asAuth(UID_B, EMAIL_B,
        `INSERT INTO public.learners (user_id, display_name, preferences, verified_emails, needs_verification)
         VALUES ($1,'canary-b','{}'::jsonb, ARRAY[$2], false) RETURNING id`, [UID_B, EMAIL_B]));

    await expectOk('minimal insert, no email (WithTeacher.vue:211)',
      await asAuth(UID_C, null,
        `INSERT INTO public.learners (user_id, display_name) VALUES ($1,'') RETURNING id`, [UID_C]));

    await expectOk('display_name update (SettingsScreen.vue:455)',
      await asAuth(UID_A, EMAIL_A,
        `UPDATE public.learners SET display_name = 'renamed' WHERE user_id = $1 RETURNING display_name`, [UID_A]));

    await expectOk('preferences update (App.vue:365, useAuth.ts:744)',
      await asAuth(UID_A, EMAIL_A,
        `UPDATE public.learners SET preferences = '{"last_course_code":"cym_for_eng"}'::jsonb WHERE user_id = $1 RETURNING id`, [UID_A]));

    // the compensating path: strip A's address, then let the RPC put it back
    await q(`UPDATE public.learners SET verified_emails = ARRAY[]::text[] WHERE user_id = $1`, [UID_A]);
    const synced = await asAuth(UID_A, EMAIL_A, `SELECT public.sync_my_verified_emails() AS emails`);
    if (synced.error) bad('sync_my_verified_emails() back-fills own address', synced.error);
    else if ((synced.rows[0].emails || []).includes(EMAIL_A)) ok('sync_my_verified_emails() back-fills own address', JSON.stringify(synced.rows[0].emails));
    else bad('sync_my_verified_emails() back-fills own address', `got ${JSON.stringify(synced.rows[0].emails)}`);

    const syncedTwice = await asAuth(UID_A, EMAIL_A, `SELECT public.sync_my_verified_emails() AS emails`);
    (syncedTwice.rows?.[0]?.emails || []).filter((e) => e === EMAIL_A).length === 1
      ? ok('sync_my_verified_emails() is idempotent (no duplicate)')
      : bad('sync_my_verified_emails() is idempotent (no duplicate)', JSON.stringify(syncedTwice));

    await expectOk('get_my_verified_emails() still readable (useAuth.ts:211)',
      await asAuth(UID_A, EMAIL_A, `SELECT public.get_my_verified_emails() AS emails`));

    await expectOk('service_role UPDATE verified_emails — OTP path (api/email/verify.ts:86)',
      await asService(
        `UPDATE public.learners SET verified_emails = verified_emails || 'canary-second@example.invalid'::text
          WHERE user_id = $1 RETURNING verified_emails`, [UID_A]));

    await expectOk('service_role INSERT with platform_role (api/admin/create-staff.ts:98)',
      await asService(
        `INSERT INTO public.learners (user_id, display_name, platform_role, verified_emails)
         VALUES ($1,'staff','ssi_admin',ARRAY['canary-staff@example.invalid']) RETURNING id`, [UID_D]));

    await expectOk('service_role UPDATE needs_verification (api/email/verify.ts:118)',
      await asService(`UPDATE public.learners SET needs_verification = false WHERE user_id = $1 RETURNING id`, [UID_A]));

    // claim_learner still works off an OTP-attested address on the target row.
    // The learner id is resolved out-of-band (as owner) because RLS hides A's
    // row from B — in the real flow useAuth.ts gets it from the SECURITY DEFINER
    // find_learner_by_email RPC, not from a direct select.
    const targetA = (await q(`SELECT id FROM public.learners WHERE user_id = $1`, [UID_A])).rows[0].id;
    const claim = await asAuth(UID_E, 'canary-second@example.invalid',
      `SELECT public.claim_learner($1::uuid) AS old_uid`, [targetA]);
    claim.error
      ? bad('claim_learner() still links on an attested address', claim.error)
      : ok('claim_learner() still links on an attested address', JSON.stringify(claim.rows[0]));

    // ── 4. verdict ──────────────────────────────────────────────────────────
    console.log(`\n${pass} passed, ${fail} failed`);

    // fixtures never survive, committed or not
    await q(`DELETE FROM public.learners WHERE user_id = ANY($1)`, [[UID_A, UID_B, UID_C, UID_D, UID_E]]);
    await q(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [[UID_A, UID_B, UID_C, UID_D, UID_E]]);

    if (fail === 0 && COMMIT) {
      await q('COMMIT');
      await q(`NOTIFY pgrst, 'reload schema'`);
      console.log('COMMITTED + schema reload notified.');
    } else {
      await q('ROLLBACK');
      console.log(fail === 0 ? 'ROLLED BACK (dry run — re-run with --commit).' : 'ROLLED BACK (assertions failed).');
      if (fail > 0) process.exitCode = 1;
    }
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('CANARY ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
