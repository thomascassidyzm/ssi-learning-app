// Deployed View-as verification — the three View-as rough edges the founder
// found on the dev build (2026-07-18):
//   1. GET /api/govt/school-links 403'd while impersonating a group leader.
//   2. Viewing as a school leader crashed at useSchoolData.ts:300
//      ("Cannot read properties of null (reading 'school_id')").
//   3. Write controls (Create school, name cards, invite cards) rendered
//      under the read-only "Viewing as …" banner.
//
// It mints an ssi_admin session IN MEMORY (no token ever hits disk — needs
// SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_ANON_KEY in the environment, same
// as mint-sessions.mjs), primes the act-as persona in sessionStorage exactly
// as useActAs.actAs does, loads /schools on the DEPLOYED dev build, and asserts
// no crash / no 403 / no write controls. Personas are the live IME Demo cast.
//
// Run: node verify-viewas.mjs   (reads keys from repo-root .env.local if the
// vars aren't already exported).
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'

function env(name) {
  if (process.env[name]) return process.env[name]
  try {
    const txt = readFileSync(new URL('../../../../.env.local', import.meta.url), 'utf8')
    for (const line of txt.split('\n')) {
      const i = line.indexOf('=')
      if (i < 0 || line.slice(0, i) !== name) continue
      return line.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')
    }
  } catch { /* no env file */ }
  return undefined
}

const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const ANON = env('VITE_SUPABASE_ANON_KEY')
if (!SERVICE || !ANON) throw new Error('missing SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY')

// ssi_admin who drives View-as (thomas.cassidy+admin001).
const ADMIN_EMAIL = 'thomas.cassidy+admin001@gmail.com'
const admin = createClient(SUPABASE_URL, SERVICE)
const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: ADMIN_EMAIL })
if (le) throw new Error('generateLink: ' + le.message)
const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: v, error: ve } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (ve) throw new Error('verifyOtp: ' + ve.message)
const session = v.session

// Live IME Demo Programme cast (the founder's three personas).
const PERSONAS = [
  { key: 'ime', userId: '5b81fcb3-b424-4505-be67-0683d2816660', role: 'govt_admin', name: 'IME Group Leader' },
  { key: 'lissy', userId: '35590546-9d28-48fd-bc3b-fed7c5d261da', role: 'school_admin', name: 'Lissy Thomas' },
  { key: 'anu', userId: '7761a3df-ffb8-4dc2-804d-5af212f7a301', role: 'teacher', name: 'Anu Varghese' },
]
const roleCache = JSON.stringify({ platformRole: 'ssi_admin', educationalRole: null })

const browser = await chromium.launch()
let anyFail = false

for (const persona of PERSONAS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(([authKey, sess, rc, actKey, personaJson]) => {
    window.localStorage.setItem(authKey, sess)
    window.localStorage.setItem('ssi-user-role', rc)
    window.sessionStorage.setItem(actKey, personaJson)
  }, ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(session), roleCache, 'ssi-acting-as', JSON.stringify(persona)])

  const page = await ctx.newPage()
  const errs = []
  const net403 = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + String(e).slice(0, 300)))
  page.on('response', (r) => { if (r.status() === 403 && r.url().includes('/api/')) net403.push(r.url().replace(BASE, '')) })

  console.log(`\n=== View-as ${persona.name} (${persona.role}) ===`)
  await page.goto(BASE + '/schools', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(3500)

  const hasDashboard = await page.locator('.dashboard-view').count() > 0
  const errorBanner = (await page.locator('.fetch-error-banner').allTextContents()).join(' | ').trim()
  const banner = (await page.locator('body').innerText()).includes('Viewing as')
  const bodyText = await page.locator('body').innerText()
  const createSchool = (await page.locator('input[placeholder="School name"]').count() > 0) || bodyText.includes('Create school')
  const schoolIdCrash = errs.some(e => e.includes('school_id') && e.includes('null'))
  const schoolLinks403 = net403.some(u => u.includes('school-links'))

  await page.screenshot({ path: new URL(`./viewas-${persona.key}.png`, import.meta.url).pathname })

  const fails = []
  if (!hasDashboard) fails.push('dashboard did not render')
  if (!banner) fails.push('no "Viewing as" banner')
  if (schoolIdCrash) fails.push('school_id null crash')
  if (schoolLinks403) fails.push('school-links 403')
  if (errorBanner) fails.push(`error banner: ${errorBanner}`)
  if (persona.role === 'govt_admin' && createSchool) fails.push('create-school control visible in read-only')

  console.log(`  dashboard=${hasDashboard} banner=${banner} schoolIdCrash=${schoolIdCrash} api403s=${net403.length ? net403.join(',') : 'none'} errorBanner=${errorBanner || 'none'}`)
  if (persona.role === 'govt_admin') console.log(`  create-school control present: ${createSchool} (want false)`)
  if (fails.length) { anyFail = true; console.log(`  >>> FAIL: ${fails.join('; ')}`) }
  else console.log('  >>> PASS')

  await ctx.close()
}

await browser.close()
console.log(`\n${anyFail ? 'SOME CHECKS FAILED' : 'ALL PERSONAS PASSED'}`)
process.exit(anyFail ? 1 : 0)
