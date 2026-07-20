// THE VIEW — org-switch layout-stability probe (docs/the-view/layout-stability-REPORT.md).
// Founder bug 2026-07-20: switching node via the map rail's "others at this level"
// wobbles the page 3-4 times per switch. This probe drives a real admin session on a
// DEPLOYED build, switches nodes through the rail exactly like the founder does, and
// records per-switch layout-shift entries (CLS) plus a 100ms-resolution height
// timeline of every named section, so the offenders are named, not guessed.
//
//   node e2e/the-view/layout-stability-probe.mjs [baseUrl] [viewportWidth]
//   default base: https://staging.saysomethingin.app     (run from packages/player-vue)
//
// Target after the fix: at most ONE settle per switch, CLS per switch < 0.02.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.argv[2] || 'https://staging.saysomethingin.app'
const WIDTH = Number(process.argv[3] || 1440)
const PROJECT_REF = 'swfvymspfxmnfhevgdkg'
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`

// IME Demo Programme tree (stable demo data): region ↔ region, then school ↔ school.
const START = { id: '652bd018-4b84-477e-8e06-676d5d6a7630', name: 'Coastal Districts Region' }
const SWITCHES = [
  'Pilot Districts Region',
  'Coastal Districts Region',
  'Pilot Districts Region',
  // drill into a school, then sibling-switch at school level
  'Green Valley International, Jaipur',
  "St. Mary's Academy, Kochi",
  'Sunrise Public School, Pune',
  "St. Mary's Academy, Kochi",
]

function env(name) {
  if (process.env[name]) return process.env[name]
  for (const f of ['/Users/tomcassidy/SSi/ssi-learning-app/.env.local', '/Users/tomcassidy/SSi/ssi-learning-app/.env']) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const i = line.indexOf('=')
        if (i < 0 || line.slice(0, i) !== name) continue
        return line.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')
      }
    } catch { /* skip */ }
  }
  return undefined
}

const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'))
const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'thomas.cassidy+admin001@gmail.com' })
if (le) throw le
const anon = createClient(SUPABASE_URL, env('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
const { data: v, error: ve } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (ve) throw ve
console.log('admin session ok', v.session.user.id, '·', BASE, '·', WIDTH + 'px')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: WIDTH, height: 950 } })
await page.addInitScript(([authKey, sess, roleCache]) => {
  window.localStorage.setItem(authKey, sess)
  window.localStorage.setItem('ssi-user-role', roleCache)
  // Layout-shift ledger: every entry, with the elements that moved.
  window.__ls = []
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        // Keep input-adjacent shifts too (flagged): the founder's wobble is
        // click-triggered, so canonical CLS (which drops hadRecentInput
        // entries) reads 0 while the page visibly jumps. We report both.
        window.__ls.push({
          t: e.startTime,
          v: e.value,
          hri: !!e.hadRecentInput,
          src: (e.sources || []).map((s) => {
            const n = s.node
            if (!n) return '?'
            const cls = typeof n.className === 'string' && n.className ? '.' + n.className.split(/\s+/).slice(0, 2).join('.') : ''
            return (n.tagName || '?') + cls
          }),
        })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch { /* not supported */ }
}, [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(v.session), JSON.stringify({ platformRole: 'ssi_admin', educationalRole: null })])

const SECTIONS = {
  rail: '.rail-col',
  identity: '.identity',
  actionBar: '.node-action-bar, .action-bar',
  statsRow: '.stats-row',
  classCards: '.class-cards',
  childrenSection: '.children-section',
  page: '.node-home',
}

async function snapshot() {
  return page.evaluate((SECTIONS) => {
    const out = { scrollY: window.scrollY, docH: document.documentElement.scrollHeight }
    for (const [k, sel] of Object.entries(SECTIONS)) {
      const el = document.querySelector(sel)
      out[k] = el ? Math.round(el.getBoundingClientRect().height) : null
    }
    return out
  }, SECTIONS)
}

async function settleWait() {
  await page.waitForFunction(() => {
    const el = document.querySelector('.node-home')
    return el && !el.innerText.includes('Loading')
  }, null, { timeout: 30000 }).catch(() => console.log('  (settle timeout — still Loading)'))
}

console.log('== cold load start node ==')
await page.goto(`${BASE}/admin/groups/${START.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await settleWait()
await page.waitForTimeout(1200)

// Expand "others at this level" once — it stays open across switches (same mount).
const results = []
for (const [i, targetName] of SWITCHES.entries()) {
  const toggle = page.locator('.rail-toggle')
  if (await toggle.count()) {
    const open = await page.locator('.rail-sublist').count()
    if (!open) await toggle.click()
  }
  // The target may be a sibling (sublist) or a child (rail child row) — take either.
  const btn = page.locator('.map-rail .rail-link', { hasText: targetName }).first()
  if (!(await btn.count())) { console.log(`SKIP — "${targetName}" not in rail`); continue }

  const epoch = await page.evaluate(() => { window.__lsMark = window.__ls.length; return performance.now() })
  const before = await snapshot()
  await btn.click()

  // Sample geometry every 100ms for 3.5s after the click.
  const timeline = []
  for (let t = 0; t < 35; t++) {
    timeline.push(await snapshot())
    await page.waitForTimeout(100)
  }
  const shifts = await page.evaluate((epoch) => window.__ls.slice(window.__lsMark).filter((e) => e.t >= epoch - 50), epoch)
  const cls = shifts.reduce((s, e) => s + e.v, 0) // all shifts, incl. input-adjacent — the honest founder-feel number

  // Per-section verdict: how many times did its height CHANGE during the window?
  const sectionReport = {}
  for (const k of Object.keys(SECTIONS).concat(['scrollY', 'docH'])) {
    const series = [before[k], ...timeline.map((s) => s[k])]
    let changes = 0
    for (let j = 1; j < series.length; j++) if (series[j] !== series[j - 1]) changes++
    if (changes > 0) sectionReport[k] = { changes, series: series.filter((x, idx, a) => idx === 0 || x !== a[idx - 1]) }
  }

  results.push({ switch: `${i + 1}: → ${targetName}`, cls: +cls.toFixed(4), shiftCount: shifts.length, shifts, sections: sectionReport })
  console.log(`\n[switch ${i + 1}] → ${targetName}`)
  console.log(`  CLS=${cls.toFixed(4)}  layout-shift entries=${shifts.length}`)
  for (const s of shifts) console.log(`    +${Math.round(s.t)}ms  v=${s.v.toFixed(4)}  ${s.src.join(', ').slice(0, 140)}`)
  for (const [k, r] of Object.entries(sectionReport)) console.log(`  ${k}: ${r.changes} height changes  ${r.series.join(' → ')}`)
  await settleWait()
  await page.waitForTimeout(400)
}

const summary = {
  base: BASE, width: WIDTH, when: new Date().toISOString(),
  perSwitch: results.map((r) => ({ switch: r.switch, cls: r.cls, shiftCount: r.shiftCount })),
  worstCls: Math.max(...results.map((r) => r.cls), 0),
}
console.log('\n== SUMMARY ==')
for (const r of summary.perSwitch) console.log(`  ${r.switch}  CLS=${r.cls}  shifts=${r.shiftCount}`)
console.log(`  worst CLS per switch: ${summary.worstCls}  (target < 0.02)`)
writeFileSync('/tmp/layout-stability-probe.json', JSON.stringify({ summary, results }, null, 2))
console.log('full detail → /tmp/layout-stability-probe.json')
await browser.close()
