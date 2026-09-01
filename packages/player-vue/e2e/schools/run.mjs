// SCHOOLS-DASHBOARD PERFORMANCE HARNESS (2026-09-01).
//
// The learner-journey baseline (docs/perf/journey-baseline-2026-09-01.md)
// measured what a LEARNER waits for. This measures what a SCHOOL LEADER and a
// TEACHER wait for, using the same instrument and the same refusals:
//
//   - measured against the real deployed build, never a local dev server;
//   - Chrome DevTools' own network presets, never unthrottled;
//   - median + full spread + n, and a surface that never finishes is recorded
//     AS one rather than dropped from the median;
//   - the stop condition is CONTENT ON THE GLASS (a roster row, a class card),
//     not a resolved navigation — a route that resolves before its data lands
//     proves nothing.
//
// Per surface it records: time to content, request COUNT and BYTES split by
// leg, the longest serial chain of same-leg requests (the chattiness that a
// 900ms RTT punishes), and the slowest single request.
//
// Read-only: it signs in as a real school admin / teacher and looks at pages.

import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, mintSession, stat, NET } from '../journeys/lib.mjs'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const NETNAME = process.env.NET || 'good'
const RUNS = Number(process.env.RUNS || 3)
const OUT = `${process.env.CS_SCRATCH || '/tmp'}/schools-perf`
const ONLY = process.env.SURFACE || null

// Sunrise Public School, Pune — the largest real tenant in the live DB:
// 4 classes, 82 students, 33,391 lego_progress rows, 9,545 seed_progress,
// 590 sessions. Demo tenant, but with genuine progress volume behind it.
const SCHOOL_ID = '2fd27c83-936f-4810-a88b-7d7b32315cee'
const CLASS_ID = 'e2bbe2de-cada-4aed-908a-4b36d26ca95c' // Grade 6A
const ADMIN = 'thomas.cassidy+demo.ime.sunrise.admin@gmail.com'
const TEACHER = 'thomas.cassidy+demo.ime.sunrise.teacher1@gmail.com'

