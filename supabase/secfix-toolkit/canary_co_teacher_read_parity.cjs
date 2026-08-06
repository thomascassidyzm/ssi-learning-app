#!/usr/bin/env node
/**
 * Canary for 20260806_co_teacher_read_parity.sql  (item A-74, co-teaching)
 *
 * One transaction against the live shared DB:
 *   1. pick a REAL class with a real roster; measure what the LEAD teacher can
 *      read today (the parity target)
 *   2. tag a synthetic co-teacher onto that class and measure again — this is
 *      the BUG DEMONSTRATION: the co-teacher must see ~nothing BEFORE the fix.
 *      If they can already see everything, the migration is unnecessary and
 *      this canary FAILS LOUDLY rather than silently rubber-stamping a no-op.
 *   3. apply the migration
 *   4. assert EVERY LEGIT PATH STILL ALIVE — lead teacher unchanged,
 *      school_admin unchanged, learner's own-row unchanged
 *   5. assert LEAK CLOSED — an unrelated authenticated stranger still reads
 *      zero on every table
 *   6. assert PARITY — the co-teacher now matches the lead exactly
 *   7. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_co_teacher_read_parity.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260806_co_teacher_read_parity.sql');
const COMMIT = process.argv.includes('--commit');

// A synthetic co-teacher and an unrelated stranger. Fixed uuids so reruns are
// deterministic; they exist only inside the transaction.
const CO_TEACHER = '00000000-c0de-4aaa-8aaa-000000000001';
const STRANGER   = '00000000-c0de-4bbb-8bbb-000000000002';

let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  // savepoint-wrapped probe as a real role with real JWT claims
  async function asUser(uid, sql, params) {
    await q('SAVEPOINT p');
    try {
      await q(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await q('SET LOCAL ROLE authenticated');
      const r = await q(sql, params);
      await q('RESET ROLE');
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }

  try {
    await q('BEGIN');

    // ---- fixture: a real class with a real roster -------------------------
    const cls = (await q(`
      SELECT c.id, c.class_name, c.teacher_user_id, c.school_id, s.admin_user_id
      FROM public.classes c
      LEFT JOIN public.schools s ON s.id = c.school_id
      WHERE c.teacher_user_id IS NOT NULL
      ORDER BY (SELECT count(*) FROM public.user_tags ut
                WHERE ut.tag_value = 'CLASS:' || c.id::text AND ut.removed_at IS NULL) DESC
      LIMIT 1`)).rows[0];
    if (!cls) throw new Error('no fixture class with a lead teacher');

    // Pupil learner ids resolved AS POSTGRES, then passed in as literals — so
    // each table's policy is measured in isolation rather than through the
    // user_tags policy (which is itself under test).
    const pupils = (await q(`
      SELECT l.id, l.user_id FROM public.learners l
      JOIN public.user_tags ut ON ut.user_id = l.user_id
      WHERE ut.tag_value = 'CLASS:' || $1::text
        AND ut.role_in_context = 'student' AND ut.removed_at IS NULL`, [cls.id])).rows;
    const pupilIds = pupils.map(p => p.id);

    console.log(`— fixture: "${cls.class_name}" (${cls.id})`);
    console.log(`  lead=${cls.teacher_user_id}  school_admin=${cls.admin_user_id}  pupils=${pupilIds.length}`);
    if (pupilIds.length === 0) throw new Error('fixture class has no pupil learner rows');

    // ---- the five surfaces can_view_learner_data gates, plus the roster ----
    const SURFACES = {
      'roster tags':      [`SELECT count(*)::int n FROM public.user_tags WHERE tag_value = 'CLASS:' || $1::text AND removed_at IS NULL`, [cls.id]],
      'learners':         [`SELECT count(*)::int n FROM public.learners WHERE id = ANY($1::uuid[])`, [pupilIds]],
      'sessions':         [`SELECT count(*)::int n FROM public.sessions WHERE learner_id = ANY($1::uuid[])`, [pupilIds]],
      'seed_progress':    [`SELECT count(*)::int n FROM public.seed_progress WHERE learner_id = ANY($1::uuid[])`, [pupilIds]],
      'lego_progress':    [`SELECT count(*)::int n FROM public.lego_progress WHERE learner_id = ANY($1::uuid[])`, [pupilIds]],
      'course_enrollments': [`SELECT count(*)::int n FROM public.course_enrollments WHERE learner_id = ANY($1::uuid[])`, [pupilIds]],
      'class_student_progress': [`SELECT count(*)::int n FROM public.class_student_progress WHERE class_id = $1::uuid`, [cls.id]],
    };

    async function measure(uid) {
      const out = {};
      for (const [name, [sql, params]] of Object.entries(SURFACES)) {
        const r = await asUser(uid, sql, params);
        out[name] = r.error ? `ERR:${r.error.message.slice(0, 60)}` : r.rows[0].n;
      }
      return out;
    }
    const show = (label, m) => console.log(`  ${label.padEnd(22)} ` +
      Object.entries(m).map(([k, v]) => `${k}=${v}`).join('  '));

    // ---- 1. tag the co-teacher FIRST -------------------------------------
    // The tag goes in before any measurement so every before/after pair is
    // taken against the SAME fixture state. (Measuring the lead first and
    // inserting after makes the lead's roster count go 26 → 27 purely because
    // of the canary's own row — a false "lead gained access" alarm.)
    await q(`INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
             VALUES ($1, 'class', 'CLASS:' || $2::text, 'teacher', 'canary')`, [CO_TEACHER, cls.id]);

    console.log('\n[1] BEFORE — baseline reads (co-teacher already tagged)');
    const leadBefore = await measure(cls.teacher_user_id);
    show('lead teacher', leadBefore);
    const adminBefore = cls.admin_user_id ? await measure(cls.admin_user_id) : null;
    if (adminBefore) show('school_admin', adminBefore);
    const strangerBefore = await measure(STRANGER);
    show('stranger', strangerBefore);

    // ---- 2. DEMONSTRATE THE BUG ------------------------------------------
    console.log('\n[2] BEFORE FIX — co-teacher reads (expect near-zero: this IS the bug)');
    const coBefore = await measure(CO_TEACHER);
    show('co-teacher', coBefore);

    const gapSurfaces = Object.keys(SURFACES).filter(k => k !== 'roster tags');
    const blindBefore = gapSurfaces.every(k => coBefore[k] === 0);
    blindBefore
      ? ok('bug reproduced: co-teacher reads 0 pupil rows on every gated surface')
      : bad('bug NOT reproduced', `co-teacher already sees ${JSON.stringify(coBefore)} — migration may be a no-op; STOP and re-read the live function`);

    // ---- 3. apply -----------------------------------------------------------
    console.log('\n[3] applying 20260806_co_teacher_read_parity.sql (in txn)');
    // strip the migration's own BEGIN/COMMIT — we own the transaction here
    const sql = fs.readFileSync(MIGRATION, 'utf8')
      .replace(/^\s*BEGIN\s*;/mi, '').replace(/^\s*COMMIT\s*;/mi, '');
    await q(sql);
    ok('migration applied without error');

    // ---- 4/5/6. assert ------------------------------------------------------
    console.log('\n[4] AFTER — reads');
    const leadAfter = await measure(cls.teacher_user_id);
    show('lead teacher', leadAfter);
    const coAfter = await measure(CO_TEACHER);
    show('co-teacher', coAfter);
    const adminAfter = cls.admin_user_id ? await measure(cls.admin_user_id) : null;
    if (adminAfter) show('school_admin', adminAfter);
    const strangerAfter = await measure(STRANGER);
    show('stranger', strangerAfter);

    console.log('\n[5] assertions');

    // EVERY LEGIT PATH STILL ALIVE — monotonic widening, nobody loses access
    for (const k of Object.keys(SURFACES)) {
      if (leadAfter[k] === leadBefore[k]) ok(`lead unchanged: ${k} = ${leadAfter[k]}`);
      else bad(`LEAD LOST/GAINED ACCESS: ${k}`, `${leadBefore[k]} → ${leadAfter[k]}`);
    }
    if (adminBefore) {
      for (const k of Object.keys(SURFACES)) {
        if (adminAfter[k] === adminBefore[k]) ok(`school_admin unchanged: ${k} = ${adminAfter[k]}`);
        else bad(`SCHOOL_ADMIN ACCESS CHANGED: ${k}`, `${adminBefore[k]} → ${adminAfter[k]}`);
      }
    }

    // LEAK CLOSED — an unrelated authenticated stranger still sees nothing
    for (const k of Object.keys(SURFACES)) {
      if (strangerAfter[k] === 0) ok(`stranger still blind: ${k} = 0`);
      else bad(`LEAK: stranger reads ${k}`, `${strangerAfter[k]} rows`);
    }

    // PARITY — the whole point
    for (const k of Object.keys(SURFACES)) {
      if (coAfter[k] === leadAfter[k]) ok(`co-teacher at parity: ${k} = ${coAfter[k]}`);
      else bad(`NO PARITY: ${k}`, `co-teacher ${coAfter[k]} vs lead ${leadAfter[k]}`);
    }

    // A learner's own row is untouched by any of this
    const anyLearner = (await q(`SELECT id, user_id FROM public.learners
      WHERE user_id IS NOT NULL AND id <> ALL($1::uuid[]) LIMIT 1`, [pupilIds])).rows[0];
    if (anyLearner) {
      const own = await asUser(anyLearner.user_id,
        `SELECT count(*)::int n FROM public.learners WHERE id = $1::uuid`, [anyLearner.id]);
      (!own.error && own.rows[0].n === 1)
        ? ok('unrelated learner still reads own row')
        : bad('own-row read broken', own.error ? own.error.message : `n=${own.rows[0].n}`);
      const cross = await asUser(anyLearner.user_id,
        `SELECT count(*)::int n FROM public.learners WHERE id = ANY($1::uuid[])`, [pupilIds]);
      (!cross.error && cross.rows[0].n === 0)
        ? ok('unrelated learner still cannot cross-read the class')
        : bad('LEAK: unrelated learner cross-reads', JSON.stringify(cross.rows || cross.error.message));
    }

    // ---- 7. commit or roll back --------------------------------------------
    console.log(`\n— ${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) {
      // drop the synthetic fixture tag before committing the real change
      await q(`DELETE FROM public.user_tags WHERE user_id = $1`, [CO_TEACHER]);
      await q('COMMIT');
      console.log('✅ COMMITTED — co-teacher read parity is live');
    } else {
      await q('ROLLBACK');
      console.log(fail === 0
        ? 'ROLLED BACK (green — rerun with --commit to apply)'
        : '❌ ROLLED BACK — assertions failed, nothing changed');
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
