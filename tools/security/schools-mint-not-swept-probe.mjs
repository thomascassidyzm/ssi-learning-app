// job #354 — THE SCHOOLS LOCKOUT PROBE, against a live environment.
//
// Ran against production twice on 2026-09-07: before the fix the schools case
// came back "password DEAD, other device DEAD" (the live breakage), after it
// all four cases PASS. It proves case 2 the only way that counts — by actually
// signing in with the teacher's password AFTER the code sign-in.
//
//   SB_URL=… SB_SRK=… SB_ANON=… BASE=https://saysomethingin.app node tools/security/schools-mint-not-swept-probe.mjs
//
// It creates users on @ssi-probe.invalid and deletes each one at the end.

import { createClient } from '@supabase/supabase-js'

const URL = process.env.SB_URL, SRK = process.env.SB_SRK, ANON = process.env.SB_ANON
const BASE = process.env.BASE // e.g. https://saysomethingin.app
const admin = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

const sid = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).session_id } catch { return null } }

async function runCase({ name, mintedBy, expectSwept }) {
  const email = `job354-probe-${name}-${Date.now()}@ssi-probe.invalid`
  const password = 'Teacher-Set-This-' + Math.random().toString(36).slice(2, 10)
  const out = { name, mintedBy, email }

  // 1. Mint the account the way possession-redeem does: session handed out, marker stamped.
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (cErr) return { ...out, FAILED: 'createUser: ' + cErr.message }
  const uid = created.user.id

  // The "mint session" — the one the flow handed out.
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data: mintSess } = await anon().auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
  const mintSessionId = sid(mintSess.session.access_token)

  const marker = mintedBy === null
    ? { session_id: mintSessionId, minted_at: new Date().toISOString() }   // provenance ABSENT
    : { session_id: mintSessionId, minted_by: mintedBy, minted_at: new Date().toISOString() }
  await admin.auth.admin.updateUserById(uid, { app_metadata: { unclaimed_mint: marker } })

  // 2. The teacher sets their own password (SchoolsPasswordPrompt).
  await admin.auth.admin.updateUserById(uid, { password, user_metadata: { has_password: true } })

  // sanity: the password works before anything else happens
  const pre = await anon().auth.signInWithPassword({ email, password })
  out.passwordWorksBefore = !!pre.data?.session

  // a second device, already signed in, whose session must survive
  const { data: link2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data: otherDevice } = await anon().auth.verifyOtp({ token_hash: link2.properties.hashed_token, type: 'magiclink' })

  // 3. They sign in on a NEW device by emailed code.
  const { data: link3 } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data: codeSess } = await anon().auth.verifyOtp({ token_hash: link3.properties.hashed_token, type: 'magiclink' })
  out.codeSignInSessionId = sid(codeSess.session.access_token)

  // 4. …and the browser calls claim-account, as useAuth does on every SIGNED_IN.
  const r = await fetch(`${BASE}/api/auth/claim-account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${codeSess.session.access_token}`, 'Content-Type': 'application/json' },
  })
  out.claimStatus = r.status
  out.claimBody = await r.json().catch(() => null)

  // 5. THE QUESTION: does the password they set still work?
  const post = await anon().auth.signInWithPassword({ email, password })
  out.passwordWorksAfter = !!post.data?.session
  out.passwordError = post.error?.message || null

  // and does the other device's session survive?
  const { data: refreshed } = await anon().auth.refreshSession({ refresh_token: otherDevice.session.refresh_token })
  out.otherDeviceSurvives = !!refreshed?.session

  out.EXPECTED = expectSwept ? 'password DEAD, other device DEAD' : 'password ALIVE, other device ALIVE'
  out.VERDICT = (out.passwordWorksAfter === !expectSwept && out.otherDeviceSurvives === !expectSwept) ? 'PASS' : 'FAIL'

  await admin.auth.admin.deleteUser(uid).catch(() => {})
  return out
}

const cases = [
  { name: 'schools', mintedBy: 'possession_redeem', expectSwept: false },
  { name: 'schools-adopt', mintedBy: 'possession_adopt', expectSwept: false },
  { name: 'buyer', mintedBy: 'buyer_account', expectSwept: true },
  { name: 'noprovenance', mintedBy: null, expectSwept: false },
]
const only = process.argv[2]
for (const c of cases) {
  if (only && c.name !== only) continue
  console.log(JSON.stringify(await runCase(c), null, 1))
}
