import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim(), ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim(), SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const PERSONA = { key: 'user:96105179-6598-4f2b-9281-a1d28270581b', userId: '96105179-6598-4f2b-9281-a1d28270581b', role: 'school_admin', name: 'angharadjones' }
async function mint(email) {
  const gl = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })).json()
  const vj = await (await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: gl.email_otp }) })).json()
  if (!vj.access_token) throw new Error('mint ' + JSON.stringify(gl).slice(0,200) + ' / ' + JSON.stringify(vj).slice(0,200))
  return vj
}
const session = await mint('thomas.cassidy+ssi@gmail.com')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript(([k, v, pk, pv]) => {
  try { localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {}
  for (const m of ['pushState', 'replaceState']) {
    const o = history[m].bind(history)
    history[m] = (s, t, u) => { console.log(`HIST ${m} -> ${u}\n` + new Error().stack.split('\n').slice(2, 9).join('\n')); return o(s, t, u) }
  }
}, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA)])
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.text(); if (t.startsWith('HIST')) console.log(t) })
const mode = process.env.MODE || 'click'
if (mode === 'click') {
  await page.goto(`${BASE}/schools/classes`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(3000)
  console.log('--- clicking row')
  await page.locator('tbody tr').first().locator('td').first().click()
} else {
  await page.goto(`${BASE}/schools/classes/${mode}`, { waitUntil: 'domcontentloaded' })
}
await page.waitForTimeout(6000)
console.log('final', page.url())
await browser.close()
