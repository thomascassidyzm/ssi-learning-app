/**
 * Entry-without-email — live verification against a deployed preview.
 *
 * Proves the two new doors work for a teacher-shaped account that has never
 * confirmed its email, and screenshots what that teacher actually sees, at
 * phone size.
 *
 * Fixture uses e2e-door-* addresses on our own MX-backed domain (the
 * endpoint MX-checks the typed address and never sends mail to it), plus an
 * is_test school and torn
 * down at the end.
 *
 * Usage: BASE=https://<preview> node e2e/_entry-without-email-verify.mjs
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import fs from 'fs'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-feat-entry-without-email-zenjin.vercel.app'
const SHOTS = process.env.SHOTS || '/tmp/shots'
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim()
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()
const ledger = { users: [], learners: [], schools: [], codes: [], tags: [] }
const results = []
const log = (ok, what, detail = '') => { results.push({ ok, what, detail }); console.log(ok ? '  PASS' : '  FAIL', what, detail) }

function code6() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join('')
}

async function mkUser(email, opts = {}) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: opts.confirm ?? false, user_metadata: { e2e_entry_door: true } })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  ledger.users.push(data.user.id)
  return data.user.id
}
async function learnerFor(userId, patch = {}) {
  for (let i = 0; i < 20; i++) {
    const { data } = await admin.from('learners').select('id').eq('user_id', userId).maybeSingle()
    if (data) {
      await admin.from('learners').update({ is_internal: true, ...patch }).eq('id', data.id)
      ledger.learners.push(data.id)
      return data.id
    }
    await new Promise(r => setTimeout(r, 400))
  }
  return null
}
async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function sessionFor(userId) {
  const { data: u } = await admin.auth.admin.getUserById(userId)
  const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  const anon = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)
  const { data: v } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  return v.session
}
/**
 * Open a magic link, then carry the session onto BASE.
 *
 * Supabase only redirects to allow-listed origins, so on a preview alias the
 * link lands on production and the session lives on THAT origin. In
 * production the link lands where it should; this hop is test plumbing, not a
 * product path — the sign-in itself is entirely real either way.
 */
async function openViaLink(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(9000)
  const stored = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) return [k, localStorage.getItem(k)]
    }
    return null
  })
  if (!stored) throw new Error(`magic link did not establish a session (landed on ${page.url()})`)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), stored)
}

/** A real magic-link URL for a user — we open it in the browser, as a person would. */
async function signInUrlFor(userId) {
  const { data: u } = await admin.auth.admin.getUserById(userId)
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: u.user.email, options: { redirectTo: BASE },
  })
  if (error) throw new Error(`generateLink: ${error.message}`)
  return data.properties.action_link
}

const teacherEmail = `e2e-door-teacher-${stamp}@saysomethingin.com`
const adminEmail = `e2e-door-admin-${stamp}@saysomethingin.com`
const teacherJoin = code6()

