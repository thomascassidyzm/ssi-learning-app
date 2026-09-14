/**
 * Job #625 — one dropdown everywhere, every dropdown searchable.
 *
 * Opens each replaced dropdown on a deployed build, types in its filter, picks
 * a row, and screenshots closed / open / filtered / picked. Pages: Intelligence
 * at school-leader scope (fixture school) and at ssi_admin scope (a real school
 * node, read-only), the classes list, students, settings, and a phone-width
 * Intelligence shot.
 *
 * Fixture: one is_test school with a leader, a teacher and two classes; torn
 * down in `finally`. Sessions are minted with generateLink + verifyOtp, no email.
 *
 *   BASE=https://staging.saysomethingin.app SHOTS=$CS_SCRATCH/shots-625 \
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… \
 *   ADMIN_EMAIL=thomas.cassidy+admin001@gmail.com node e2e/_625-dropdown-probe.mjs
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const SHOTS = process.env.SHOTS || `${process.env.CS_SCRATCH || '/tmp'}/shots-625`
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim()
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim()
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim()
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) throw new Error('need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY')
fs.mkdirSync(SHOTS, { recursive: true })

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()
const ledger = { users: [], schools: [], codes: [], classes: [] }
const code6 = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')

async function mkUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { e2e_625: true } })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  ledger.users.push(data.user.id)
  return data.user.id
}
async function learnerFor(userId, patch = {}) {
  for (let i = 0; i < 25; i++) {
    const { data } = await admin.from('learners').select('id').eq('user_id', userId).maybeSingle()
    if (data) { await admin.from('learners').update({ is_internal: true, ...patch }).eq('id', data.id); return data.id }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`no learner row for ${userId}`)
}
async function sessionForEmail(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`generateLink ${email}: ${error.message}`)
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (vErr) throw new Error(`verifyOtp: ${vErr.message}`)
  return v.session
}
async function sessionFor(userId) {
  const { data: u } = await admin.auth.admin.getUserById(userId)
  return sessionForEmail(u.user.email)
}

const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0]
const authKey = `sb-${projectRef}-auth-token`
const report = { base: BASE, build: null, pages: [] }

async function openPage(browser, session, path, viewport = { width: 1280, height: 1100 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 })
  await ctx.addInitScript(([k, sess]) => { window.localStorage.setItem(k, JSON.stringify(sess)) }, [authKey, session])
  const page = await ctx.newPage()
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  // Data-backed pages paint their controls once their fetch lands; give them up to 25s.
  await page.waitForSelector('.fs-trigger', { timeout: 25000 }).catch(() => {})
  if (path.includes('/insights') && (await page.locator('.fs-trigger').count()) === 0) {
    // A brand-new school's first rate-compare read has been seen to fail once
    // ("Couldn't load these numbers just now"); the next read works. Reload once.
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForSelector('.fs-trigger', { timeout: 25000 }).catch(() => {})
  }
  await page.waitForTimeout(2500)
  if (path.startsWith('/schools/settings')) {
    // Localisation is one section of the settings page; the dropdowns live there.
    await page.locator('button', { hasText: /Localisation/ }).first().click().catch(() => {})
    await page.waitForTimeout(800)
  }
  return { ctx, page }
}

/** Drive every FrostSelect on the page: closed → open → filtered → picked. */
async function driveDropdowns(page, name, { typeText } = {}) {
  const entry = { name, url: page.url(), dropdowns: [], nativeSelects: await page.locator('select').count(), shots: [] }
  const shot = async (suffix) => { const p = `${SHOTS}/${name}-${suffix}.png`; await page.screenshot({ path: p, fullPage: false }).catch(() => {}); entry.shots.push(p) }
  await shot('0-closed')
  const triggers = page.locator('.fs-trigger')
  const n = await triggers.count()
  for (let i = 0; i < n; i++) {
    const trig = triggers.nth(i)
    const label = (await trig.getAttribute('aria-label')) || `dropdown-${i}`
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const d = { label, before: (await trig.innerText()).trim() }
    if (await trig.isDisabled()) { d.skipped = 'disabled'; entry.dropdowns.push(d); continue }
    // Leave nothing open from the previous dropdown before touching this one.
    await page.keyboard.press('Escape').catch(() => {})
    await page.mouse.click(2, 2).catch(() => {})
    await page.waitForTimeout(200)
    await trig.scrollIntoViewIfNeeded().catch(() => {})
    await trig.click()
    await page.waitForTimeout(400)
    const search = page.locator('.fs-panel input.fs-search')
    d.searchPresent = await search.count() === 1
    d.searchFocused = await page.evaluate(() => document.activeElement?.classList.contains('fs-search'))
    d.rowsOpen = await page.locator('.fs-panel .fs-opt').count()
    d.tickOnSelected = await page.locator('.fs-panel .fs-opt.selected .fs-check').innerText().catch(() => '')
    await shot(`${i + 1}-${slug}-open`)
    // Type the first word of the LAST row so the filter visibly narrows.
    const rows = await page.locator('.fs-panel .fs-opt-label').allInnerTexts()
    const target = rows.length > 1 ? rows[rows.length - 1] : rows[0]
    const q = typeText || (target || '').trim().split(/\s+/)[0]?.slice(0, 4) || ''
    if (q && d.searchPresent) { await search.type(q, { delay: 40 }); await page.waitForTimeout(300) }
    d.typed = q
    d.rowsFiltered = await page.locator('.fs-panel .fs-opt').count()
    d.filteredLabels = (await page.locator('.fs-panel .fs-opt-label').allInnerTexts()).map((s) => s.trim())
    await shot(`${i + 1}-${slug}-filtered`)
    const first = page.locator('.fs-panel .fs-opt:not(.is-disabled)').first()
    if (await first.count()) { d.picked = (await first.innerText()).trim(); await first.click(); await page.waitForTimeout(1500) }
    d.panelClosedAfterPick = (await page.locator('.fs-panel').count()) === 0
    d.after = (await triggers.nth(i).innerText().catch(() => '')).trim()
    await shot(`${i + 1}-${slug}-picked`)
    entry.dropdowns.push(d)
  }
  report.pages.push(entry)
  console.log(`\n${name} @ ${entry.url}: ${n} dropdowns, ${entry.nativeSelects} native <select>`)
  for (const d of entry.dropdowns) console.log('  ·', JSON.stringify(d))
}

