#!/usr/bin/env node
/**
 * Canary for 20260911_support_channel.sql — support_threads / support_messages /
 * support_signals.
 *
 * One transaction against the live shared DB:
 *   1. apply the migration
 *   2. build fixtures inside a savepoint: a thread for school A, a thread for
 *      school B, an org thread for the gwynedd group, messages and a signal
 *   3. LEAK-CLOSED probes — anon sees nothing; a school admin sees ONLY their
 *      own school's thread and messages; support_signals is unreadable by
 *      anyone but the service role; no authenticated write of any kind lands
 *   4. LEGIT-PATHS-ALIVE probes — the service role replays api/support/_shared
 *      ensureThread, api/support/messages POST, api/support/thread GET (incl.
 *      the last_read_at stamp), api/support/population's integer count and the
 *      doorbell's doorbell_sent_at update; and each owner reads their own row
 *   5. roll back to the fixture savepoint (the DDL survives, the fixtures do not)
 *   6. COMMIT only if --commit AND every assertion is green; else ROLLBACK.
 *
 * Usage: node canary_support_channel.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8').match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260911_support_channel.sql');
const COMMIT = process.argv.includes('--commit');

// Real rows, so the predicates evaluate truthfully rather than against invented ids.
const SCHOOL_A = 'c268d89d-2ff2-4d60-ae27-669d5ff25429', ADMIN_A = '2f2e12e7-e8f6-43a1-ad65-e8439a2ba242';
const SCHOOL_B = '77cb4111-fd12-4e40-86db-46f55d070d6a', ADMIN_B = '7a61b162-ce19-4a5b-835d-eca252e7029a';
const GROUP_G  = '2c4620d3-aace-4854-b4a1-bb575a3f5dfb', GOVT_G  = 'c2d41dec-981f-442f-b4a4-4d5643705a6c';
const GOVT_OTHER = 'fa7d92c7-0dd7-4fe8-869e-ae9658f8c397'; // cardiff-council, not over gwynedd

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  async function probe(role, sql, uid) {
    await q('SAVEPOINT p');
    try {
      if (uid) await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role })]);
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql);
      await q('RESET ROLE'); await q(`SELECT set_config('request.jwt.claims', NULL, true)`);
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      await q('RESET ROLE'); await q(`SELECT set_config('request.jwt.claims', NULL, true)`);
      return { error: e };
    }
  }
  const expectOk = async (n, role, sql, uid) => {
    const r = await probe(role, sql, uid);
    r.error ? bad(n, r.error.message) : ok(n);
    return r;
  };
  const expectRows = async (n, role, sql, uid, want) => {
    const r = await probe(role, sql, uid);
    if (r.error) bad(n, r.error.message);
    else if (r.rowCount !== want) bad(n, `expected ${want} row(s), got ${r.rowCount}`);
    else ok(n);
    return r;
  };
  const expectDeny = async (n, role, sql, uid) => {
    const r = await probe(role, sql, uid);
    if (r.error && /permission denied/i.test(r.error.message)) ok(n);
    else if (r.error) bad(n, `denied but wrong error: ${r.error.message}`);
    else bad(n, `NOT DENIED (${r.rowCount} rows)`);
  };
  const expectNoWrite = async (n, role, sql, uid) => {
    const r = await probe(role, sql, uid);
    if (r.error && /(permission denied|row-level security|violates)/i.test(r.error.message)) ok(n);
    else if (r.error) bad(n, `blocked but wrong error: ${r.error.message}`);
    else if (r.rowCount === 0) ok(`${n} (no row written)`);
    else bad(n, `WROTE ${r.rowCount} row(s)`);
  };

  try {
    await q('BEGIN');

    console.log('\n[1] apply the migration');
    const sql = fs.readFileSync(MIGRATION, 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await q(sql);
    ok('migration applied inside the transaction');

    console.log('\n[2] posture as declared');
    const posture = await q(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('support_threads','support_messages','support_signals') ORDER BY relname`);
    posture.rows.length === 3 && posture.rows.every((r) => r.relrowsecurity)
      ? ok('RLS enabled on all three tables') : bad('RLS enabled on all three tables', JSON.stringify(posture.rows));
    const pol = await q(`SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename LIKE 'support%' ORDER BY tablename`);
    const names = pol.rows.map((r) => `${r.tablename}:${r.cmd}`).sort().join(',');
    names === 'support_messages:SELECT,support_threads:SELECT'
      ? ok('exactly two policies, both SELECT, none on support_signals') : bad('policy set', names);

    console.log('\n[3] fixtures');
    await q('SAVEPOINT fixtures');
    const tA = (await q(`INSERT INTO support_threads (school_id, language) VALUES ($1,'eng') RETURNING id`, [SCHOOL_A])).rows[0].id;
    const tB = (await q(`INSERT INTO support_threads (school_id, language) VALUES ($1,'eng') RETURNING id`, [SCHOOL_B])).rows[0].id;
    const tG = (await q(`INSERT INTO support_threads (group_id, language) VALUES ($1,'cym') RETURNING id`, [GROUP_G])).rows[0].id;
    const mA = (await q(`INSERT INTO support_messages (thread_id, body, direction, author_source, author_via, author_user_id) VALUES ($1,'canary question A','in','human','jwt',$2) RETURNING id`, [tA, ADMIN_A])).rows[0].id;
    await q(`INSERT INTO support_messages (thread_id, body, direction, author_source, author_via, in_reply_to) VALUES ($1,'canary reply A','out','agent','service-key',$2)`, [tA, mA]);
    await q(`INSERT INTO support_messages (thread_id, body, direction, author_source, author_via, author_user_id) VALUES ($1,'canary question B','in','human','jwt',$2)`, [tB, ADMIN_B]);
    await q(`INSERT INTO support_messages (thread_id, body, direction, author_source, author_via, author_user_id) VALUES ($1,'canary question G','in','human','jwt',$2)`, [tG, GOVT_G]);
    await q(`INSERT INTO support_signals (signal_key, school_id) VALUES ('tile-contradiction:canary',$1), ('tile-contradiction:canary',$2)`, [SCHOOL_A, SCHOOL_B]);
    ok('three threads, four messages, two signal rows');

    console.log('\n[4] LEAK-CLOSED');
    await expectDeny('anon cannot read support_threads', 'anon', 'SELECT * FROM support_threads');
    await expectDeny('anon cannot read support_messages', 'anon', 'SELECT * FROM support_messages');
    await expectDeny('anon cannot read support_signals', 'anon', 'SELECT * FROM support_signals');
    await expectDeny('a school admin cannot read support_signals', 'authenticated', 'SELECT * FROM support_signals', ADMIN_A);
    await expectRows("school A's admin sees only school A's thread", 'authenticated', `SELECT id FROM support_threads WHERE id IN ('${tA}','${tB}','${tG}')`, ADMIN_A, 1);
    const seenA = await probe('authenticated', `SELECT id FROM support_threads WHERE id IN ('${tA}','${tB}','${tG}')`, ADMIN_A);
    (!seenA.error && seenA.rows[0].id === tA) ? ok("...and it is school A's own thread") : bad('own-thread identity', JSON.stringify(seenA.rows || seenA.error?.message));
    await expectRows("school A's admin sees only school A's messages", 'authenticated', `SELECT id FROM support_messages WHERE thread_id IN ('${tA}','${tB}','${tG}')`, ADMIN_A, 2);
    await expectRows("school B's admin cannot see school A's thread", 'authenticated', `SELECT id FROM support_threads WHERE id = '${tA}'`, ADMIN_B, 0);
    await expectRows("school B's admin cannot see school A's messages", 'authenticated', `SELECT id FROM support_messages WHERE thread_id = '${tA}'`, ADMIN_B, 0);
    await expectRows('a govt admin over another council cannot see the gwynedd org thread', 'authenticated', `SELECT id FROM support_threads WHERE id = '${tG}'`, GOVT_OTHER, 0);
    await expectRows("a school admin cannot see an org thread", 'authenticated', `SELECT id FROM support_threads WHERE id = '${tG}'`, ADMIN_A, 0);
    await expectNoWrite('a school admin cannot insert a message', 'authenticated', `INSERT INTO support_messages (thread_id, body, direction, author_source) VALUES ('${tA}','forged','out','human')`, ADMIN_A);
    await expectNoWrite('a school admin cannot insert a thread', 'authenticated', `INSERT INTO support_threads (school_id) VALUES ('${SCHOOL_A}')`, ADMIN_A);
    await expectNoWrite('a school admin cannot update their own thread', 'authenticated', `UPDATE support_threads SET last_read_at = now() WHERE id = '${tA}'`, ADMIN_A);
    await expectNoWrite('a school admin cannot update a message', 'authenticated', `UPDATE support_messages SET body = 'tampered' WHERE id = '${mA}'`, ADMIN_A);
    await expectNoWrite('a school admin cannot delete a message', 'authenticated', `DELETE FROM support_messages WHERE id = '${mA}'`, ADMIN_A);
    await expectNoWrite('a school admin cannot write a signal', 'authenticated', `INSERT INTO support_signals (signal_key, school_id) VALUES ('forged','${SCHOOL_A}')`, ADMIN_A);

    console.log('\n[5] LEGIT PATHS ALIVE');
    await expectRows("school A's admin reads their own thread (the app's read path)", 'authenticated', `SELECT id, language, standing_notes FROM support_threads WHERE id = '${tA}'`, ADMIN_A, 1);
    await expectRows("school A's admin reads their own turn-taking (2 rows, in then out)", 'authenticated', `SELECT body, direction FROM support_messages WHERE thread_id = '${tA}' ORDER BY created_at`, ADMIN_A, 2);
    await expectRows('the gwynedd govt admin reads their own org thread', 'authenticated', `SELECT id FROM support_threads WHERE id = '${tG}'`, GOVT_G, 1);
    await expectRows("...and its messages", 'authenticated', `SELECT id FROM support_messages WHERE thread_id = '${tG}'`, GOVT_G, 1);
    await expectOk('service role replays ensureThread (select by school_id)', 'service_role', `SELECT * FROM support_threads WHERE school_id = '${SCHOOL_A}'`);
    await expectOk('service role writes the question row (messages POST)', 'service_role', `INSERT INTO support_messages (thread_id, body, direction, author_source, author_via, author_user_id, envelope) VALUES ('${tA}','svc question','in','human','jwt','${ADMIN_A}','{"scope":"school"}'::jsonb)`);
    await expectOk('service role writes the answer row and takes the turn', 'service_role', `UPDATE support_messages SET answered_at = now() WHERE id = '${mA}'`);
    await expectOk('service role stamps last_read_at (thread GET)', 'service_role', `UPDATE support_threads SET last_read_at = now(), last_message_at = now() WHERE id = '${tA}'`);
    await expectOk('service role stamps doorbell_sent_at (the cron)', 'service_role', `UPDATE support_messages SET doorbell_sent_at = now() WHERE thread_id = '${tA}' AND direction = 'out'`);
    const pop = await probe('service_role', `SELECT count(DISTINCT school_id)::int AS n FROM support_signals WHERE signal_key = 'tile-contradiction:canary'`);
    (!pop.error && pop.rows[0].n === 2) ? ok('population endpoint counts 2 schools, integers only') : bad('population count', JSON.stringify(pop.rows || pop.error?.message));
    await expectOk('service role upserts a signal (seen_count bump)', 'service_role', `INSERT INTO support_signals (signal_key, school_id) VALUES ('tile-contradiction:canary','${SCHOOL_A}') ON CONFLICT (signal_key, school_id) DO UPDATE SET seen_count = support_signals.seen_count + 1, last_seen_at = now()`);
    await expectOk('the watcher query uses the partial index', 'service_role', `SELECT id FROM support_messages WHERE direction = 'in' AND answered_at IS NULL ORDER BY created_at LIMIT 5`);

    console.log('\n[6] shape holds');
    const both = await probe('service_role', `INSERT INTO support_threads (school_id, group_id) VALUES ('${SCHOOL_A}','${GROUP_G}')`);
    (both.error && /support_threads_one_owner/.test(both.error.message)) ? ok('a thread cannot own both a school and a group') : bad('one-owner CHECK', both.error?.message || 'accepted');
    const neither = await probe('service_role', `INSERT INTO support_threads (language) VALUES ('eng')`);
    (neither.error && /support_threads_one_owner/.test(neither.error.message)) ? ok('a thread cannot be ownerless') : bad('one-owner CHECK (neither)', neither.error?.message || 'accepted');
    const dup = await probe('service_role', `INSERT INTO support_threads (school_id) VALUES ('${SCHOOL_A}')`);
    (dup.error && /support_threads_school_uniq/.test(dup.error.message)) ? ok('one thread per school, forever (ensureThread race path)') : bad('school uniq index', dup.error?.message || 'accepted');

    console.log('\n[7] drop the fixtures, keep the DDL');
    await q('ROLLBACK TO SAVEPOINT fixtures');
    const left = await q(`SELECT count(*)::int n FROM support_threads`);
    left.rows[0].n === 0 ? ok('no canary rows survive') : bad('fixtures cleared', `${left.rows[0].n} rows left`);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) {
      await q(`NOTIFY pgrst, 'reload schema'`);
      await q('COMMIT');
      console.log('COMMITTED — the three tables are live, schema reload notified.');
    } else {
      await q('ROLLBACK');
      console.log(fail === 0 ? 'ROLLED BACK (dry run — pass --commit to land it).' : 'ROLLED BACK (assertions failed).');
      process.exitCode = fail === 0 ? 0 : 1;
    }
  } catch (e) {
    try { await q('ROLLBACK'); } catch {}
    console.error('ABORTED:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
