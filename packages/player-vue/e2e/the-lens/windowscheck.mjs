// THE LENS windows+measures walk: window chips set BOTH the headline period
// and the chart span (honest-pace), the measure picker carries the four
// telemetry-backed measures, and the compare-to menu offers the full ancestor
// chain at every depth (the live tree is 2 tiers deep, so a root's chain is
// honestly just the globals). Voice rules must not regress.
//
//   EXPECT_BUILD=<sha> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-lens/windowscheck.mjs
//
// Screenshots land in docs/the-lens/ as jpg (network prefers small pushes).
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

// Live demo nodes (2-tier forest: root programme/region → school nodes → classes)
const CLASS_ID = '6cd8d7e0-4f27-4f8a-b346-90f9403e48c8'   // Rang a Trí — Gaelscoil na Mara → Gaelscoileanna Píolótach
const SCHOOL_ID = '2fd27c83-936f-4810-a88b-7d7b32315cee'  // Sunrise Public School, Pune → IME Demo Programme
const ROOT_GROUP_ID = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a' // IME Demo Programme — a ROOT (no ancestors in the data)

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
const TOKEN = v.session.access_token

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// ─────────────────────────────────────────────────────────────────────────────
// PART A — API contract at every depth (exact assertions, one round trip each)
// ─────────────────────────────────────────────────────────────────────────────
async function api(id, qs = '') {
  const r = await fetch(`${BASE}/api/groups/${id}/rate-compare${qs}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  check(`API ${id.slice(0, 8)}${qs || ''}: 200`, r.ok, String(r.status))
  return r.ok ? r.json() : {}
}

{ // CLASS depth — chain: own school → its root → globals (4 options)
  const j = await api(CLASS_ID)
  const compares = j.options?.compares?.map((o) => o.label) ?? []
  check('class: windows offered (4 chips)', j.options?.windows?.length === 4, JSON.stringify(j.options?.windows?.map((w) => w.label)))
  check('class: default window = term', j.applied?.window === 'term', j.applied?.window)
  check('class: trendLabel weekly·12', j.trendLabel === 'Weekly · last 12 weeks', j.trendLabel)
  check('class: measures = 3 (no active_classes at class level)',
    j.options?.measures?.length === 3 && !j.options.measures.some((m) => m.value === 'active_classes'),
    JSON.stringify(j.options?.measures?.map((m) => m.value)))
  check('class: full compare chain (school → root → 2 globals)',
    compares.length === 4 && compares[0].includes('Gaelscoil na Mara') && compares[1].includes('Gaelscoileanna Píolótach'),
    JSON.stringify(compares))
  check('class: forced active_classes falls back to rate',
    (await api(CLASS_ID, '?measure=active_classes')).applied?.measure === 'rate')
}

{ // SCHOOL depth — chain: root programme → globals (3 options)
  const j = await api(SCHOOL_ID)
  const compares = j.options?.compares?.map((o) => o.label) ?? []
  check('school: full compare chain (programme → 2 globals)',
    compares.length === 3 && compares[0] === 'IME Demo Programme average', JSON.stringify(compares))
  check('school: measures = 4', j.options?.measures?.length === 4, JSON.stringify(j.options?.measures?.map((m) => m.value)))
  // Window math: chip sets headline period AND chart span together.
  const wk = await api(SCHOOL_ID, '?window=week')
  check('school week: daily·7 trend', wk.trendLabel === 'Daily · last 7 days' && wk.trendPeriodDays === 1
    && (wk.entity?.trend?.length ?? 0) <= 7, `${wk.trendLabel} · ${wk.entity?.trend?.length} pts`)
  const all = await api(SCHOOL_ID, '?window=all')
  check('school all-time: monthly·12 trend', all.trendLabel === 'Monthly · last 12 months' && all.trendPeriodDays === 30, all.trendLabel)
  // Measures carry the same grammar with honest units.
  const min = await api(SCHOOL_ID, '?measure=minutes_per_class')
  check('school minutes_per_class: min/week', min.unit === 'min' && min.per === 'week' && typeof min.entity?.value === 'number',
    `${min.unit}/${min.per} = ${min.entity?.value}`)
  const hrs = await api(SCHOOL_ID, '?measure=hours_total')
  check('school hours_total: hours unit', hrs.unit === 'hours' && typeof hrs.entity?.value === 'number', `${hrs.entity?.value} hours`)
  const act = await api(SCHOOL_ID, '?measure=active_classes')
  check('school active_classes: % unit', act.unit === '%' && typeof act.entity?.value === 'number', `${act.entity?.value}%`)
  // Legacy ?days= stays byte-compatible (no window param).
  const legacy = await api(SCHOOL_ID, '?days=60')
  check('school legacy days=60: custom window honoured', (legacy.windowLabel || '').includes('60'), legacy.windowLabel)
}

{ // ROOT/region depth — no ancestors exist in the data: globals only, honestly.
  const j = await api(ROOT_GROUP_ID)
  const compares = j.options?.compares?.map((o) => o.label) ?? []
  check('root: compare menu = the 2 globals (tree is 2 tiers — data, not code)',
    compares.length === 2 && compares.every((c) => c.startsWith('Global average')), JSON.stringify(compares))
  check('root: windows + measures still offered', j.options?.windows?.length === 4 && (j.options?.measures?.length ?? 0) >= 3)
}

// ─────────────────────────────────────────────────────────────────────────────
// PART B — UI walk (screenshots as evidence; voice rules must not regress)
// ─────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])

async function voiceGuards(shot, body) {
  check(`${shot}: no "YOU v" voice`, !/\bYOU v\b/.test(body))
  check(`${shot}: no "Where you sit"`, !/Where you sit/i.test(body))
  check(`${shot}: no raw S/L position ids`, !/Furthest LEGO · S\d+ · L\d+/.test(body))
}

async function shootReady(p, shot) {
  await p.waitForTimeout(600)
  await p.screenshot({ path: `${OUT}${shot}.jpg`, fullPage: true, type: 'jpeg', quality: 80 })
}

// Poll body text for the expected read (the fetch after a chip/measure change
// can outlast any fixed sleep — wait for the card to actually say the thing).
async function waitForText(p, re, timeout = 20000) {
  const t0 = Date.now()
  let body = ''
  while (Date.now() - t0 < timeout) {
    body = await p.locator('body').innerText().catch(() => '')
    if (re.test(body)) return body
    await p.waitForTimeout(400)
  }
  return body
}

async function pickMeasure(p, label) {
  await p.locator('label:has-text("Measure") button').first().click()
  await p.locator('[role="listbox"] [role="option"]', { hasText: label }).first().click()
  await waitForText(p, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
}

{ // SCHOOL node — chips + measures, the founder's main surface.
  const p = await ctx.newPage()
  await p.goto(`${BASE}/admin/schools/${SCHOOL_ID}/analytics`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.rc, .nre-status', { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(1500)
  let body = await p.locator('body').innerText().catch(() => '')
  check('UI school: chips render, This term active',
    await p.locator('.wc-chip.active', { hasText: 'This term' }).count() === 1)
  check('UI school: default caption weekly·12', /Weekly · last 12 weeks/i.test(body))
  await voiceGuards('ui-school-default', body)
  await shootReady(p, 'windows-school-term')

  await p.locator('.wc-chip', { hasText: 'This week' }).click()
  body = await waitForText(p, /Daily · last 7 days/i)
  check('UI school week: caption daily·7', /Daily · last 7 days/i.test(body))
  check('UI school week: URL persists ?window=week', p.url().includes('window=week'), p.url())
  await shootReady(p, 'windows-school-week')

  await p.locator('.wc-chip', { hasText: 'All time' }).click()
  body = await waitForText(p, /Monthly · last 12 months/i)
  check('UI school all: caption monthly·12', /Monthly · last 12 months/i.test(body))
  await shootReady(p, 'windows-school-all')

  // Back to term, then walk the measures.
  await p.locator('.wc-chip', { hasText: 'This term' }).click()
  await waitForText(p, /Weekly · last 12 weeks/i)
  await pickMeasure(p, 'Practice minutes per class')
  body = await waitForText(p, /min \/ week/i)
  check('UI school minutes: MIN / WEEK caption', /min \/ week/i.test(body))
  check('UI school minutes: URL persists ?measure=', p.url().includes('measure=minutes_per_class'), p.url())
  await shootReady(p, 'measure-school-minutes')

  await pickMeasure(p, 'Practice hours')
  body = await waitForText(p, /Practice hours/i)
  check('UI school hours: hours caption', /Practice hours/i.test(body) && /hours/i.test(body))
  await shootReady(p, 'measure-school-hours')

  await pickMeasure(p, 'Active classes share')
  body = await waitForText(p, /Active classes share[\s\S]*%/i)
  check('UI school active share: % suffix on headline', /%/.test(body) && /Active classes share/i.test(body))
  await shootReady(p, 'measure-school-active')
  await p.close()
}

{ // CLASS node — chips work, measure list is the 3-strong class set.
  const p = await ctx.newPage()
  await p.goto(`${BASE}/admin/classes/${CLASS_ID}/insights`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.rc, .nre-status', { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(1500)
  const body = await p.locator('body').innerText().catch(() => '')
  check('UI class: chips render', await p.locator('.wc-chip').count() === 4)
  await p.locator('label:has-text("Measure") button').first().click()
  const opts = await p.locator('[role="listbox"] [role="option"]').allInnerTexts()
  check('UI class: measure list = 3, no Active classes share',
    opts.length === 3 && !opts.some((o) => /Active classes/i.test(o)), JSON.stringify(opts))
  await p.keyboard.press('Escape')
  await voiceGuards('ui-class', body)
  await shootReady(p, 'windows-class')
  await p.close()
}

{ // ROOT group node — engine renders, compare menu honestly global-only.
  const p = await ctx.newPage()
  await p.goto(`${BASE}/admin/groups/${ROOT_GROUP_ID}/analytics`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.rc, .nre-status', { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(1500)
  const body = await p.locator('body').innerText().catch(() => '')
  check('UI root: card renders for the programme', /IME Demo Programme/i.test(body))
  await voiceGuards('ui-root', body)
  await shootReady(p, 'windows-root-programme')
  await p.close()
}

await browser.close()
console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