let browser
try {
  report.build = await (await fetch(`${BASE}/version.json`)).json().catch(() => null)
  console.log('build', JSON.stringify(report.build))

  // ── fixture ──
  const leaderEmail = `e2e-625-leader-${stamp}@saysomethingin.com`
  const teacherEmail = `e2e-625-teacher-${stamp}@saysomethingin.com`
  const leaderId = await mkUser(leaderEmail)
  await learnerFor(leaderId, { educational_role: 'school_admin', display_name: 'ZZ 625 Head' })
  const teacherId = await mkUser(teacherEmail)
  await learnerFor(teacherId, { educational_role: 'teacher', display_name: 'ZZ 625 Teacher' })
  const teacherJoin = code6()
  const { data: school, error: sErr } = await admin.from('schools').insert({
    school_name: `ZZ 625 Dropdown School ${stamp}`, admin_user_id: leaderId,
    teacher_join_code: teacherJoin, admin_join_code: code6(), is_test: true,
  }).select('id').single()
  if (sErr) throw new Error(`school insert: ${sErr.message}`)
  ledger.schools.push(school.id)
  const { data: inv } = await admin.from('invite_codes').insert({
    code: teacherJoin, code_type: 'teacher', created_by: leaderId, grants_school_id: school.id, is_active: true, use_count: 0,
  }).select('id').single()
  if (inv) ledger.codes.push(inv.id)
  for (const [nm, cc] of [['ZZ 625 Dosbarth', 'cym_s_for_eng'], ['ZZ 625 Clase', 'spa_for_eng']]) {
    const { data: cls, error: cErr } = await admin.from('classes').insert({ class_name: nm, school_id: school.id, teacher_user_id: teacherId, course_code: cc }).select('id').single()
    if (cErr) console.log('  note: class insert failed —', cErr.message); else ledger.classes.push(cls.id)
  }
  console.log('fixture: school', school.id, 'classes', ledger.classes.join(','))

  // A real school node for the ssi_admin scope — the busiest class's school, read-only.
  let realSchoolId = null
  if (ADMIN_EMAIL) {
    const { data: busy, error: bErr } = await admin.from('classes').select('school_id').not('school_id', 'is', null).order('created_at', { ascending: true }).limit(1)
    if (bErr) console.log('real-school lookup failed:', bErr.message)
    realSchoolId = busy?.[0]?.school_id ?? null
    console.log('real school for ssi_admin scope:', realSchoolId)
  }

  browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
  const leaderSession = await sessionFor(leaderId)
  const teacherSession = await sessionFor(teacherId)
  const adminSession = ADMIN_EMAIL ? await sessionForEmail(ADMIN_EMAIL).catch((e) => { console.log('admin session failed:', e.message); return null }) : null

  const runs = [
    ['intelligence-leader', leaderSession, `/org/${school.id}/insights`],
    ['classes-list-teacher', teacherSession, '/schools/classes'],
    ['classes-list-leader', leaderSession, '/schools/classes'],
    ['students-leader', leaderSession, '/schools/students'],
    ['settings-leader', leaderSession, '/schools/settings'],
  ]
  if (adminSession && realSchoolId) runs.push(['intelligence-ssi-admin', adminSession, `/org/${realSchoolId}/insights`])
  const only = (process.env.ONLY || '').split(',').filter(Boolean)
  for (const [name, sess, path] of runs) {
    if (only.length && !only.some((o) => name.includes(o))) continue
    const { ctx, page } = await openPage(browser, sess, path)
    await driveDropdowns(page, name)
    await ctx.close()
  }
  // Phone width: the panel must open and stay on screen.
  {
    const { ctx, page } = await openPage(browser, leaderSession, `/org/${school.id}/insights`, { width: 390, height: 780 })
    await driveDropdowns(page, 'intelligence-leader-phone')
    await ctx.close()
  }
  fs.writeFileSync(`${SHOTS}/report.json`, JSON.stringify(report, null, 2))
  console.log(`\nshots + report.json in ${SHOTS}`)
} finally {
  if (browser) await browser.close()
  for (const id of ledger.classes) await admin.from('classes').delete().eq('id', id)
  for (const id of ledger.codes) await admin.from('invite_codes').delete().eq('id', id)
  for (const id of ledger.schools) await admin.from('schools').delete().eq('id', id)
  for (const id of ledger.users) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log('teardown done')
}
