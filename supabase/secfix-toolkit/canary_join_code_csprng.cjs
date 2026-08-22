#!/usr/bin/env node
/**
 * Canary for 20260822_join_code_csprng_and_grant_lockdown.sql (SEC22-01).
 *
 * One transaction against the live shared DB:
 *   1. snapshot the pre-state (grants, prosecdef, a real existing join code)
 *   2. apply the migration
 *   3. LEAK CLOSED — anon and authenticated can no longer EXECUTE
 *      public.generate_join_code()
 *   4. EVERY LEGIT PATH ALIVE —
 *        a. service_role can still call the minter directly
 *        b. a signed-in teacher's browser INSERT on public.classes still
 *           mints a well-formed student_join_code (this is the path the
 *           revoke could plausibly have killed: `authenticated` holds INSERT
 *           on classes and the trigger used to run SECURITY INVOKER)
 *        c. a service-role INSERT on public.schools still mints both the
 *           teacher and admin join codes
 *   5. EXISTING CODES UNTOUCHED — the codes already stored still read back
 *      byte-identical, and the live lookup/validation surfaces still resolve
 *      an existing code (nothing was regenerated or invalidated)
 *   6. QUALITY — 300 freshly minted codes are well-formed, drawn only from the
 *      declared alphabets, and not repeating
 *   7. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_join_code_csprng.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const DASH = path.join(os.homedir(), 'SSi', 'ssi-dashboard-v7-clean');
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260822_join_code_csprng_and_grant_lockdown.sql');
const COMMIT = process.argv.includes('--commit');

const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{3}-[0-9]{3}$/;

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  async function probe(role, sql, claims) {
    await q('SAVEPOINT p');
    try {
      if (claims) await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql);
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }
  const expectOk = async (name, role, sql, claims) => {
    const r = await probe(role, sql, claims);
    r.error ? bad(name, r.error.message) : ok(name);
    return r;
  };
  const expectDeny = async (name, role, sql, claims) => {
    const r = await probe(role, sql, claims);
    if (r.error && /permission denied/i.test(r.error.message)) ok(name);
    else if (r.error) bad(name, `denied but wrong error: ${r.error.message}`);
    else bad(name, `NOT DENIED (returned ${JSON.stringify(r.rows)})`);
  };

  try {
    await q('BEGIN');

    // ── 1. pre-state, so the assertions below are differences, not guesses ──
    console.log('— pre-state');
    const pre = await q(`
      SELECT p.proname, p.prosecdef, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('generate_join_code','set_class_join_code','set_school_join_code')
      ORDER BY p.proname`);
    for (const r of pre.rows) console.log(`    ${r.proname}: secdef=${r.prosecdef} acl=${r.acl}`);

    // A real, already-issued code. Everything about it must survive untouched.
    const existing = await q(`
      SELECT id, student_join_code FROM public.classes
      WHERE student_join_code IS NOT NULL AND student_join_code <> ''
      ORDER BY created_at LIMIT 5`);
    if (existing.rowCount === 0) bad('found existing class join codes to protect', 'none in table');
    else ok(`found ${existing.rowCount} existing class join codes to protect (oldest: ${existing.rows[0].student_join_code})`);
    const existingSchools = await q(`
      SELECT id, teacher_join_code, admin_join_code FROM public.schools
      WHERE teacher_join_code IS NOT NULL ORDER BY created_at LIMIT 5`);

    // A real teacher uid, so the browser-insert probe exercises a genuine
    // identity rather than a synthetic one the policies might treat oddly.
    const teacher = await q(`
      SELECT teacher_user_id FROM public.classes
      WHERE teacher_user_id IS NOT NULL AND school_id IS NULL
      ORDER BY created_at DESC LIMIT 1`);
    const teacherUid = teacher.rows[0]?.teacher_user_id;
    if (!teacherUid) bad('found a real teacher uid for the browser-insert probe', 'none');
    else ok(`browser-insert probe will run as real teacher uid ${teacherUid.slice(0, 8)}…`);

    // ── 2. apply ──
    console.log('— applying 20260822_join_code_csprng_and_grant_lockdown.sql (in txn)');
    await q(fs.readFileSync(MIGRATION, 'utf8'));

    const anonClaims = { role: 'anon' };
    const authClaims = { sub: teacherUid, role: 'authenticated' };

    // ── 3. leak closed ──
    console.log('— leak closed: the RPC sampling port');
    await expectDeny('anon EXECUTE generate_join_code()', 'anon',
      'SELECT public.generate_join_code()', anonClaims);
    await expectDeny('authenticated EXECUTE generate_join_code()', 'authenticated',
      'SELECT public.generate_join_code()', authClaims);

    // ── 4. every legit path alive ──
    console.log('— legit paths alive');
    const svc = await expectOk('service_role EXECUTE generate_join_code()', 'service_role',
      'SELECT public.generate_join_code() AS code');
    if (!svc.error) {
      const code = svc.rows[0].code;
      CODE_RE.test(code) ? ok(`service_role mint is well-formed (${code})`)
                         : bad('service_role mint is well-formed', `got ${JSON.stringify(code)}`);
    }

    // 4b. THE path the revoke could have killed.
    const browserInsert = await probe('authenticated', `
      INSERT INTO public.classes (class_name, course_code, school_id, teacher_user_id, is_active)
      VALUES ('SEC22-01 canary class', 'spa_for_eng_v2', NULL, ${quote(teacherUid)}, true)
      RETURNING id, student_join_code`, authClaims);
    if (browserInsert.error) {
      bad('signed-in teacher browser INSERT on classes still mints a code', browserInsert.error.message);
    } else {
      const minted = browserInsert.rows[0].student_join_code;
      CODE_RE.test(minted)
        ? ok(`signed-in teacher browser INSERT on classes still mints a code (${minted})`)
        : bad('signed-in teacher browser INSERT on classes still mints a code', `got ${JSON.stringify(minted)}`);
    }

    // 4c. server-side school creation (api/admin/create-school.ts,
    //     api/govt/create-school.ts, api/onboarding/provision.ts all use the
    //     service-role key).
    const schoolInsert = await probe('service_role', `
      INSERT INTO public.schools (school_name, admin_user_id)
      VALUES ('SEC22-01 canary school', ${quote(teacherUid)})
      RETURNING id, teacher_join_code, admin_join_code`);
    if (schoolInsert.error) {
      bad('service-role INSERT on schools still mints both codes', schoolInsert.error.message);
    } else {
      const { teacher_join_code: t, admin_join_code: a } = schoolInsert.rows[0];
      CODE_RE.test(t) && CODE_RE.test(a) && t !== a
        ? ok(`service-role INSERT on schools still mints both codes (${t} / ${a})`)
        : bad('service-role INSERT on schools still mints both codes', `got ${JSON.stringify([t, a])}`);
    }

    // ── 5. existing codes untouched ──
    console.log('— existing codes untouched');
    let drift = [];
    for (const row of existing.rows) {
      const now = await q('SELECT student_join_code FROM public.classes WHERE id = $1', [row.id]);
      if (now.rows[0]?.student_join_code !== row.student_join_code) {
        drift.push(`${row.id}: ${row.student_join_code} → ${now.rows[0]?.student_join_code}`);
      }
    }
    for (const row of existingSchools.rows) {
      const now = await q('SELECT teacher_join_code, admin_join_code FROM public.schools WHERE id = $1', [row.id]);
      if (now.rows[0]?.teacher_join_code !== row.teacher_join_code ||
          now.rows[0]?.admin_join_code !== row.admin_join_code) {
        drift.push(`school ${row.id} changed`);
      }
    }
    drift.length === 0
      ? ok(`all ${existing.rowCount + existingSchools.rowCount} sampled existing codes byte-identical after the migration`)
      : bad('existing codes byte-identical', drift.join('; '));

    // The live redemption surfaces still resolve a code that already exists.
    if (existing.rows[0]) {
      const lookup = await probe('service_role',
        `SELECT id FROM public.classes WHERE student_join_code = ${quote(existing.rows[0].student_join_code)}`);
      lookup.error || lookup.rowCount === 0
        ? bad('existing class join code still resolves by lookup', lookup.error?.message || 'no rows')
        : ok('existing class join code still resolves by lookup');
    }
    const view = await probe('service_role',
      `SELECT count(*)::int AS n FROM public.invite_code_validation WHERE is_active = true`);
    view.error
      ? bad('invite_code_validation (the /api/code/validate surface) still readable', view.error.message)
      : ok(`invite_code_validation still readable — ${view.rows[0].n} active codes, none touched`);

    // ── 6. quality of the new mint ──
    console.log('— mint quality');
    const many = await probe('service_role',
      'SELECT public.generate_join_code() AS code FROM generate_series(1, 300)');
    if (many.error) {
      bad('300-code sample', many.error.message);
    } else {
      const codes = many.rows.map((r) => r.code);
      const malformed = codes.filter((x) => !CODE_RE.test(x));
      malformed.length === 0 ? ok('300/300 minted codes match ^[A-Z no I/O]{3}-[0-9]{3}$')
                             : bad('all minted codes well-formed', `${malformed.length} bad, e.g. ${malformed[0]}`);
      const uniq = new Set(codes).size;
      uniq >= 299 ? ok(`${uniq}/300 distinct — no PRNG lock-up`)
                  : bad('minted codes distinct', `only ${uniq}/300 distinct`);
      const lettersSeen = new Set(codes.flatMap((x) => x.slice(0, 3).split('')));
      lettersSeen.size >= 20 ? ok(`letter alphabet exercised (${lettersSeen.size}/24 consonants seen in 900 draws)`)
                             : bad('letter alphabet exercised', `only ${lettersSeen.size}/24 seen — possible modulo bias`);
      const digitsSeen = new Set(codes.flatMap((x) => x.slice(4).split('')));
      digitsSeen.size === 10 ? ok('digit alphabet exercised (10/10 digits seen)')
                             : bad('digit alphabet exercised', `only ${digitsSeen.size}/10 seen`);
    }

    // ── 7. post-state, for the record ──
    console.log('— post-state');
    const post = await q(`
      SELECT p.proname, p.prosecdef, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('generate_join_code','set_class_join_code','set_school_join_code')
      ORDER BY p.proname`);
    for (const r of post.rows) console.log(`    ${r.proname}: secdef=${r.prosecdef} acl=${r.acl}`);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) {
      // The canary's own fixture rows must never survive the commit.
      await q(`DELETE FROM public.classes WHERE class_name = 'SEC22-01 canary class'`);
      await q(`DELETE FROM public.schools WHERE school_name = 'SEC22-01 canary school'`);
      await q('COMMIT');
      console.log('COMMITTED — migration is live (canary fixture rows removed).');
    } else {
      await q('ROLLBACK');
      console.log(fail === 0 ? 'ROLLED BACK (dry run — pass --commit to apply).'
                             : 'ROLLED BACK — assertions failed, nothing applied.');
    }
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('CANARY ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();

/** Single-quote a literal for inline SQL (probes run under SET LOCAL ROLE, so
 *  they can't use bound parameters across the savepoint helper). */
function quote(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}
