// Job #650: before/after screenshots of Listening Mode → Dialogues → scene 1 in
// Drill and Immersion at phone width, plus the DOM facts: is the mode caption
// present, is a progress bar present in the scene view. Env: PROBE_URL,
// SESSION_JSON, COURSE, OUT_DIR, TAG, CHROME_BIN.
const { chromium } = await import(process.env.PW_TEST_PKG || '@playwright/test')
import fs from 'fs'

const URL = process.env.PROBE_URL || 'https://staging.saysomethingin.app/'
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const COURSE = process.env.COURSE || 'spa_for_eng'
const OUT_DIR = process.env.OUT_DIR || '.'
const TAG = process.env.TAG || 'probe'

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(({ ref, sess }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess))
  localStorage.setItem('ssi-listening-mode', 'immersion')
}, { ref: REF, sess: session })
const page = await ctx.newPage()
const out = { url: URL, course: COURSE, shots: {} }
page.on('pageerror', (e) => (out.jsErrors ??= []).push(String(e).slice(0, 200)))

const facts = () => page.evaluate(() => ({
  modeDesc: document.querySelector('.listen-mode-desc')?.textContent.trim() ?? null,
  progressBar: !!document.querySelector('.listening-overlay .progress-bar'),
  progressText: document.querySelector('.listening-overlay .progress-text')?.textContent.trim() ?? null,
  topHairline: !!document.querySelector('.listening-overlay .top-progress'),
  sceneStrip: document.querySelector('.scene-strip')?.textContent.trim() ?? null,
  toggle: [...document.querySelectorAll('.lmt-btn')].map((b) => ({ label: b.textContent.trim(), title: b.title || null, active: b.classList.contains('active') })),
  rows: document.querySelectorAll('.listening-overlay .phrase-row').length,
}))

await page.goto(`${URL}?course=${COURSE}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(8000)
const trig = page.locator('.mode-trigger').first()
await trig.click({ timeout: 8000 }).catch((e) => (out.trigError = String(e).slice(0, 150)))
await page.waitForTimeout(1500)
const listen = page.locator('.tray-item').filter({ hasText: /listen/i }).first()
if (await listen.count()) await listen.click({ timeout: 5000 }).catch((e) => (out.listenError = String(e).slice(0, 150)))
await page.locator('.scene-card, .scene-empty, .scene-list-wrap .error').first().waitFor({ state: 'visible', timeout: 90000 }).catch((e) => (out.listWaitError = String(e).slice(0, 120)))
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT_DIR}/${TAG}-pod-list.png` })
out.shots.podList = `${TAG}-pod-list.png`
// Pod cards first (pod list), then scene cards inside the pod.
const podCard = page.locator('.scene-card.pod-card').first()
if (await podCard.count()) { await podCard.click(); await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT_DIR}/${TAG}-scene-list.png` }); out.shots.sceneList = `${TAG}-scene-list.png` }
const sceneCard = page.locator('.scene-card:not(.pod-card)').first()
await sceneCard.click({ timeout: 8000 }).catch((e) => (out.sceneError = String(e).slice(0, 150)))
await page.locator('.listening-overlay .phrase-row').first().waitFor({ state: 'visible', timeout: 30000 }).catch((e) => (out.rowsWaitError = String(e).slice(0, 120)))
await page.waitForTimeout(1200)
out.immersion = await facts()
await page.screenshot({ path: `${OUT_DIR}/${TAG}-immersion.png` })
out.shots.immersion = `${TAG}-immersion.png`
await page.locator('.lmt-btn').filter({ hasText: /drill/i }).first().click({ timeout: 5000 }).catch((e) => (out.drillError = String(e).slice(0, 150)))
await page.waitForTimeout(1200)
out.drill = await facts()
await page.screenshot({ path: `${OUT_DIR}/${TAG}-drill.png` })
out.shots.drill = `${TAG}-drill.png`
fs.writeFileSync(`${OUT_DIR}/${TAG}-facts.json`, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
await browser.close()
