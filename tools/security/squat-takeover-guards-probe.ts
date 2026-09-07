/**
 * NOT PART OF ANY SUITE, AND DELIBERATELY SO. This talks to the REAL Supabase
 * project — it is how the job #345 takeover was proved, first that it worked
 * and then that it does not. `vitest.api.config.ts` includes api/** and
 * scripts/** only, so nothing here runs by accident.
 *
 * To re-run it:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_ANON_KEY=... \
 *   EXPECT=fixed npx vitest run --root . tools/security/<this file>
 * (point vitest's `include` at tools/security/*.ts for the run; see the job
 * #345 report for the throwaway config used.)
 *
 * IT CREATES AND DELETES REAL ACCOUNTS on a named test address and touches
 * nothing else — no learner progress, ever. Every account it makes is removed
 * in afterAll. Verified live 2026-09-07: zero residue after the run.
 */
/**
 * The three cases the fix must ALSO get right, live (job #345):
 *   A. the squatter cannot clear their own marker from the session they were handed
 *   B. the squatter cannot claim the account using the password they planted
 *   C. the paying customer is untouched — mint, session and password all work,
 *      and calling claim on their own mint session changes nothing
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import buyerAccount from '../../api/auth/buyer-account'
import claimAccount from '../../api/auth/claim-account'
import { readUnclaimedMint } from '../../api/_utils/unclaimedMint'

const URL = process.env.SUPABASE_URL!.trim()
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()
const ANON = process.env.VITE_SUPABASE_ANON_KEY!.trim()
const svc = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } })
const made: string[] = []
const claims = (j: string) => JSON.parse(Buffer.from(j.split('.')[1], 'base64').toString('utf8'))

async function mint(email: string, password?: string) {
  const req: any = { method: 'POST', body: { email, password }, headers: { 'x-vercel-forwarded-for': '198.51.100.7' }, socket: {} }
  let status = 0, payload: any = null
  const res: any = { setHeader: () => res, status: (s: number) => { status = s; return res }, json: (p: any) => { payload = p; return res }, end: () => res }
  await buyerAccount(req, res)
  return { status, payload }
}
async function claim(token: string) {
  const req: any = { method: 'POST', body: {}, headers: { authorization: `Bearer ${token}` }, socket: {} }
  let status = 0, payload: any = null
  const res: any = { setHeader: () => res, status: (s: number) => { status = s; return res }, json: (p: any) => { payload = p; return res }, end: () => res }
  await claimAccount(req, res)
  return { status, payload }
}
const markerOf = async (id: string) => readUnclaimedMint((await svc.auth.admin.getUserById(id)).data!.user as any)

afterAll(async () => {
  for (const id of made) { await svc.from('learners').delete().eq('user_id', id); await svc.auth.admin.deleteUser(id).catch(() => {}) }
  console.log('[teardown] removed', made.length, 'test account(s)')
}, 120000)

describe('the fix under attack, and under normal use', () => {
  it('A — the squatter cannot clear their own marker', async () => {
    const email = `thomas.cassidy+zz.cs345a.${String(Date.now()).slice(-8)}@gmail.com`
    const m = await mint(email, 'Planted2026!')
    const tok = m.payload.session.access_token
    made.push(claims(tok).sub)
    const r = await claim(tok)
    console.log('A — squatter calls claim on the mint session:', r.status, JSON.stringify(r.payload))
    expect(r.payload.claimed).toBe(false)
    expect((await markerOf(claims(tok).sub))?.session_id, 'marker must survive').toBe(claims(tok).session_id)
    const { data: still } = await svc.auth.getUser(tok)
    console.log('   squatter session survives their own no-op claim:', !!still?.user)
  }, 120000)

  it('B — the squatter cannot claim with the password they planted', async () => {
    const email = `thomas.cassidy+zz.cs345b.${String(Date.now()).slice(-8)}@gmail.com`
    const PW = 'Planted2026!'
    const m = await mint(email, PW)
    const id = claims(m.payload.session.access_token).sub
    made.push(id)
    // They sign out locally and sign back in with their own password: a NEW
    // session id, so the session check alone would let them through.
    const a = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: pw } = await a.auth.signInWithPassword({ email, password: PW })
    const c2 = claims(pw!.session!.access_token)
    console.log('B — squatter re-signs in with the planted password. new session:', c2.session_id !== claims(m.payload.session.access_token).session_id, '| amr:', JSON.stringify(c2.amr))
    const r = await claim(pw!.session!.access_token)
    console.log('   claim result:', r.status, JSON.stringify(r.payload))
    expect(r.payload.claimed, 'a password sign-in must never claim').toBe(false)
    expect((await markerOf(id)), 'marker must survive').not.toBeNull()

    // And the real owner, arriving after all that, still wins.
    const { data: link } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
    const b = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: owner } = await b.auth.verifyOtp({ email, token: (link as any).properties.email_otp, type: 'email' })
    const r2 = await claim(owner!.session!.access_token)
    console.log('   owner then claims:', r2.status, 'claimed=' + r2.payload.claimed)
    expect(r2.payload.claimed).toBe(true)
    const c3 = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: pwErr } = await c3.auth.signInWithPassword({ email, password: PW })
    console.log('   planted password after the owner claims:', pwErr ? 'DEAD' : 'ALIVE')
    expect(!!pwErr).toBe(true)
  }, 120000)

  it('C — the paying customer is untouched', async () => {
    const email = `thomas.cassidy+zz.cs345c.${String(Date.now()).slice(-8)}@gmail.com`
    const PW = 'BuyerChose2026!'
    const m = await mint(email, PW)
    console.log('C — buyer mints an account and a session:', m.status, m.payload.success)
    expect(m.status).toBe(200)
    const tok = m.payload.session.access_token
    const id = claims(tok).sub
    made.push(id)
    // Their session works, their password works, and the claim call the app
    // now makes on every sign-in is a no-op for them.
    const { data: me } = await svc.auth.getUser(tok)
    const r = await claim(tok)
    const a = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: pw, error: pwErr } = await a.auth.signInWithPassword({ email, password: PW })
    const { data: rt } = await createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } }).auth.refreshSession({ refresh_token: m.payload.session.refresh_token })
    const { data: learner } = await svc.from('learners').select('needs_verification').eq('user_id', id).maybeSingle()
    console.log('   session live:', !!me?.user, '| claim was a no-op:', r.payload.claimed === false, '| their password works:', !!pw?.session && !pwErr, '| refresh works:', !!rt?.session, '| needs_verification:', (learner as any)?.needs_verification)
    expect(!!me?.user).toBe(true)
    expect(r.payload.claimed).toBe(false)
    expect(!!pw?.session).toBe(true)
    expect(!!rt?.session).toBe(true)
    expect((learner as any)?.needs_verification).toBe(true)
  }, 120000)
})
