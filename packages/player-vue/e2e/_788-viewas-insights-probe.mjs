// Job #788: Insights under View As as a teacher whose class only has play-as-class
// sessions (R Jeffery, Ysgol Cas-gwent 11P). Mints the ssi_admin session, plants
// the persona, opens /schools/analytics (school-level Insights tab) and the
// class-scoped ?class= deep link, screenshots both. Read-only. Env: BASE, SHOTS,
// SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CHROME_BIN.
import { chromium } from '@playwright/test'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://saysomethingin.app').replace(/\/$/, '')
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
const settle = async (page, ms = 4000) => { await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(ms) }
console.log('BASE', BASE, 'version', (await fetch(`${BASE}/version.json`).then(r => r.text())).slice(0, 120))
const session = await mint(ADMIN_EMAIL)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript(([k, v, pk, pv]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA)])
const page = await ctx.newPage()
const api = []
page.on('response', async (r) => { const u = r.url(); if (u.includes('/api/me/teaching-context') || u.includes('rate-compare')) { let b = ''; try { b = (await r.text()).slice(0, 200) } catch {} api.push(`${r.status()} ${u.replace(BASE, '')} :: ${b}`) } })
for (const [name, url] of [['school-insights', `${BASE}/schools/analytics`], ['class-insights', `${BASE}/schools/analytics?class=${CLASS_11P}`]]) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  const file = path.join(SHOTS, `${TAG}-${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(name, page.url(), '\n  text:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400))
}
console.log('API:\n' + api.join('\n'))
await browser.close()
