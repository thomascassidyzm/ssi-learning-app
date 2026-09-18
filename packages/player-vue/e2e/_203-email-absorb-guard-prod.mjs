// Job #203 — BLOCKER 1 live production proof of commit 2aa91c904.
// isAbsorbableStub() must refuse to absorb an account holding ANY
// user_entitlements or subscriptions row (even expired/cancelled), and must
// still absorb a genuinely empty stub. Run against PRODUCTION.
import fs from 'node:fs'
const BASE = process.env.BASE || 'https://saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8').match(/^(?:VITE_)?SUPABASE_ANON_KEY=(.+)$/m)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const db = (p, init) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...init }).then(async r => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } })
const link = (email) => fetch(`${U}/auth/v1/admin/generate_link`, { method:'POST', headers:H, body: JSON.stringify({ type:'magiclink', email }) }).then(r => r.json())
const sessionFor = async (email) => {
  const l = await link(email); if (!l.hashed_token) throw new Error('no link: '+JSON.stringify(l))
  const v = await fetch(`${U}/auth/v1/verify`, { method:'POST', headers:{ apikey: ANON, 'Content-Type':'application/json' }, body: JSON.stringify({ type:'email', email, token: l.email_otp }) }).then(r=>r.json())
  if (!v.access_token) throw new Error('verify failed: '+JSON.stringify(v))
  return v
}
const authUser = (id) => fetch(`${U}/auth/v1/admin/users/${id}`, { headers: H }).then(async r => ({ status: r.status, body: await r.json().catch(()=>null) }))
const delUser = (id) => fetch(`${U}/auth/v1/admin/users/${id}`, { method:'DELETE', headers: H }).then(r => r.status)

const fails = []
const check = (ok, what) => { console.log(`${ok?'PASS':'FAIL'}  ${what}`); if (!ok) fails.push(what) }
const stamp = Date.now().toString().slice(-7)
const mk = (n) => `zz-203-${n}-${stamp}@ssi-probe.test`
const ledger = []   // {kind, id}

console.log(`BASE=${BASE}`)
console.log('prod version:', await fetch(`${BASE}/version.json`).then(r=>r.text()))

// ── account A: the claimant
const A = mk('claimant')
const sessA = await sessionFor(A)
ledger.push({ kind:'auth', id: sessA.user.id, label:A })
const [lA] = await db(`learners?user_id=eq.${sessA.user.id}&select=id`)
if (!lA) throw new Error('no learner row for A')
ledger.push({ kind:'learner', id: lA.id, label:A })
console.log(`claimant  : ${A}  auth=${sessA.user.id} learner=${lA.id}`)

// ── mint a target stub account and return its ids
async function mintStub(name) {
  const email = mk(name)
  const l = await link(email); if (!l.hashed_token) throw new Error('no link for '+email)
  const u = await fetch(`${U}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, { headers:H }).then(r=>r.json())
  const au = (u.users||[]).find(x => (x.email||'').toLowerCase() === email)
  if (!au) throw new Error('stub auth user not found for '+email)
  const [lr] = await db(`learners?user_id=eq.${au.id}&select=id,verified_emails`)
  if (!lr) throw new Error('stub learner row not created for '+email)
  ledger.push({ kind:'auth', id: au.id, label: email }); ledger.push({ kind:'learner', id: lr.id, label: email })
  console.log(`stub ${name.padEnd(9)}: ${email}  auth=${au.id} learner=${lr.id} verified=${JSON.stringify(lr.verified_emails)}`)
  return { email, authId: au.id, learnerId: lr.id }
}

// POST the real production endpoint, as A, claiming `email`
async function claim(email) {
  const otp = (await link(email)).email_otp
  const r = await fetch(`${BASE}/api/email/verify`, { method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${sessA.access_token}` },
    body: JSON.stringify({ email, token: otp }) })
  const body = await r.json().catch(()=>null)
  console.log(`   POST ${BASE}/api/email/verify {email:${email}} -> ${r.status} ${JSON.stringify(body)}`)
  return { status: r.status, body }
}

// ════ CASE 1 — stub holding an EXPIRED user_entitlements row
console.log('\n── CASE 1: target holds an EXPIRED user_entitlements row')
const s1 = await mintStub('ent')
const ent = await db('user_entitlements', { method:'POST', headers:{...H, Prefer:'return=representation'},
  body: JSON.stringify({ learner_id: s1.learnerId, access_type:'full', source:'admin',
    granted_courses:['zzz_probe'], expires_at:'2020-01-01T00:00:00Z' }) })
check(Array.isArray(ent) && ent[0]?.id, `expired entitlement row created (${JSON.stringify(ent).slice(0,120)})`)
if (ent[0]?.id) ledger.push({ kind:'entitlement', id: ent[0].id, label:s1.email })
const r1 = await claim(s1.email)
check(r1.status === 409 && r1.body?.code === 'email_on_other_account', 'CASE1 refused with 409 email_on_other_account')
const a1 = await authUser(s1.authId)
check(a1.status === 200, 'CASE1 target auth user still exists')
const l1 = await db(`learners?id=eq.${s1.learnerId}&select=id`)
check(Array.isArray(l1) && l1.length === 1, 'CASE1 target learner row still exists')
const e1 = await db(`user_entitlements?learner_id=eq.${s1.learnerId}&select=id,expires_at`)
check(Array.isArray(e1) && e1.length === 1, `CASE1 entitlement row still exists (${JSON.stringify(e1)})`)

