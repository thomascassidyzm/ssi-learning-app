// Which request fails for the non-lead co-teacher on the class-detail page?
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const CLASS_URL = fs.readFileSync('/home/tomcassidy/chepstow-run/class-url.txt', 'utf8').trim()
const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-gpu', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1100 },
  storageState: '/home/tomcassidy/chepstow-run/cover-state.json',
})
const p = await ctx.newPage()
p.on('response', async (r) => {
  const u = r.url()
  if (!/\/api\/|supabase\.co/.test(u)) return
  const bad = r.status() >= 400
  if (bad || /class/i.test(u)) {
    let body = ''
    try {
      body = (await r.text()).slice(0, 300)
    } catch {}
    console.log(r.status(), u.slice(0, 160), bad ? '<< ' + body : '')
  }
})
p.on('requestfailed', (r) => console.log('REQFAILED', r.url().slice(0, 160), r.failure()?.errorText))
await p.goto(CLASS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(18000)
await browser.close()
