// Job #195 — the no-code school door under Tom's three security rulings,
// end to end on a deployed build, as a probe head:
//   1. set up a school with no code and land in the dashboard (job #188 flow);
//   2. RULING 1: a class's pupil link and pupil code are refused while the
//      mailbox is unproved, with the line that names what unblocks it;
//   3. confirm the code in the banner — RULING 2: the session is still alive
//      afterwards and the door's unclaimed-mint marker is retired;
//   4. RULING 1 again: the same pupil link and code are now open;
//   5. RULING 3: with a second session minted out of band before proof, the
//      banner shows the one line; Keep is the default and calls nothing.
// Then every probe row is deleted.
//
//   BASE=https://staging.saysomethingin.app EMAIL=head+probe@example.org node e2e/_195-enrol-gate-proof.mjs
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const EMAIL = process.env.EMAIL
const SECOND = process.env.SECOND_SESSION !== '0'
if (!EMAIL) { console.error('EMAIL is required'); process.exit(1) }
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth:{persistSession:false} })
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY, { auth:{persistSession:false, autoRefreshToken:false} })
const results = []
const check = (name, ok, detail='') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const ledger = { userId: null, schoolId: null, classId: null, codeId: null }

const browser = await chromium.launch({ args: ['--disable-gpu','--no-sandbox'], ...(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {}) })
const ctx = await browser.newContext({ viewport:{width:1200,height:900} })
const p = await ctx.newPage()
try {
  // 1. The door.
  await p.goto(`${BASE}/schools1`, { waitUntil:'domcontentloaded', timeout:60000 })
  await p.waitForTimeout(6000)
  try {
    await p.locator('.fs-trigger').first().click({ timeout: 5000 })
    await p.waitForTimeout(600)
    const opt = p.locator('[role=option], .fs-option, .fs-opt, .fs-item, .fs-list button, .fs-menu button').first()
    if (await opt.count()) await opt.click({ timeout: 5000 })
    else await p.getByText(/Welsh|Cymraeg/).first().click({ timeout: 5000 })
    await p.waitForTimeout(1000)
  } catch { /* heritage door preselects */ }
  await p.locator('#ob-email').fill(EMAIL)
  await p.locator('button', { hasText: /Set up my school/ }).first().click()
  await p.waitForTimeout(15000)
  check('door lands in the dashboard with no code typed', /\/schools|\/org\//.test(p.url()) && !(await p.locator('body').innerText()).includes('Check your email'), p.url())
  check('mailbox banner shown', await p.locator('.mailbox-banner').count() > 0)

  // Find the probe rows.
  const { data: link0 } = await admin.auth.admin.generateLink({ type:'magiclink', email: EMAIL })
  ledger.userId = link0?.user?.id
  const { data: school } = await admin.from('schools').select('id, school_name').eq('admin_user_id', ledger.userId).maybeSingle()
  ledger.schoolId = school?.id
  check('school provisioned on the unproved founder', !!ledger.schoolId, school?.school_name)
  const { data: u0 } = await admin.auth.admin.getUserById(ledger.userId)
  check('founder is unproven and stamped by the door', u0?.user?.user_metadata?.setup_door === 'school' && u0?.user?.user_metadata?.email_confirmed_manually !== true && !!u0?.user?.app_metadata?.unclaimed_mint)

  // A class with a pupil code, the way create-class would leave it.
  const code = 'PRB-' + String(Math.floor(100 + Math.random()*900))
  const { data: cls, error: clsErr } = await admin.from('classes').insert({ school_id: ledger.schoolId, teacher_user_id: ledger.userId, class_name: 'Probe 3B', course_code: 'cym_for_eng', student_join_code: code }).select('id').single()
  if (clsErr) console.log('class insert:', clsErr.message)
  ledger.classId = cls?.id
  const { data: inv, error: invErr } = await admin.from('invite_codes').insert({ code, code_type: 'student', grants_class_id: ledger.classId, created_by: ledger.userId, is_active: true }).select('id').single()
  if (invErr) console.log('invite insert:', invErr.message)
  ledger.codeId = inv?.id

  // 2. RULING 1 — held.
  const byCode = async () => { const r = await fetch(`${BASE}/api/teacher/by-code?code=${code}`); return { status: r.status, body: await r.json().catch(()=>({})) } }
  const validate = async () => { const r = await fetch(`${BASE}/api/code/validate`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code }) }); return { status: r.status, body: await r.json().catch(()=>({})) } }
  let b = await byCode(); check('RULING 1: pupil link unavailable while unproved', b.status === 404 && b.body.reason === 'unavailable' && /confirming first/.test(b.body.message||''), JSON.stringify(b.body).slice(0,160))
  let v = await validate(); check('RULING 1: pupil code refused while unproved, no class name given', v.body.valid === false && v.body.code === 'enrolment_held' && !JSON.stringify(v.body).includes('Probe 3B'), JSON.stringify(v.body).slice(0,160))
  // The class page says the same.
  await p.goto(`${BASE}/org/${ledger.classId}`, { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{})
  await p.waitForTimeout(8000)
  const classText = (await p.locator('body').innerText()).replace(/\s+/g,' ')
  check("RULING 1: the teacher's class page shows the hold line, no link", /Pupils can't join yet/.test(classText) && !classText.includes(`/with/${code}`), classText.slice(0,0))
  await p.screenshot({ path: `${process.env.CS_SCRATCH}/195-1-held.png`, fullPage:true })

  // 5 (setup). A second live session, minted out of band, before proof.
  if (SECOND) {
    const { data: l2 } = await admin.auth.admin.generateLink({ type:'magiclink', email: EMAIL })
    const { data: s2, error: s2e } = await anon.auth.verifyOtp({ token_hash: l2.properties.hashed_token, type: 'magiclink' })
    check('second session minted for ruling 3', !!s2?.session && !s2e, s2e?.message)
  }

  // 3. Prove in the banner.
  await p.goto(`${BASE}/org/${ledger.schoolId}`, { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{})
  await p.waitForTimeout(8000)
  const { data: link } = await admin.auth.admin.generateLink({ type:'magiclink', email: EMAIL })
  await p.locator('.mailbox-banner__input').first().fill(link.properties.email_otp)
  await p.locator('.mailbox-banner__btn').first().click()
  await p.waitForTimeout(8000)
  const status = (await p.locator('.mailbox-banner__status').allInnerTexts()).join('|')
  check('banner confirms the code', /sorted for good/.test(status), status)
  const { data: u1 } = await admin.auth.admin.getUserById(ledger.userId)
  check('RULING 2: marker retired at proof', u1?.user?.user_metadata?.email_confirmed_manually === true && !u1?.user?.app_metadata?.unclaimed_mint)
  const { data: { session: live } } = await p.evaluate(async () => {
    const raw = Object.entries(localStorage).find(([k]) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    return { data: { session: raw ? JSON.parse(raw[1]) : null } }
  })
  const me = await fetch(`${BASE}/api/me/bootstrap`, { headers: { Authorization: `Bearer ${live?.access_token || ''}` } }).catch(()=>null)
  check('RULING 2: the proving session is still alive after proof', !!live?.access_token && me && me.status !== 401, `bootstrap ${me?.status}`)
  if (SECOND) {
    const line = p.locator('.mailbox-banner__sessions')
    check('RULING 3: the second-device line is shown on the proving device', await line.count() > 0, (await line.allInnerTexts()).join('|'))
    await p.screenshot({ path: `${process.env.CS_SCRATCH}/195-2-line.png`, fullPage:true })
    if (await line.count()) { await line.locator('button').first().click(); await p.waitForTimeout(500) }
    check('RULING 3: Keep hides the line', await p.locator('.mailbox-banner__sessions').count() === 0)
    const { data: n } = await admin.rpc('live_session_count', { p_user_id: ledger.userId })
    check('RULING 3: Keep ended nothing — both sessions still live', typeof n === 'number' && n >= 2, `live_session_count=${n}`)
  }

  // 4. RULING 1 — open.
  b = await byCode(); check('RULING 1: pupil link open after proof', b.status === 200, `status ${b.status}`)
  v = await validate(); check('RULING 1: pupil code valid after proof', v.body.valid === true && v.body.context?.className === 'Probe 3B', JSON.stringify(v.body).slice(0,160))
  await p.goto(`${BASE}/org/${ledger.classId}`, { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{})
  await p.waitForTimeout(8000)
  const classText2 = (await p.locator('body').innerText()).replace(/\s+/g,' ')
  check("RULING 1: the class page now offers the link", !/Pupils can't join yet/.test(classText2))
  await p.screenshot({ path: `${process.env.CS_SCRATCH}/195-3-open.png`, fullPage:true })
} catch (e) {
  console.log('PROBE ERROR', e?.message || e)
} finally {
  await browser.close()
  // Teardown — every probe row, in FK order.
  if (ledger.codeId) await admin.from('invite_codes').delete().eq('id', ledger.codeId)
  if (ledger.classId) { await admin.from('user_tags').delete().eq('tag_value', `CLASS:${ledger.classId}`); await admin.from('classes').delete().eq('id', ledger.classId) }
  if (ledger.userId) { await admin.from('invite_codes').delete().eq('created_by', ledger.userId); await admin.from('possession_mint_attempts').delete().eq('email', EMAIL.toLowerCase()) }
  if (ledger.schoolId) { await admin.from('school_domain_claims').delete().eq('school_id', ledger.schoolId).then(()=>{}, ()=>{}); await admin.from('schools').delete().eq('id', ledger.schoolId) }
  if (ledger.userId) { await admin.from('user_tags').delete().eq('user_id', ledger.userId); await admin.from('learners').delete().eq('user_id', ledger.userId); await admin.auth.admin.deleteUser(ledger.userId).catch(()=>{}) }
  const { data: gone } = ledger.userId ? await admin.auth.admin.getUserById(ledger.userId) : { data: { user: null } }
  const { data: sgone } = ledger.schoolId ? await admin.from('schools').select('id').eq('id', ledger.schoolId).maybeSingle() : { data: null }
  console.log('TEARDOWN: auth user gone =', !gone?.user, '; school gone =', !sgone)
  console.log('SUMMARY:', results.filter(r=>r.ok).length, '/', results.length, 'passed')
}
