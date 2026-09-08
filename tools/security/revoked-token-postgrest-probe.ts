/**
 * job #371 — THE REVOKED-TOKEN PROBE, at the layer that matters.
 *
 * Astra's claim 2 (2026-09-08, confirmed): the old takeover probe declared a
 * revoked access token "dead" by asking GoTrue (`svc.auth.getUser(token)`).
 * GoTrue says dead the instant a global sign-out runs. PostgREST does not ask
 * GoTrue — it checks the JWT's signature and expiry locally — so the same token
 * kept reading rows for the rest of its 3600 seconds. A probe that asserts at
 * GoTrue reports "closed" while the token still reads data.
 *
 * This probe asserts at PostgREST. The squat case ends by taking the OLD access
 * token and reading the account's own learners row through /rest/v1 — and
 * requires a 401. It also proves the schools contest rule end to end against
 * real GoTrue, through the real claim-account handler.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… VITE_SUPABASE_ANON_KEY=… \
 *   npx vitest run --root . -c tools/security/probe.vitest.config.ts tools/security/revoked-token-postgrest-probe.ts
 *
 * NOT PART OF ANY SUITE, deliberately: it talks to the REAL project, creates
 * accounts on @ssi-probe.invalid and deletes every one of them in afterAll.
 * vitest.api.config.ts includes api/** and scripts/** only.
 *
 * WHAT RED MEANS. Case A's "asked" step is red on any code before job #371
 * (the schools mint was never swept, so the owner's sign-in was ignored). The
 * PostgREST assertion stays red until supabase/secfix-toolkit/session_guard.sql
 * is applied to the database — that red is the truth about the token layer,
 * and this probe exists so it can no longer be papered over.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import claimAccount from '../../api/auth/claim-account'
import { buildUnclaimedMint, readSessionId } from '../../api/_utils/unclaimedMint'

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const svc = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const made: string[] = []

async function session(email: string) {
  const { data: link } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  const { data } = await anon().auth.verifyOtp({ token_hash: (link as any).properties.hashed_token, type: 'magiclink' })
  return data!.session!
}
async function callClaim(token: string, body: Record<string, unknown> = {}) {
  const req: any = { method: 'POST', body, headers: { authorization: `Bearer ${token}` }, socket: {} }
  let status = 0, payload: any = null
  const res: any = { setHeader() {}, status(s: number) { status = s; return res }, json(p: any) { payload = p; return res }, end() { return res } }
  await claimAccount(req, res)
  return { status, payload }
}
/** THE ASSERTION THAT MATTERS: the old token, against PostgREST, RLS and all. */
async function postgrestReads(token: string, uid: string) {
  const r = await fetch(`${URL_}/rest/v1/learners?select=id&user_id=eq.${uid}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  return { status: r.status, body: await r.text() }
}
/** A schools mint exactly as possession-redeem leaves it, plus a password
 *  set through the schools prompt: unproven address, marker stamped. */
async function mintSchoolsAccount(name: string) {
  const email = `job371-${name}-${Date.now()}@ssi-probe.invalid`
  const password = 'Planted-' + Math.random().toString(36).slice(2, 10)
  const { data: c, error } = await svc.auth.admin.createUser({ email, email_confirm: false, user_metadata: { onboarded_via: 'possession' } })
  if (error) throw new Error('createUser: ' + error.message)
  const uid = c.user!.id
  made.push(uid)
  await svc.from('learners').insert({ user_id: uid, display_name: name, needs_verification: true })
  // Password FIRST. In the real flow the teacher sets it from their own live
  // session (useAuth.updatePassword), which GoTrue keeps alive; an ADMIN
  // password write logs every session out, so it has to precede the mint
  // session here or the probe kills the very session it is about to test.
  await svc.auth.admin.updateUserById(uid, { password, user_metadata: { onboarded_via: 'possession', has_password: true } })
  const mint = await session(email)
  await svc.auth.admin.updateUserById(uid, {
    app_metadata: { ...(c.user!.app_metadata || {}), ...buildUnclaimedMint(readSessionId(mint.access_token)!, 'possession_redeem') },
  })
  return { email, password, uid, mint }
}

afterAll(async () => {
  for (const id of made) {
    await svc.from('learners').delete().eq('user_id', id)
    await svc.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log(`cleaned up ${made.length} probe accounts`)
})

describe('job #371 — contested schools accounts, asserted at the token layer', () => {
  it('A. THE SQUAT — a stranger planted a password on a teacher\'s address; the owner says "not me"', async () => {
    const a = await mintSchoolsAccount('squat')
    const owner = await session(a.email)
    const first = await callClaim(owner.access_token)
    console.log('A1 owner code sign-in ->', JSON.stringify(first.payload))
    expect(first.payload?.ask, 'the owner\'s code sign-in must be ASKED — not swept, not ignored').toBe(true)
    const pre = await postgrestReads(a.mint.access_token, a.uid)
    expect(pre.status, 'before the answer the squatter\'s token still reads: nothing decided yet').toBe(200)

    const contested = await callClaim(owner.access_token, { contest: true })
    expect(contested.payload?.claimed, '"not me" sweeps the account').toBe(true)
    const { error: pw } = await anon().auth.signInWithPassword({ email: a.email, password: a.password })
    expect(!!pw, 'the planted password is dead').toBe(true)
    const { error: rt } = await anon().auth.refreshSession({ refresh_token: a.mint.refresh_token })
    expect(!!rt, 'the squatter\'s refresh token is dead').toBe(true)
    const { data: gu } = await svc.auth.getUser(a.mint.access_token)
    expect(!!gu?.user, 'GoTrue: the squatter\'s access token is dead (where the OLD probe stopped)').toBe(false)
    const { data: fresh } = await svc.auth.getUser(contested.payload.session.access_token)
    expect(!!fresh?.user, 'the owner holds a fresh session').toBe(true)

    const post = await postgrestReads(a.mint.access_token, a.uid)
    console.log('A2 squatter\'s old access token against PostgREST after the sweep ->', post.status, post.body.slice(0, 60))
    expect(post.status, 'THE TOKEN LAYER: PostgREST must refuse the swept token (200 = session_guard.sql is not applied)').toBe(401)
  }, 90000)

  it('B. THE TEACHER — their own second device signs in by code and says "that was me"', async () => {
    const b = await mintSchoolsAccount('teacher')
    const device2 = await session(b.email)
    const first = await callClaim(device2.access_token)
    expect(first.payload?.ask, 'asked, exactly as in A — the server cannot tell the two apart, by design').toBe(true)
    const vouched = await callClaim(device2.access_token, { vouch: true })
    expect(vouched.payload?.vouched).toBe(true)
    expect(vouched.payload?.claimed).not.toBe(true)
    const { data: pw } = await anon().auth.signInWithPassword({ email: b.email, password: b.password })
    expect(!!pw?.session, 'THE #354 PROPERTY: the teacher\'s own password still works').toBe(true)
    const { data: rt } = await anon().auth.refreshSession({ refresh_token: b.mint.refresh_token })
    expect(!!rt?.session, 'the teacher\'s first device is still signed in').toBe(true)
    const { data: u } = await svc.auth.admin.getUserById(b.uid)
    expect(u.user!.app_metadata?.unclaimed_mint, 'the marker is retired — never asked again').toBeFalsy()
    const again = await callClaim(device2.access_token)
    expect(again.payload?.ask).not.toBe(true)
    expect(again.payload?.claimed).not.toBe(true)
    const { data: l } = await svc.from('learners').select('needs_verification, verified_emails').eq('user_id', b.uid).maybeSingle()
    expect(l?.needs_verification).toBe(false)
    expect((l?.verified_emails || []) as string[]).toContain(b.email)
  }, 90000)

  it('C. THE SQUATTER CANNOT SPEAK EITHER WORD', async () => {
    const c = await mintSchoolsAccount('words')
    const fromMint = await callClaim(c.mint.access_token, { contest: true })
    expect(fromMint.payload?.claimed).not.toBe(true)
    expect(fromMint.payload?.ask).not.toBe(true)
    const { data: pwSess } = await anon().auth.signInWithPassword({ email: c.email, password: c.password })
    const fromPw = await callClaim(pwSess!.session!.access_token, { vouch: true })
    expect(fromPw.payload?.vouched).not.toBe(true)
    const { data: u } = await svc.auth.admin.getUserById(c.uid)
    expect(!!u.user!.app_metadata?.unclaimed_mint, 'the marker survives both attempts').toBe(true)
  }, 90000)
})
