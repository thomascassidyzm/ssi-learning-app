// Job #428: shoot the Dialogues tab of Listening Mode on a deployed build as a
// signed-in learner — the pod list online, the first pod opened (when the
// build has pod cards), then airplane mode after a reload. PROBE_URL,
// SESSION_JSON, COURSE, OUT_DIR, TAG, CHROME_BIN.
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
const openListening = async (o) => {
  const trig = page.locator('.mode-trigger').first()
  o.modeTriggerFound = await trig.count()
  if (!o.modeTriggerFound) return
  await trig.click({ timeout: 5000 }).catch((e) => (o.trigError = String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  const listen = page.locator('.tray-item').filter({ hasText: /listen/i }).first()
  if (await listen.count()) await listen.click({ timeout: 5000 }).catch((e) => (o.listenError = String(e).slice(0, 120)))
  await page.locator('.scene-card, .scene-empty, .scene-list-wrap .error, .view-tab').first().waitFor({ state: 'visible', timeout: 60000 }).catch((e) => (o.waitError = String(e).slice(0, 100)))
  await page.waitForTimeout(4000)
}
const readList = async () => ({
  sceneCards: await page.locator('.scene-card:not(.pod-card)').count(),
  podCards: await page.locator('.pod-card').allInnerTexts().catch(() => []),
  chips: await page.locator('.pod-chip').allInnerTexts().catch(() => []),
  headings: await page.locator('.scene-group-heading').allInnerTexts().catch(() => []),
  errors: await page.locator('.scene-list-wrap .error').allInnerTexts().catch(() => []),
})
const out = { url: URL, course: process.env.COURSE }
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
out.online = {}
await openListening(out.online)
out.online.list = await readList()
await shot('online-dialogues')
if (out.online.list.podCards.length) {
  await page.locator('.pod-card').first().click({ timeout: 5000 }).catch((e) => (out.online.openError = String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  out.online.podOpen = await readList()
  await shot('online-pod-open')
  await page.locator('.back-fab').first().click({ timeout: 5000 }).catch((e) => (out.online.backError = String(e).slice(0, 120)))
  await page.waitForTimeout(800)
  out.online.afterBack = await readList()
}
// Airplane mode: reload through the service worker, reopen Listening.
await ctx.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => (out.reloadError = String(e).slice(0, 160)))
await page.waitForTimeout(12000)
out.offline = {}
await openListening(out.offline)
out.offline.list = await readList()
await shot('offline-dialogues')
if (out.offline.list.podCards.length) {
  await page.locator('.pod-card').last().click({ timeout: 5000 }).catch((e) => (out.offline.openError = String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  out.offline.lastPodOpen = await readList()
  await shot('offline-last-pod-open')
}
out.jsErrors = jsErrors
console.log(JSON.stringify(out, null, 1))
await browser.close()