const legOf = (url) => {
  if (/rest\/v1\/rpc\//.test(url)) return 'rpc'
  if (/rest\/v1\/(class_student_progress|class_activity_stats|class_sessions|classes|class_teachers|demographic_cycle_averages)/.test(url)) return 'class-data'
  if (/rest\/v1\/(lego_progress|seed_progress|sessions|daily_contributions|course_enrollments|learners|user_tags)/.test(url)) return 'learner-data'
  if (/rest\/v1\/(course_legos|course_seeds|courses|algorithm_config)/.test(url)) return 'course-content'
  if (/rest\/v1\/(schools|groups|govt_admins|invite_codes|entitlement_grants)/.test(url)) return 'org-data'
  if (/auth\/v1\//.test(url)) return 'auth'
  if (/\.(js|css)(\?|$)/i.test(url)) return 'app-code'
  if (/\/api\//.test(url)) return 'api'
  return 'other'
}

// Bytes actually transferred. content-length is absent on chunked/compressed
// PostgREST responses, so fall back to the decoded body length — reported as
// decoded, never silently as zero.
function recorder(page, ref) {
  const rows = []
  page.on('request', (req) => {
    const url = req.url()
    if (url.startsWith('data:') || url.includes('/api/player-events')) return
    rows.push({ leg: legOf(url), url: url.slice(0, 300), method: req.method(), start: Date.now() - ref.t0, end: null, status: null, bytes: null })
  })
  page.on('response', async (res) => {
    const row = [...rows].reverse().find((r) => r.url === res.url().slice(0, 300) && r.end === null)
    if (!row) return
    row.end = Date.now() - ref.t0
    row.status = res.status()
    try {
      const len = res.headers()['content-length']
      const body = await res.body()
      row.bytes = body?.length ?? (len ? Number(len) : null)
    } catch { /* body gone — reported as null, not zero */ }
  })
  page.on('requestfailed', (req) => {
    const row = [...rows].reverse().find((r) => r.url === req.url().slice(0, 300) && r.end === null)
    if (row) { row.end = Date.now() - ref.t0; row.status = 'FAILED' }
  })
  return rows
}

// Longest chain of requests where each STARTS after the previous ENDED — the
// serial depth. This is the number a 900ms round trip multiplies.
function serialDepth(rows) {
  const r = rows.filter((x) => x.end !== null && x.leg !== 'app-code' && x.leg !== 'other')
    .sort((a, b) => a.start - b.start)
  let best = 0, bestChain = []
  const depth = new Array(r.length).fill(1)
  const from = new Array(r.length).fill(-1)
  for (let i = 0; i < r.length; i++) {
    for (let j = 0; j < i; j++) {
      if (r[j].end <= r[i].start && depth[j] + 1 > depth[i]) { depth[i] = depth[j] + 1; from[i] = j }
    }
    if (depth[i] > best) { best = depth[i]; let k = i; bestChain = []; while (k !== -1) { bestChain.unshift(r[k]); k = from[k] } }
  }
  return { depth: best, chain: bestChain.map((x) => `${x.leg} ${x.url.split('/rest/v1/')[1]?.slice(0, 70) || x.url.slice(-50)} ${x.start}→${x.end}`) }
}

function summarise(rows, endMs) {
  const inWindow = rows.filter((r) => r.start <= endMs)
  const byLeg = {}
  for (const r of inWindow) {
    const l = (byLeg[r.leg] ||= { requests: 0, bytes: 0 })
    l.requests++
    l.bytes += r.bytes || 0
  }
  const slowest = [...inWindow].filter((r) => r.end !== null).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 5)
    .map((r) => ({ ms: r.end - r.start, bytes: r.bytes, url: r.url.split('/rest/v1/')[1]?.slice(0, 110) || r.url.slice(0, 110) }))
  const biggest = [...inWindow].sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 5)
    .map((r) => ({ bytes: r.bytes, url: r.url.split('/rest/v1/')[1]?.slice(0, 110) || r.url.slice(0, 110) }))
  return {
    totalRequests: inWindow.length,
    totalBytes: inWindow.reduce((n, r) => n + (r.bytes || 0), 0),
    byLeg, slowest, biggest,
    serial: serialDepth(inWindow),
    failures: inWindow.filter((r) => r.status === 'FAILED' || (typeof r.status === 'number' && r.status >= 400)).length,
  }
}

// Wait for real content, not a route change. Each surface names the selector
// that proves a human could read it. Checked in the page rather than through
// a Playwright locator because several of these selectors match BOTH a hidden
// skeleton and the real element — `.first()` was landing on the hidden one and
// reporting "never rendered" for a page that had rendered fine.
async function waitContent(page, selectors, deadline) {
  while (Date.now() < deadline) {
    const hit = await page.evaluate((sels) => {
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect()
          const drawn = el.tagName === 'CANVAS' || el.tagName === 'svg'
          if (r.width > 0 && r.height > 0 && (drawn || (el.textContent || '').trim().length > 1)) return sel
        }
      }
      return null
    }, selectors).catch(() => null)
    if (hit) return hit
    await page.waitForTimeout(60)
  }
  return null
}

const SURFACES = [
  // Content selectors name the thing a HUMAN can read. Loading placeholders
  // in this app carry `.empty-state` / `.node-loading`, so those are
  // deliberately excluded — the first pass stopped on "Loading your classes…"
  // and reported a 1.4s page that had no data on it.
  { key: 'dashboard', who: 'admin', path: `/org/${SCHOOL_ID}`,
    content: ['.identity-name', '.child-row', '.node-children'] },
  { key: 'classes', who: 'teacher', path: '/schools/classes',
    content: ['.table-card .ssi-table tbody tr .cell-name'] },
  // The roster on this page currently never renders (see the DB finding), so
  // the honest stop condition is the LAST panel fetchClassDetail populates —
  // the teacher list. It is what proves the whole detail load finished.
  { key: 'class-detail', who: 'teacher', path: `/schools/classes/${CLASS_ID}`,
    content: ['.teacher-row'] },
  { key: 'students', who: 'admin', path: '/schools/students',
    content: ['.student-name'] },
  { key: 'teachers', who: 'admin', path: '/schools/teachers',
    content: ['.teacher-name'] },
  { key: 'analytics', who: 'teacher', path: '/schools/analytics',
    content: ['.insight-card', 'canvas', 'svg.chart', '.compare-row', '.insight-body'] },
  { key: 'insights', who: 'admin', path: `/org/${SCHOOL_ID}/insights`,
    content: ['.insight-card', 'canvas', 'svg.chart', '.compare-row', '.insight-body'] },
]

