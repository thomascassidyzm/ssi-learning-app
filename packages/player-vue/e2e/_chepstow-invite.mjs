// Chepstow scenario — step 3: open the class detail and mint the class-scoped
// co-teacher invite link.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'https://saysomethingin.app'
const OUT = '/home/tomcassidy/chepstow-run/out'
const CLASS = 'ZZ Test — Year 7 Welsh'

const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-gpu', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  storageState: '/home/tomcassidy/chepstow-run/leader-state.json',
})
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const dump = async (l) => console.log(`--- ${l} ---\n` + (await p.locator('body').innerText()).slice(0, 3000))
const controls = async (l) => {
  console.log(`--- ${l} CONTROLS ---`)
  for (const c of await p.evaluate(() =>
    [...document.querySelectorAll('button,a,input,[role="button"]')]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || '').trim().slice(0, 60),
        ph: el.getAttribute('placeholder'),
        cls: String(el.className || '').slice(0, 45),
        href: el.getAttribute('href'),
        vis: el.getBoundingClientRect().width > 0,
      }))
      .filter((c) => c.vis),
  ))
    console.log(JSON.stringify(c))
}

await p.goto(BASE + '/schools/classes', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(9000)
await p.getByText(CLASS).first().click()
await p.waitForTimeout(9000)
console.log('CLASS URL:', p.url())
fs.writeFileSync('/home/tomcassidy/chepstow-run/class-url.txt', p.url())
await shot('class-detail')
await dump('CLASS DETAIL')
await controls('CLASS DETAIL')
await browser.close()
