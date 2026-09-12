// Job #343 (Tom, flight): ita_for_eng, Offline mode ON with downloaded content,
// Listening Mode dialogue scene, Immersion then Drill, network up then forced off.
import { chromium } from '@playwright/test'
const URL = process.env.PROBE_URL || 'https://staging.saysomethingin.app/?course=ita_for_eng'
const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}), args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext()
const page = await ctx.newPage()
const jsErrors = [], consoleErrors = [], events = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
page.on('request', (r) => { if (r.url().includes('/api/player-events') && r.method() === 'POST') { try { for (const ev of JSON.parse(r.postData() || '{}').events || []) events.push(ev) } catch {} } })
const out = { url: URL, passes: {} }
const text = (sel) => page.locator(sel).first().innerText().catch(() => null)
const openTray = async (re) => { await page.locator('.mode-trigger').first().click({ timeout: 5000 }); await page.waitForTimeout(1200); const it = page.locator('.tray-item').filter({ hasText: re }).first(); const n = await it.count(); if (n) await it.click({ timeout: 5000 }); return n }
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
out.courseOnScreen = (await page.evaluate(() => document.body.innerText.slice(0, 400)))?.replace(/\n/g, ' | ')
await page.locator('.center-btn').first().click({ timeout: 5000 }).catch((e) => (out.startError = String(e).slice(0, 120)))
await page.waitForTimeout(6000)
// Offline mode ON → picker → download
out.offlineTrayBefore = await page.locator('.tray-item').filter({ hasText: /offline/i }).first().innerText().catch(() => null)
out.offlineItem = await openTray(/offline/i)
await page.waitForTimeout(3000)
out.pickerSeen = await page.locator('.offline-picker').count()
out.pickerText = (await text('.offline-picker'))?.replace(/\n/g, ' | ').slice(0, 300)
const dl = page.locator('.offline-picker button.offline-depth-download, .offline-picker button').filter({ hasText: /download|take|offline/i }).first()
out.downloadBtn = await dl.innerText().catch(() => null)
await dl.click({ timeout: 5000 }).catch((e) => (out.dlError = String(e).slice(0, 120)))
// wait for the picker to close and the download to settle
for (let i = 0; i < 40; i++) { await page.waitForTimeout(3000); if (!(await page.locator('.offline-picker').count())) break }
await page.waitForTimeout(20000)
await page.locator('.mode-trigger').first().click({ timeout: 5000 }).catch(() => {})
await page.waitForTimeout(1000)
out.offlineTrayAfter = await page.locator('.tray-item').filter({ hasText: /offline/i }).first().innerText().catch(() => null)
out.offlineKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('offline')).map((k) => k + '=' + String(localStorage.getItem(k)).slice(0, 60)))
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(800)
// Listening Mode → first dialogue scene
out.listenItem = await openTray(/listen/i)
await page.waitForTimeout(8000)
out.sceneCards = await page.locator('.scene-card').count()
out.overlayHead = (await page.evaluate(() => document.body.innerText.slice(0, 500)))?.replace(/\n/g, ' | ')
async function runPass(name, mode) {
  const before = events.length
  const card = page.locator('.scene-card').first()
  if (await card.count()) { await card.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(5000) }
  const btn = page.locator('.lmt-btn').filter({ hasText: mode }).first()
  const modeBtn = await btn.count()
  if (modeBtn) await btn.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const row = page.locator('.phrase-row').first()
  const rows = await row.count()
  if (rows) await row.click({ timeout: 5000 }).catch(() => {}); else await page.locator('.transport-btn').first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(75000)
  const mine = events.slice(before).filter((e) => e.event_type === 'audio_play' && e.payload?.mode === 'listening')
  const idx = [...new Set(mine.map((e) => e.payload.phraseIndex))]
  out.passes[name] = { modeBtn, rows, listeningClips: mine.length, listenModes: [...new Set(mine.map((e) => e.payload.listenMode))], phraseIndexes: idx.slice(0, 40), scenes: [...new Set(mine.map((e) => e.payload.sceneNumber))], okFalse: mine.filter((e) => e.payload.ok === false).length, cacheHits: mine.filter((e) => e.payload.cacheHit).length, seedIds: [...new Set(mine.map((e) => e.payload.seedId))].slice(0, 12), screen: (await page.evaluate(() => document.body.innerText.slice(0, 260)))?.replace(/\n/g, ' | ') }
  await page.locator('.transport-btn').first().click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(1500)
}
await runPass('online_immersion', /immersion/i)
await runPass('online_drill', /drill/i)
await ctx.setOffline(true)
out.forcedOffline = true
await page.waitForTimeout(3000)
await runPass('offline_immersion', /immersion/i)
await runPass('offline_drill', /drill/i)
await ctx.setOffline(false); await page.waitForTimeout(8000) // let the buffer flush
out.sessions = [...new Set(events.map((e) => e.session_id))]
out.jsErrors = jsErrors; out.consoleErrors = [...new Set(consoleErrors)].slice(0, 8)
console.log(JSON.stringify(out, null, 1))
await browser.close()
