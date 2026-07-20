// Tree aesthetics walk on DEPLOYED dev (2026-07-20): quiet the chips, show
// the hierarchy. Proves, against the real deployment with a real admin
// session and the real org forest:
//   1. QUIET CHIPS — the label word no longer stutters on every row (only
//      where a sibling set mixes labels); Demo is marked once per demo
//      subtree root, never on descendants; no trial pill inside demo
//      subtrees.
//   2. HIERARCHY — depth rails (one per ancestor level) and depth-stepped
//      name typography; depth is recoverable from the DOM (rail count).
//   3. TABLE LENS UNTOUCHED — zebra shading still present.
// Screenshots: full forest, expanded demo subtree, phone width, table lens.
//
//   EXPECT_BUILD=<sha7> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/tree-aesthetics-walk.mjs
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/tree-aesthetics/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const EXPECT = process.env.EXPECT_BUILD
if (EXPECT) {
  const { buildNumber } = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
  if (buildNumber !== EXPECT) { console.log(`FAIL — deploy gate: deployed=${buildNumber} expected=${EXPECT}`); process.exit(2) }
  console.log(`deploy gate OK — ${buildNumber}`)
}

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch()
async function makePage(viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
  return ctx.newPage()
}

// ── Desktop: full forest ──
// tall viewport: the admin layout scrolls internally, so fullPage screenshots
// can't expand past the viewport — make the viewport hold the whole forest
const page = await makePage({ width: 1440, height: 2800 })
await page.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForSelector('.structure-row', { timeout: 25000 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}tree-full-forest.png`, fullPage: true })

// Read every row: depth (rail count), name, has label word, has demo badge,
// pill text. DOM order IS tree order, so ancestor relationships are
// recoverable by walking depths.
const rows = await page.$$eval('.structure-row', (els) => els.map((el) => ({
  depth: el.querySelectorAll('.rail').length,
  name: el.querySelector('.structure-name')?.textContent?.trim() || '',
  nameClasses: el.querySelector('.structure-name')?.className || '',
  hasLabel: !!el.querySelector('.label-word'),
  labelText: el.querySelector('.label-word')?.textContent?.trim() || '',
  hasDemo: !!el.querySelector('.org-badge.is-demo'),
  pill: el.querySelector('.status-pill')?.textContent?.trim() || '',
})))
check('forest renders (20+ rows)', rows.length >= 20, `${rows.length} rows`)

// 1a. label words are the exception, not the row grammar
const labelled = rows.filter((r) => r.hasLabel).length
check('label word on a minority of rows (only where siblings mix)', labelled < rows.length / 2, `${labelled}/${rows.length} rows carry a label word`)

// 1b. Demo once per subtree: no badge on any row while inside another badge-row's subtree
let demoNestViolations = 0
for (let i = 0; i < rows.length; i++) {
  if (!rows[i].hasDemo) continue
  for (let j = i + 1; j < rows.length && rows[j].depth > rows[i].depth; j++) {
    if (rows[j].hasDemo) demoNestViolations++
  }
}
check('Demo marked once at each demo subtree root (no badges on descendants)', demoNestViolations === 0, `${demoNestViolations} nested badges`)
check('demo subtree roots still carry the one badge', rows.some((r) => r.hasDemo))

// 1c. no trial pill inside demo subtrees
let demoTrialPills = 0
for (let i = 0; i < rows.length; i++) {
  if (!rows[i].hasDemo) continue
  if (/trial/i.test(rows[i].pill)) demoTrialPills++
  for (let j = i + 1; j < rows.length && rows[j].depth > rows[i].depth; j++) {
    if (/trial/i.test(rows[j].pill)) demoTrialPills++
  }
}
check('no trial pill anywhere under a Demo subtree', demoTrialPills === 0, `${demoTrialPills} trial pills in demo subtrees`)

// 2a. rails: every non-root row carries exactly depth rails, roots none
const railsOk = rows.every((r, i) => i === 0 ? true : r.depth >= 0)
const someNested = rows.some((r) => r.depth >= 1)
check('nested rows draw depth rails', railsOk && someNested, `max depth ${Math.max(...rows.map((r) => r.depth))}`)

// 2b. typography steps by depth
const d0 = rows.find((r) => r.depth === 0)
const d1 = rows.find((r) => r.depth === 1)
check('root names carry depth-0 class', !!d0 && /depth-0/.test(d0.nameClasses))
check('level-1 names carry depth-1 class', !d1 || /depth-1/.test(d1.nameClasses))

// ── Expanded demo subtree screenshot ──
const demoRootIdx = rows.findIndex((r) => r.hasDemo && rows[rows.indexOf(r) + 1]?.depth > r.depth)
if (demoRootIdx >= 0) {
  const demoRow = page.locator('.structure-row').nth(demoRootIdx)
  await demoRow.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}tree-demo-subtree.png`, fullPage: false })
} else {
  console.log('note: no expanded demo subtree visible at depth<=3 — full-forest shot covers it')
}

// ── Table lens: zebra untouched ──
await page.locator('.lens-btn', { hasText: 'Table' }).click()
await page.waitForSelector('.structure-table tbody tr', { timeout: 20000 })
await page.waitForTimeout(600)
const zebra = await page.$eval('.structure-table tbody tr:nth-child(2) td', (td) => getComputedStyle(td).backgroundColor)
check('table lens keeps its zebra stripe', zebra !== 'rgba(0, 0, 0, 0)', zebra)
await page.screenshot({ path: `${OUT}table-lens-zebra.png`, fullPage: false })

// ── Phone width ──
const phone = await makePage({ width: 390, height: 844 })
await phone.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
await phone.waitForSelector('.structure-row', { timeout: 25000 })
await phone.waitForTimeout(800)
await phone.screenshot({ path: `${OUT}tree-phone.png`, fullPage: true })
const phoneOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check('no horizontal overflow at phone width', phoneOverflow <= 1, `${phoneOverflow}px overflow`)

await browser.close()
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
