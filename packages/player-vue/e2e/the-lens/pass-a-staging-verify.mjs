// Founder pass A — deployed-staging verification walk (one-off probe).
// Checks: window chips (labels/default/Today framing/term alias), insights
// where-you-are rail + identity + no Back link + verbs corner, manual
// scroll-to-true-bottom on the five surfaces, idle polling, cold load.
//
//   BASE_URL=https://staging.saysomethingin.app node --env-file=../../.env --env-file=../../.env.local e2e/the-lens/pass-a-staging-verify.mjs
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const SHOT_DIR = process.env.SHOT_DIR || '../../docs/the-lens'

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr

const CLASS_ID = 'e2bbe2de-cada-4aed-908a-4b36d26ca95c' // Grade 6A, Sunrise Pune
const { data: groups } = await svc.from('groups').select('id, name').eq('is_demo', true).limit(1)
const groupId = groups?.[0]?.id

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`)
}

const browser = await chromium.launch()
async function newCtx(vp = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
  return ctx
}

async function chipState(p) {
  return p.evaluate(() => {
    const chips = [...document.querySelectorAll('.wc-chip')].map(c => c.textContent.trim())
    const active = document.querySelector('.wc-chip.active')?.textContent.trim() ?? null
    return { chips: chips.slice(0, 4), active }
  })
}

const EXPECT_CHIPS = ['Today', 'Last 7 days', 'Last 30 days', 'All time']

// ── 1+2. Insights views: chips, default, Today, alias, rail, no-back, verbs ──
const ctx = await newCtx()
const p = await ctx.newPage()

for (const [path, label, kickerWord] of [
  [`/admin/groups/${groupId}/analytics`, 'Group insights', 'Insights'],
  [`/admin/classes/${CLASS_ID}/insights`, 'Class insights', 'Insights'],
]) {
  await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
  await p.waitForTimeout(3000)
  const cs = await chipState(p)
  check(`${label}: chip labels`, JSON.stringify(cs.chips) === JSON.stringify(EXPECT_CHIPS), JSON.stringify(cs.chips))
  check(`${label}: default = Last 30 days`, cs.active === 'Last 30 days', String(cs.active))

  const dom = await p.evaluate(() => ({
    here: document.querySelector('.rail-row.is-here')?.textContent.trim() ?? null,
    kicker: [...document.querySelectorAll('.schools-kicker')].map(k => k.textContent.trim()),
    back: document.body.innerText.includes('Back to group home') || document.body.innerText.includes('← Back'),
    verbs: [...document.querySelectorAll('.verb-btn')].map(b => b.textContent.trim()),
  }))
  check(`${label}: rail you-are-here lit`, Boolean(dom.here && dom.here.includes("you're here")), String(dom.here).slice(0, 60))
  check(`${label}: identity kicker "· Insights"`, dom.kicker.some(k => k.includes('Insights')), dom.kicker.join(' | '))
  check(`${label}: no "Back to group home"`, !dom.back)
  check(`${label}: verbs Overview + All boards`, dom.verbs.includes('Overview') && dom.verbs.includes('All boards'), dom.verbs.join(' | '))
  await p.screenshot({ path: `${SHOT_DIR}/pass-a-verify-${label.toLowerCase().replace(/ /g, '-')}.jpg`, type: 'jpeg', quality: 60 })

  // Today: click chip, expect hourly caption + per-day framing
  await p.click('.wc-chip:has-text("Today")')
  await p.waitForTimeout(3500)
  const todayTxt = await p.evaluate(() => document.body.innerText)
  check(`${label}: Today hourly caption`, /Hourly\s*·\s*last 24 hours/i.test(todayTxt))
  check(`${label}: Today per-day framing`, /\/\s*day|per day/i.test(todayTxt))
  if (label === 'Group insights')
    await p.screenshot({ path: `${SHOT_DIR}/pass-a-verify-today-hourly.jpg`, type: 'jpeg', quality: 60 })

  // Old deep-link aliases forward without error
  for (const alias of ['term', 'week', '4w']) {
    await p.goto(`${BASE}${path}?window=${alias}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
    await p.waitForTimeout(3000)
    const a = await chipState(p)
    const errTxt = await p.evaluate(() => /something went wrong|error/i.test(document.body.innerText.slice(0, 2000)))
    const expected = alias === 'week' ? 'Last 7 days' : 'Last 30 days'
    check(`${label}: ?window=${alias} → ${expected}, no error`, a.active === expected && !errTxt, `active=${a.active} err=${errTxt}`)
  }
}

