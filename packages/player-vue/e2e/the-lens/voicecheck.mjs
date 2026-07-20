// THE LENS voice re-walk: every rate-compare card must speak AS the selected
// entity (founder ruling 2026-07-19) — never "YOU" for a class/school node,
// compare-to prefilled with the nearest ancestor, honest ordinal rank for tiny
// cohorts, and position lines carrying LEGO content (never raw S/L ids).
//
//   EXPECT_BUILD=<sha> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-lens/voicecheck.mjs
//
// Screenshots land in docs/the-lens/ (committed as walk evidence).
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-lens/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const EXPECT = process.env.EXPECT_BUILD
if (EXPECT) {
  const { buildNumber } = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
  if (buildNumber !== EXPECT) { console.log(`FAIL — deploy gate: deployed=${buildNumber} expected=${EXPECT}`); process.exit(2) }
}

// Demo nodes (live DB, is_demo subtrees):
const CLASS_ID = '6cd8d7e0-4f27-4f8a-b346-90f9403e48c8'   // Rang a Trí — 1 of 3 classes in Gaelscoil na Mara
const SCHOOL_ID = '2fd27c83-936f-4810-a88b-7d7b32315cee'  // Sunrise Public School, Pune — 1 of 2 schools in IME Demo Programme

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

async function walkNode(path, shot, expects) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.rc, .nre-status', { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(1500)
  const body = await p.locator('body').innerText().catch(() => '')
  for (const [label, re] of expects) check(`${shot}: ${label}`, re.test(body), (body.match(re) || [])[0] || 'not found')
  // The card must never claim to be the viewer.
  check(`${shot}: no "YOU v" voice`, !/\bYOU v\b/.test(body))
  check(`${shot}: no "Where you sit"`, !/Where you sit/i.test(body))
  check(`${shot}: no raw S/L position ids`, !/Furthest LEGO · S\d+ · L\d+/.test(body))
  await p.screenshot({ path: `${OUT}${shot}.png`, fullPage: true })
  await p.close()
}

// 1) CLASS node — Rang a Trí v Gaelscoil na Mara avg, siblings = the other 2 classes.
await walkNode(`/admin/classes/${CLASS_ID}/insights`, 'voice-class', [
  ['subject is the class', /Rang a Trí/],
  ['compare-to defaults to the school', /Gaelscoil na Mara average/],
  ['cohort copy', /Where this class sits · classes in Gaelscoil na Mara/i],
])

// 2) SCHOOL node — Sunrise Pune v IME Demo Programme avg, siblings = peer schools.
await walkNode(`/admin/schools/${SCHOOL_ID}/analytics`, 'voice-school', [
  ['subject is the school', /Sunrise Public School/],
  ['compare-to defaults to the programme', /IME Demo Programme average/],
  ['cohort copy', /Where this school sits · schools in IME Demo Programme/i],
])

// 3) Demo Rate-compare board (/admin/stats) — learner, class, school levels.
{
  const p = await ctx.newPage()
  await p.goto(`${BASE}/admin/stats`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.getByRole('tab', { name: /Rate compare/i }).click({ timeout: 20000 })
    .catch(async () => { await p.locator('.board-tab', { hasText: 'Rate compare' }).click() })
  await p.waitForSelector('.rc', { timeout: 20000 })

  for (const level of ['Learner', 'Class', 'School']) {
    await p.locator('.rtb-seg', { hasText: level }).click()
    await p.waitForTimeout(700)
    const body = await p.locator('body').innerText().catch(() => '')
    const compareVal = await p.locator('.rtb-field:has-text("Compare to") select, label:has-text("Compare to") select')
      .first().evaluate((el) => el.selectedOptions[0]?.textContent?.trim() ?? '')
      .catch(() => '')
    check(`board ${level}: compare-to prefilled (never empty)`, compareVal.length > 0, compareVal)
    check(`board ${level}: no "Where you sit"`, !/Where you sit/i.test(body))
    check(`board ${level}: no raw S/L ids`, !/Furthest LEGO · S\d+ · L\d+/.test(body))
    if (level === 'Class') {
      check('board Class: cohort = sibling classes copy', /Where this class sits · classes in /i.test(body))
      check('board Class: honest tiny-n rank (no 100th pctl of own members)', /\d+(st|nd|rd|th) of \d+/.test(body))
    }
    await p.screenshot({ path: `${OUT}board-${level.toLowerCase()}.png`, fullPage: true })
  }
  await p.close()
}

await browser.close()
console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
