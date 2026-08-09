// Chepstow scenario — step 2/3: the leader creates a class, then mints the
// class-scoped co-teacher invite LINK (this lane sends no email by design —
// it renders a copy-me /redeem/:code link).
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'https://saysomethingin.app'
const OUT = '/home/tomcassidy/chepstow-run/out'
const CLASS = 'ZZ Test — Year 7 Welsh'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-gpu', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  storageState: '/home/tomcassidy/chepstow-run/leader-state.json',
})
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const dump = async (label) => console.log(`--- ${label} ---\n` + (await p.locator('body').innerText()).slice(0, 2500))

console.log('STEP 2 — create the class')
await p.goto(BASE + '/schools/classes', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(8000)
await p.getByRole('button', { name: /Create your first class|New class/ }).first().click()
await p.waitForTimeout(3000)
await shot('class-create-dialog')
await dump('CREATE DIALOG')

console.log('\n--- DIALOG CONTROLS ---')
for (const c of await p.evaluate(() =>
  [...document.querySelectorAll('button,input,select,textarea,[role="button"]')]
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || '').trim().slice(0, 60),
      ph: el.getAttribute('placeholder'),
      id: el.id || null,
      cls: String(el.className || '').slice(0, 50),
      vis: el.getBoundingClientRect().width > 0,
    }))
    .filter((c) => c.vis),
))
  console.log(JSON.stringify(c))

// Fill whatever text input the dialog offers for the class name.
const nameInput = p.locator('input[type="text"]:visible, input:not([type]):visible').first()
await nameInput.fill(CLASS)
await p.waitForTimeout(500)
await shot('class-create-filled')
const submit = p
  .getByRole('button', { name: /^(Create|Create class|Save|Add class|Continue)$/i })
  .last()
await submit.click()
await p.waitForTimeout(8000)
await shot('class-created')
await dump('AFTER CREATE')
console.log('URL:', p.url())

console.log('\nSTEP 3 — open the class and mint the co-teacher invite link')
// Navigate into the class detail if we are not already there.
if (!/\/classes\/[0-9a-f-]{8,}/.test(p.url())) {
  const card = p.getByText(CLASS).first()
  if (await card.count()) {
    await card.click()
    await p.waitForTimeout(7000)
  }
}
console.log('CLASS URL:', p.url())
await shot('class-detail')
await dump('CLASS DETAIL')

console.log('\n--- CLASS DETAIL CONTROLS ---')
for (const c of await p.evaluate(() =>
  [...document.querySelectorAll('button,a,input,[role="button"]')]
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || '').trim().slice(0, 60),
      ph: el.getAttribute('placeholder'),
      cls: String(el.className || '').slice(0, 50),
      href: el.getAttribute('href'),
      vis: el.getBoundingClientRect().width > 0,
    }))
    .filter((c) => c.vis),
))
  console.log(JSON.stringify(c))

await ctx.storageState({ path: '/home/tomcassidy/chepstow-run/leader-state.json' })
fs.writeFileSync('/home/tomcassidy/chepstow-run/class-url.txt', p.url())
await browser.close()
