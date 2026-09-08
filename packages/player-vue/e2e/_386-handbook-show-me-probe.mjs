// Run from a directory that has playwright installed (ssi-dashboard-v7-clean-prod), with LD_LIBRARY_PATH per memory, TMPDIR=/tmp,
// against a local vite build of this branch: BASE=http://127.0.0.1:5386. Job #386.
// job #386 — drive "Show me" from the Handbook end to end on the LOCAL worktree build.
// READ-ONLY: signs in as the ZZ Probe leader, taps Show me, walks the steps, watches for mutations.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const BASE = process.env.BASE || 'http://127.0.0.1:5386'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const env = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8')
const KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env', 'utf8').match(/^SUPABASE_ANON_KEY=(.+)/m)[1].trim()
const NODE = '5173cc61-ee87-4437-8b6c-b04d9f782e8d'
const EMAIL = 'zz-probe-147-1788786910@ssi-probe.test'
const ENTRY = process.env.ENTRY || 'ways-in-who-can-get-in-and-how-to-change-it'
const OUT = process.env.OUT || (process.env.CS_SCRATCH + '/drive')
fs.mkdirSync(OUT, { recursive: true })
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const link = await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }).then((r) => r.json())
if (!link.hashed_token) { console.error('no hashed_token', link); process.exit(1) }
const v = await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }) }).then((r) => r.json())
if (!v.access_token) { console.error('verify failed', v); process.exit(1) }
const session = { access_token: v.access_token, refresh_token: v.refresh_token, expires_in: v.expires_in, expires_at: Math.floor(Date.now() / 1000) + (v.expires_in || 3600), token_type: 'bearer', user: v.user }

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
const mutations = []
let armed = false
page.on('request', (r) => { if (armed && r.method() !== 'GET' && r.url().includes('/api/') && !r.url().includes('player-events')) mutations.push(`${r.method()} ${r.url()}`) })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 140)) })
await page.addInitScript(([k, s]) => window.localStorage.setItem(k, JSON.stringify(s)), ['sb-swfvymspfxmnfhevgdkg-auth-token', session])

let fails = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ' :: ' + detail : ''}`); if (!ok) fails++ }

await page.goto(`${BASE}/org/${NODE}/handbook`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.entry-head', { timeout: 30000 })
await page.waitForTimeout(1500)
check('handbook renders', (await page.locator('.entry-head').count()) > 0, `${await page.locator('.entry-head').count()} entries`)
check('nothing auto-plays on the handbook', !(await page.locator('html').getAttribute('data-walk-active')))
const entry = page.locator(`#hb-${ENTRY}`)
await entry.locator('.entry-head').click()
await page.waitForTimeout(400)
const showMe = entry.locator('[data-handbook-demo]')
check('Show me is offered on the entry', (await showMe.count()) === 1, `walk=${await showMe.getAttribute('data-handbook-demo')}`)
const takeMe = entry.locator('.entry-goto')
check('Take me there stays as the quieter alternative', (await takeMe.count()) === 1, `class=${await takeMe.getAttribute('class')}`)
await page.screenshot({ path: `${OUT}/1-entry-open.png`, fullPage: false })
const walkId = await showMe.getAttribute('data-handbook-demo')
armed = true
await showMe.click()
await page.waitForFunction((id) => (document.documentElement.getAttribute('data-walk-active') || '').startsWith(id + ':'), walkId, { timeout: 15000 })
check('one tap navigated to the place', /\/org\/[0-9a-f-]{36}$/.test(page.url()), page.url())
const steps = []
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1200)
  const active = await page.locator('html').getAttribute('data-walk-active')
  if (!active) { steps.push({ active: null, ring: 0, card: '' }); await page.screenshot({ path: `${OUT}/3-after.png`, fullPage: false }); break }
  const ring = await page.locator('.walk-ring').count()
  const card = (await page.locator('.walk-card-mount').innerText()).replace(/\s+/g, ' ').trim()
  const anchored = await page.evaluate(() => { const r = document.querySelector('.walk-ring'); if (!r) return null; const b = r.getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el?.closest('[data-walk]')?.getAttribute('data-walk') ?? null })
  steps.push({ active, ring, card })
  console.log(`  step ${active} ring=${ring} on=${anchored} :: ${card.slice(0, 160)}`)
  await page.screenshot({ path: `${OUT}/2-step-${i}.png`, fullPage: false })
  const next = page.locator('[data-walk-overlay] button', { hasText: /^(Next|Done)$/ })
  if (await next.count()) await next.first().click()
  else { const tap = page.locator('.walk-ring'); console.log('  click-step: tapping the ringed element'); const anchored = await page.evaluate(() => { const r = document.querySelector('.walk-ring'); if (!r) return null; const b = r.getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el?.closest('[data-walk]')?.getAttribute('data-walk') ?? null }); console.log('  ringed anchor:', anchored); await page.mouse.click(...(await tap.boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2]))) }
}
check('walk reached its end and cleared', steps.at(-1)?.active === null, JSON.stringify(steps.map((s) => s.active)))
check('every step had a ring on a real element', steps.filter((s) => s.active).every((s) => s.ring === 1 || (s.active || '').endsWith(':done')), steps.map((s) => `${s.active}:${s.ring}`).join(' '))
check('no mutating API call fired', mutations.length === 0, mutations.join(' | '))
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS')
process.exit(fails ? 1 : 0)
