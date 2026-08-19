#!/usr/bin/env node
/**
 * Canary for 20260819_phrases_spoken_ledger.sql
 * ---------------------------------------------
 * Repo doctrine (CLAUDE.md, RLS rule 3): no DB-auth change without a canary
 * run — apply in ONE transaction, replay the real app queries as the real
 * roles, assert leak-closed AND every-legit-path-alive, COMMIT iff green.
 *
 * What this one has to prove:
 *   1. the new column exists, defaults 0, and every existing row reads 0
 *      (no learner's number moves as a side effect of the migration);
 *   2. bump_speaking_opportunities is BYTE-IDENTICAL afterwards — the whole
 *      reason for a separate function is that the shared one is not touched,
 *      and that only means anything if it is checked;
 *   3. the owning learner CAN write their own row through the new RPC, and
 *      the write lands on phrases_spoken WITHOUT disturbing opportunities or
 *      play_seconds (those belong to a parallel branch);
 *   4. a DIFFERENT learner's id is REJECTED with 42501 — the ownership guard,
 *      i.e. leak-closed;
 *   5. anon cannot execute it at all;
 *   6. own-row SELECT under RLS as `authenticated` returns the new column for
 *      your own rows and nothing for anyone else's;
 *   7. the existing opportunities write path still works (not-broken check).
 *
 * Usage:  node canary_phrases_spoken_ledger.cjs          # dry run, rolls back
 *         node canary_phrases_spoken_ledger.cjs --commit # commits iff green
 */
const fs = require('fs')
const path = require('path')
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean'
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))

const COMMIT = process.argv.includes('--commit')
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260819_phrases_spoken_ledger.sql')

// Tom's learner (thomas.cassidy+ssi@gmail.com) — the owner half of the pair.
const OWNER_LEARNER = '81987d60-0c00-4553-8a36-79f83cdf1774'
const TEST_COURSE = '__canary_phrases_spoken__'

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
const m = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)
if (!m) { console.error('No DATABASE_URL in .env.psql'); process.exit(1) }

const checks = []
function assert(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Run a query as a given Supabase role with a given auth.uid() JWT claim. */
async function asRole(c, role, authUid, sql, params) {
  await c.query('SAVEPOINT role_probe')
  try {
    const claims = authUid ? JSON.stringify({ sub: authUid, role }) : JSON.stringify({ role })
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims])
    await c.query(`SET LOCAL ROLE ${role}`)
    const res = await c.query(sql, params)
    await c.query('RESET ROLE')
    await c.query('RELEASE SAVEPOINT role_probe')
    return { ok: true, rows: res.rows, rowCount: res.rowCount }
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT role_probe')
    await c.query('RESET ROLE')
    return { ok: false, code: e.code, message: e.message }
  }
}

