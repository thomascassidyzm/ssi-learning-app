// Job #302, half one corrected: sign in AS a real school admin (Tom's own test-scenario
// account, Angharad ZZ Test at "ZZ Test — Chepstow scenario"), no View-as, and walk the
// in-app support channel: entry point, compose, a posted message, and the stats-door sheet.
// This WRITES one or two support messages to the test school's thread, deliberately.
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'
const BASE = 'https://staging.saysomethingin.app'
const SHOTS = process.env.SHOTS
const EMAIL = process.env.LEADER_EMAIL || 'thomas.cassidy+chepstowtest-leader@gmail.com'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL.trim(), ANON = process.env.VITE_SUPABASE_ANON_KEY.trim(), SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!glj.email_otp) throw new Error('generate_link: ' + JSON.stringify(glj).slice(0, 200))
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!vj.access_token) throw new Error('verify: ' + JSON.stringify(vj).slice(0, 200)); return vj
}
const settle = async (p) => { await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(2000) }
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const session = await mint(EMAIL)
console.log('signed in as', session.user?.id, session.user?.email)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
const page = await ctx.newPage()
const errors = []
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`${r.status()} ${r.url().slice(0, 100)}`) })
const out = []
const shot = async (name, note) => { const f = path.join(SHOTS, `real--${name}.png`); await page.screenshot({ path: f }); out.push({ name, url: page.url(), note, errors: errors.splice(0) }); console.log(name, '|', page.url(), '|', note) }
try {
  await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  await shot('01-landing', 'a real school admin, no View-as, landing from /schools')
  // The entry point: the avatar, tapped by a finger.
  await page.locator('.user-trigger').first().click({ timeout: 10000 })
  await page.waitForTimeout(500)
  const items = await page.locator('.user-menu-pop .menu-item').allInnerTexts().catch(() => [])
  await shot('02-menu-open', `avatar tapped: ${JSON.stringify(items)}`)
  await page.locator('.user-menu-pop .menu-item-support').first().click({ timeout: 10000 })
  await settle(page)
  await shot('03-support-page', 'Support tapped in the menu')
  // Compose.
  const msg = `Test from job #302, ${new Date().toISOString().slice(0, 16)}Z — how do I add a second teacher to a class?`
  await page.locator('textarea').first().fill(msg)
  await page.waitForTimeout(300)
  await shot('04-compose-typed', 'message typed, Send enabled')
  await page.locator('button:has-text("Send")').first().click({ timeout: 10000 })
  await page.waitForTimeout(3000)
  await shot('05-posted', 'after Send: the posted message in the thread')
  // Wait a while to see whether anything answers.
  await page.waitForTimeout(90000)
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)
  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  await shot('06-thread-after-90s', `thread after 90 s and a reload; text: ${bodyText.slice(0, 300)}`)
  // Door one: the stats sheet on the org lens.
  await page.goto(`${BASE}/org/648185c9-78cf-48bd-98bd-8a5dd73670d5`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  const ask = page.locator('.ask-support').first()
  await ask.scrollIntoViewIfNeeded().catch(() => {})
  await shot('07-org-lens-stats', `org lens as a real admin; ask-support count=${await page.locator('.ask-support').count()}`)
  await ask.click({ timeout: 10000 })
  await page.waitForTimeout(600)
  await page.locator('.sheet-input').first().fill('Test from job #302 — is 0 minutes this week right for this school?')
  await shot('08-sheet-typed', 'Does this look wrong sheet with text')
  await page.locator('.sheet-actions .btn-play').first().click({ timeout: 10000 })
  await page.waitForTimeout(2500)
  await shot('09-sheet-sent', (await page.locator('.sheet-sent').first().innerText().catch(() => 'no sent note')))
  await page.goto(`${BASE}/schools/support`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
  await shot('10-thread-both', 'the thread with both messages')
} finally { await browser.close() }
fs.writeFileSync(path.join(SHOTS, 'manifest-real.json'), JSON.stringify(out, null, 2)); console.log('done')
