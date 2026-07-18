// Verify the Structure surface on the DEPLOYED dev build with a real admin
// session: /admin/structure renders the tree, /admin/setup + /admin/schools
// redirect in, node selection shows the facets (staff / entitlements /
// ways-in strip), and the nav carries the four-idea tab set. Screenshots
// (desktop + mobile) to docs/structure-redesign/img/.
//
//   node --env-file=../../.env --env-file=../../.env.local e2e/structure-redesign/verify-deployed.mjs
//
// Set EXPECT_BUILD=<7-char sha> to gate on version.json first.
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/structure-redesign/img/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

// 0) deploy gate — is the pushed commit actually live?
if (process.env.EXPECT_BUILD) {
  const r = await fetch(`${BASE}/version.json`, { cache: 'no-store' })
  const { buildNumber } = await r.json()
  console.log('deployed build:', buildNumber, 'expecting:', process.env.EXPECT_BUILD)
  if (buildNumber !== process.env.EXPECT_BUILD) {
    console.log('NOT DEPLOYED YET')
    process.exit(2)
  }
}

const URL_SB = process.env.VITE_SUPABASE_URL
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const email = process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com'
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
console.log('admin session ok', v.session.user.id)
const projectRef = new URL(URL_SB).hostname.split('.')[0]

const results = []
function step(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`)
}

const browser = await chromium.launch()

async function makePage(viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  return page
}

// ── Desktop ──
const page = await makePage({ width: 1440, height: 1100 })

await page.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)
step('structure page renders the tree', await page.locator('.groups-tree').count() > 0, page.url())
step('nav shows Structure + Invites flat tabs',
  await page.locator('.tabs > a.tab:has-text("Structure")').count() > 0 &&
  await page.locator('.tabs > a.tab:has-text("Invites")').count() > 0)
await page.screenshot({ path: `${OUT}structure-desktop-tree.png`, fullPage: false })

// redirects in from the dissolved routes
for (const from of ['/admin/setup', '/admin/schools', '/admin']) {
  await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(1500)
  step(`${from} redirects to /admin/structure`, page.url().includes('/admin/structure'), page.url())
}

// select a GROUP node → detail facets
const firstGroup = page.locator('.group-row .group-name-editable').first()
if (await firstGroup.count() > 0) {
  await firstGroup.click()
  await page.waitForTimeout(1200)
  step('group detail panel opens', await page.locator('.detail-title h2').count() > 0,
    await page.locator('.detail-title h2').first().textContent().catch(() => ''))
  step('group facets: ways in + staff + entitlements',
    await page.locator('.facet').count() >= 3)
  await page.screenshot({ path: `${OUT}structure-desktop-group-detail.png`, fullPage: false })
}

// select a SCHOOL node → ways-in strip links into Invites
const firstSchool = page.locator('.entity-row').first()
if (await firstSchool.count() > 0) {
  await firstSchool.click()
  await page.waitForTimeout(1500)
  const waysIn = await page.locator('.waysin-item').count()
  step('school detail shows ways-in strip (2 standing joins)', waysIn === 2, `${waysIn} items`)
  const href = await page.locator('.waysin-item').first().getAttribute('href').catch(() => null)
  step('ways-in links into /admin/invites?q=', !!href && href.includes('/admin/invites?q='), href || '')
  await page.screenshot({ path: `${OUT}structure-desktop-school-detail.png`, fullPage: false })
}

// search filters to a school name and keeps its branch
const anySchoolName = await page.locator('.entity-row .entity-name').first().textContent().catch(() => null)
if (anySchoolName) {
  await page.fill('.filter-bar-input', anySchoolName.trim().slice(0, 12))
  await page.waitForTimeout(800)
  step('search keeps the matching school visible',
    await page.locator(`.entity-row:has-text("${anySchoolName.trim().slice(0, 12)}")`).count() > 0)
  await page.fill('.filter-bar-input', '')
}

// ── Mobile ──
const mob = await makePage({ width: 390, height: 844 })
await mob.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
await mob.waitForTimeout(3000)
step('mobile renders the tree', await mob.locator('.groups-tree').count() > 0)
await mob.screenshot({ path: `${OUT}structure-mobile-tree.png`, fullPage: false })
const mobSchool = mob.locator('.entity-row').first()
if (await mobSchool.count() > 0) {
  await mobSchool.click()
  await mob.waitForTimeout(1200)
  await mob.mouse.wheel(0, 600)
  await mob.waitForTimeout(400)
  await mob.screenshot({ path: `${OUT}structure-mobile-school-detail.png`, fullPage: false })
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
