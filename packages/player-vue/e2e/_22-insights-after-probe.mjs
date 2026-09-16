// Job #22: the "after" to pack dd91fb3a. Mints REAL sessions for the IME demo
// Sunrise Public School, Pune (is_demo=true): teacher Amit Pawar and school
// leader Kavita Deshmukh — no View As, no real school touched. Opens the
// teacher's Insights (/schools/analytics) and the leader's node Insights
// (/org/<schoolNode>/insights) at phone 390×844 and desktop 1280×900, grows
// the viewport to the real content height and screenshots full-content, and
// prints the measured height against the phone/desktop viewport. Read-only.
// Env: BASE, SHOTS, TAG, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, CHROME_BIN.
import { chromium } from '@playwright/test'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const TAG = process.env.TAG || 'after'
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const TEACHER = 'thomas.cassidy+demo.ime.sunrise.teacher3@gmail.com'
const LEADER = 'thomas.cassidy+demo.ime.sunrise.admin@gmail.com'
const SCHOOL_NODE = '741e9b6e-9542-4ac4-9d28-e29471ceaf41'
const CLASS_7A = '29692584-9edc-4f01-a421-3dcc8f8a2cdc'
async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!v.ok || !vj.access_token) throw new Error(`verify ${v.status}`); return vj
}
const settle = async (page, ms = 5000) => { await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(ms) }
console.log('BASE', BASE, 'version', (await fetch(`${BASE}/version.json`).then(r => r.text()).catch(() => 'n/a')).slice(0, 160))
const sessions = { teacher: await mint(TEACHER), leader: await mint(LEADER) }
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const out = []
for (const view of [
  { name: 'teacher-phone', who: 'teacher', width: 390, height: 844, url: `${BASE}/schools/analytics?class=${CLASS_7A}` },
  { name: 'teacher-desktop', who: 'teacher', width: 1280, height: 900, url: `${BASE}/schools/analytics?class=${CLASS_7A}` },
  { name: 'leader-phone', who: 'leader', width: 390, height: 844, url: `${BASE}/org/${SCHOOL_NODE}/insights` },
  { name: 'leader-desktop', who: 'leader', width: 1280, height: 900, url: `${BASE}/org/${SCHOOL_NODE}/insights` },
]) {
  const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 2 })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); sessionStorage.removeItem('ssi-viewing-as') } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(sessions[view.who])])
  const page = await ctx.newPage()
  const api = []
  page.on('response', async (r) => {
    if (!r.url().includes('rate-compare')) return
    let b = null; try { b = await r.json() } catch {}
    api.push({ status: r.status(), url: r.url().replace(BASE, ''), applied: b?.applied, week: b?.week ? { entity: b.week.entity, cohort: b.week.cohort, classes: (b.week.classes || []).map(c => `${c.name}:${c.totalMinutes}`) } : null, allTime: b?.allTime ?? null, tags: b?.tags ?? null, reason: b?.reason ?? null })
  })
  await page.goto(view.url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  // The real scroll container inside the shell, else the document.
  const h = await page.evaluate(() => {
    const el = document.querySelector('.schools-container') || document.scrollingElement
    return Math.max(el?.scrollHeight || 0, document.documentElement.scrollHeight, document.body.scrollHeight)
  })
  await page.setViewportSize({ width: view.width, height: Math.min(Math.max(h, view.height), 12000) })
  await page.waitForTimeout(800)
  const file = path.join(SHOTS, `${TAG}-${view.name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
  out.push({ view: view.name, url: page.url(), contentHeight: h, viewport: `${view.width}×${view.height}`, screens: +(h / view.height).toFixed(1), file, api, text: text.slice(0, 900) })
  console.log(`\n── ${view.name} ── ${page.url()}\n  content ${h}px in a ${view.height}px viewport = ${(h / view.height).toFixed(1)} screens\n  text: ${text.slice(0, 600)}`)
  for (const a of api) console.log('  API', a.status, a.url, JSON.stringify({ applied: a.applied, week: a.week, allTime: a.allTime, tags: a.tags, reason: a.reason }).slice(0, 900))
  await ctx.close()
}
fs.writeFileSync(path.join(SHOTS, `${TAG}-summary.json`), JSON.stringify(out, null, 2))
console.log('\nSHOTS:', out.map(o => o.file).join(' '))
await browser.close()
