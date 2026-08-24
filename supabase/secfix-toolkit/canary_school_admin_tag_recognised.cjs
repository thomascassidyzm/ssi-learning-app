#!/usr/bin/env node
/**
 * Canary for 20260807c_school_admin_tag_is_school_admin.sql (+ 20260807d).
 *
 * ⚠️  ALREADY APPLIED LIVE, 2026-08-07 — so this canary's pre-migration
 * assertions will now FAIL ("bug NOT reproduced"), which is correct and
 * expected. It is kept as the record of what was proven before the change.
 * To check the CURRENT live state, run the read-only companion instead:
 *     node verify_school_admin_tag_parity.cjs
 *
 * ⚠️  INCIDENT, same day: a run of this canary deadlocked partway through
 * applying 20260807d (DROP/CREATE POLICY takes ACCESS EXCLUSIVE, and a
 * concurrent session was holding user_tags). The DB was afterwards found in a
 * PARTIALLY-APPLIED state — user_tags_update existed with its USING clause but
 * NO WITH CHECK, which in Postgres makes the USING clause serve as the check
 * and briefly allowed any authenticated user to promote their own user_tag to
 * role_in_context 'admin'. Detected and closed within minutes; the escalation
 * probe now lives permanently in verify_school_admin_tag_parity.cjs so it can
 * never recur unnoticed. Lesson, and the reason for the lock_timeout below:
 * a canary that applies policy DDL must fail FAST on lock contention rather
 * than sit and deadlock, and its final state must always be re-read from
 * pg_policy rather than inferred from "the transaction rolled back".
 *
 * THE BUG (Tom, staging, 2026-08-07, as "Harbour Leader" / School Admin at
 * "Harbour View School, Visakhapatnam"): the Dashboard tab listed the school's
 * three classes while the Classes tab, same user same school, said "0 classes"
 * and rendered the first-run "No classes yet" empty state. The dashboard list
 * is server-mediated; the Classes tab reads `classes` straight from the
 * browser and therefore through RLS. classes_select's admin disjunct is
 * is_school_admin_of(school_id), which only ever asked "are you the
 * schools.admin_user_id pointer?" — so every school admin who holds the
 * service-role-written school ADMIN TAG instead of the pointer read zero rows,
 * silently. The migration teaches the function the tag spelling too.
 *
 * One transaction against the live shared DB:
 *   1. fixture — a REAL tag-only school admin (school tag, role_in_context
 *      'admin', who is NOT their school's admin_user_id) whose school has
 *      active classes; plus synthetic negative actors
 *   2. BUG DEMONSTRATION (pre-migration): that admin reads 0 of their own
 *      school's classes, while the pointer admin reads all of them. If the bug
 *      does NOT reproduce, FAIL LOUDLY rather than rubber-stamp a no-op
 *   3. apply the migration
 *   4. LEGIT PATH ALIVE — the tag admin now reads exactly their school's
 *      active classes, and can read the panels the Classes tab renders
 *      (class_student_progress, class_sessions)
 *   5. NO WIDENING — the tag admin still reads nothing from another school; a
 *      school tag with role_in_context 'teacher' still grants no school-wide
 *      class read (the supply-teacher case); a stranger still reads nothing;
 *      the pointer admin is unregressed
 *   6. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_school_admin_tag_recognised.cjs [--commit]
 * Creds: DATABASE_URL — ssi-dashboard-v7-clean/.env.psql, else this repo's .env.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const DASH_CANDIDATES = [
  '/home/tomcassidy/SSi/ssi-dashboard-v7-clean',
  '/home/tomcassidy/ssi-dashboard-v7-clean',
];
const dash = DASH_CANDIDATES.find((d) => fs.existsSync(path.join(d, '.env.psql')));
const { Client } = require(
  dash && fs.existsSync(path.join(dash, 'node_modules', 'pg'))
    ? path.join(dash, 'node_modules', 'pg')
    : path.join(REPO, 'node_modules', 'pg'),
);
const envText = dash
  ? fs.readFileSync(path.join(dash, '.env.psql'), 'utf8')
  : fs.readFileSync(path.join(REPO, '.env'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];

// Both halves of the fix apply together: 'c' teaches is_school_admin_of() the
// tag spelling, 'd' routes every hand-inlined copy of that test through it.
// Applying 'c' alone leaves the leader reading her classes but no roster and
// no sessions — proven live 2026-08-07, which is why 'd' exists.
const MIGRATIONS = [
  path.join(__dirname, '..', 'migrations', '20260807c_school_admin_tag_is_school_admin.sql'),
  path.join(__dirname, '..', 'migrations', '20260807d_school_admin_tag_parity.sql'),
];
const COMMIT = process.argv.includes('--commit');

// Synthetic negative actors — never committed.
const SCHOOL_TEACHER = '00000000-c0de-4a11-8a11-000000000021'; // school tag, role 'teacher'
const STRANGER       = '00000000-c0de-4a22-8a22-000000000022'; // no tags at all

let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  // Probe as a real role with real JWT claims, inside a savepoint so a denial
  // (or a policy error) cannot poison the outer transaction.
  async function asUser(uid, sql, params) {
    await q('SAVEPOINT p');
    try {
      await q(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await q('SET LOCAL ROLE authenticated');
      const r = await q(sql, params);
      await q('RESET ROLE');
      await q('RELEASE SAVEPOINT p');
      return { rowCount: r.rowCount, rows: r.rows };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e, rowCount: 0, rows: [] };
    }
  }

  // The exact read the Classes tab performs (useClassesData.fetchClasses,
  // school-admin branch).
  const READ_CLASSES =
    `SELECT id, class_name FROM public.classes WHERE school_id = $1 AND is_active = true`;

  try {
    // Fail fast on lock contention instead of sitting until the deadlock
    // detector fires mid-DDL. See the INCIDENT note at the top of this file.
    await q(`SET lock_timeout = '15s'`);
    await q('BEGIN');

    // ---- 1. fixture ------------------------------------------------------
    // A REAL tag-only school admin: holds a live school tag with
    // role_in_context 'admin', is NOT their school's admin_user_id pointer,
    // and their school has at least one active class.
    const fx = (await q(`
      SELECT ut.user_id      AS tag_admin,
             s.id            AS school_id,
             s.school_name,
             s.admin_user_id AS pointer_admin,
             (SELECT count(*) FROM public.classes c
               WHERE c.school_id = s.id AND c.is_active) AS class_count
      FROM public.user_tags ut
      JOIN public.schools s ON ('SCHOOL:' || s.id::text) = ut.tag_value
      WHERE ut.tag_type = 'school'
        AND ut.role_in_context = 'admin'
        AND ut.removed_at IS NULL
        AND s.admin_user_id IS DISTINCT FROM ut.user_id
        AND EXISTS (SELECT 1 FROM public.classes c
                     WHERE c.school_id = s.id AND c.is_active)
      -- Prefer a school with a REAL roster. A fixture whose classes happen to
      -- have no students would let the roster assertions below pass vacuously,
      -- which is exactly how the class_student_progress gap nearly slipped
      -- through on the first run of this canary.
      ORDER BY (SELECT count(*) FROM public.class_student_progress csp
                 JOIN public.classes c2 ON c2.id = csp.class_id
                WHERE c2.school_id = s.id) DESC,
               class_count DESC
      LIMIT 1`)).rows[0];
    if (!fx) throw new Error('no fixture: no tag-only school admin whose school has active classes');
    const expected = Number(fx.class_count);

    // Another school with active classes — the "no widening" probe.
    const other = (await q(`
      SELECT s.id, s.school_name FROM public.schools s
      WHERE s.id <> $1
        AND EXISTS (SELECT 1 FROM public.classes c WHERE c.school_id = s.id AND c.is_active)
      LIMIT 1`, [fx.school_id])).rows[0];

    console.log(`\nFixture: "${fx.school_name}" (${fx.school_id}) — ${expected} active class(es)`);
    console.log(`  tag admin     ${fx.tag_admin}`);
    console.log(`  pointer admin ${fx.pointer_admin ?? '—'}`);
    console.log(`  other school  ${other ? `"${other.school_name}" (${other.id})` : '— none found'}\n`);

    // A school-tagged TEACHER on the SAME school — must never gain a
    // school-wide class read from this migration (the supply-teacher case).
    await q(`INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
             VALUES ($1,'school',$2,'teacher',$3)`,
      [SCHOOL_TEACHER, `SCHOOL:${fx.school_id}`, fx.tag_admin]);

    // ---- 2. BUG DEMONSTRATION (pre-migration) ----------------------------
    console.log('BEFORE — the bug Tom saw:');
    const preTag = await asUser(fx.tag_admin, READ_CLASSES, [fx.school_id]);
    if (preTag.rowCount === 0) {
      ok(`tag admin reads 0 of their own school's ${expected} classes (bug reproduced — the empty Classes tab)`);
    } else {
      bad('bug NOT reproduced — migration would be a no-op', `read ${preTag.rowCount} rows`);
    }

    // The second lie, one table down — this is what 20260807d exists for.
    const preRoster = await asUser(fx.tag_admin,
      `SELECT csp.class_id FROM public.class_student_progress csp
         JOIN public.classes c ON c.id = csp.class_id WHERE c.school_id = $1`, [fx.school_id]);
    const ptrRoster = await asUser(fx.pointer_admin ?? STRANGER,
      `SELECT csp.class_id FROM public.class_student_progress csp
         JOIN public.classes c ON c.id = csp.class_id WHERE c.school_id = $1`, [fx.school_id]);
    if (Number(ptrRoster.rowCount) > 0 && preRoster.rowCount === 0) {
      ok(`tag admin reads 0 roster rows where the pointer admin reads ${ptrRoster.rowCount} (second bug reproduced — "0 students" on every card)`);
    } else if (Number(ptrRoster.rowCount) === 0) {
      console.log('  – fixture school has no roster rows at all; roster bug not exercised');
    } else {
      bad('roster bug NOT reproduced — 20260807d may be a no-op', `tag admin already reads ${preRoster.rowCount}`);
    }

    if (fx.pointer_admin) {
      const prePointer = await asUser(fx.pointer_admin, READ_CLASSES, [fx.school_id]);
      if (prePointer.rowCount === expected) ok(`pointer admin already reads all ${expected} (the working half)`);
      else bad('pointer admin cannot read the school\'s classes even BEFORE the fix',
        `read ${prePointer.rowCount} of ${expected}`);
    } else {
      console.log('  – fixture school has no admin_user_id pointer; branch not exercised');
    }

    if (fail) throw new Error('pre-migration assertions failed — refusing to apply');

    // ---- 3. apply --------------------------------------------------------
    for (const mig of MIGRATIONS) {
      console.log(`\nApplying ${path.basename(mig)} …`);
      const sql = fs.readFileSync(mig, 'utf8')
        .replace(/^\s*BEGIN;\s*$/m, '')
        .replace(/^\s*COMMIT;\s*$/m, '')
        // NOTIFY cannot run inside this canary's open transaction without
        // firing on rollback; the migration files keep it for real deploys.
        .replace(/^\s*NOTIFY\s+pgrst[^;]*;\s*$/gm, '');
      await q(sql);
      console.log('  applied inside the open transaction');
    }
    console.log('');

    // ---- 4. LEGIT PATH ALIVE ---------------------------------------------
    console.log('AFTER — the leader can see her school:');
    const postTag = await asUser(fx.tag_admin, READ_CLASSES, [fx.school_id]);
    if (postTag.rowCount === expected) {
      ok(`tag admin now reads all ${expected} of her school's classes (${postTag.rows.map(r => r.class_name).join(', ')})`);
    } else {
      bad('tag admin STILL cannot read her school\'s classes',
        `read ${postTag.rowCount} of ${expected}${postTag.error ? ` — ${postTag.error.message}` : ''}`);
    }

    // PARITY is the real bar. The Classes tab does not stop at the class rows
    // — it renders per-class student counts and a 7-day sparkline, and the
    // class detail page renders a roster. A leader who reaches the list but
    // sees "0 students" on every card has not been unblocked, she has been
    // told a second lie. So assert the tag admin reads EXACTLY what the
    // pointer admin reads: not merely "more than zero", and not more.
    if (fx.pointer_admin) {
      const PARITY = [
        ['classes', READ_CLASSES, [fx.school_id], 'the Classes tab list'],
        ['class_student_progress',
          `SELECT csp.class_id FROM public.class_student_progress csp
             JOIN public.classes c ON c.id = csp.class_id WHERE c.school_id = $1`,
          [fx.school_id], 'per-class student counts and the class roster'],
        ['class_sessions',
          `SELECT cs.class_id FROM public.class_sessions cs
             JOIN public.classes c ON c.id = cs.class_id WHERE c.school_id = $1`,
          [fx.school_id], 'the 7-day activity sparkline'],
        ['user_tags (school + class rows)',
          `SELECT ut.id FROM public.user_tags ut
            WHERE ut.removed_at IS NULL
              AND (ut.tag_value = 'SCHOOL:' || $1::text
                   OR ut.tag_value IN (SELECT 'CLASS:' || c.id::text
                                         FROM public.classes c WHERE c.school_id = $1))`,
          [fx.school_id], 'the staff and student lists'],
      ];
      for (const [label, sql, params, renders] of PARITY) {
        const asTag = await asUser(fx.tag_admin, sql, params);
        const asPtr = await asUser(fx.pointer_admin, sql, params);
        if (asTag.error) {
          bad(`tag admin blocked from ${label}`, asTag.error.message);
        } else if (asTag.rowCount === asPtr.rowCount) {
          ok(`${label}: tag admin reads ${asTag.rowCount}, same as the pointer admin — ${renders} render`);
        } else {
          bad(`${label}: NO PARITY`, `tag admin ${asTag.rowCount} vs pointer admin ${asPtr.rowCount}`);
        }
      }
    }

    // ---- 5. NO WIDENING --------------------------------------------------
    console.log('\nAFTER — nothing else moved:');
    if (other) {
      const cross = await asUser(fx.tag_admin, READ_CLASSES, [other.id]);
      if (cross.rowCount === 0) ok('tag admin still reads NOTHING from another school');
      else bad('LEAK — tag admin read another school\'s classes', `${cross.rowCount} rows`);
    } else {
      console.log('  – no second school with classes; cross-tenant probe skipped');
    }

    // Both negative actors must stay at zero on EVERY table the parity pass
    // touched, not just on `classes` — a widening in user_tags_select would be
    // the most dangerous of the four (it is the staff and student list).
    const NEGATIVE = [
      ['classes', READ_CLASSES],
      ['class_student_progress',
        `SELECT csp.class_id FROM public.class_student_progress csp
           JOIN public.classes c ON c.id = csp.class_id WHERE c.school_id = $1`],
      ['class_sessions',
        `SELECT cs.class_id FROM public.class_sessions cs
           JOIN public.classes c ON c.id = cs.class_id WHERE c.school_id = $1`],
      ['user_tags (class rows)',
        `SELECT ut.id FROM public.user_tags ut WHERE ut.removed_at IS NULL
           AND ut.tag_value IN (SELECT 'CLASS:' || c.id::text
                                  FROM public.classes c WHERE c.school_id = $1)`],
    ];
    for (const [who, uid] of [["school 'teacher' tag holder", SCHOOL_TEACHER], ['stranger', STRANGER]]) {
      let leaked = 0;
      for (const [label, sql] of NEGATIVE) {
        const r = await asUser(uid, sql, [fx.school_id]);
        if (r.rowCount > 0) { bad(`LEAK — ${who} read ${label}`, `${r.rowCount} rows`); leaked++; }
      }
      if (!leaked) ok(`${who} still reads NOTHING across all four tables`);
    }

    if (fx.pointer_admin) {
      const postPointer = await asUser(fx.pointer_admin, READ_CLASSES, [fx.school_id]);
      if (postPointer.rowCount === expected) ok('pointer admin unregressed');
      else bad('REGRESSION — pointer admin lost their read', `read ${postPointer.rowCount} of ${expected}`);
    }

    // ---- 6. verdict ------------------------------------------------------
    console.log(`\n${pass} passed · ${fail} failed`);
    if (fail === 0 && COMMIT) {
      // Drop the synthetic actor before committing the function change.
      await q(`DELETE FROM public.user_tags WHERE user_id = ANY($1)`, [[SCHOOL_TEACHER, STRANGER]]);
      await q('COMMIT');
      // Outside the transaction, so PostgREST actually reloads.
      await q(`NOTIFY pgrst, 'reload schema'`);
      console.log('\n✅ COMMITTED — is_school_admin_of() now recognises the school admin tag.');
    } else {
      await q('ROLLBACK');
      console.log(fail === 0
        ? '\n↩️  ROLLED BACK (dry run — re-run with --commit to apply)'
        : '\n↩️  ROLLED BACK — assertions failed, nothing applied');
      process.exitCode = fail === 0 ? 0 : 1;
    }
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('\n💥 CANARY ABORTED:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