// ── Stats board: Rate compare chips ──
await p.goto(`${BASE}/admin/stats`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
await p.waitForTimeout(2000)
await p.click('text=Rate compare').catch(() => {})
await p.waitForTimeout(3000)
const sb = await chipState(p)
check('Stats board (Rate compare): chip labels', JSON.stringify(sb.chips) === JSON.stringify(EXPECT_CHIPS), JSON.stringify(sb.chips))
check('Stats board: default = Last 30 days', sb.active === 'Last 30 days', String(sb.active))
await p.screenshot({ path: `${SHOT_DIR}/pass-a-verify-stats-rates.jpg`, type: 'jpeg', quality: 60 })
await ctx.close()

// ── 3. Manual scroll-to-true-bottom, laptop + phone ──
const SCROLL_PAGES = [
  ['/admin/structure', 'Structure'],
  [`/admin/groups/${groupId}`, 'Node home'],
  [`/admin/groups/${groupId}/analytics`, 'Insights'],
  ['/admin/users', 'Users'],
  ['/admin/stats', 'Stats'],
]
for (const vp of [{ name: 'laptop', width: 1280, height: 800 }, { name: 'phone', width: 390, height: 700 }]) {
  const c2 = await newCtx({ width: vp.width, height: vp.height })
  const p2 = await c2.newPage()
  for (const [path, label] of SCROLL_PAGES) {
    await p2.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
    await p2.waitForTimeout(3000)
    const r = await p2.evaluate(async () => {
      const els = [...document.querySelectorAll('*')]
      let owner = null
      for (const el of els) {
        const cs = getComputedStyle(el)
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 8)
          if (!owner || el.scrollHeight > owner.scrollHeight) owner = el
      }
      if (!owner) {
        // nothing needs to scroll only if all content fits the viewport
        const fits = document.body.scrollHeight <= window.innerHeight + 8
        return { fits, reached: fits, owner: null }
      }
      owner.scrollTop = owner.scrollHeight
      await new Promise(r => setTimeout(r, 400))
      const reached = owner.scrollTop + owner.clientHeight >= owner.scrollHeight - 4
      return { fits: false, reached, owner: `${owner.tagName}.${String(owner.className).split(' ')[0]}`, top: owner.scrollTop }
    })
    check(`Scroll bottom [${vp.name}] ${label}`, r.reached, r.owner ? `owner=${r.owner}` : 'content fits viewport')
    if (vp.name === 'phone' && label === 'Insights')
      await p2.screenshot({ path: `${SHOT_DIR}/pass-a-verify-insights-bottom-phone.jpg`, type: 'jpeg', quality: 60 })
  }
  await c2.close()
}

// ── 4. Regression: cold load fast; no idle polling ──
const c3 = await newCtx()
const p3 = await c3.newPage()
const t0 = Date.now()
await p3.goto(`${BASE}/admin/structure`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await p3.waitForSelector('.admin-container', { timeout: 30000 }).catch(() => {})
const coldMs = Date.now() - t0
check('Cold load: /admin/structure content < 8s', coldMs < 8000, `${coldMs}ms`)

await p3.waitForTimeout(5000) // let startup settle
let idleReqs = []
p3.on('request', req => { if (!['image', 'font'].includes(req.resourceType())) idleReqs.push(req.url()) })
await p3.waitForTimeout(65000)
const polling = idleReqs.filter(u => !u.includes('sw.js') && !u.includes('workbox'))
check('No idle polling over 65s', polling.length === 0, polling.slice(0, 5).join(', ') || 'zero requests')

await c3.close()
await browser.close()

const fails = results.filter(r => !r.ok)
console.log(`\n${results.length} checks, ${fails.length} failures`)
process.exit(fails.length ? 1 : 0)
