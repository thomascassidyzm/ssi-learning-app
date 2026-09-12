#!/usr/bin/env node
/**
 * Canary for 20260912a_support_messages_column_grant.sql and
 * 20260912b_is_govt_admin_over_group_by_parent_id.sql (job #300).
 *
 * One transaction:
 *   PRE  — both defects reproduce on the live definitions:
 *          (B) a school admin reads draft_reply / envelope straight off
 *              support_messages as `authenticated`;
 *          (A) a govt_admin of root org X is "over" an unrelated root org Y
 *              whose name slugs to the same path.
 *        — baseline every REAL govt_admin's visible groups / schools / classes /
 *          support threads / messages, and the real school admin's thread view.
 *   APPLY — both migrations, in this txn.
 *   POST — (B) the five sensitive columns (+ author_user_id) are permission
 *              denied; MESSAGE_VIEW_COLUMNS + thread_id still read the row;
 *          (A) own root / own child TRUE, same-slug root and its child FALSE,
 *              unrelated FALSE, non-admin FALSE; schools under the same-slug org
 *              invisible;
 *        — every real admin's visible SETS are identical to the baseline;
 *        — function ACL / SECURITY DEFINER / search_path unchanged.
 *   COMMIT only with --commit AND zero failures; else ROLLBACK.
 *
 * Usage: node canary_20260912_support_grant_and_govt_subtree.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = process.env.DASH || '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));
const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIG_DIR = path.join(__dirname, '..', 'migrations');
const MIGRATIONS = [
  '20260912a_support_messages_column_grant.sql',
  '20260912b_is_govt_admin_over_group_by_parent_id.sql',
];
const COMMIT = process.argv.includes('--commit');

// The app's own projection — must match api/support/_shared.ts MESSAGE_VIEW_COLUMNS.
const VIEW_COLUMNS = 'id, body, direction, author_source, author_name, in_reply_to, escalated_at, escalation_resolved_at, answered_at, created_at';
const SENSITIVE = ['envelope', 'draft_reply', 'escalation_evidence', 'move_reason', 'model_ladder', 'author_user_id'];

// Fixture identities (never real people).
const FX_ADMIN_A = '0000aaaa-0000-4000-8000-000000000a01';
const FX_NOBODY  = '0000aaaa-0000-4000-8000-000000000a02';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };
const first = (s) => String(s || '').split('\n')[0];

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];

  /** Run one statement as a role + jwt, always rolled back to the savepoint. */
  const asRole = async (role, sub, sql, params) => {
    await q('SAVEPOINT r');
    try {
      await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql, params);
      await q('ROLLBACK TO SAVEPOINT r');
      return { rows: r.rows, err: null };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT r');
      return { rows: null, err: e.message };
    }
  };
  const asAuth = (sub, sql, params) => asRole('authenticated', sub, sql, params);
  const idSet = (rows, k = 'id') => (rows || []).map((r) => r[k]).sort().join(',');

  /** Everything a govt_admin can see through the four policies, as sets. */
  async function visibleAs(sub) {
    const g = await asAuth(sub, `SELECT id FROM public.groups WHERE public.is_govt_admin_over_group(id) ORDER BY id`);
    const s = await asAuth(sub, `SELECT id FROM public.schools ORDER BY id`);
    const k = await asAuth(sub, `SELECT id FROM public.classes ORDER BY id`);
    const t = await asAuth(sub, `SELECT id FROM public.support_threads ORDER BY id`);
    const m = await asAuth(sub, `SELECT id FROM public.support_messages ORDER BY id`);
    for (const [n, r] of Object.entries({ g, s, k, t, m })) if (r.err) return { err: `${n}: ${r.err}` };
    return { groups: idSet(g.rows), schools: idSet(s.rows), classes: idSet(k.rows), threads: idSet(t.rows), messages: idSet(m.rows) };
  }

  try {
    await q('BEGIN');

    const fnAclPre = await one(`SELECT proacl::text AS acl, prosecdef, proconfig::text AS cfg FROM pg_proc WHERE oid = 'public.is_govt_admin_over_group(uuid)'::regprocedure`);

    // ── Fixtures ────────────────────────────────────────────────────────────
    // (B) a message with every sensitive column set, on the real school thread.
    const thread = await one(`SELECT t.id, t.school_id, s.admin_user_id FROM public.support_threads t JOIN public.schools s ON s.id = t.school_id LIMIT 1`);
    if (!thread) throw new Error('no school support thread to test against');
    const SCHOOL_ADMIN = thread.admin_user_id;
    const msg = await one(
      `INSERT INTO public.support_messages (thread_id, body, direction, author_source, author_via, author_user_id, envelope, escalation_evidence, draft_reply, move_reason, model_ladder)
       VALUES ($1, 'canary question', 'in', 'human', 'jwt', $2, '{"server":{"secret":"envelope"}}', 'canary evidence', 'canary draft reply', 'canary move reason', '{"rungs":[]}')
       RETURNING id`, [thread.id, SCHOOL_ADMIN]);

    // (A) two root orgs that slug to the same path; the admin governs only A.
    const gA = (await one(`INSERT INTO public.groups (name, type, is_demo, is_test) VALUES ('Canary Same Name Org', 'group', true, true) RETURNING id, path`));
    const gB = (await one(`INSERT INTO public.groups (name, type, is_demo, is_test) VALUES ('canary same-name org', 'group', true, true) RETURNING id, path`));
    const gAchild = (await one(`INSERT INTO public.groups (name, type, parent_id, is_demo, is_test) VALUES ('Canary Child', 'group', $1, true, true) RETURNING id`, [gA.id])).id;
    const gBchild = (await one(`INSERT INTO public.groups (name, type, parent_id, is_demo, is_test) VALUES ('Canary Child', 'group', $1, true, true) RETURNING id`, [gB.id])).id;
    const gOther = (await one(`INSERT INTO public.groups (name, type, is_demo, is_test) VALUES ('Canary Unrelated Org', 'group', true, true) RETURNING id`)).id;
    await q(`INSERT INTO public.govt_admins (user_id, group_id, organization_name, created_by) VALUES ($1, $2, 'Canary Same Name Org', 'canary')`, [FX_ADMIN_A, gA.id]);
    const schoolB = (await one(`INSERT INTO public.schools (school_name, admin_user_id, group_id, teacher_join_code, admin_join_code, is_test) VALUES ('Canary School under B', $1, $2, 'CANARY-T', 'CANARY-A', true) RETURNING id`, [FX_NOBODY, gBchild])).id;
    gA.path === gB.path ? ok(`fixture: two root orgs share path '${gA.path}'`) : bad('fixture paths differ', `${gA.path} vs ${gB.path}`);

    // ── PRE: both defects reproduce ─────────────────────────────────────────
    console.log('— PRE (live definitions)');
    let r = await asAuth(SCHOOL_ADMIN, `SELECT draft_reply, envelope FROM public.support_messages WHERE id = $1`, [msg.id]);
    r.rows && r.rows[0] && r.rows[0].draft_reply === 'canary draft reply'
      ? ok('B reproduces: school admin reads draft_reply + envelope via PostgREST role')
      : bad('B pre-check', r.err || JSON.stringify(r.rows));
    r = await asAuth(FX_ADMIN_A, `SELECT public.is_govt_admin_over_group($1) AS v`, [gB.id]);
    r.rows && r.rows[0].v === true ? ok('A reproduces: admin of A is "over" same-slug root B') : bad('A pre-check', r.err || JSON.stringify(r.rows));
    r = await asAuth(FX_ADMIN_A, `SELECT id FROM public.schools WHERE id = $1`, [schoolB]);
    r.rows && r.rows.length === 1 ? ok('A reproduces: admin of A sees the school under B') : bad('A pre-check schools', r.err || JSON.stringify(r.rows));

    // Baseline every real govt_admin and the real school admin.
    const admins = (await q(`SELECT DISTINCT user_id FROM public.govt_admins WHERE user_id ~ '^[0-9a-f-]{36}$' AND user_id <> $1 ORDER BY 1`, [FX_ADMIN_A])).rows.map((x) => x.user_id);
    const pre = {};
    for (const u of admins) pre[u] = await visibleAs(u);
    const preSchoolAdmin = await visibleAs(SCHOOL_ADMIN);
    const preErr = Object.values(pre).filter((v) => v.err);
    preErr.length === 0 ? ok(`baseline captured for ${admins.length} real govt_admins + the school admin`) : bad('baseline', preErr[0].err);

    // ── APPLY ───────────────────────────────────────────────────────────────
    console.log('— applying migrations (in txn)');
    for (const f of MIGRATIONS) {
      const body = fs.readFileSync(path.join(MIG_DIR, f), 'utf8')
        .replace(/^\s*NOTIFY[^;]*;\s*$/gm, '')
        .replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
      await q(body);
      ok(`applied ${f}`);
    }

    // ── POST (B): columns ───────────────────────────────────────────────────
    console.log('— POST B: support_messages column grant');
    for (const col of SENSITIVE) {
      r = await asAuth(SCHOOL_ADMIN, `SELECT ${col} FROM public.support_messages WHERE id = $1`, [msg.id]);
      r.err && /permission denied/.test(r.err) ? ok(`${col} denied (${first(r.err)})`) : bad(`${col} still readable`, r.err || JSON.stringify(r.rows));
    }
    r = await asAuth(SCHOOL_ADMIN, `SELECT * FROM public.support_messages WHERE id = $1`, [msg.id]);
    r.err && /permission denied/.test(r.err) ? ok('select * denied (a caller must name columns)') : bad('select *', r.err || 'returned rows');
    r = await asAuth(SCHOOL_ADMIN, `SELECT thread_id, ${VIEW_COLUMNS} FROM public.support_messages WHERE thread_id = $1 ORDER BY created_at`, [thread.id]);
    r.rows && r.rows.some((x) => x.id === msg.id && x.body === 'canary question')
      ? ok('MESSAGE_VIEW_COLUMNS + thread_id still read the school admin\'s own row')
      : bad('view columns', r.err || JSON.stringify(r.rows));
    r = await asAuth(FX_NOBODY, `SELECT thread_id, ${VIEW_COLUMNS} FROM public.support_messages WHERE thread_id = $1`, [thread.id]);
    r.rows && r.rows.length === 0 ? ok('a stranger still sees no rows (row policy intact)') : bad('stranger rows', r.err || JSON.stringify(r.rows));
    r = await asRole('anon', null, `SELECT id FROM public.support_messages`);
    r.err ? ok(`anon denied (${first(r.err)})`) : bad('anon', 'returned rows');
    const colGrants = await q(`SELECT column_name FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='support_messages' AND grantee='authenticated' AND privilege_type='SELECT' ORDER BY 1`);
    const granted = colGrants.rows.map((x) => x.column_name).sort().join(',');
    const expected = ['thread_id', ...VIEW_COLUMNS.split(',').map((s) => s.trim())].sort().join(',');
    granted === expected ? ok(`authenticated column grant is exactly MESSAGE_VIEW_COLUMNS + thread_id (${colGrants.rows.length} of 25)`) : bad('column grant set', granted);
    const tbl = await one(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='support_messages' AND grantee IN ('authenticated','anon')`);
    tbl.n === 0 ? ok('no table-level grant to authenticated/anon remains') : bad('table grant', `${tbl.n} remain`);

    // ── POST (A): subtree by parent_id ──────────────────────────────────────
    console.log('— POST A: is_govt_admin_over_group by parent_id');
    const cases = [
      ['own root A', gA.id, true], ['own child of A', gAchild, true],
      ['same-slug root B', gB.id, false], ['child of same-slug B', gBchild, false],
      ['unrelated root', gOther, false],
    ];
    for (const [n, gid, want] of cases) {
      r = await asAuth(FX_ADMIN_A, `SELECT public.is_govt_admin_over_group($1) AS v`, [gid]);
      r.rows && r.rows[0].v === want ? ok(`${n} → ${want}`) : bad(n, r.err || JSON.stringify(r.rows));
    }
    r = await asAuth(FX_NOBODY, `SELECT public.is_govt_admin_over_group($1) AS v`, [gA.id]);
    r.rows && r.rows[0].v === false ? ok('non-admin → false') : bad('non-admin', r.err || JSON.stringify(r.rows));
    r = await asAuth(FX_ADMIN_A, `SELECT id FROM public.schools WHERE id = $1`, [schoolB]);
    r.rows && r.rows.length === 0 ? ok('leak closed: school under same-slug B invisible to admin of A') : bad('school B visible', r.err || JSON.stringify(r.rows));
    r = await asAuth(FX_ADMIN_A, `SELECT public.is_govt_admin_over_group('00000000-0000-0000-0000-000000000000') AS v`);
    r.rows && r.rows[0].v === false ? ok('unknown group id → false, no error') : bad('unknown id', r.err || JSON.stringify(r.rows));

    // Every real admin sees exactly what they saw before.
    let same = 0, diff = [];
    for (const u of admins) {
      const post = await visibleAs(u);
      if (post.err) { diff.push(`${u}: ${post.err}`); continue; }
      const keys = ['groups', 'schools', 'classes', 'threads', 'messages'];
      const d = keys.filter((k) => pre[u][k] !== post[k]);
      d.length ? diff.push(`${u}: ${d.join('/')} changed`) : same++;
    }
    diff.length === 0 ? ok(`every real govt_admin's visible groups/schools/classes/threads/messages identical (${same}/${admins.length})`) : bad('real admin drift', diff.join(' | '));
    const postSchoolAdmin = await visibleAs(SCHOOL_ADMIN);
    JSON.stringify(preSchoolAdmin) === JSON.stringify(postSchoolAdmin) ? ok('the real school admin\'s visible sets identical') : bad('school admin drift', JSON.stringify({ preSchoolAdmin, postSchoolAdmin }));

    const fnAclPost = await one(`SELECT proacl::text AS acl, prosecdef, proconfig::text AS cfg FROM pg_proc WHERE oid = 'public.is_govt_admin_over_group(uuid)'::regprocedure`);
    JSON.stringify(fnAclPre) === JSON.stringify(fnAclPost) ? ok(`function ACL / definer / search_path unchanged (${fnAclPost.acl})`) : bad('function ACL changed', JSON.stringify({ fnAclPre, fnAclPost }));
    const def = (await one(`SELECT pg_get_functiondef('public.is_govt_admin_over_group(uuid)'::regprocedure) AS d`)).d;
    /parent_id/.test(def) && !/\.path/.test(def) ? ok('live definition walks parent_id and never mentions path') : bad('definition', def);

    // ── Fixtures out, then decide ───────────────────────────────────────────
    await q(`DELETE FROM public.support_messages WHERE id = $1`, [msg.id]);
    await q(`DELETE FROM public.schools WHERE id = $1`, [schoolB]);
    await q(`DELETE FROM public.govt_admins WHERE user_id = $1`, [FX_ADMIN_A]);
    await q(`DELETE FROM public.groups WHERE id = ANY($1::uuid[])`, [[gAchild, gBchild, gA.id, gB.id, gOther]]);
    const left = await one(`SELECT (SELECT count(*)::int FROM public.support_messages) m, (SELECT count(*)::int FROM public.groups WHERE name ILIKE 'canary %') g, (SELECT count(*)::int FROM public.govt_admins WHERE user_id=$1) a`, [FX_ADMIN_A]);
    left.m === 0 && left.g === 0 && left.a === 0 ? ok('fixtures removed (0 messages, 0 canary groups, 0 canary admins)') : bad('fixture residue', JSON.stringify(left));

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) {
      await q('COMMIT');
      await q(`NOTIFY pgrst, 'reload schema'`);
      console.log('COMMITTED + pgrst reload');
    } else {
      await q('ROLLBACK');
      console.log(fail ? 'ROLLED BACK (failures)' : 'ROLLED BACK (dry run — pass --commit to apply)');
    }
  } catch (e) {
    console.error('FATAL', e.message);
    try { await q('ROLLBACK'); } catch {}
    process.exitCode = 2;
  } finally {
    await c.end();
  }
  if (fail) process.exitCode = 1;
})();
