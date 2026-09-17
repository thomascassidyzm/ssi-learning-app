/**
 * Job #69 — the Handbook design pass, shot on staging as the REAL school
 * leader of ZZ Test Chepstow. Phone first at 390px, then desktop.
 */
import { chromium } from '/home/tomcassidy/.cs-worktrees/ssi-learning-app/69-ssi-app-handbook-search-stays-pu/node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-learning-app/.env.local', 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const SVC = fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env', 'utf8')
  .split('\n').find((l) => l.startsWith('SUPABASE_SERVICE_KEY=')).split('=')[1].trim()
const URL = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY
const EMAIL = 'thomas.cassidy+chepstowtest-leader@gmail.com'
const SITE = 'https://staging.saysomethingin.app'
const OUT = process.env.OUT || '/home/tomcassidy/.cs-scratch/hb69'

const link = await (await fetch(`${URL}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
})).json()
const otp = link.email_otp ?? link.properties?.email_otp
const session = await (await fetch(`${URL}/auth/v1/verify`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email: EMAIL, token: otp }),
})).json()
if (!session.access_token) throw new Error('no session: ' + JSON.stringify(session).slice(0, 200))
const ref = new URL(URL).host.split('.')[0]

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME })
for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1400, height: 950 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${ref}-auth-token`, JSON.stringify(session)])
  const page = await ctx.newPage()
  await page.goto(`${SITE}/schools/handbook`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/${name}-1-shut.png`, fullPage: false })
  // Typing narrows the rows and expands none of them.
  await page.fill('.handbook-search', 'bug')
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/${name}-2-search.png` })
  await page.fill('.handbook-search', '')
  await page.waitForTimeout(400)
  // A chip jumps to its section and opens it; then scroll for back-to-top.
  const chips = await page.$$('.handbook-chip')
  if (chips.length) { await chips[chips.length - 1].click(); await page.waitForTimeout(700) }
  await page.evaluate(() => document.querySelector('.schools-container')?.scrollBy(0, 900))
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${name}-3-open-scrolled.png` })
  const report = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('.section-head')].map((h) => h.textContent.trim().replace(/\s+/g, ' ')),
    backToTop: Boolean(document.querySelector('.handbook-totop')),
    openRows: document.querySelectorAll('.entry-body').length,
  }))
  console.log(name, JSON.stringify(report))
  await ctx.close()
}
await browser.close()
console.log('shots in', OUT)
