#!/usr/bin/env node
/**
 * Canary for 20260718_the_model_expand.sql (docs/THE-MODEL.md §5 expand phase).
 *
 * One transaction against the live shared DB:
 *   1. pre-snapshot: school/group/class counts, school_summary count,
 *      a sample school_summary row (values must be bit-identical after).
 *   2. apply the migration body (its own BEGIN/COMMIT/NOTIFY stripped).
 *   3. assert I2: every school has node_group_id → a groups row with
 *      type='school', name = school_name, parent_id = schools.group_id,
 *      non-null path (trigger fired).
 *   4. assert exactly one node per school (no double-mint on re-run).
 *   5. assert every class with a school_id got group_id = its school's node.
 *   6. assert user_tags now accepts tag_type='group' (probe insert, rolled
 *      back) and still denies an unknown tag_type.
 *   7. assert old-shape reads unchanged: school_summary count + sample row
 *      identical; invite_code_validation still selectable.
 *   8. COMMIT only if --commit AND all green; else ROLLBACK. NOTIFY pgrst
 *      only on real commit.
 *
 * Usage: node canary_the_model_expand.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260718_the_model_expand.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  async function probe(sql, params) {
    await q('SAVEPOINT p');
    try {
      const r = await q(sql, params);
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }

  try {
    await q('BEGIN');

    console.log('— pre-snapshot');
    const pre = {
      schools: (await q('SELECT count(*)::int c FROM public.schools')).rows[0].c,
      groups: (await q('SELECT count(*)::int c FROM public.groups')).rows[0].c,
      classes: (await q('SELECT count(*)::int c FROM public.classes')).rows[0].c,
      summary: (await q('SELECT count(*)::int c FROM public.school_summary')).rows[0].c,
      sample: (await q('SELECT * FROM public.school_summary ORDER BY school_id LIMIT 1')).rows[0] ?? null,
    };
    console.log(`  schools=${pre.schools} groups=${pre.groups} classes=${pre.classes} summary=${pre.summary}`);

    console.log('— applying migration body (in txn)');
    const body = fs.readFileSync(MIGRATION, 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '')
      .replace(/^\s*COMMIT;\s*$/m, '')
      .replace(/^\s*NOTIFY[^;]*;\s*$/m, '');
    await q(body);
    ok('migration applied');

    // I2: every school has exactly one well-formed node
    const orphans = await q(`
      SELECT count(*)::int c FROM public.schools s
      LEFT JOIN public.groups g ON g.id = s.node_group_id
      WHERE s.node_group_id IS NULL OR g.id IS NULL
         OR g.type <> 'school' OR g.name <> s.school_name
         OR g.parent_id IS DISTINCT FROM s.group_id
         OR g.path IS NULL`);
    orphans.rows[0].c === 0 ? ok('I2: every school has a well-formed node (type/name/parent/path)')
      : bad('I2', `${orphans.rows[0].c} schools with missing/malformed nodes`);

    const doubles = await q(`
      SELECT count(*)::int c FROM (
        SELECT node_group_id FROM public.schools WHERE node_group_id IS NOT NULL
        GROUP BY node_group_id HAVING count(*) > 1) d`);
    doubles.rows[0].c === 0 ? ok('one node per school (no double-mint)')
      : bad('double-mint', `${doubles.rows[0].c} nodes shared by multiple schools`);

    const minted = await q('SELECT count(*)::int c FROM public.groups');
    minted.rows[0].c === pre.groups + pre.schools || minted.rows[0].c >= pre.groups
      ? ok(`groups count sane (${pre.groups} → ${minted.rows[0].c})`)
      : bad('groups count', `${pre.groups} → ${minted.rows[0].c}`);

    // I7 groundwork: classes backfilled
    const classGaps = await q(`
      SELECT count(*)::int c FROM public.classes c
      JOIN public.schools s ON s.id = c.school_id
      WHERE c.group_id IS DISTINCT FROM s.node_group_id`);
    classGaps.rows[0].c === 0 ? ok('every school-attached class points at its school node')
      : bad('class backfill', `${classGaps.rows[0].c} classes mismatched`);

    // user_tags CHECK: group now allowed, junk still denied
    const anyNode = (await q(`SELECT node_group_id id FROM public.schools WHERE node_group_id IS NOT NULL LIMIT 1`)).rows[0];
    if (anyNode) {
      const ins = await probe(
        `INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
         VALUES ('canary-the-model', 'group', 'GROUP:' || $1, 'teacher', 'canary') RETURNING id`, [anyNode.id]);
      ins.error ? bad('tag_type=group accepted', ins.error.message) : ok('tag_type=group accepted');
      if (!ins.error) await q(`DELETE FROM public.user_tags WHERE user_id = 'canary-the-model'`);
    }
    const junk = await probe(
      `INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
       VALUES ('canary-the-model', 'banana', 'X', 'teacher', 'canary')`);
    junk.error && /check constraint/i.test(junk.error.message)
      ? ok('unknown tag_type still denied') : bad('unknown tag_type', junk.error ? junk.error.message : 'NOT DENIED');

    // old-shape reads unchanged
    const post = {
      summary: (await q('SELECT count(*)::int c FROM public.school_summary')).rows[0].c,
      sample: (await q('SELECT * FROM public.school_summary ORDER BY school_id LIMIT 1')).rows[0] ?? null,
    };
    post.summary === pre.summary ? ok(`school_summary count unchanged (${post.summary})`)
      : bad('school_summary count', `${pre.summary} → ${post.summary}`);
    JSON.stringify(post.sample) === JSON.stringify(pre.sample)
      ? ok('school_summary sample row bit-identical')
      : bad('school_summary sample row drifted', JSON.stringify({ pre: pre.sample, post: post.sample }));
    const icv = await probe('SELECT count(*) FROM public.invite_code_validation');
    icv.error ? bad('invite_code_validation read', icv.error.message) : ok('invite_code_validation still selectable');

    // idempotence: run the body again inside the same txn, assert no new mints
    await q(body);
    const remint = await q('SELECT count(*)::int c FROM public.groups');
    remint.rows[0].c === minted.rows[0].c ? ok('idempotent (re-run mints nothing)')
      : bad('idempotence', `${minted.rows[0].c} → ${remint.rows[0].c}`);

    console.log(`\n${pass} pass / ${fail} fail`);
    if (fail === 0 && COMMIT) {
      await q('COMMIT');
      await q(`NOTIFY pgrst, 'reload schema'`);
      console.log('COMMITTED (live) + pgrst reload');
    } else {
      await q('ROLLBACK');
      console.log(COMMIT ? 'ROLLED BACK (failures)' : 'ROLLED BACK (dry run — pass --commit to apply)');
      if (fail > 0) process.exit(1);
    }
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('CANARY ERROR:', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
