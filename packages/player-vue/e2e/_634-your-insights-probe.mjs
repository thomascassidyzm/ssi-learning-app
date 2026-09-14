// Job #634 — headless probe: the Library's "Your insights" on a deployed build,
// signed in as a REAL test learner (not view-as). Screenshots the Library entry
// and the open insights panel at desktop and phone width, and the small-course
// case where the percentile is suppressed.
//
// Env: PROBE_JSON (path to { uid, lid, session }), PROBE_BASE (default staging),
//      CHROME_BIN, OUT_DIR. See memory: playwright-needs-ld-library-path.
import { chromium } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.PROBE_BASE || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT_DIR || '/tmp'
const REF = new URL(process.env.SUPABASE_URL || 'https://swfvymspfxmnfhevgdkg.supabase.co').host.split('.')[0]
const { session } = JSON.parse(readFileSync(process.env.PROBE_JSON, 'utf8'))
const BIG = process.env.BIG_COURSE || 'cym_s_for_eng'
const SMALL = process.env.SMALL_COURSE || 'spa_for_eng'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })

async function run(label, viewport, course, { openPanel = true } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${BASE}/?course=${course}&screen=library`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const card = page.locator('[data-testid="your-insights-card"]')
  const found = await card.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)
  console.log(`${label}: url=${page.url()} card=${found} title=${found ? await card.locator('.yi-card-title').innerText() : '-'}`)
  if (!found) { await page.screenshot({ path: `${OUT}/${label}-no-card.png`, fullPage: true }); await ctx.close(); return null }
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/${label}-library.png`, fullPage: false })
  if (!openPanel) { await ctx.close(); return null }
  await card.click()
  const panel = page.locator('[data-testid="your-insights-panel"]')
  await panel.waitFor({ state: 'visible', timeout: 10_000 })
  // Either the widget or an honest status — never a spinner forever.
  await Promise.race([
    page.locator('[data-testid="your-insights-panel"] .rc').waitFor({ state: 'visible', timeout: 45_000 }),
    page.locator('[data-testid="your-insights-panel"] .nre-status:not(:has-text("Loading"))').waitFor({ state: 'visible', timeout: 45_000 }),
  ]).catch(() => {})
  await page.waitForTimeout(1200) // ECharts settle
  await panel.scrollIntoViewIfNeeded()
  await panel.screenshot({ path: `${OUT}/${label}-insights.png` })
  const headline = await page.locator('[data-testid="your-insights-panel"] .rc-stat-row').innerText().catch(() => '(no widget)')
  const status = await page.locator('[data-testid="your-insights-panel"] .nre-status').innerText().catch(() => '')
  const note = await page.locator('[data-testid="rc-percentile-note"]').innerText().catch(() => '')
  const chip = await page.locator('[data-testid="your-insights-panel"] .rc-pct-chip').innerText().catch(() => '')
  const foot = await page.locator('[data-testid="your-insights-panel"] .rc-dist-foot').innerText().catch(() => '')
  console.log(`${label}: headline="${headline.replace(/\n/g, ' ')}" status="${status}" chip="${chip}" note="${note}" foot="${foot.replace(/\n/g, ' ')}"`)
  // The raw contract, for the record.
  const api = await page.evaluate(async ([tok, c]) => {
    const r = await fetch(`/api/me/insights?course_code=${c}`, { headers: { Authorization: `Bearer ${tok}` } })
    const j = await r.json()
    return { status: r.status, applied: j.applied, entity: j.entity?.value, average: j.average?.value, percentile: j.percentile, percentileNote: j.percentileNote, activePeople: j.activePeople, cohortSize: j.cohortSize, insufficientData: j.insufficientData, reason: j.reason, distN: j.distribution?.values?.length, split: j.split, counted: j.counted }
  }, [session.access_token, course])
  console.log(`${label}: api=${JSON.stringify(api)}`)
  if (errors.length) console.log(`${label}: console errors: ${errors.slice(0, 5).join(' | ')}`)
  await ctx.close()
  return api
}

await run('desktop-big', { width: 1280, height: 900 }, BIG)
await run('phone-big', { width: 390, height: 844 }, BIG)
await run('phone-small', { width: 390, height: 844 }, SMALL)
await browser.close()
