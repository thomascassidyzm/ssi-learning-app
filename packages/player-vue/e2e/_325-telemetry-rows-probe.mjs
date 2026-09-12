/**
 * #325 — do live player rows carry mode and belt, and does Listening Mode log
 * per-clip audio_play? Signs in as the Colombo "fresh" fixture, plays a few
 * cycles, toggles mode on the resting overlay, plays more, opens Listening
 * Mode and plays a clip, then flushes. Captures every batch the page POSTs to
 * /api/player-events and prints a summary; the server-side check is psql.
 *
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_KEY=… \
 *   TMPDIR=/tmp/c325 LD_LIBRARY_PATH=~/.pwlibs/root/usr/lib/x86_64-linux-gnu \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   PROBE_URL=https://staging.saysomethingin.app node e2e/_325-telemetry-rows-probe.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = (process.env.PROBE_URL || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const EMAIL = process.env.PROBE_EMAIL || 'thomas.cassidy+colombo-fresh@gmail.com'
const OUT = process.env.PROBE_OUT || '/tmp/_325-probe.json'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json()
  if (!gl.ok || !glj.email_otp) throw new Error(`generate_link: ${gl.status}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json()
  if (!v.ok || !vj.access_token) throw new Error(`verify: ${v.status}`)
  return vj
}

const startedAt = new Date().toISOString()
const session = await mint(EMAIL)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
const page = await ctx.newPage()

const batches = []
const notes = []
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)))
page.on('request', (r) => {
  if (!r.url().includes('/api/player-events')) return
  try { batches.push({ at: new Date().toISOString(), events: JSON.parse(r.postData() || '{}').events || [] }) } catch { notes.push('unparseable batch') }
})
const step = async (name, fn) => {
  try { await fn(); notes.push(`ok: ${name}`) } catch (e) { notes.push(`FAIL: ${name}: ${String(e.message || e).slice(0, 160)}`) }
}
const flush = async () => {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(2500)
}

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(9000)
const version = await fetch(`${BASE}/version.json`).then((r) => r.json()).catch(() => null)

await step('start playback', async () => { await page.locator('.center-btn').first().click({ timeout: 10000 }); await page.waitForTimeout(28000) })
await step('pause to reach the resting overlay', async () => { await page.locator('.center-btn').first().click({ timeout: 10000 }); await page.waitForSelector('.mode-switch-btn', { timeout: 10000 }) })
let toggledTo = null
await step('toggle the mode pill', async () => {
  const pills = page.locator('.mode-switch-btn')
  const n = await pills.count()
  for (let i = 0; i < n; i++) {
    const p = pills.nth(i)
    if ((await p.getAttribute('aria-pressed')) !== 'true') { toggledTo = (await p.innerText()).trim(); await p.click(); break }
  }
  await page.waitForTimeout(1500)
})
await step('resume playback after the toggle', async () => { await page.locator('.center-btn').first().click({ timeout: 10000 }); await page.waitForTimeout(28000) })
await flush()
await step('open Listening Mode', async () => {
  await page.locator('.mode-trigger').first().click({ timeout: 10000 })
  await page.waitForTimeout(800)
  await page.locator('.tray-item', { hasText: /listen/i }).first().click({ timeout: 10000 })
  await page.waitForTimeout(6000)
})
await step('play a clip in Listening Mode', async () => {
  const card = page.locator('.scene-card').first()
  if (await card.count()) { await card.click({ timeout: 5000 }); await page.waitForTimeout(3000) }
  await page.locator('.transport-btn').first().click({ timeout: 10000 })
  await page.waitForTimeout(25000)
})
await flush()
await page.waitForTimeout(1500)

const events = batches.flatMap((b) => b.events)
const summarise = (evs) => {
  const byType = {}
  for (const e of evs) {
    const p = e.payload || {}
    const t = (byType[e.event_type] ||= { rows: 0, withMode: 0, withBelt: 0, modes: {}, belts: {}, cycleTypes: {} })
    t.rows++
    if ('mode' in p) { t.withMode++; t.modes[p.mode] = (t.modes[p.mode] || 0) + 1 }
    if ('belt' in p) { t.withBelt++; t.belts[p.belt] = (t.belts[p.belt] || 0) + 1 }
    if (p.cycleType) t.cycleTypes[p.cycleType] = (t.cycleTypes[p.cycleType] || 0) + 1
  }
  return byType
}
const listeningRows = events.filter((e) => e.event_type === 'audio_play' && e.payload?.cycleType === 'listening_mode')
const out = {
  base: BASE, version, startedAt, endedAt: new Date().toISOString(), email: EMAIL, toggledTo,
  batches: batches.length, events: events.length, byType: summarise(events),
  sampleAudioPlay: events.find((e) => e.event_type === 'audio_play' && e.payload?.cycleType !== 'listening_mode')?.payload ?? null,
  sampleRoundComplete: events.find((e) => e.event_type === 'round_complete')?.payload ?? null,
  sampleListeningModePlay: listeningRows[0]?.payload ?? null,
  listeningModeRows: listeningRows.length,
  sessionIds: [...new Set(events.map((e) => e.session_id))],
  notes, pageErrors,
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
await browser.close()