let browser
try {
  // ── Fixture: a school, its admin, and a teacher join code ───────────────
  const adminUserId = await mkUser(adminEmail, { confirm: true })
  await learnerFor(adminUserId, { educational_role: 'school_admin', display_name: 'E2E Head' })
  const { data: school, error: schoolErr } = await admin.from('schools').insert({
    school_name: `E2E Door School ${stamp}`,
    admin_user_id: adminUserId,
    teacher_join_code: teacherJoin,
    admin_join_code: code6(),
    is_test: true,
  }).select('id').single()
  if (schoolErr) throw new Error(`school insert: ${schoolErr.message}`)
  ledger.schools.push(school.id)

  const { data: inviteRow, error: codeErr } = await admin.from('invite_codes').insert({
    code: teacherJoin,
    code_type: 'teacher',
    created_by: adminUserId,
    grants_school_id: school.id,
    is_active: true,
    use_count: 0,
  }).select('id').single()
  if (codeErr) throw new Error(`invite_codes insert: ${codeErr.message}`)
  ledger.codes.push(inviteRow.id)

  // ── 1. THE WALL, reproduced: asking for a code creates a shell account ──
  // This is what happens today when a Hwb teacher types their address and the
  // mail never lands. 81 real accounts sit in this state.
  const shellUserId = await mkUser(teacherEmail, { confirm: false })
  await learnerFor(shellUserId)
  const { data: shellCheck } = await admin.auth.admin.getUserById(shellUserId)
  log(!shellCheck.user.last_sign_in_at && !shellCheck.user.email_confirmed_at,
      'fixture: teacher has a shell account, never signed in, never confirmed')

  // ── 2. Shell adoption: the invite code now lets them in anyway ──────────
  const adopt = await post('/api/auth/possession-redeem', { code: teacherJoin, email: teacherEmail, displayName: 'E2E Teacher' })
  log(adopt.status === 200 && adopt.json.adopted === true && !!adopt.json.session,
      'possession-redeem ADOPTS the empty shell instead of refusing',
      `status=${adopt.status} adopted=${adopt.json.adopted} reason=${adopt.json.reason || ''}`)

  // ── 3. Takeover boundary still holds: a LIVE account is never adopted ───
  const liveEmail = `e2e-door-live-${stamp}@saysomethingin.com`
  const liveUserId = await mkUser(liveEmail, { confirm: true })
  await learnerFor(liveUserId, { educational_role: 'teacher' })
  const takeover = await post('/api/auth/possession-redeem', { code: teacherJoin, email: liveEmail, displayName: 'Impostor' })
  log(takeover.status === 409 && takeover.json.reason === 'already_registered' && !takeover.json.session,
      'a LIVE account is still refused — no takeover',
      `status=${takeover.status} reason=${takeover.json.reason}`)

  // ── 4. School admin mints a sign-in link for their own teacher ──────────
  await admin.from('user_tags').insert({
    user_id: shellUserId, tag_type: 'school', tag_value: `SCHOOL:${school.id}`,
    role_in_context: 'teacher', added_by: adminUserId,
  })
  await admin.from('learners').update({ educational_role: 'teacher', display_name: 'E2E Teacher' }).eq('user_id', shellUserId)
  // The admin's own staff tag, so scope resolution sees them inside the school.
  await admin.from('user_tags').insert({
    user_id: adminUserId, tag_type: 'school', tag_value: `SCHOOL:${school.id}`,
    role_in_context: 'admin', added_by: adminUserId,
  })
  const adminSession = await sessionFor(adminUserId)
  const mint = await post('/api/school/staff-signin-link', { target_user_id: shellUserId }, adminSession.access_token)
  log(mint.status === 200 && !!mint.json.action_link,
      'school admin can mint a sign-in link for their own teacher',
      `status=${mint.status}`)

  // ── 5. Containment: a teacher at ANOTHER school is refused ──────────────
  const outsiderId = await mkUser(`e2e-door-outsider-${stamp}@saysomethingin.com`, { confirm: true })
  await learnerFor(outsiderId, { educational_role: 'teacher' })
  const outside = await post('/api/school/staff-signin-link', { target_user_id: outsiderId }, adminSession.access_token)
  log(outside.status === 404, 'a teacher at another school is refused', `status=${outside.status}`)

  // ── 6. Containment: someone who outranks the school is refused ──────────
  const bigUserId = await mkUser(`e2e-door-leader-${stamp}@saysomethingin.com`, { confirm: true })
  await learnerFor(bigUserId, { educational_role: 'govt_admin' })
  await admin.from('user_tags').insert({
    user_id: bigUserId, tag_type: 'school', tag_value: `SCHOOL:${school.id}`,
    role_in_context: 'teacher', added_by: adminUserId,
  })
  const big = await post('/api/school/staff-signin-link', { target_user_id: bigUserId }, adminSession.access_token)
  log(big.status === 403, 'a group leader wearing a teacher tag is refused — no stepping up', `status=${big.status}`)

  // ── 7. Browser, phone-sized ─────────────────────────────────────────────
  browser = await chromium.launch()

  // 7a. The teacher gets in through the link their own admin minted — the
  //     whole point: a real sign-in, with no email anywhere in the loop.
  const teacherCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const tp = await teacherCtx.newPage()
  await openViaLink(tp, mint.json.action_link)
  await tp.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await tp.waitForTimeout(8000)
  await tp.screenshot({ path: `${SHOTS}/1-teacher-in-no-email.png`, fullPage: false })
  const teacherText = await tp.evaluate(() => document.body.innerText)
  log(/You're signed in/i.test(teacherText) || /Welcome|Dashboard|classes/i.test(teacherText) && !/Send me a code/i.test(teacherText),
      'the never-confirmed teacher is inside the product, via a link, with no email',
      teacherText.replace(/\s+/g, ' ').slice(0, 100))
  log(/Set a password/i.test(teacherText),
      'the teacher is offered a password — the way back in that needs no inbox')

  // 7b. The school admin's own view: the staff list and the sign-in link panel.
  const adminCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const ap = await adminCtx.newPage()
  await openViaLink(ap, await signInUrlFor(adminUserId))
  await ap.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await ap.waitForTimeout(9000)
  const lensChip = ap.locator('.chip', { hasText: /All teachers/i }).first()
  if (await lensChip.count()) {
    await lensChip.scrollIntoViewIfNeeded()
    await lensChip.click()
    await ap.waitForTimeout(5000)
  } else {
    console.log('   [diag] no Teachers lens chip found; url =', ap.url())
  }
  await ap.screenshot({ path: `${SHOTS}/2-admin-teachers.png`, fullPage: true })
  console.log('   [diag] chips on page =', await ap.locator('.chip').count(), '| url =', ap.url())
  const btn = ap.locator('[data-walk="teacher-signin-link"]').first()
  if (await btn.count()) {
    await btn.click()
    await ap.waitForTimeout(4000)
    await ap.screenshot({ path: `${SHOTS}/3-signin-link-panel.png`, fullPage: true })
    const panel = await ap.evaluate(() => /Hand this to/i.test(document.body.innerText))
    log(panel, 'the admin sees a copyable sign-in link with its plain-language caveat')
  } else {
    log(false, 'Sign-in link button visible on the staff list', 'button not found')
  }

  // 7d. The schools front door offers two ways in, not one.
  const doorCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const wp = await doorCtx.newPage()
  await wp.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await wp.waitForTimeout(5000)
  await wp.screenshot({ path: `${SHOTS}/5-front-door.png`, fullPage: true })
  const doorText = await wp.evaluate(() => document.body.innerText)
  log(/Use a password instead/i.test(doorText) && /blocked by school email filters/i.test(doorText),
      'the schools front door offers a password route and says why the code may never come',
      doorText.replace(/\s+/g, ' ').slice(0, 120))

  // 7c. The redeem dead end now names two inbox-free routes.
  const deadCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const dp = await deadCtx.newPage()
  await dp.goto(`${BASE}/redeem/${teacherJoin}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await dp.waitForTimeout(3000)
  const emailField = dp.locator('#redeem-email, input[type="email"]').first()
  if (await emailField.count()) {
    await emailField.fill(liveEmail)
    const nameField = dp.locator('input[type="text"]').first()
    if (await nameField.count()) await nameField.fill('Impostor')
    const submit = dp.locator('form button[type="submit"]').first()
    await submit.waitFor({ state: 'visible', timeout: 20000 })
    await submit.click()
    await dp.waitForTimeout(2000)
    await dp.waitForFunction(() => /already exists/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {})
    await dp.waitForTimeout(1500)
    await dp.screenshot({ path: `${SHOTS}/4-no-dead-end.png`, fullPage: true })
    const routes = await dp.evaluate(() => document.body.innerText)
    log(/password/i.test(routes) && /Sign-in link/i.test(routes),
        'the already-registered screen names both inbox-free routes',
        routes.replace(/\s+/g, ' ').slice(0, 160))
  } else {
    log(false, 'redeem page reached its email step', 'no email field')
  }
} catch (err) {
  console.error('THREW:', err)
  results.push({ ok: false, what: 'run completed without throwing', detail: String(err && err.message) })
} finally {
  if (browser) await browser.close().catch(() => {})
  // Teardown
  // Our own rate-limit rows, so repeat runs don't lock the probe out.
  await admin.from('possession_mint_attempts').delete().like('email', 'e2e-door-%')
  for (const id of ledger.codes) await admin.from('invite_codes').delete().eq('id', id)
  for (const id of ledger.schools) await admin.from('schools').delete().eq('id', id)
  for (const id of ledger.users) {
    await admin.from('user_tags').delete().eq('user_id', id)
    await admin.from('learners').delete().eq('user_id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  const pass = results.filter(r => r.ok).length
  console.log(`\n=== ${pass}/${results.length} checks passed ===`)
  fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2))
  process.exit(results.every(r => r.ok) ? 0 : 1)
}
