/**
 * Job #306 probe: THE PAGE'S ONE IDIOM, checked against the deployed app.
 *
 * Loads the St Alban's leader home on staging under View-as (ssi_admin →
 * leejames, School leader) at phone width, and asserts that every list with
 * more than three rows renders exactly three plus a Show all control, and that
 * tapping the control reveals the rest and folds back. Then the Chepstow
 * classes page under View-as angharadjones, same assertions on the class
 * table. Shoots both pages at 390px. Exit 1 on any failed assertion — run it
 * by hand, or from a nightly, and red is the finding.
 *
 *   set -a; . /home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env; set +a
 *   TMPDIR=/tmp LD_LIBRARY_PATH=~/.pwlibs/root/usr/lib/x86_64-linux-gnu:~/cslibs/root/usr/lib/x86_64-linux-gnu \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   SHOTS=$CS_SCRATCH/shots node e2e/_306-top-three-probe.mjs
 *
 * BASE defaults to staging; SHOTS to $TMPDIR/shots. The View-as personas are
 * the two real school leaders Tom checks the page as; the probe never signs
 * in as them — it signs in as the admin and reads their school, which is the
 * same page they see.
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || path.join(process.env.TMPDIR || '/tmp', 'shots')
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const PERSONAS = {
  leejames: { key: 'user:be35b6de-96d5-4900-b6b8-e6c4ab8360d9', userId: 'be35b6de-96d5-4900-b6b8-e6c4ab8360d9', role: 'school_admin', name: 'leejames' },
  angharadjones: { key: 'user:96105179-6598-4f2b-9281-a1d28270581b', userId: '96105179-6598-4f2b-9281-a1d28270581b', role: 'school_admin', name: 'angharadjones' },
}
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json()
  if (!gl.ok || !glj.email_otp) throw new Error(`generate_link: ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json()
  if (!v.ok || !vj.access_token) throw new Error(`verify: ${v.status} ${JSON.stringify(vj).slice(0, 200)}`)
  return vj
}
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1000)
}
async function fullPageShot(page, file) {
  const tall = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)).catch(() => 900)
  await page.setViewportSize({ width: 390, height: Math.min(Math.max(844, tall + 40), 12000) })
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: true })
}

const session = await mint(ADMIN_EMAIL)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })

async function openAs(persona, route) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v, pk, pv]) => { try { localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(persona)])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`pageerror: ${String(e.message).slice(0, 200)}`))
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  return { ctx, page }
}

// ── 1. St Alban's leader home as leejames ──
{
  const { ctx, page } = await openAs(PERSONAS.leejames, '/schools')
  check('leader home reached under View-as leejames', /\/org\//.test(page.url()), page.url())
  await page.waitForSelector('.node-home .identity-name', { timeout: 30000 }).catch(() => {})
  const text = await page.evaluate(() => document.body.innerText)
  check('headline says "practised", never "spoken"', /Phrases practised this week/i.test(text) && !/phrases spoken/i.test(text))
  check('year-group tiles render', await page.locator('[data-walk="node-year-groups"] .year-tile').count() >= 1)

  // Ways In: > 3 links at St Alban's → grouped rows + Show all; open, count, fold.
  const groups = await page.locator('.ways-in-group').count()
  const showAll = page.locator('[data-walk="ways-in-show-all"]')
  check('Ways In folds to grouped rows with a Show all control', groups >= 1 && (await showAll.count()) === 1, `${groups} groups`)
  const foldedLabel = (await showAll.count()) ? await showAll.innerText() : ''
  const n = Number((foldedLabel.match(/Show all (\d+)/) || [])[1] || 0)
  await fullPageShot(page, '306-stalbans-home-390.png')
  if (await showAll.count()) {
    await showAll.click()
    await page.waitForTimeout(500)
    const rows = await page.locator('.ways-in-table tbody tr').count()
    check('Show all opens every link row', rows === n && rows > 3, `${rows} of ${n}`)
    const fewer = page.locator('.ways-in .show-all[data-show-all="fewer"]')
    check('open ledger offers Show fewer', (await fewer.count()) === 1)
    await fewer.click()
    await page.waitForTimeout(300)
    check('Show fewer folds the ledger back', (await page.locator('.ways-in-table tbody tr').count()) === 0)
  }
  // Below this: with more than three classes the tree shows three + Show all.
  const classRows = await page.locator('.tree-row.is-class').count()
  const treeMore = page.locator('.tree-more .show-all[data-show-all="all"]')
  check('Below this shows three classes then Show all', classRows === 3 && (await treeMore.count()) >= 1, `${classRows} rows, ${await treeMore.count()} controls`)
  if (await treeMore.count()) {
    await treeMore.first().click()
    await page.waitForTimeout(300)
    check('Show all reveals the rest of the classes', (await page.locator('.tree-row.is-class').count()) > 3)
  }
  // Phrases: three rows + Show all when the school practised more than three phrases.
  const phraseRows = await page.locator('[data-walk="node-phrases"] tbody tr').count()
  const phraseMore = await page.locator('[data-walk="node-phrases"] .show-all').count()
  check('phrase table shows at most three rows, with a control when there are more', phraseRows <= 3 && (phraseRows < 3 || phraseMore === 1), `${phraseRows} rows, ${phraseMore} controls`)
  await ctx.close()
}

// ── 2. Chepstow classes page as angharadjones ──
{
  const { ctx, page } = await openAs(PERSONAS.angharadjones, '/schools/classes')
  await page.waitForSelector('[data-walk="classes-table"]', { timeout: 30000 }).catch(() => {})
  const rows = await page.locator('[data-walk="classes-table"] tbody tr').count()
  const control = page.locator('.table-show-all .show-all')
  check('classes table shows three rows then Show all', rows === 3 && (await control.count()) === 1, `${rows} rows`)
  check('year-group tiles render on the classes page', await page.locator('[data-walk="classes-year-groups"] .year-tile').count() >= 1)
  await fullPageShot(page, '306-chepstow-classes-390.png')
  if (await control.count()) {
    const label = await control.innerText()
    const n = Number((label.match(/Show all (\d+)/) || [])[1] || 0)
    await control.click()
    await page.waitForTimeout(500)
    check('Show all reveals every class row', (await page.locator('[data-walk="classes-table"] tbody tr').count()) === n && n > 3, `${n}`)
  }
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join('; ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
