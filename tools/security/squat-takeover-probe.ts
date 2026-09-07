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
 * LIVE ATTACK PROBE — buyer-account squat takeover (job #345).
 *
 * Runs the REAL attack against the REAL Supabase project with a named test
 * address, then tears every row down. Nothing here touches learner progress.
 *
 * The "mailbox owner" step uses the service role's generateLink to read the
 * SAME six digits api/auth/send-code.ts would have mailed. That is a faithful
 * stand-in for receiving the mail: the code is identical, and the client step
 * (anon verifyOtp type:'email') is byte-for-byte what SignInModal.vue does.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import buyerAccount from '../../api/auth/buyer-account'

const URL = process.env.SUPABASE_URL!.trim()
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()
const ANON = process.env.VITE_SUPABASE_ANON_KEY!.trim()
const svc = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } })

const STAMP = String(Date.now()).slice(-8)
const VICTIM = `thomas.cassidy+zz.cs345.${STAMP}@gmail.com`
const ATTACKER_PW = 'AttackerPlanted2026!'

const made: string[] = []

async function callBuyerAccount(body: any) {
  const req: any = { method: 'POST', body, headers: { 'x-vercel-forwarded-for': '203.0.113.' + (STAMP.slice(-2)) }, socket: {} }
  let status = 0, payload: any = null
  const res: any = {
    setHeader() { return res },
    status(s: number) { status = s; return res },
    json(p: any) { payload = p; return res },
    end() { return res },
  }
  await buyerAccount(req, res)
  return { status, payload }
}

function claims(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'))
}

afterAll(async () => {
  for (const id of made) {
    await svc.from('learners').delete().eq('user_id', id)
    await svc.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('[teardown] removed', made.length, 'test account(s)')
}, 120000)

describe('buyer-account squat takeover', () => {
  it('runs the real attack end to end', async () => {
    console.log('\nVICTIM ADDRESS:', VICTIM)

    // ── STEP 1. ATTACKER squats the address with a password of their choosing.
    const mint = await callBuyerAccount({ email: VICTIM, password: ATTACKER_PW })
    console.log('STEP 1 — attacker POSTs buyer-account:', mint.status, mint.payload?.success ? 'session returned' : JSON.stringify(mint.payload))
    expect(mint.status).toBe(200)
    const attackerAccess = mint.payload.session.access_token as string
    const attackerRefresh = mint.payload.session.refresh_token as string
    const c = claims(attackerAccess)
    console.log('   attacker JWT claims of interest:', JSON.stringify({ sub: c.sub, session_id: c.session_id, amr: c.amr, aal: c.aal }))
    made.push(c.sub)

    // ── STEP 2. REAL OWNER proves the mailbox, exactly as SignInModal does.
    const { data: link } = await svc.auth.admin.generateLink({ type: 'magiclink', email: VICTIM })
    const otp = (link as any)?.properties?.email_otp as string
    console.log('STEP 2 — owner receives the mailed code:', otp ? 'yes' : 'NO CODE')
    const ownerClient = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: ownerSess, error: ownerErr } = await ownerClient.auth.verifyOtp({ email: VICTIM, token: otp, type: 'email' })
    console.log('   owner OTP sign-in:', ownerErr ? 'FAILED ' + ownerErr.message : 'signed in')
    expect(ownerSess?.session).toBeTruthy()
    const oc = claims(ownerSess!.session!.access_token)
    console.log('   owner JWT claims of interest:', JSON.stringify({ sub: oc.sub, session_id: oc.session_id, amr: oc.amr, aal: oc.aal }))
    console.log('   SAME ACCOUNT AS THE ATTACKER?', oc.sub === c.sub)

    // ── (post-fix only) whatever the app does to claim the account runs here.
    let ownerStillIn = false
    const claimMod = await import('../../api/auth/claim-account').catch(() => null)
    if (claimMod) {
      const req: any = { method: 'POST', body: {}, headers: { authorization: `Bearer ${ownerSess!.session!.access_token}` }, socket: {} }
      let status = 0, payload: any = null
      const res: any = { setHeader: () => res, status: (s: number) => { status = s; return res }, json: (p: any) => { payload = p; return res }, end: () => res }
      await (claimMod as any).default(req, res)
      console.log('   CLAIM endpoint ran:', status, JSON.stringify(payload)?.slice(0, 160))
      if (payload?.session?.access_token) {
        const nc = claims(payload.session.access_token)
        const { data: still } = await svc.auth.getUser(payload.session.access_token)
        console.log('   OWNER KEPT A LIVE SESSION:', !!still?.user, '| new session_id:', nc.session_id)
        ownerStillIn = !!still?.user
      }
    } else {
      console.log('   CLAIM endpoint: does not exist (pre-fix)')
    }

    // ── STEP 3. Do the attacker's planted credentials still work?
    const probeA = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: pw, error: pwErr } = await probeA.auth.signInWithPassword({ email: VICTIM, password: ATTACKER_PW })
    const passwordWorks = !!pw?.session && !pwErr
    console.log('\nSTEP 3a — PLANTED PASSWORD still signs in:', passwordWorks, pwErr ? `(${pwErr.message})` : '')

    const probeB = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: rt, error: rtErr } = await probeB.auth.refreshSession({ refresh_token: attackerRefresh })
    const refreshWorks = !!rt?.session && !rtErr
    console.log('STEP 3b — PLANTED REFRESH TOKEN still renews:', refreshWorks, rtErr ? `(${rtErr.message})` : '')

    const { data: au, error: auErr } = await svc.auth.getUser(attackerAccess)
    const accessWorks = !!au?.user && !auErr
    console.log('STEP 3c — PLANTED ACCESS TOKEN still resolves:', accessWorks, auErr ? `(${auErr.message})` : '')

    console.log('\nRESULT:', (passwordWorks || refreshWorks || accessWorks) ? '*** TAKEOVER STANDS ***' : 'planted credentials are ALL dead')

    if (process.env.EXPECT === 'fixed') {
      // The owner must still be signed in — securing the account must not
      // lock the person who just proved the mailbox out of it.
      expect(passwordWorks, 'planted password must be dead').toBe(false)
      expect(refreshWorks, 'planted refresh token must be dead').toBe(false)
      expect(accessWorks, 'planted access token must be dead').toBe(false)
      expect(ownerStillIn, 'the mailbox owner must still be signed in').toBe(true)
    }
  }, 120000)
})
