// Does a first-time visitor on a genuinely bad link SEE that the connection is
// slow, rather than a blank screen? Fresh context, hard throttle, poll for the
// notice, then confirm the app still recovers and becomes pressable.
import { chromium } from '@playwright/test'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
const LIBS = [`${homedir()}/.ssi-sentinel-libs`, `${homedir()}/.pwlibs/root/usr/lib/x86_64-linux-gnu`]
const lib = LIBS.find(existsSync); if (lib) process.env.LD_LIBRARY_PATH = `${lib}:${process.env.LD_LIBRARY_PATH || ''}`
const chrome = execSync(`ls ${homedir()}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | tail -1`).toString().trim()
const BASE = process.env.BASE_URL
const b = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext()
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 250*1024/8, uploadThroughput: 200*1024/8 })
await page.goto(BASE + '/', { waitUntil: 'commit' })
const t0 = Date.now()
let noticeAt = null, noticeText = null, pressableAt = null
while (Date.now() - t0 < 120000) {
  if (!noticeAt) {
    const n = await page.locator('.slow-network-notice').first()
    if (await n.count() && await n.isVisible().catch(() => false)) {
      noticeAt = Date.now() - t0
      noticeText = (await n.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      await page.screenshot({ path: process.env.OUT + '/slow-notice.png' })
    }
  }
  const c = page.locator('.center-btn').first()
  if (await c.count() && !(await c.evaluate(el => el.classList.contains('is-disabled')).catch(() => true))) {
    pressableAt = Date.now() - t0; break
  }
  await page.waitForTimeout(200)
}
console.log(JSON.stringify({ noticeAt, noticeText, pressableAt }, null, 1))
await b.close()
