/**
 * job #375 — THE ON-DOMAIN TEACHER PATH, END TO END, AGAINST THE LIVE DATABASE.
 *
 * The one outcome that must never regress: a teacher arriving on their school's
 * teacher link, at an address on the school's claimed domain, gets in with ONE TAP
 * and NO EMAIL. Job #354 broke exactly this and wiped real teachers' passwords, so
 * it is asserted against the real handlers and the real database, not mocked.
 *
 * It creates one probe school on an unclaimable-nowhere-else domain, arrives on it,
 * and deletes every row it made in afterAll.
 *
 *   npx vitest run --root . -c tools/security/probe.vitest.config.ts \
 *     tools/security/ondomain-teacher-path-probe.ts
 *
 * NOT PART OF ANY SUITE, deliberately — it talks to the REAL project.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import possessionRedeem from '../../api/auth/possession-redeem'
import redeem from '../../api/code/redeem'
import { claimDomainForSchool, resolveArrival } from '../../api/_utils/schoolDomain'
import { ensureJoinCodesRegistered } from '../../api/_utils/schoolJoinCodes'

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const svc = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } })

const STAMP = Date.now()
// Our OWN domain: possession-redeem enforces a real mail exchanger (an invented
// .sch.uk is definitively MX-less and is refused, correctly), and this path never
// sends mail by design — so if it ever did, it would land in our own mailbox.
// The claim and both accounts are deleted in afterAll.
const DOMAIN = 'saysomethingin.com'
const made: { users: string[]; schools: string[] } = { users: [], schools: [] }
/** every mail this run would have caused, if any handler tried to send one */
const mailsSent: string[] = []

function call(handler: any, body: Record<string, unknown>, token?: string) {
  const req: any = {
    method: 'POST', body, query: {},
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: {}, connection: {},
  }
  let status = 0, payload: any = null
  const res: any = {
    setHeader() {}, status(s: number) { status = s; return res },
    json(p: any) { payload = p; return res }, end() { return res },
  }
  return handler(req, res).then(() => ({ status, payload }))
}

afterAll(async () => {
  for (const id of made.users) {
    await svc.from('learners').delete().eq('user_id', id)
    await svc.auth.admin.deleteUser(id).catch(() => {})
  }
  for (const id of made.schools) {
    await svc.from('school_identity_claims').delete().eq('school_id', id)
    await svc.from('invite_codes').delete().eq('school_id', id)
    await svc.from('schools').delete().eq('id', id)
  }
  console.log(`cleaned up ${made.users.length} accounts, ${made.schools.length} schools`)
})

describe('job #375 — the on-domain teacher arrives in one tap, with no email', () => {
  it('a school claims its founding admin\'s domain, and a teacher on it is proven from birth', async () => {
    // ── the school, and its founding admin on the domain ──
    const adminEmail = `head-${STAMP}@${DOMAIN}`
    const { data: adminUser } = await svc.auth.admin.createUser({ email: adminEmail, email_confirm: true })
    made.users.push(adminUser!.user!.id)
    const { data: school, error: sErr } = await svc
      .from('schools')
      .insert({ school_name: `Probe School ${STAMP}`, admin_user_id: adminUser!.user!.id })
      .select('id, teacher_join_code')
      .single()
    expect(sErr).toBeNull()
    made.schools.push(school!.id)
    // exactly what the real provisioning path does after the trigger mints the codes
    await ensureJoinCodesRegistered(svc, school!.id, adminUser!.user!.id)

    const claim = await claimDomainForSchool(svc, {
      schoolId: school!.id, email: adminEmail, source: 'founding_admin', addedBy: adminUser!.user!.id,
    })
    expect(claim.status).toBe('claimed')
    expect(claim.domain).toBe(DOMAIN)

    // ── the teacher arrives on the link, at an address on that domain ──
    const teacherEmail = `teacher-${STAMP}@${DOMAIN}`
    const arrival = await resolveArrival(svc, school!.id, teacherEmail)
    expect(arrival.onDomain).toBe(true)
    expect(arrival.via).toBe('domain')

    const pr = await call(possessionRedeem, {
      code: school!.teacher_join_code, email: teacherEmail, name: 'Probe Teacher',
    })
    console.log('possession-redeem ->', pr.status, 'onDomain=' + pr.payload?.onDomain, 'session=' + !!pr.payload?.session?.access_token)
    expect(pr.status).toBe(200)
    const token = pr.payload?.session?.access_token || pr.payload?.access_token
    expect(typeof token).toBe('string')
    // the endpoint returns tokens, not a user object — the subject IS the account
    const uid = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).sub as string
    expect(uid).toBeTruthy()
    made.users.push(uid)

    // ── ONE TAP: the session exists already; nothing asked for a code ──
    const rd = await call(redeem, { code: school!.teacher_join_code, codeKind: 'invite' }, token)
    console.log('redeem ->', rd.status, JSON.stringify(rd.payload))
    expect(rd.status).toBe(200)

    // ── NO EMAIL: proven from birth, never nudged to verify ──
    const { data: learner } = await svc
      .from('learners').select('needs_verification, verified_emails').eq('user_id', uid).single()
    expect(learner!.needs_verification).toBe(false)
    expect(learner!.verified_emails).toContain(teacherEmail.toLowerCase())
    expect(mailsSent).toEqual([])
  }, 60_000)
})
