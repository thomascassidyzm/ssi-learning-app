// Ad-hoc real-browser audit of the /tutors sign-up door — reproduces Aran's
// report. Drives the actual cold-signup flow (language pick -> email -> OTP)
// against a real deployed URL, screenshots each step, and logs console/
// network errors. Read-only reconnaissance — no assertions, just evidence.
//
// Usage: BASE_URL=<url> node e2e/tutors-audit/audit-tutors-signup.mjs
import { chromium } from '@playwright/test'
import fs from 'fs'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = 'e2e/tutors-audit/out'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
const consoleErrors = []
const pageErrors = []
const netFailures = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('requestfailed', (req) => netFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`))
page.on('response', async (res) => {
  if (res.status() >= 400 && res.url().includes('/api/')) {
    netFailures.push(`${res.status()} ${res.url()}`)
  }
})

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  console.log(`shot: ${name}`)
}

try {
  console.log('--- 1. Cold visit /tutors ---')
  await page.goto(BASE + '/tutors', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await shot('01-tutors-cold')
  console.log('title:', await page.title())
  console.log('url:', page.url())

  const bodyText = await page.locator('body').innerText()
  console.log('body length:', bodyText.length)
  console.log('first 400 chars:\n', bodyText.slice(0, 400))

  // Check design tokens / stale styling: look for computed bg color of the panel
  const trackClass = await page.locator('.onboard').getAttribute('class').catch(() => null)
  console.log('onboard root class:', trackClass)

  console.log('\n--- 2. Pick a course, fill email, attempt send code ---')
  const courseBtn = page.locator('.ob-lang-row, .ob-lang-tile').filter({ hasText: 'English for Hindi Speakers' }).first()
  if (await courseBtn.count()) {
    await courseBtn.click()
    console.log('clicked course option')
  } else {
    console.log('NO COURSE OPTION FOUND to click')
  }

  const emailInput = page.locator('input[type="email"], input[placeholder*="mail" i]').first()
  if (await emailInput.count()) {
    await emailInput.fill('tutor.audit.test+' + Date.now() + '@gmail.com')
    await shot('02-email-filled')
  } else {
    console.log('NO EMAIL INPUT FOUND on choose step')
  }

  // Try to find and click a "Send" / continue button
  const sendBtn = page.locator('button:has-text("Send"), button:has-text("Continue"), button:has-text("code")').first()
  if (await sendBtn.count()) {
    const disabled = await sendBtn.isDisabled()
    console.log('send button disabled?', disabled)
    if (!disabled) {
      await sendBtn.click()
      await page.waitForTimeout(2500)
      await shot('03-after-send')
      console.log('url after send:', page.url())
      console.log('body after send (first 400):\n', (await page.locator('body').innerText()).slice(0, 400))
    }
  } else {
    console.log('NO SEND BUTTON FOUND')
  }

  console.log('\n--- 3. Direct nav to legacy /teach paths (back-compat check) ---')
  for (const path of ['/teach', '/teach/setup', '/teach/upgrade']) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch((e) => console.log(path, 'nav error', String(e)))
    await page.waitForTimeout(800)
    console.log(path, '->', page.url())
  }
  await shot('04-teach-redirect-result')

} catch (err) {
  console.error('FATAL:', err)
} finally {
  console.log('\n=== console errors ===')
  console.log(consoleErrors.join('\n') || '(none)')
  console.log('\n=== page errors ===')
  console.log(pageErrors.join('\n') || '(none)')
  console.log('\n=== network failures (4xx/5xx on /api or failed requests) ===')
  console.log(netFailures.join('\n') || '(none)')
  await browser.close()
}
