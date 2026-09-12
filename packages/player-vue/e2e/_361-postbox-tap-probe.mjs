// Job #361: does the learner bug postbox submit from a REAL phone tap?
// Astra (2026-09-12) refuted #347's "whole pipeline proven": that probe used
// el.click(). This one uses a 390x844 touch context and page.tap on the
// Settings gear, the Report a bug row and the Send button — never el.click,
// never dispatchEvent — then reads bug_reports back with the service key.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (~/.config/ssi-support/env);
// CHROME_BIN, LD_LIBRARY_PATH, short TMPDIR (see memory notes).
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.PROBE_URL || 'https://staging.saysomethingin.app/'
const MARKER = `job361-tap-probe-${Date.now()}`
const TEXT = `PROBE, not a real bug: job #361 house re-check of a real phone tap on Send (${MARKER}). Safe to ignore.`
const out = { url: URL, marker: MARKER, steps: [] }
const step = (name, data) => { out.steps.push({ name, ...data }); console.error(name, JSON.stringify(data)) }

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
})
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))
let apiCall = null
page.on('response', async (r) => {
  if (r.url().includes('/api/report/bug')) apiCall = { status: r.status(), body: (await r.text().catch(() => '')).slice(0, 300) }
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(8000)

// Tap the Settings gear on the bottom nav, as a thumb would.
const gear = page.locator('button.pill-btn:has(circle[r="3"])').first()
step('gear', { found: await gear.count() })
if (await gear.count()) await gear.tap({ timeout: 5000 }).catch((e) => step('gearTapError', { e: String(e).slice(0, 150) }))
await page.waitForTimeout(2000)
const row = page.locator('[data-walk="report-bug"]').first()
step('reportRow', { found: await row.count() })
if (!(await row.count())) { await page.screenshot({ path: `${process.env.CS_SCRATCH}/361-no-row.png` }); console.log(JSON.stringify(out)); await browser.close(); process.exit(4) }
await row.scrollIntoViewIfNeeded().catch(() => {})
await row.tap({ timeout: 5000 }).catch((e) => step('rowTapError', { e: String(e).slice(0, 150) }))
const textarea = page.locator('[data-walk="report-bug-text"]')
await textarea.waitFor({ timeout: 10000 })
await textarea.tap()
await page.keyboard.type(TEXT, { delay: 2 })
await page.waitForTimeout(500)
const send = page.locator('[data-walk="report-bug-send"]')
const box = await send.boundingBox()
step('send', { box, disabled: await send.isDisabled(), text: (await send.textContent())?.trim() })
// Real pointer at the button's own coordinates: touchstart/touchend via CDP.
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
const thanks = await page.locator('[data-walk="report-bug-thanks"]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
await page.screenshot({ path: `${process.env.CS_SCRATCH}/361-after-tap.png` })
step('afterTap', { thanksShown: thanks, apiCall, pageErrors })
await browser.close()

// Read the row back.
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
let rowDb = null
for (let i = 0; i < 10 && !rowDb; i++) {
  const { data } = await svc.from('bug_reports').select('id, body, course_code, app_version, app_shell, device, created_at').ilike('body', `%${MARKER}%`).maybeSingle()
  rowDb = data || null
  if (!rowDb) await new Promise((r) => setTimeout(r, 2000))
}
step('row', rowDb ? { ok: true, id: rowDb.id, app_version: rowDb.app_version, app_shell: rowDb.app_shell, viewport: rowDb.device?.viewport, ua: (rowDb.device?.user_agent || '').slice(0, 40) } : { ok: false })
out.verdict = thanks && rowDb ? 'TAP SUBMITS' : 'TAP DOES NOT SUBMIT'
console.log(JSON.stringify(out, null, 1))
