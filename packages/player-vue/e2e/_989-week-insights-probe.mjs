// Job #989: Class Insights in school weeks. Mints the ssi_admin session, plants
// the R Jeffery teacher persona (Ysgol Cas-gwent 11P — a class whose only record
// is play-as-class), opens the class insights page at PHONE width and again as
// the school leader sees it, screenshots both, and prints the week block the
// endpoint returned. Read-only. Env: BASE, SHOTS, SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CHROME_BIN.
import { chromium } from '@playwright/test'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const TAG = process.env.TAG || 'shot'
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const PERSONA = { key: 'user:a57bb43b-23b6-415f-ac59-1695b0fe2abe', userId: 'a57bb43b-23b6-415f-ac59-1695b0fe2abe', role: 'teacher', name: 'R Jeffery' }
const CLASS_11P = '1a89495d-564e-43ed-80d5-dd49b07fb742'
async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!v.ok || !vj.access_token) throw new Error(`verify ${v.status}`); return vj
}
const settle = async (page, ms = 4500) => { await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {}); await page.waitForTimeout(ms) }
console.log('BASE', BASE, 'version', (await fetch(`${BASE}/version.json`).then(r => r.text()).catch(() => 'n/a')).slice(0, 160))
const session = await mint(ADMIN_EMAIL)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const shots = []
for (const view of [
  { name: 'teacher-phone', width: 390, height: 844, persona: PERSONA, url: `${BASE}/schools/analytics?class=${CLASS_11P}` },
  { name: 'leader-phone', width: 390, height: 844, persona: null, url: `${BASE}/schools/analytics` },
]) {
  const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 2 })
  await ctx.addInitScript(([k, v, pk, pv]) => {
    try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); if (pv) sessionStorage.setItem(pk, pv); else sessionStorage.removeItem(pk) } catch {}
  }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', view.persona ? JSON.stringify(view.persona) : ''])
  const page = await ctx.newPage()
  const api = []
  page.on('response', async (r) => {
    if (!r.url().includes('rate-compare')) return
    let b = null; try { b = await r.json() } catch {}
    api.push({ status: r.status(), url: r.url().replace(BASE, ''), week: b?.week ?? null, reason: b?.reason ?? null })
  })
  await page.goto(view.url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  const file = path.join(SHOTS, `${TAG}-${view.name}.png`)
  await page.screenshot({ path: file, fullPage: true }); shots.push(file)
  console.log(`\n── ${view.name} ── ${page.url()}`)
  console.log('  text:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 700))
  for (const a of api) console.log('  API', a.status, a.url, '\n   week:', JSON.stringify(a.week)?.slice(0, 700), a.reason ? `\n   reason: ${a.reason}` : '')
  await ctx.close()
}
console.log('\nSHOTS:', shots.join(' '))
await browser.close()
