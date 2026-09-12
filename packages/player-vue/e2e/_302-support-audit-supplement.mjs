// Supplementary shots for job #302: the doors the View-as banner covers, opened by script,
// plus probes on the class page door and the bug FAB. READ-ONLY. Runs from packages/player-vue.
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'
const BASE = 'https://staging.saysomethingin.app'
const SHOTS = process.env.SHOTS
const SUPABASE_URL = process.env.VITE_SUPABASE_URL.trim(), ANON = process.env.VITE_SUPABASE_ANON_KEY.trim(), SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const SCHOOL = '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255', CLASS = '01041bae-ef81-4c78-bc21-b1a8f0def808'
async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json()
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  return v.json()
}
const settle = async (p) => { await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(2000) }
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const session = await mint('thomas.cassidy+ssi@gmail.com')
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
const page = await ctx.newPage()
const out = []
const shot = async (name, note) => { const f = path.join(SHOTS, `b--${name}.png`); await page.screenshot({ path: f }); out.push({ name, url: page.url(), note }); console.log(name, '|', note) }
const jsClick = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true }, sel)
try {
  await page.goto(`${BASE}/admin/structure`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  await page.getByTestId('view-as-open').click({ timeout: 20000 })
  await page.getByTestId('view-as-search').fill('angharadjones')
  await page.locator('.vap-menu .vap-item').filter({ hasText: /angharadjones/i }).first().click({ timeout: 20000 })
  await page.waitForURL(/\/schools|\/org/, { timeout: 30000 }); await settle(page)

  // 1. Where the banner sits over the top bar: geometry.
  const geo = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().toJSON() : null }
    const banner = document.querySelector('[data-testid="view-as-exit"]')?.closest('div, header, aside, section')
    return { banner: banner ? banner.getBoundingClientRect().toJSON() : null, bannerClass: banner?.className, trigger: r('.user-trigger'), hamburger: r('.nav-toggle'), topbar: r('.schools-topbar'), fab: (() => { const b = [...document.querySelectorAll('button')].find((x) => /bug|feedback|report/i.test(x.getAttribute('aria-label') || '') || /bug|feedback/i.test(x.className)); return b ? { label: b.getAttribute('aria-label'), cls: b.className, rect: b.getBoundingClientRect().toJSON() } : null })() }
  })
  console.log('GEOMETRY', JSON.stringify(geo))
  fs.writeFileSync(path.join(SHOTS, 'b--geometry.json'), JSON.stringify(geo, null, 2))
  // Element at the avatar's centre — what a finger actually hits.
  const hit = await page.evaluate(() => { const t = document.querySelector('.user-trigger'); if (!t) return null; const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? { tag: e.tagName, cls: e.className, text: (e.textContent || '').trim().slice(0, 40) } : null })
  console.log('HIT-TEST at avatar centre:', JSON.stringify(hit))
  out.push({ name: 'hit-test', note: JSON.stringify(hit) })

  // 2. Menu opened by script on the org lens (a finger cannot reach it under the banner).
  await jsClick('.user-trigger'); await page.waitForTimeout(500)
  const items = await page.locator('.user-menu-pop .menu-item').allInnerTexts().catch(() => [])
  await shot('01-org-school--menu-open-by-script', `menu items=${JSON.stringify(items)}`)
  await jsClick('.user-trigger'); await page.waitForTimeout(300)

  // 3. Banner hidden: the top bar as a real leader sees it, no View-as.
  await page.evaluate(() => { const b = document.querySelector('[data-testid="view-as-exit"]')?.closest('div, header, aside, section'); if (b) b.style.display = 'none' })
  await page.waitForTimeout(300)
  await shot('02-org-school--topbar-without-banner', 'View-as banner hidden by script: what a real leader sees at the top')
  await jsClick('.user-trigger'); await page.waitForTimeout(500)
  await shot('03-org-school--menu-open-without-banner', 'menu open, banner hidden')
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)

  // 4. The banner's own Pages list.
  await page.getByTestId('view-as-pages').click({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(600)
  const pagesText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)
  await shot('04-org-school--view-as-pages-open', `Pages list open`)
  fs.writeFileSync(path.join(SHOTS, 'b--pages-text.txt'), pagesText)
  await page.keyboard.press('Escape').catch(() => {})
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)

  // 5. The bug FAB bottom-right.
  const fabInfo = await page.evaluate(() => { const b = [...document.querySelectorAll('button, a')].filter((x) => getComputedStyle(x).position === 'fixed').map((x) => ({ tag: x.tagName, label: x.getAttribute('aria-label'), title: x.getAttribute('title'), cls: x.className, text: (x.textContent || '').trim().slice(0, 40), rect: x.getBoundingClientRect().toJSON() })); return b })
  console.log('FIXED BUTTONS', JSON.stringify(fabInfo))
  fs.writeFileSync(path.join(SHOTS, 'b--fixed-buttons.json'), JSON.stringify(fabInfo, null, 2))
  const fab = fabInfo.find((x) => /bug|feedback|report|tester/i.test(`${x.label} ${x.title} ${x.cls}`))
  if (fab) {
    await page.evaluate((cls) => { const b = [...document.querySelectorAll('button, a')].find((x) => x.className === cls); b?.click() }, fab.cls)
    await page.waitForTimeout(800)
    await shot('05-org-school--fab-open', `fab label=${fab.label} cls=${fab.cls}`)
    await page.keyboard.press('Escape').catch(() => {})
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)
  }

  // 6. /schools/support with the menu open by script.
  await page.goto(`${BASE}/schools/support`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  await jsClick('.user-trigger'); await page.waitForTimeout(500)
  await shot('06-schools-support--menu-open-by-script', 'Support page, menu open by script')

  // 7. /schools/handbook: an entry that has a walk, opened, as staging renders it today.
  await page.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  const ok = await jsClick('#hb-share-a-class-with-a-colleague .entry-head'); await page.waitForTimeout(400)
  await page.evaluate(() => document.getElementById('hb-share-a-class-with-a-colleague')?.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(300)
  const offers = await page.locator('#hb-share-a-class-with-a-colleague [data-walk-offer]').count()
  await shot('07-schools-handbook--share-a-class-entry-open', `entry opened=${ok} walk offers on entry=${offers} (pack names walk share-a-class)`)

  // 8. /schools/classes/8H: is the #286 door there at all?
  await page.goto(`${BASE}/schools/classes/${CLASS}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  const probe = await page.evaluate(() => ({ headActions: document.querySelector('.page-head-actions')?.innerHTML?.slice(0, 400) ?? null, htw: document.querySelectorAll('.htw').length, toggles: document.querySelectorAll('.htw-toggle').length, handbookLinks: [...document.querySelectorAll('a')].filter((a) => /handbook/i.test(a.textContent || '')).map((a) => a.getAttribute('href')) }))
  console.log('CLASS PAGE PROBE', JSON.stringify(probe))
  fs.writeFileSync(path.join(SHOTS, 'b--class-page-probe.json'), JSON.stringify(probe, null, 2))
  await shot('08-schools-class--head', `htw=${probe.htw} toggles=${probe.toggles} headActions=${probe.headActions ? 'present' : 'absent'}`)
} finally { await browser.close() }
fs.writeFileSync(path.join(SHOTS, 'manifest-b.json'), JSON.stringify(out, null, 2))
console.log('done')
