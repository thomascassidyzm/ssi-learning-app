#!/usr/bin/env node
// Apply supabase/migrations/20260908_handbook_questions.sql to the live DB in
// ONE transaction, canary the posture, and COMMIT only with --commit and only
// if every assertion is green. Default is rollback (RLS doctrine rule 3).
//   node tools/handbook/apply-handbook-questions.mjs [--commit]
import { readFileSync } from 'node:fs'
import pg from '/home/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg/lib/index.js'
const url = readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql', 'utf8').match(/DATABASE_URL=["']?([^"'\n]+)/)[1]
const sql = readFileSync(new URL('../../supabase/migrations/20260908_handbook_questions.sql', import.meta.url), 'utf8')
const COMMIT = process.argv.includes('--commit')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
let ok = true
const check = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? ' :: ' + detail : ''}`); if (!pass) ok = false }
try {
  await c.query('BEGIN')
  await c.query(sql)
  const rls = await c.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.handbook_questions'::regclass")
  check('RLS enabled', rls.rows[0]?.relrowsecurity === true)
  const pol = await c.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'handbook_questions'")
  check('zero client policies', pol.rows[0].n === 0, `${pol.rows[0].n}`)
  for (const role of ['anon', 'authenticated']) {
    const r = await c.query("SELECT has_table_privilege($1, 'public.handbook_questions', 'SELECT') AS s, has_table_privilege($1, 'public.handbook_questions', 'INSERT') AS i", [role])
    check(`${role} cannot read or write`, r.rows[0].s === false && r.rows[0].i === false)
  }
  const svc = await c.query("SELECT has_table_privilege('service_role', 'public.handbook_questions', 'INSERT') AS i, has_table_privilege('service_role', 'public.handbook_questions', 'UPDATE') AS u")
  check('service_role can insert and update', svc.rows[0].i && svc.rows[0].u)
  // A legitimate write path stays alive: insert, read back, delete — inside the txn.
  const ins = await c.query("INSERT INTO public.handbook_questions (auth_user_id, persona, route, env, question) VALUES ('canary', 'teacher', '/schools/handbook', 'dev', 'canary question?') RETURNING id, status")
  check('insert defaults status=new', ins.rows[0].status === 'new')
  let refused = false
  try { await c.query('SAVEPOINT s'); await c.query("INSERT INTO public.handbook_questions (auth_user_id, persona, route, question) VALUES ('canary', 'teacher', '/x', 'no')") } catch { refused = true; await c.query('ROLLBACK TO SAVEPOINT s') }
  check('a two-letter question is refused by the CHECK', refused)
  await c.query('DELETE FROM public.handbook_questions WHERE auth_user_id = $1', ['canary'])
  if (ok && COMMIT) { await c.query('COMMIT'); console.log('COMMITTED') }
  else { await c.query('ROLLBACK'); console.log(ok ? 'ROLLED BACK (dry run — pass --commit)' : 'ROLLED BACK — a check failed') }
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('ERROR', e.message); ok = false
} finally { await c.end() }
process.exit(ok ? 0 : 1)
