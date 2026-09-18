// Job #32: the evidence for the fix-up of #22, on the deployed site.
//
// Signs in as the real IME demo leader for Sunrise Public School, Pune, opens
// the leader's Insights page with LAST WEEK and MARATHI selected, expands both
// panels, and then answers two questions with the page's own traffic:
//
//   (a) PRIVACY — every response the page received, grepped for the display
//       name and the learners.id of every learner under the school. Zero is
//       the only pass (Tom, 2026-09-16 16:31Z: nothing in Insights names a
//       pupil, on the glance or behind a tap).
//   (b) SCOPE — the window and the course each endpoint was asked for, beside
//       the card's own, and the expanded panels screenshotted under it.
//
// Read-only. Env: BASE, SHOTS, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, CHROME_BIN.
import { chromium } from '@playwright/test'
import fs from 'fs'; import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const LEADER = 'thomas.cassidy+demo.ime.sunrise.admin@gmail.com'
const SCHOOL = '2fd27c83-936f-4810-a88b-7d7b32315cee'
const SCHOOL_NODE = '741e9b6e-9542-4ac4-9d28-e29471ceaf41'

const rest = async (p) => (await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })).json()

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${gl.status}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!v.ok || !vj.access_token) throw new Error(`verify ${v.status}`); return vj
}

// THE ROSTER, from the named door itself: GET /api/org/vad without the
// aggregate flag is the admin board's read and still answers with every name.
// Whatever it names is exactly what the Insights path must not carry.
const classes = await rest(`classes?select=id,class_name,course_code,class_learner_id&school_id=eq.${SCHOOL}`)
const session = await mint(LEADER)
const named = await (await fetch(`${BASE}/api/org/vad?groupId=${SCHOOL_NODE}`, { headers: { Authorization: `Bearer ${session.access_token}` } })).json()
const classNames = new Set(classes.map(c => c.class_name))
const roster = Object.entries(named.names || {})
// A class account is named after its class, and a class name on the page is
// fine; a person's name is not.
const pupils = roster.filter(([, n]) => n && !classNames.has(n))
console.log(`roster: ${roster.length} learners named by the admin door, ${pupils.length} of them people`)

console.log('BASE', BASE, 'version', (await fetch(`${BASE}/version.json`).then(r => r.text())).trim())

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); sessionStorage.removeItem('ssi-viewing-as') } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
const page = await ctx.newPage()

const calls = []
page.on('response', async (r) => {
  const u = r.url()
  if (!u.includes('/api/')) return
  let body = ''
  try { body = await r.text() } catch { return }
  calls.push({ url: u.replace(BASE, ''), status: r.status(), body })
})

const url = `${BASE}/org/${SCHOOL_NODE}/insights?window=last_week&course=eng_for_mar`
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(6000)
// The why? chip: at school level it must say what the cohort is COUNTED IN.
await page.click('.wk-why').catch(() => {})
await page.waitForTimeout(500)
const whyText = await page.$eval('.wk-why-text', (el) => el.textContent?.trim() || '').catch(() => '')
console.log('WHY:', whyText)
// Open everything behind a tap — the ruling covers behind a tap too.
for (const sum of await page.$$('details.niv-more > summary')) { await sum.click(); await page.waitForTimeout(2500) }
await page.waitForTimeout(4000)

// The shell scrolls an INNER container, so document.scrollingElement stays
// one viewport tall and a fullPage shot would show only the first screen.
const h = await page.evaluate(() => {
  let best = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
  for (const el of Array.from(document.querySelectorAll('div, main, section'))) {
    const s = getComputedStyle(el)
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') best = Math.max(best, el.scrollHeight)
  }
  return best
})
await page.setViewportSize({ width: 390, height: Math.min(Math.max(h, 844), 12000) })
await page.waitForTimeout(1000)
const shot = path.join(SHOTS, 'leader-lastweek-marathi-expanded.png')
await page.screenshot({ path: shot, fullPage: true })

const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')

// ── (a) PRIVACY ────────────────────────────────────────────────────────────
const hits = []
for (const c of calls) {
  for (const [id, name] of pupils) {
    if (c.body.includes(name)) hits.push({ url: c.url, kind: 'name', value: name })
    if (c.body.includes(id)) hits.push({ url: c.url, kind: 'learner id', value: id })
  }
}
const textHits = pupils.filter(([, n]) => text.includes(n)).map(([, n]) => n)

// ── (b) SCOPE ──────────────────────────────────────────────────────────────
const scope = calls
  .filter(c => /rate-compare|org\/intel|org\/vad/.test(c.url))
  .map(c => {
    let j = null; try { j = JSON.parse(c.body) } catch {}
    return {
      url: c.url,
      status: c.status,
      applied: j?.applied ?? null,
      courseCode: j?.courseCode ?? null,
      peopleIncluded: j?.peopleIncluded ?? null,
      week: j?.week ? { label: j.week.label, range: j.week.rangeLabel, entityMinutes: j.week.entity?.totalMinutes, classes: (j.week.classes || []).map(x => x.name) } : null,
      classes: Array.isArray(j?.classes) ? j.classes.map(x => x.name) : null,
      aggregate: j?.aggregate ?? null,
      scopeTotal: j?.scope?.total ?? null,
      names: j?.names ? Object.keys(j.names).length : null,
      metrics: Array.isArray(j?.metrics) ? j.metrics.length : null,
      people: Array.isArray(j?.people) ? j.people.length : null,
    }
  })

const report = {
  base: BASE,
  version: await fetch(`${BASE}/version.json`).then(r => r.json()),
  url,
  apiCalls: calls.map(c => `${c.status} ${c.url}`),
  privacy: { pupilsChecked: pupils.length, responseHits: hits, pageTextHits: textHits },
  whyText,
  scope,
  contentHeight: h,
  screenshot: shot,
  pageText: text.slice(0, 2500),
}
fs.writeFileSync(path.join(SHOTS, 'probe-32.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, pageText: undefined }, null, 2))
console.log('\nPRIVACY:', hits.length === 0 && textHits.length === 0 ? 'ZERO pupil names or ids, in any response or on the page' : `FAIL — ${hits.length} response hits, ${textHits.length} on-page hits`)
console.log('SHOT:', shot)
await browser.close()
