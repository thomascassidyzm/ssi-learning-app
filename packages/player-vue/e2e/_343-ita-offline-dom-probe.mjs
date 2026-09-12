// Job #343: ita_for_eng, Offline mode download COMPLETE, browser forced offline,
// dialogue scene in Immersion then Drill — evidence is the current phrase row
// advancing over time (telemetry cannot POST offline).
import { chromium } from '@playwright/test'
const URL = 'https://staging.saysomethingin.app/?course=ita_for_eng'
const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}), args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext(); const page = await ctx.newPage()
const jsErrors = [], consoleErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
const out = {}
const openTray = async (re) => { await page.locator('.mode-trigger').first().click({ timeout: 5000 }); await page.waitForTimeout(1200); const it = page.locator('.tray-item').filter({ hasText: re }).first(); const n = await it.count(); if (n) await it.click({ timeout: 5000 }); return n }
const trayOffline = async () => { await page.locator('.mode-trigger').first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(800); const t = await page.locator('.tray-item').filter({ hasText: /offline/i }).first().innerText().catch(() => null); await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500); return t?.replace(/\n/g, ' | ') }
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = (await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch(() => null))?.buildNumber
await page.waitForTimeout(9000)
await page.locator('.center-btn').first().click({ timeout: 5000 }).catch(() => {})
await page.waitForTimeout(4000)
await openTray(/offline/i); await page.waitForTimeout(3000)
await page.locator('.offline-picker button').filter({ hasText: /^download$/i }).first().click({ timeout: 5000 }).catch((e) => (out.dlError = String(e).slice(0, 100)))
for (let i = 0; i < 60; i++) { await page.waitForTimeout(5000); const t = await trayOffline(); out.offlineTray = t; if (t && !/downloading/i.test(t)) break }
await openTray(/listen/i); await page.waitForTimeout(8000)
await page.locator('.scene-card').first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(4000)
await ctx.setOffline(true); out.forcedOffline = true; await page.waitForTimeout(2000)
out.navigatorOnline = await page.evaluate(() => navigator.onLine)
async function pass(name, mode) {
  await page.locator('.lmt-btn').filter({ hasText: mode }).first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1000)
  await page.locator('.phrase-row').first().click({ timeout: 5000 }).catch(() => {})
  const samples = []
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(5000); samples.push(await page.evaluate(() => { const rows = [...document.querySelectorAll('.phrase-row')]; const c = rows.findIndex((r) => r.classList.contains('current')); return `${c + 1}/${rows.length}:${(rows[c]?.innerText || '').replace(/\n/g, ' ').slice(0, 40)}` })) }
  out[name] = { distinctCurrent: [...new Set(samples)].length, samples, errorsSoFar: jsErrors.length }
  await page.locator('.transport-btn').first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1500)
}
await pass('offline_immersion', /immersion/i)
await pass('offline_drill', /drill/i)
out.jsErrors = jsErrors; out.consoleErrors = [...new Set(consoleErrors)].slice(0, 8)
console.log(JSON.stringify(out, null, 1)); await browser.close()
