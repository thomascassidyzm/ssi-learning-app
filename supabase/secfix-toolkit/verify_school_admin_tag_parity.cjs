#!/usr/bin/env node
/**
 * LIVE verifier for the school-admin tag parity fix (20260807c + 20260807d).
 *
 * Read-only. Runs entirely inside a transaction that is ALWAYS rolled back —
 * it writes nothing, ever. Safe to run against the shared DB at any time.
 *
 * WHAT IT PROVES, against whatever is live right now:
 *   PARITY      — a school's TAG admin reads exactly what that school's
 *                 POINTER admin reads, across the four tables the schools
 *                 surface actually renders (classes, class_student_progress,
 *                 class_sessions, user_tags). Not "more than zero": EQUAL.
 *   NO WIDENING — a school tag with role_in_context 'teacher' (an ordinary
 *                 member of staff, e.g. a supply teacher on no classes) and a
 *                 total stranger both still read nothing; and the tag admin
 *                 reads nothing from a DIFFERENT school.
 *   NO ESCALATION — nobody can promote their own user_tag row to
 *                 role_in_context 'admin' or 'teacher'. This one is here
 *                 because a partial apply on 2026-08-07 briefly dropped
 *                 user_tags_update's WITH CHECK and opened exactly that hole;
 *                 it is now a permanent assertion so it cannot recur silently.
 *
 * The fixture is discovered, not hardcoded: the tag-admin'd school with the
 * biggest real roster. A school whose classes have no students would let the
 * roster assertions pass vacuously, which is how the class_student_progress
 * gap nearly slipped through the first time.
 *
 * Usage: node verify_school_admin_tag_parity.cjs
 * Exit 0 = all green. Exit 1 = something regressed.
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

const STRANGER = '00000000-c0de-4a22-8a22-000000000022';

let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

// The four reads the leader's schools surface actually performs.
const READS = {
  classes:
    `SELECT id FROM public.classes WHERE school_id = $1::uuid AND is_active = true`,
  'class rosters (class_student_progress)':
    `SELECT csp.class_id FROM public.class_student_progress csp
       JOIN public.classes c ON c.id = csp.class_id WHERE c.school_id = $1::uuid`,
  'class sessions (activity sparkline)':
    `SELECT cs.class_id FROM public.class_sessions cs
       JOIN public.classes c ON c.id = cs.class_id WHERE c.school_id = $1::uuid`,
  'user_tags (staff + student lists)':
    `SELECT ut.id FROM public.user_tags ut WHERE ut.removed_at IS NULL
       AND (ut.tag_value = 'SCHOOL:' || ($1::uuid)::text
            OR ut.tag_value IN (SELECT 'CLASS:' || c.id::text
                                  FROM public.classes c WHERE c.school_id = $1::uuid))`,
};

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  // Probe as a real role with real JWT claims, inside a savepoint so a denial
  // cannot poison the outer transaction. Returns a row count, or {err}.
  async function asUser(uid, sql, params) {
    await q('SAVEPOINT p');
    try {
      await q(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await q('SET LOCAL ROLE authenticated');
      const r = await q(sql, params);
      await q('RESET ROLE');
      await q('RELEASE SAVEPOINT p');
      return r.rowCount;
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { err: e.message };
    }
  }

  try {
    await q('BEGIN');

    const fx = (await q(`
      SELECT ut.user_id AS tag_admin, s.id AS school_id, s.school_name,
             s.admin_user_id AS pointer_admin
      FROM public.user_tags ut
      JOIN public.schools s ON ('SCHOOL:' || s.id::text) = ut.tag_value
      WHERE ut.tag_type = 'school' AND ut.role_in_context = 'admin'
        AND ut.removed_at IS NULL
        AND s.admin_user_id IS DISTINCT FROM ut.user_id
        AND s.admin_user_id IS NOT NULL
      ORDER BY (SELECT count(*) FROM public.class_student_progress csp
                  JOIN public.classes c2 ON c2.id = csp.class_id
                 WHERE c2.school_id = s.id) DESC
      LIMIT 1`)).rows[0];
    if (!fx) throw new Error('no fixture: no school with both a tag admin and a pointer admin');

    // An ordinary member of staff at the SAME school: school tag, but
    // role_in_context 'teacher'. The supply-teacher shape.
    const staff = (await q(`
      SELECT ut.user_id FROM public.user_tags ut
      WHERE ut.tag_type = 'school' AND ut.role_in_context = 'teacher'
        AND ut.removed_at IS NULL AND ut.tag_value = 'SCHOOL:' || $1::text
        AND NOT EXISTS (SELECT 1 FROM public.classes c
                         WHERE c.school_id = $1::uuid AND c.teacher_user_id = ut.user_id)
        AND NOT EXISTS (SELECT 1 FROM public.user_tags ct
                         WHERE ct.user_id = ut.user_id AND ct.tag_type = 'class'
                           AND ct.removed_at IS NULL)
      LIMIT 1`, [fx.school_id])).rows[0]?.user_id;

    const other = (await q(`
      SELECT s.id FROM public.schools s WHERE s.id <> $1
        AND EXISTS (SELECT 1 FROM public.classes c WHERE c.school_id = s.id AND c.is_active)
      LIMIT 1`, [fx.school_id])).rows[0]?.id;

    console.log(`\nFixture: "${fx.school_name}" (${fx.school_id})`);
    console.log(`  tag admin     ${fx.tag_admin}`);
    console.log(`  pointer admin ${fx.pointer_admin}\n`);

    // ---- PARITY ----------------------------------------------------------
    console.log('PARITY — tag admin vs pointer admin on the same school:');
    for (const [label, sql] of Object.entries(READS)) {
      const tag = await asUser(fx.tag_admin, sql, [fx.school_id]);
      const ptr = await asUser(fx.pointer_admin, sql, [fx.school_id]);
      if (tag && tag.err) bad(`${label}: tag admin blocked`, tag.err);
      else if (tag === ptr) ok(`${label}: both read ${tag}`);
      else bad(`${label}: NO PARITY`, `tag admin ${tag} vs pointer admin ${ptr}`);
    }

    // ---- NO WIDENING -----------------------------------------------------
    console.log('\nNO WIDENING:');
    const negatives = [['stranger', STRANGER]];
    if (staff) negatives.unshift([`school 'teacher' tag holder (${staff.slice(0, 8)}…)`, staff]);
    else console.log("  – no class-less school 'teacher' tag holder at this school; probe skipped");

    for (const [who, uid] of negatives) {
      let leaked = 0;
      for (const [label, sql0] of Object.entries(READS)) {
        // Exclude the actor's OWN tag rows: user_tags_select has always let
        // anyone read their own tags, which is correct and predates this work.
        const sql = label.startsWith('user_tags') ? `${sql0} AND ut.user_id <> '${uid}'` : sql0;
        const r = await asUser(uid, sql, [fx.school_id]);
        if (typeof r === 'number' && r > 0) { bad(`${who} read ${label}`, `${r} rows`); leaked++; }
      }
      if (!leaked) ok(`${who} reads nothing across all four tables`);
    }

    if (other) {
      const cross = await asUser(fx.tag_admin, READS.classes, [other]);
      if (cross === 0) ok('tag admin reads nothing from a different school');
      else bad('CROSS-TENANT LEAK', `${cross} rows`);
    }

    // ---- NO ESCALATION ---------------------------------------------------
    console.log('\nNO SELF-ESCALATION:');
    const anyClass = (await q(`SELECT id FROM public.classes LIMIT 1`)).rows[0].id;
    const probeTag = (await q(
      `INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
       VALUES ($1,'class',$2,'student',$1) RETURNING id`,
      [STRANGER, `CLASS:${anyClass}`])).rows[0].id;
    for (const role of ['admin', 'teacher']) {
      const r = await asUser(STRANGER,
        `UPDATE public.user_tags SET role_in_context = $2 WHERE id = $1`, [probeTag, role]);
      if (r === 0 || (r && r.err)) ok(`nobody can self-promote their own tag to '${role}'`);
      else bad(`SELF-ESCALATION OPEN to '${role}'`, `${r} rows written`);
    }

    console.log(`\n${pass} passed · ${fail} failed`);
  } catch (e) {
    console.error('\n💥 VERIFIER ABORTED:', e.message);
    fail++;
  } finally {
    // Unconditional. This tool never writes.
    await q('ROLLBACK').catch(() => {});
    await c.end();
    process.exitCode = fail ? 1 : 0;
  }
})();
