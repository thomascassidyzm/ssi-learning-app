/**
 * #315 — is the schools/teach surface actually in the interface language?
 *
 * The counting answer ("N keys exist") is not the answer. This opens the real
 * pages in a real browser under a non-English locale, as a school admin and as
 * a teacher, and photographs what they see. Then it reads every visible text
 * node back and reports which ones are still English.
 *
 * Fixture: one is_test school with an admin, a teacher, a class and students,
 * all torn down at the end. Nothing touches a real account.
 *
 * Usage:
 *   BASE=https://<preview> LOCALE=cym SHOTS=$CS_SCRATCH/shots \
 *   node e2e/_315-schools-locale-probe.mjs
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const LOCALE = process.env.LOCALE || 'cym'
const SHOTS = process.env.SHOTS || `${process.env.CS_SCRATCH || '/tmp'}/shots-${LOCALE}`
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim()
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim()
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) throw new Error('need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY')

fs.mkdirSync(SHOTS, { recursive: true })
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()
const ledger = { users: [], schools: [], codes: [], classes: [] }

const code6 = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')

async function mkUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { e2e_315: true } })
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
async function sessionFor(userId) {
  const { data: u } = await admin.auth.admin.getUserById(userId)
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (error) throw new Error(`generateLink: ${error.message}`)
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (vErr) throw new Error(`verifyOtp: ${vErr.message}`)
  return v.session
}

/**
 * English-looking? A crude test on purpose: two or more runs of Latin letters
 * that spell a common English function word, or a Latin-only string of three
 * or more words. Welsh and the other Latin-script locales share the alphabet,
 * so this over-reports — every hit is READ by a human, it is a reading list
 * and never a verdict.
 */
const ENGLISH_TELLS = /\b(the|your|and|with|from|this|that|you|are|for|not|add|remove|class|classes|student|students|teacher|teachers|school|settings|course|courses|progress|back|continue|save|search|name|invite|link|first|setup|dashboard|weeks?|days?|minutes?)\b/i

const AUDIT = `(() => {
  const out = []
  const walk = (n) => {
    if (n.nodeType === 3) {
      const t = n.textContent.trim()
      if (t && n.parentElement && getComputedStyle(n.parentElement).display !== 'none') out.push(t)
      return
    }
    if (n.nodeType !== 1) return
    const el = n
    if (['SCRIPT','STYLE','SVG','NOSCRIPT'].includes(el.tagName)) return
    for (const a of ['placeholder','aria-label','title','alt']) {
      const v = el.getAttribute && el.getAttribute(a)
      if (v && v.trim()) out.push('[' + a + '] ' + v.trim())
    }
    for (const c of el.childNodes) walk(c)
  }
  walk(document.body)
  return out
})()`

const PAGES = [
  ['admin', '/schools', 'schools-dashboard'],
  ['admin', '/schools/setup', 'setup'],
  ['admin', '/schools/teachers', 'teachers'],
  ['admin', '/schools/students', 'students'],
  ['admin', '/schools/settings', 'settings'],
  ['admin', '/schools/upgrade', 'upgrade'],
  ['admin', '/schools/handbook', 'handbook'],
  ['teacher', '/schools', 'teacher-dashboard'],
  ['teacher', '/schools/classes', 'teacher-classes'],
]

let browser
const findings = []
try {
  // ── fixture ────────────────────────────────────────────────────────────
  const adminEmail = `e2e-315-admin-${stamp}@saysomethingin.com`
  const teacherEmail = `e2e-315-teacher-${stamp}@saysomethingin.com`
  const adminUserId = await mkUser(adminEmail)
  await learnerFor(adminUserId, { educational_role: 'school_admin', display_name: 'ZZ 315 Head' })
  const teacherUserId = await mkUser(teacherEmail)
  await learnerFor(teacherUserId, { educational_role: 'teacher', display_name: 'ZZ 315 Teacher' })

  const teacherJoin = code6()
  const { data: school, error: sErr } = await admin.from('schools').insert({
    school_name: `ZZ 315 Locale School ${stamp}`,
    admin_user_id: adminUserId,
    teacher_join_code: teacherJoin,
    admin_join_code: code6(),
    is_test: true,
  }).select('id').single()
  if (sErr) throw new Error(`school insert: ${sErr.message}`)
  ledger.schools.push(school.id)

  const { data: inv } = await admin.from('invite_codes').insert({
    code: teacherJoin, code_type: 'teacher', created_by: adminUserId,
    grants_school_id: school.id, is_active: true, use_count: 0,
  }).select('id').single()
  if (inv) ledger.codes.push(inv.id)

  const { data: cls, error: cErr } = await admin.from('classes').insert({
    class_name: 'ZZ 315 Dosbarth', school_id: school.id,
    teacher_user_id: teacherUserId, course_code: 'spa_for_eng',
  }).select('id').single()
  if (cErr) console.log('  note: class insert failed —', cErr.message)
  else ledger.classes.push(cls.id)

  console.log('fixture: school', school.id, 'class', cls?.id ?? '(none)')

  // ── the browse ─────────────────────────────────────────────────────────
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
  const sessions = { admin: await sessionFor(adminUserId), teacher: await sessionFor(teacherUserId) }
  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0]
  const authKey = `sb-${projectRef}-auth-token`

  for (const [who, path, name] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
    await ctx.addInitScript(([k, sess, loc]) => {
      window.localStorage.setItem(k, JSON.stringify(sess))
      window.localStorage.setItem('ssi-locale', loc)
      window.localStorage.setItem('ssi-locale-source', 'chosen')
    }, [authKey, sessions[who], LOCALE])
    const page = await ctx.newPage()
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(6000)
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {})
    const texts = await page.evaluate(AUDIT).catch(() => [])
    const suspect = [...new Set(texts)].filter((t) => t.length > 2 && ENGLISH_TELLS.test(t))
    findings.push({ who, path, name, url: page.url(), total: texts.length, suspect })
    console.log(`\n${name}  (${who} @ ${page.url()})  ${texts.length} strings, ${suspect.length} look English`)
    for (const s of suspect.slice(0, 60)) console.log('   ·', s.slice(0, 120))
    await ctx.close()
  }
  fs.writeFileSync(`${SHOTS}/findings.json`, JSON.stringify(findings, null, 2))
  console.log(`\nshots + findings.json in ${SHOTS}`)
} finally {
  if (browser) await browser.close()
  for (const id of ledger.classes) await admin.from('classes').delete().eq('id', id)
  for (const id of ledger.codes) await admin.from('invite_codes').delete().eq('id', id)
  for (const id of ledger.schools) await admin.from('schools').delete().eq('id', id)
  for (const id of ledger.users) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log('teardown done')
}
