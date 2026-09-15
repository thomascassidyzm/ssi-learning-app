import { chromium } from '@playwright/test'
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
const j = await (await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: 'thomas.cassidy+chepstowtest-leader@gmail.com' }) })).json()
const sess = await (await fetch(`${SB_URL}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: j.hashed_token }) })).json()
const KEY = `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
for (const [name, vp, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile })
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(sess)])
  const page = await ctx.newPage()
  const calls = []
  page.on('response', (r) => { if (r.url().includes('/api/support/')) calls.push(`${r.request().method()} ${new URL(r.url()).pathname}${new URL(r.url()).search} ${r.status()}`) })
  await page.goto('https://saysomethingin.app/schools', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000)
  const menuItems = await page.locator('.user-trigger').first().tap().then(() => page.locator('.user-menu-pop button, .user-menu-pop a').allTextContents()).catch((e) => String(e).slice(0, 80))
  await page.goto('https://saysomethingin.app/schools/support', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000)
  const ta = page.locator('textarea').first()
  const info = { name, url: page.url(), menuItems, textarea: await ta.count(), visible: await ta.isVisible().catch(() => false), enabled: await ta.isEnabled().catch(() => false), sendButtons: await page.locator('button:has-text("Send"), button:has-text("Anfon")').count(), bodyText: (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 400), calls }
  await page.screenshot({ path: `${process.env.CS_SCRATCH}/support-${name}.png`, fullPage: true })
  console.log(JSON.stringify(info, null, 1))
  await ctx.close()
}
await browser.close()