async function measureSurface(surface, sessions, runIdx) {
  const profile = `${OUT}/profile-${surface.key}-${runIdx}`
  const ref = { t0: Date.now() }
  const { ctx, page } = await launch(profile, { net: NETNAME, session: sessions[surface.who], returnUser: true })
  const rows = recorder(page, ref)
  const t0 = Date.now()
  ref.t0 = t0
  let nav = null, err = null
  try {
    await page.goto(BASE + surface.path, { waitUntil: 'commit', timeout: 60000 })
    nav = Date.now() - t0
  } catch (e) { err = String(e).slice(0, 160) }
  const found = await waitContent(page, surface.content, t0 + 45000)
  const contentMs = found ? Date.now() - t0 : null
  // settle: let anything still in flight land, so the request census is honest
  await page.waitForTimeout(2500)
  const settleMs = Date.now() - t0
  const url = page.url()
  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 400)
  try { await page.screenshot({ path: `${OUT}/${surface.key}-${NETNAME}-${runIdx}.png` }) } catch {}
  await ctx.close().catch(() => {})
  return {
    surface: surface.key, run: runIdx, net: NETNAME, navMs: nav, contentMs, foundSelector: found,
    settleMs, finalUrl: url, err, bodyHead: found ? null : bodyText,
    atContent: contentMs ? summarise(rows, contentMs) : null,
    atSettle: summarise(rows, settleMs),
    // Full census kept so duplicate requests are provable, not inferred.
    allRows: rows.map((r) => ({ leg: r.leg, m: r.method, s: r.start, e: r.end, st: r.status, b: r.bytes, u: r.url })),
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const sessions = { admin: await mintSession(ADMIN), teacher: await mintSession(TEACHER) }
  const results = []
  for (const s of SURFACES) {
    if (ONLY && !ONLY.split(',').includes(s.key)) continue
    for (let i = 0; i < RUNS; i++) {
      const r = await measureSurface(s, sessions, i)
      results.push(r)
      console.log(`${s.key} #${i} net=${NETNAME} content=${r.contentMs ?? 'NEVER'}ms sel=${r.foundSelector} reqs=${r.atContent?.totalRequests ?? r.atSettle.totalRequests} bytes=${Math.round((r.atContent?.totalBytes ?? r.atSettle.totalBytes) / 1024)}KB serial=${(r.atContent ?? r.atSettle).serial.depth}${r.err ? ' ERR ' + r.err : ''}`)
    }
  }
  const summary = {}
  for (const s of SURFACES) {
    const rs = results.filter((r) => r.surface === s.key)
    if (!rs.length) continue
    summary[s.key] = {
      n: rs.length,
      neverRendered: rs.filter((r) => r.contentMs === null).length,
      contentMs: stat(rs.map((r) => r.contentMs)),
      requests: stat(rs.map((r) => (r.atContent ?? r.atSettle).totalRequests)),
      bytes: stat(rs.map((r) => (r.atContent ?? r.atSettle).totalBytes)),
      serialDepth: stat(rs.map((r) => (r.atContent ?? r.atSettle).serial.depth)),
      example: rs[0],
    }
  }
  writeFileSync(`${OUT}/results-${NETNAME}.json`, JSON.stringify({ base: BASE, net: NETNAME, netParams: NET[NETNAME], school: SCHOOL_ID, results, summary }, null, 2))
  console.log('\n' + JSON.stringify(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { n: v.n, never: v.neverRendered, content: v.contentMs.median, reqs: v.requests.median, kb: Math.round(v.bytes.median / 1024), serial: v.serialDepth.median }])), null, 1))
  console.log('→', `${OUT}/results-${NETNAME}.json`)
}
main().catch((e) => { console.error(e); process.exit(1) })
