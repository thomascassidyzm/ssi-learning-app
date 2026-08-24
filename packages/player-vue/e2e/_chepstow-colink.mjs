// Chepstow scenario — step 3b: mint the class-scoped co-teacher link.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'https://saysomethingin.app'
const OUT = '/home/tomcassidy/chepstow-run/out'
const CLASS = 'ZZ Test — Year 7 Welsh'

const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-gpu', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1200 },
  storageState: '/home/tomcassidy/chepstow-run/leader-state.json',
})
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
p.on('response', (r) => {
  if (/\/api\/invite/.test(r.url())) console.log('API', r.status(), r.url())
})

const CLASS_URL = fs.readFileSync('/home/tomcassidy/chepstow-run/class-url.txt', 'utf8').trim()
await p.goto(CLASS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(12000)
console.log('at:', p.url(), '| class heading present:', await p.getByText(CLASS).count())

console.log('waiting for "Create a co-teacher link" to enable (gated on classData.id)')
const mint = p.getByRole('button', { name: 'Create a co-teacher link' })
for (let i = 0; i < 30 && (await mint.isDisabled()); i++) await p.waitForTimeout(2000)
console.log('  disabled?', await mint.isDisabled())
await mint.click()
await p.waitForTimeout(7000)
await p.screenshot({ path: `${OUT}/co-teacher-link.png`, fullPage: true })

const body = await p.locator('body').innerText()
console.log('--- TEACHERS PANEL ---')
const i = body.indexOf('TEACHERS')
console.log(body.slice(i, i + 1200))

const links = [...body.matchAll(/https:\/\/saysomethingin\.app\/redeem\/[A-Z0-9-]+/g)].map((m) => m[0])
console.log('REDEEM LINKS ON PAGE:', JSON.stringify([...new Set(links)]))
fs.writeFileSync('/home/tomcassidy/chepstow-run/redeem-links.json', JSON.stringify([...new Set(links)], null, 1))
await browser.close()
