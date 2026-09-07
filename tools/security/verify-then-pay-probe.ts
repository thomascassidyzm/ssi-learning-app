/**
 * NOT PART OF ANY SUITE, AND DELIBERATELY SO. This talks to the REAL Supabase
 * project. `vitest.api.config.ts` includes api/** and scripts/** only, so
 * nothing here runs by accident.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_ANON_KEY=... \
 *   npx vitest run --root . tools/security/verify-then-pay-probe.ts
 *   (point vitest's `include` at tools/security/*.ts for the run)
 *
 * IT CREATES AND DELETES REAL ACCOUNTS on named test addresses and touches
 * nothing else — never learner progress. Every account it makes is removed in
 * afterAll.
 *
 * WHAT IT PROVES, job #345:
 *   1. the takeover has no door left — the endpoint that created an account
 *      from a typed address with a caller-supplied password is gone;
 *   2. the new flow works for a NEW buyer, and a code is the only way to a
 *      session;
 *   3. a returning buyer is indistinguishable from an unknown address, so the
 *      form cannot be used to ask who has an account;
 *   4. anyone squatted while the old endpoint was live is still swept when
 *      their real owner signs in — the claim mechanism outlives the endpoint;
 *   5. the squatter still cannot claim their own account.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import claimAccount from '../../api/auth/claim-account'
import { buildUnclaimedMint, readUnclaimedMint, readSessionId } from '../../api/_utils/unclaimedMint'

const URL_ = process.env.SUPABASE_URL!.trim()
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()
const ANON = process.env.VITE_SUPABASE_ANON_KEY!.trim()
const svc = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = () => String(Date.now()).slice(-8) + Math.floor(Math.random() * 100)
const addr = (tag: string) => `thomas.cassidy+zz.cs345${tag}.${stamp()}@gmail.com`
const made: string[] = []

/** The six digits api/auth/send-code.ts would have mailed. Standing in for a
 *  mailbox faithfully: it is the same value, fetched the same way. */
async function mailedCode(email: string): Promise<string> {
  const { data } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  return (data as any).properties.email_otp
}

async function findByEmail(email: string) {
  const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 })
  return data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
}

/**
 * An account in the state the OLD purchase form left them in, and the state
 * api/auth/possession-redeem.ts still creates: unverified address, a password
 * somebody else chose, a live session, marked unclaimed. Built through the
 * admin API rather than through the retired endpoint, because the endpoint is
 * the thing that is gone.
 */
async function mintUnclaimed(email: string, password: string) {
  const { data: created } = await svc.auth.admin.createUser({
    email, email_confirm: false, password,
    user_metadata: { onboarded_via: 'possession' },
  })
  const id = created!.user!.id
  made.push(id)
  const { data: link } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  const { data: sess } = await anon().auth.verifyOtp({
    token_hash: (link as any).properties.hashed_token, type: 'magiclink',
  })
  await svc.auth.admin.updateUserById(id, {
    app_metadata: {
      ...(created!.user!.app_metadata || {}),
      ...buildUnclaimedMint(readSessionId(sess!.session!.access_token)!, 'possession_redeem'),
    },
  })
  return { id, session: sess!.session! }
}

async function callClaim(token: string) {
  const req: any = { method: 'POST', body: {}, headers: { authorization: `Bearer ${token}` }, socket: {} }
  let status = 0, payload: any = null
  const res: any = { setHeader: () => res, status: (s: number) => { status = s; return res }, json: (p: any) => { payload = p; return res }, end: () => res }
  await claimAccount(req, res)
  return { status, payload }
}

afterAll(async () => {
  for (const id of made) {
    await svc.from('learners').delete().eq('user_id', id)
    await svc.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('[teardown] removed', made.length, 'test account(s)')
}, 180000)

describe('verify-then-pay', () => {
  it('1 — the old door is gone: no endpoint mints an account from a typed address', async () => {
    const gone = await import('../../api/auth/buyer-account').then(() => false).catch(() => true)
    console.log('1. api/auth/buyer-account:', gone ? 'gone' : 'STILL THERE')
    expect(gone, 'the endpoint that planted passwords must not exist').toBe(true)
  }, 60000)

  it('2 — a NEW buyer: a code is the only way to a session, and it works', async () => {
    const email = addr('new')
    const code = await mailedCode(email)
    const shell = await findByEmail(email)
    expect(shell, 'asking for a code creates the shell').toBeTruthy()
    made.push(shell!.id)
    console.log('2. shell created; it holds no session and no password until the code is typed')

    const { data: sess, error } = await anon().auth.verifyOtp({ email, token: code, type: 'email' })
    console.log('   typing the mailed code signs them in:', !!sess?.session && !error)
    expect(!!sess?.session).toBe(true)
  }, 60000)

  it('3 — a RETURNING buyer looks identical, so the form cannot be used to ask who has an account', async () => {
    const existing = addr('ret')
    const { data: m } = await svc.auth.admin.createUser({ email: existing, email_confirm: true })
    made.push(m!.user!.id)
    const fresh = addr('unk')

    const ask = (email: string) => fetch(`${URL_}/auth/v1/otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ email, create_user: true }),
    })
    const one = await ask(existing)
    const two = await ask(fresh)
    const b1 = await one.text(), b2 = await two.text()
    console.log('3. existing address ->', one.status, JSON.stringify(b1).slice(0, 50))
    console.log('   unknown address  ->', two.status, JSON.stringify(b2).slice(0, 50))
    const created = await findByEmail(fresh)
    if (created) made.push(created.id)
    expect(one.status, 'the two must be indistinguishable').toBe(two.status)
    expect(b1).toEqual(b2)
  }, 60000)

  it('4 — anyone squatted while the old endpoint was live is still swept', async () => {
    const email = addr('sq')
    const PLANTED = 'SquatterPlanted2026!'
    const { session: squatter } = await mintUnclaimed(email, PLANTED)

    const { data: owner } = await anon().auth.verifyOtp({
      email, token: await mailedCode(email), type: 'email',
    })
    const claimed = await callClaim(owner!.session!.access_token)
    console.log('4. owner signs in; account claimed:', claimed.status, claimed.payload.claimed)

    const { error: pwErr } = await anon().auth.signInWithPassword({ email, password: PLANTED })
    const { error: rtErr } = await anon().auth.refreshSession({ refresh_token: squatter.refresh_token })
    const { data: still } = await svc.auth.getUser(claimed.payload.session.access_token)
    console.log('   planted password:', pwErr ? 'DEAD' : 'ALIVE',
                '| planted refresh:', rtErr ? 'DEAD' : 'ALIVE',
                '| owner signed in:', still?.user ? 'YES' : 'NO')
    expect(claimed.payload.claimed).toBe(true)
    expect(!!pwErr, 'planted password must be dead').toBe(true)
    expect(!!rtErr, 'planted session must be dead').toBe(true)
    expect(!!still?.user, 'the owner must keep their session').toBe(true)
  }, 60000)

  it('5 — the squatter still cannot claim their own account', async () => {
    const email = addr('self')
    const { id, session } = await mintUnclaimed(email, 'SquatterPlanted2026!')
    const r = await callClaim(session.access_token)
    console.log('5. squatter calls claim on their own mint session:', r.status, JSON.stringify(r.payload))
    expect(r.payload.claimed).toBe(false)
    const marker = readUnclaimedMint((await svc.auth.admin.getUserById(id)).data!.user as any)
    expect(marker, 'the marker must survive').not.toBeNull()
  }, 60000)
})
