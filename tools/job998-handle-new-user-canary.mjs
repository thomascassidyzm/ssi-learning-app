/**
 * Job #998 — canary for supabase/migrations/20260914_handle_new_user_skip_linked_email.sql.
 *
 * The migration is gated (one DB behind dev/staging/prod, trigger on auth.users),
 * so it goes in by the canary method rather than a branch merge: apply in a
 * transaction, drive the real paths, assert both the fix and every legitimate
 * path still alive, COMMIT only if green.
 *
 * Paths asserted, both inside one rolled-back transaction:
 *   A. a brand-new address nobody holds  -> a learner stub IS still created
 *   B. an address another learner already verified -> NO stub; the client's
 *      link path claims the existing learner (this is the #646 recovery half)
 *   C. an auth user with no email -> still gets a learner, empty verified_emails
 */
import fs from 'node:fs'
import pg from '/home/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg/lib/index.js'
const url = fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql','utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()
const sql = fs.readFileSync('supabase/migrations/20260914_handle_new_user_skip_linked_email.sql','utf8')
const c = new pg.Client({ connectionString: url })
await c.connect()

const tag = 'job998canary'
const mk = (email) => c.query(
  `INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
   VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, '{}'::jsonb, '{}'::jsonb, now(), now())
   RETURNING id`, [email])
const learnerFor = async (id) => (await c.query('SELECT id, verified_emails FROM learners WHERE user_id = $1', [id])).rows

let green = false
await c.query('BEGIN')
try {
  await c.query(sql)

  // an existing learner that already holds the address (path B's precondition)
  const holderUser = (await mk(`${tag}-holder@example.invalid`)).rows[0].id
  await c.query(`UPDATE learners SET verified_emails = ARRAY['${tag}-second@example.invalid'] WHERE user_id = $1`, [holderUser])

  const a = (await mk(`${tag}-fresh@example.invalid`)).rows[0].id
  const b = (await mk(`${tag}-second@example.invalid`)).rows[0].id
  const cc = (await c.query(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated','', '{}'::jsonb,'{}'::jsonb, now(), now()) RETURNING id`)).rows[0].id

  const A = await learnerFor(a), B = await learnerFor(b), C = await learnerFor(cc)
  const fails = []
  if (A.length !== 1) fails.push(`A: a fresh address got ${A.length} learners, expected 1`)
  if (B.length !== 0) fails.push(`B: an already-verified address minted ${B.length} stub(s), expected 0`)
  if (C.length !== 1 || (C[0]?.verified_emails || []).length !== 0) fails.push(`C: an email-less auth user got ${JSON.stringify(C)}`)
  if (fails.length) { console.log('CANARY RED:\n  ' + fails.join('\n  ')); }
  else { console.log('CANARY GREEN: fresh address still gets a learner; an already-verified address gets no stub; an email-less user still gets an empty learner'); green = true }
} finally {
  await c.query('ROLLBACK')
}

if (green && process.env.APPLY === '1') {
  await c.query('BEGIN')
  await c.query(sql)
  await c.query('COMMIT')
  const { rows } = await c.query("select prosrc from pg_proc where proname='handle_new_user'")
  console.log('APPLIED:', rows[0].prosrc.includes('ANY (coalesce(l.verified_emails') ? 'live handle_new_user now skips the stub' : 'UNEXPECTED — live body does not carry the skip')
} else if (green) {
  console.log('not applied (set APPLY=1)')
} else {
  process.exitCode = 1
}
await c.end()
