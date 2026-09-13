// Job #544: shoot the Dialogues tab of Listening Mode on a deployed build as a
// signed-in learner and read the pod cards — the fix under test is that a
// role-addressed topic pod (the Senedd pod) is its OWN card after Pod 1, never
// in place of it, and that a plain learner sees Pod 1 alone.
// PROBE_URL, SESSION_JSON, COURSE, OUT_DIR, TAG, CHROME_BIN.
import { chromium } from '@playwright/test'
import fs from 'fs'
const URL = process.env.PROBE_URL
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const OUT_DIR = process.env.OUT_DIR || '.'
const TAG = process.env.TAG || 'shot'
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(({ ref, sess, course }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess))
  localStorage.setItem('ssi-last-course', course)
  localStorage.setItem('ssi-last-course-origin', 'chosen')
}, { ref: REF, sess: session, course: process.env.COURSE })
const page = await ctx.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
const shot = (name) => page.screenshot({ path: `${OUT_DIR}/${TAG}-${name}.png` }).catch(() => {})
const out = { url: URL, course: process.env.COURSE }
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
const trig = page.locator('.mode-trigger').first()
out.modeTriggerFound = await trig.count()
if (out.modeTriggerFound) {
  await trig.click({ timeout: 5000 }).catch((e) => (out.trigError = String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  const listen = page.locator('.tray-item').filter({ hasText: /listen/i }).first()
  if (await listen.count()) await listen.click({ timeout: 5000 }).catch((e) => (out.listenError = String(e).slice(0, 120)))
  await page.locator('.scene-card, .scene-empty, .scene-list-wrap .error').first().waitFor({ state: 'visible', timeout: 60000 }).catch((e) => (out.waitError = String(e).slice(0, 100)))
  await page.waitForTimeout(6000)
}
out.podCards = await page.locator('.pod-card').allInnerTexts().catch(() => [])
out.sceneCards = await page.locator('.scene-card:not(.pod-card)').count()
out.errors = await page.locator('.scene-list-wrap .error').allInnerTexts().catch(() => [])
await shot('dialogues')
if (out.podCards.length > 1) {
  await page.locator('.pod-card').nth(1).click({ timeout: 5000 }).catch((e) => (out.openError = String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  out.secondPodOpen = { sceneCards: await page.locator('.scene-card:not(.pod-card)').count(), headings: await page.locator('.scene-group-heading, .pod-open-title, h2').allInnerTexts().catch(() => []) }
  await shot('second-pod-open')
}
out.jsErrors = jsErrors
console.log(JSON.stringify(out, null, 1))
await browser.close()
