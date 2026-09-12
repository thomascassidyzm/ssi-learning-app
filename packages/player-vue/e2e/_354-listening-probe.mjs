// Job #354: headless proof that Italian Listening Mode lists the served pod
// and, once live, the method pod as a second titled group. Signs in by
// injecting a real Supabase session (minted via the admin OTP flow) into the
// app's auth storage, pins the course to ita_for_eng, opens Listening Mode and
// reads the Dialogues scene list: group headings, scene-card count, first and
// last card text. Screenshot to $OUT_DIR. Reusable: PROBE_URL, SESSION_JSON.
import { chromium } from '@playwright/test'
import fs from 'fs'
const URL = process.env.PROBE_URL || 'https://staging.saysomethingin.app/'
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const OUT_DIR = process.env.OUT_DIR || '.'
const TAG = process.env.TAG || 'probe'
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(({ ref, sess }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess))
  localStorage.setItem('ssi-last-course', 'ita_for_eng')
  localStorage.setItem('ssi-last-course-origin', 'chosen')
}, { ref: REF, sess: session })
const page = await ctx.newPage()
const jsErrors = [], consoleErrors = [], podLogs = [], podResponses = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
  if (/useListeningPods|ListeningMeta|servedPod/.test(m.text())) podLogs.push(m.text().slice(0, 240))
})
page.on('response', async (r) => {
  const u = r.url()
  if (/listening_pod|\/bundle/.test(u)) {
    let len = -1
    try { len = (await r.text()).length } catch {}
    podResponses.push({ url: u.replace(/^https:\/\/[^/]+/, '').slice(0, 160), status: r.status(), len })
  }
})
const out = { url: URL }
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
out.bodyHead = await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\n+/g, ' | '))
const trig = page.locator('.mode-trigger').first()
out.modeTriggerFound = await trig.count()
if (out.modeTriggerFound) {
  await trig.click({ timeout: 5000 }).catch((e) => (out.trigError = String(e).slice(0, 150)))
  await page.waitForTimeout(1500)
  const items = page.locator('.tray-item')
  out.trayItems = await items.allInnerTexts().catch(() => [])
  const listen = items.filter({ hasText: /listen/i }).first()
  if (await listen.count()) await listen.click({ timeout: 5000 }).catch((e) => (out.listenError = String(e).slice(0, 150)))
  // The Dialogues list fetches every listed pod's sentences before it renders
  // a single card; on a cold staging deploy that is well past 9 s. Wait for
  // the first card (or the empty/error state), up to 90 s.
  await page.locator('.scene-card, .scene-empty, .scene-list-wrap .error').first()
    .waitFor({ state: 'visible', timeout: 90000 }).catch((e) => (out.listWaitError = String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  out.viewTabs = await page.locator('.view-tab').allInnerTexts().catch(() => [])
  out.groupHeadings = await page.locator('.scene-group-heading').allInnerTexts().catch(() => [])
  out.sceneCards = await page.locator('.scene-card').count()
  const cards = await page.locator('.scene-card .scene-card-title').allInnerTexts().catch(() => [])
  out.firstCard = cards[0] ?? null
  out.lastCard = cards[cards.length - 1] ?? null
  out.cardNums = await page.locator('.scene-card-num').allInnerTexts().catch(() => [])
  out.sceneEmpty = await page.locator('.scene-empty').allInnerTexts().catch(() => [])
  await page.screenshot({ path: `${OUT_DIR}/${TAG}-list-top.png` }).catch(() => {})
  // Scroll the scene list to the bottom so a second group, if any, is in frame.
  await page.evaluate(() => { const el = document.querySelector('.scene-list-wrap'); if (el) el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT_DIR}/${TAG}-list-bottom.png` }).catch(() => {})
}
out.jsErrors = jsErrors; out.consoleErrors = consoleErrors.slice(0, 8)
out.podLogs = podLogs.slice(0, 12); out.podResponses = podResponses.slice(0, 12)
console.log(JSON.stringify(out, null, 1))
await browser.close()