// ════ CASE 2 — stub holding a CANCELLED subscriptions row
console.log('\n── CASE 2: target holds a CANCELLED subscriptions row')
const s2 = await mintStub('sub')
const sub = await db('subscriptions', { method:'POST', headers:{...H, Prefer:'return=representation'},
  body: JSON.stringify({ learner_id: s2.learnerId, status:'cancelled', provider:'lemonsqueezy', plan_name:'zz-probe' }) })
check(Array.isArray(sub) && sub[0]?.id, `cancelled subscription row created (${JSON.stringify(sub).slice(0,120)})`)
if (sub[0]?.id) ledger.push({ kind:'subscription', id: sub[0].id, label:s2.email })
const r2 = await claim(s2.email)
check(r2.status === 409 && r2.body?.code === 'email_on_other_account', 'CASE2 refused with 409 email_on_other_account')
const a2 = await authUser(s2.authId)
check(a2.status === 200, 'CASE2 target auth user still exists')
const l2 = await db(`learners?id=eq.${s2.learnerId}&select=id`)
check(Array.isArray(l2) && l2.length === 1, 'CASE2 target learner row still exists')
const su2 = await db(`subscriptions?learner_id=eq.${s2.learnerId}&select=id,status`)
check(Array.isArray(su2) && su2.length === 1, `CASE2 subscription row still exists (${JSON.stringify(su2)})`)

// ════ CASE 3 — CONTROL: genuinely empty stub IS absorbed
console.log('\n── CASE 3 (CONTROL): genuinely empty stub, no grant, no subscription')
const s3 = await mintStub('empty')
const r3 = await claim(s3.email)
check(r3.status === 200 && r3.body?.success === true, 'CONTROL absorbed: 200 success')
const a3 = await authUser(s3.authId)
check(a3.status === 404, `CONTROL stub auth user deleted (GET -> ${a3.status})`)
const l3 = await db(`learners?id=eq.${s3.learnerId}&select=id`)
check(Array.isArray(l3) && l3.length === 0, 'CONTROL stub learner row deleted')
const [aAfter] = await db(`learners?id=eq.${lA.id}&select=verified_emails`)
check((aAfter?.verified_emails||[]).includes(s3.email), `CONTROL address now on the claimant (${JSON.stringify(aAfter?.verified_emails)})`)

// ════ TEARDOWN
console.log('\n── TEARDOWN (FK order: grant/sub rows -> learners -> auth users)')
for (const e of ledger.filter(x=>x.kind==='entitlement')) console.log('  del entitlement', e.id, await fetch(`${U}/rest/v1/user_entitlements?id=eq.${e.id}`, {method:'DELETE',headers:H}).then(r=>r.status))
for (const e of ledger.filter(x=>x.kind==='subscription')) console.log('  del subscription', e.id, await fetch(`${U}/rest/v1/subscriptions?id=eq.${e.id}`, {method:'DELETE',headers:H}).then(r=>r.status))
for (const e of ledger.filter(x=>x.kind==='learner')) console.log('  del learner', e.id, e.label, await fetch(`${U}/rest/v1/learners?id=eq.${e.id}`, {method:'DELETE',headers:H}).then(r=>r.status))
for (const e of ledger.filter(x=>x.kind==='auth')) console.log('  del auth', e.id, e.label, await delUser(e.id))

let residue = 0
for (const e of ledger.filter(x=>x.kind==='auth')) { const a = await authUser(e.id); if (a.status !== 404) { residue++; console.log('  RESIDUE auth', e.id) } }
for (const e of ledger.filter(x=>x.kind==='learner')) { const r = await db(`learners?id=eq.${e.id}&select=id`); if (Array.isArray(r) && r.length) { residue++; console.log('  RESIDUE learner', e.id) } }
const strays = await db(`learners?or=(${ledger.filter(x=>x.kind==='learner'||x.kind==='auth').length?'':''}verified_emails.cs.{"${A}"})&select=id`)
for (const e of ledger.filter(x=>x.kind==='entitlement')) { const r = await db(`user_entitlements?id=eq.${e.id}&select=id`); if (Array.isArray(r)&&r.length) { residue++; console.log('  RESIDUE entitlement', e.id) } }
for (const e of ledger.filter(x=>x.kind==='subscription')) { const r = await db(`subscriptions?id=eq.${e.id}&select=id`); if (Array.isArray(r)&&r.length) { residue++; console.log('  RESIDUE subscription', e.id) } }
console.log(`TEARDOWN: ${ledger.length} rows created, ${residue} residue. ${residue===0 ? 'DELETION CONFIRMED — every probe auth user, learner, entitlement and subscription row is gone.' : 'INCOMPLETE'}`)
check(residue === 0, 'teardown clean')

console.log(fails.length ? `\nRED — ${fails.length} check(s) failed:\n  ${fails.join('\n  ')}` : '\nGREEN — the guard holds on production, and the control proves absorption still happens')
process.exitCode = fails.length ? 1 : 0
