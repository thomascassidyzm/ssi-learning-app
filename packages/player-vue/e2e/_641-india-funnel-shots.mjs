// #641 — throwaway capture script for the India funnel flow page.
// Takes real phone-width screenshots of the screens that EXIST today, so the
// unlisted flow page at /_flows/india-funnel-…html shows what is real rather
// than a drawing of what is planned.
//
//   LD_LIBRARY_PATH=/home/tomcassidy/.pwlibs/root/usr/lib/x86_64-linux-gnu \
//     node e2e/_641-india-funnel-shots.mjs
//
// Never set CHROME_BIN — the pinned 1208/1228/1234 builds die on launch.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const OUT = process.env.OUT_DIR || 'public/_flows/india-funnel-shots/'
const DEV = 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const MKT = 'https://www.dev.saysomethingin.com'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu'],
})

async function shot(name, fn, { storage } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: 'en-GB',
    ...(storage ? { storageState: storage } : {}),
  })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  try {
    await fn(page, ctx)
    await page.screenshot({ path: OUT + name + '.png' })
    console.log('OK  ', name, '| url:', page.url(), errs.length ? '| pageerrors: ' + errs.length : '')
  } catch (e) {
    console.log('FAIL', name, e.message)
  }
  await ctx.close()
}

const settle = (p, ms = 4000) => p.waitForTimeout(ms)

// 1a/1b — the marketing landing pages.
await shot('1-landing-hindi', async (p) => {
  await p.goto(MKT + '/eng/hindi', { waitUntil: 'load' })
  await settle(p, 6000)
})
await shot('1b-landing-hindi2', async (p) => {
  await p.goto(MKT + '/eng/hindi2', { waitUntil: 'load' })
  await settle(p, 6000)
})

// 2 — the embedded demo, playing. Try in-page first; the route is the fallback.
await shot('2-embedded-demo', async (p) => {
  await p.goto(DEV + '/embed/demo?course=eng_for_hin', { waitUntil: 'load' })
  await settle(p, 6000)
  // The demo's own start control, whatever it is called today.
  const btn = p.locator('button:visible').first()
  if (await btn.count()) await btn.click({ timeout: 8000 }).catch(() => {})
  await settle(p, 10000)
})

// 3 — the web trial in the app, Hindi UI, eng_for_hin.
await shot('3-web-trial-hindi', async (p) => {
  await p.goto(DEV + '/?course=eng_for_hin&reset=1', { waitUntil: 'load' })
  await settle(p, 9000)
  await p.goto(DEV + '/?course=eng_for_hin&stream', { waitUntil: 'load' })
  await settle(p, 10000)
  const btn = p.locator('.center-btn, button:visible').first()
  if (await btn.count()) await btn.click({ timeout: 8000 }).catch(() => {})
  await settle(p, 12000)
  await p.addStyleTag({ content: `.env-label, .env-reset, #eruda, .eruda-container { display: none !important; }` })
})

// 4 — the account screen as it exists today.
await shot('4-account-screen', async (p) => {
  await p.goto(DEV + '/?course=eng_for_hin', { waitUntil: 'load' })
  await settle(p, 8000)
  for (const sel of ['text=/sign in/i', 'text=/save progress/i', 'text=/log in/i', '[data-walk*="account"]']) {
    const l = p.locator(sel).first()
    if (await l.count()) { await l.click({ timeout: 5000 }).catch(() => {}); break }
  }
  await settle(p, 5000)
})

// 5 — the live public Play Store listing for the old India app.
await shot('5-play-store-a3f', async (p) => {
  await p.goto('https://play.google.com/store/apps/details?id=com.automagic.a3f', { waitUntil: 'load' })
  await settle(p, 7000)
})

// 6 — the web app's first-open screen, which is what the Capacitor wrap shows.
await shot('6-android-first-open', async (p) => {
  await p.goto(DEV + '/?reset=1', { waitUntil: 'load' })
  await settle(p, 9000)
  await p.goto(DEV + '/', { waitUntil: 'load' })
  await settle(p, 9000)
})

await browser.close()