;(async () => {
  const c = new Client({ connectionString: m[1], ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('BEGIN')
  try {
    // ── before-state ────────────────────────────────────────────────────
    const beforeFn = (await c.query(
      `SELECT md5(pg_get_functiondef(oid)) AS h FROM pg_proc
       WHERE proname = 'bump_speaking_opportunities' AND pronamespace = 'public'::regnamespace`
    )).rows[0]
    const beforeTotals = (await c.query(
      `SELECT count(*)::bigint AS rows, coalesce(sum(opportunities),0)::bigint AS opps,
              coalesce(sum(play_seconds),0)::bigint AS secs
       FROM learner_speaking_opportunities`
    )).rows[0]
    console.log('before:', JSON.stringify(beforeTotals), 'fn md5', beforeFn && beforeFn.h)

    // The auth uid that owns OWNER_LEARNER, and some OTHER learner to attack with.
    const owner = (await c.query(
      `SELECT user_id FROM learners WHERE id = $1`, [OWNER_LEARNER]
    )).rows[0]
    if (!owner) throw new Error('owner learner not found — wrong DB?')
    const other = (await c.query(
      `SELECT id FROM learners WHERE id <> $1 AND user_id IS NOT NULL LIMIT 1`, [OWNER_LEARNER]
    )).rows[0]
    console.log('owner auth uid:', owner.user_id, '| victim learner:', other.id)

    // ── apply the migration (minus its own BEGIN/COMMIT — we own the txn) ─
    let sql = fs.readFileSync(MIGRATION, 'utf8')
    sql = sql.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '')
    await c.query(sql)
    console.log('\nmigration applied inside the transaction. probing…\n')

    // ── 1. column exists, defaults 0, no existing row moved ──────────────
    const col = (await c.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_name='learner_speaking_opportunities' AND column_name='phrases_spoken'`
    )).rows[0]
    assert('column phrases_spoken exists as NOT NULL bigint default 0',
      col && col.data_type === 'bigint' && col.is_nullable === 'NO' && /0/.test(col.column_default || ''),
      col && `${col.data_type} null=${col.is_nullable} default=${col.column_default}`)

    const afterTotals = (await c.query(
      `SELECT count(*)::bigint AS rows, coalesce(sum(opportunities),0)::bigint AS opps,
              coalesce(sum(play_seconds),0)::bigint AS secs,
              coalesce(sum(phrases_spoken),0)::bigint AS phr,
              count(*) FILTER (WHERE phrases_spoken <> 0)::bigint AS nonzero
       FROM learner_speaking_opportunities`
    )).rows[0]
    assert('every pre-existing row reads phrases_spoken = 0', afterTotals.nonzero === '0',
      `${afterTotals.nonzero} non-zero rows`)
    assert('opportunities and play_seconds untouched by the migration',
      afterTotals.opps === beforeTotals.opps && afterTotals.secs === beforeTotals.secs &&
      afterTotals.rows === beforeTotals.rows,
      `rows ${beforeTotals.rows}->${afterTotals.rows}, opps ${beforeTotals.opps}->${afterTotals.opps}, secs ${beforeTotals.secs}->${afterTotals.secs}`)

    // ── 2. the shared function is byte-identical ─────────────────────────
    const afterFn = (await c.query(
      `SELECT md5(pg_get_functiondef(oid)) AS h FROM pg_proc
       WHERE proname = 'bump_speaking_opportunities' AND pronamespace = 'public'::regnamespace`
    )).rows
    assert('bump_speaking_opportunities still has exactly ONE overload', afterFn.length === 1,
      `${afterFn.length} overload(s)`)
    assert('bump_speaking_opportunities definition byte-identical',
      afterFn.length === 1 && afterFn[0].h === beforeFn.h)

    // ── 3. the owner CAN write their own row, phrases only ───────────────
    const ownBefore = (await c.query(
      `SELECT coalesce(sum(phrases_spoken),0)::bigint AS phr, coalesce(sum(opportunities),0)::bigint AS opps,
              coalesce(sum(play_seconds),0)::bigint AS secs
       FROM learner_speaking_opportunities WHERE learner_id = $1`, [OWNER_LEARNER]
    )).rows[0]

    const write = await asRole(c, 'authenticated', owner.user_id,
      `SELECT bump_phrases_spoken($1, $2, $3)`, [OWNER_LEARNER, TEST_COURSE, 7])
    assert('owner can execute bump_phrases_spoken on their own learner id', write.ok,
      write.ok ? '' : `${write.code} ${write.message}`)

    const ownAfter = (await c.query(
      `SELECT coalesce(sum(phrases_spoken),0)::bigint AS phr, coalesce(sum(opportunities),0)::bigint AS opps,
              coalesce(sum(play_seconds),0)::bigint AS secs
       FROM learner_speaking_opportunities WHERE learner_id = $1`, [OWNER_LEARNER]
    )).rows[0]
    assert('the write added exactly the delta to phrases_spoken',
      Number(ownAfter.phr) - Number(ownBefore.phr) === 7,
      `${ownBefore.phr} -> ${ownAfter.phr}`)
    assert('the write did NOT touch opportunities or play_seconds (parallel branch owns those)',
      ownAfter.opps === ownBefore.opps && ownAfter.secs === ownBefore.secs,
      `opps ${ownBefore.opps}->${ownAfter.opps}, secs ${ownBefore.secs}->${ownAfter.secs}`)

    // a second delta accumulates onto the SAME row rather than making a new one
    const rowsBefore = (await c.query(
      `SELECT count(*)::bigint AS n FROM learner_speaking_opportunities
       WHERE learner_id=$1 AND course_code=$2`, [OWNER_LEARNER, TEST_COURSE]
    )).rows[0].n
    await asRole(c, 'authenticated', owner.user_id,
      `SELECT bump_phrases_spoken($1, $2, $3)`, [OWNER_LEARNER, TEST_COURSE, 5])
    const dayRow = (await c.query(
      `SELECT count(*)::bigint AS n, coalesce(sum(phrases_spoken),0)::bigint AS phr
       FROM learner_speaking_opportunities WHERE learner_id=$1 AND course_code=$2`,
      [OWNER_LEARNER, TEST_COURSE]
    )).rows[0]
    assert('a second delta accumulates onto the same (learner, course, day) row',
      dayRow.n === rowsBefore && dayRow.phr === '12', `${dayRow.n} row(s), phr=${dayRow.phr}`)

    // zero/negative deltas are a clean no-op, not an error and not a row
    const noop = await asRole(c, 'authenticated', owner.user_id,
      `SELECT bump_phrases_spoken($1, $2, $3)`, [OWNER_LEARNER, '__canary_noop__', 0])
    const noopRows = (await c.query(
      `SELECT count(*)::bigint AS n FROM learner_speaking_opportunities WHERE course_code='__canary_noop__'`
    )).rows[0].n
    assert('a zero delta is a clean no-op and creates no row', noop.ok && noopRows === '0',
      `ok=${noop.ok} rows=${noopRows}`)

    // ── 4. LEAK CLOSED: another learner's id is rejected ─────────────────
    const attack = await asRole(c, 'authenticated', owner.user_id,
      `SELECT bump_phrases_spoken($1, $2, $3)`, [other.id, TEST_COURSE, 999])
    assert('writing ANOTHER learner id raises 42501 (ownership guard)',
      !attack.ok && attack.code === '42501', `${attack.code || 'no error'} ${attack.message || ''}`)

    // ── 5. anon cannot execute it at all ────────────────────────────────
    const anon = await asRole(c, 'anon', null,
      `SELECT bump_phrases_spoken($1, $2, $3)`, [OWNER_LEARNER, TEST_COURSE, 1])
    assert('anon cannot execute bump_phrases_spoken', !anon.ok,
      anon.ok ? 'EXECUTED — leak!' : `${anon.code} ${anon.message}`)
    // ...and stopped at the DOOR, not inside the body — 42501 "permission denied
    // for function" rather than a failure on the learners read within it.
    const acl = (await c.query(
      `SELECT has_function_privilege('anon', 'public.bump_phrases_spoken(uuid,text,bigint)', 'EXECUTE') AS anon_x,
              has_function_privilege('authenticated', 'public.bump_phrases_spoken(uuid,text,bigint)', 'EXECUTE') AS auth_x,
              (SELECT proacl::text FROM pg_proc WHERE proname='bump_phrases_spoken') AS acl`
    )).rows[0]
    assert('EXECUTE granted to authenticated and NOT to anon (deny-by-default)',
      acl.auth_x === true && acl.anon_x === false, acl.acl)

    // ── 6. own-row SELECT under RLS reads the new column ────────────────
    const ownRead = await asRole(c, 'authenticated', owner.user_id,
      `SELECT coalesce(sum(phrases_spoken),0)::bigint AS phr FROM learner_speaking_opportunities`)
    assert('owner reads their own phrases_spoken through RLS',
      ownRead.ok && Number(ownRead.rows[0].phr) >= 12,
      ownRead.ok ? `sum=${ownRead.rows[0].phr}` : ownRead.message)

    const victimRead = await asRole(c, 'authenticated', owner.user_id,
      `SELECT count(*)::bigint AS n FROM learner_speaking_opportunities WHERE learner_id = $1`, [other.id])
    assert('owner CANNOT read another learner\'s rows (own-row RLS still holds)',
      victimRead.ok && victimRead.rows[0].n === '0',
      victimRead.ok ? `${victimRead.rows[0].n} rows visible` : victimRead.message)

    // ── 7. the existing opportunities write path still works ────────────
    const legacy = await asRole(c, 'authenticated', owner.user_id,
      `SELECT bump_speaking_opportunities($1, $2, $3, $4)`, [OWNER_LEARNER, TEST_COURSE, 3, 30])
    const legacyRow = (await c.query(
      `SELECT opportunities::bigint AS o, play_seconds::bigint AS s, phrases_spoken::bigint AS p
       FROM learner_speaking_opportunities WHERE learner_id=$1 AND course_code=$2`,
      [OWNER_LEARNER, TEST_COURSE]
    )).rows[0]
    assert('bump_speaking_opportunities still writes opportunities + play_seconds unchanged',
      legacy.ok && legacyRow.o === '3' && legacyRow.s === '30',
      legacy.ok ? `opps=${legacyRow.o} secs=${legacyRow.s} phrases=${legacyRow.p}` : legacy.message)
    assert('...and it leaves phrases_spoken alone', legacyRow.p === '12', `phrases=${legacyRow.p}`)

    // ── clean up the canary rows before deciding ────────────────────────
    await c.query(`DELETE FROM learner_speaking_opportunities WHERE course_code LIKE '__canary%'`)

    // ── verdict ─────────────────────────────────────────────────────────
    const failed = checks.filter((x) => !x.ok)
    console.log(`\n${checks.length - failed.length}/${checks.length} green`)
    if (failed.length) {
      console.log('ROLLBACK — failures:', failed.map((f) => f.name).join('; '))
      await c.query('ROLLBACK')
      process.exit(1)
    }
    if (COMMIT) {
      await c.query('COMMIT')
      console.log('COMMITTED.')
    } else {
      await c.query('ROLLBACK')
      console.log('all green — rolled back (dry run). Re-run with --commit to apply.')
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('CANARY ERROR:', e.message)
    process.exit(1)
  } finally {
    await c.end()
  }
})()
