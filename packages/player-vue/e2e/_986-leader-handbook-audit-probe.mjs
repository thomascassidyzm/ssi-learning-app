/**
 * Job #986 leader audit: for every "Just what I can do" Handbook entry the
 * `leader` persona owns, does Show me actually start a walk and ring the
 * right anchors, and does Take me there land where PLACE_LINKS says?
 *
 * Genuine sign-in only per this run (view-as covered in a second pass if
 * time allows) — see the report for what got covered.
 *
 *   set -a; . .env.local; . ~/.ssi-sentinel.env; set +a
 *   TMPDIR=$CS_SCRATCH LD_LIBRARY_PATH=~/.pw-libs/usr/lib/x86_64-linux-gnu:~/.ssi-sentinel-libs \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   node packages/player-vue/e2e/_986-leader-handbook-audit-probe.mjs
 *
 * ACCOUNT=bumface|zzleader  WIDTH=desktop|mobile  narrow the run.
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const OUT = process.env.OUT || path.join(process.env.CS_SCRATCH, 'leader-audit')
fs.mkdirSync(OUT, { recursive: true })
const SUPABASE_URL = process.env.VITE_SUPABASE_URL.trim()
const ANON = process.env.VITE_SUPABASE_ANON_KEY.trim()
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]

const ACCOUNTS = {
  bumface: 'thomas.cassidy+bumface@gmail.com',
  zzleader: 'thomas.cassidy+zz.chepstow.leader@gmail.com',
}
const ACCOUNT_KEYS = (process.env.ACCOUNT || 'bumface,zzleader').split(',')
const WIDTHS = (process.env.WIDTH || 'desktop,mobile').split(',')
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } }

const pack = JSON.parse(fs.readFileSync('packages/player-vue/src/walkthrough/pack.json', 'utf8'))
const PLACE_LINKS = {
  'node-home': (node) => (node ? `/org/${node}` : null),
  'node-insights': (node) => (node ? `/org/${node}/insights` : null),
  'class-detail': () => '/schools/classes',
  dashboard: () => '/schools',
  teachers: () => '/schools/teachers',
  students: () => '/schools/students',
  classes: () => '/schools/classes',
  settings: () => '/schools/settings',
  'player-settings': () => '/?screen=settings',
  setup: () => '/schools/setup',
  'schools-list': () => '/schools/all',
  analytics: () => '/schools/analytics',
  upgrade: () => '/schools/upgrade',
  inbox: () => '/schools/inbox',
  'admin-invites': () => '/admin/invites',
  intel: () => '/intel',
  library: () => '/',
}

function clipsFor(entry, persona) {
  const stepping = pack.walks.filter((w) => w.steps.some((s) => s.anchor === entry.anchor)).map((w) => w.id)
  const ids = [...new Set([...(entry.walk ? [entry.walk] : []), ...stepping])]
  return ids.filter((id) => pack.walks.find((w) => w.id === id)?.personas.includes('leader'))
}
let leaderEntries = pack.handbook.filter((e) => e.personas.includes('leader'))
if (process.env.LIMIT) leaderEntries = leaderEntries.slice(0, Number(process.env.LIMIT))
if (process.env.ONLY_IDS) { const only = new Set(process.env.ONLY_IDS.split(',')); leaderEntries = leaderEntries.filter((e) => only.has(e.id)) }
console.log('leader entries:', leaderEntries.length)
const SETTLE_MS = Number(process.env.SETTLE_MS || 1200)

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!glj.email_otp) throw new Error('generate_link: ' + JSON.stringify(glj).slice(0, 200))
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!vj.access_token) throw new Error('verify: ' + JSON.stringify(vj).slice(0, 200)); return vj
}
const settle = async (p, ms = 1200) => { await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(ms) }
const walkActive = (p) => p.evaluate(() => document.documentElement.getAttribute('data-walk-active'))
async function waitWalk(p, ms = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const a = await walkActive(p); if (a) return a; await p.waitForTimeout(200) }
  return null
}

function walkStepMeta(walkId, stepIndex) {
  const w = pack.walks.find((x) => x.id === walkId)
  const s = w?.steps?.[stepIndex]
  return { anchor: s?.anchor, on: s?.advance?.on, isTerminal: !!s?.terminal }
}

async function stepThrough(page, walkId, maxSteps = 12) {
  const steps = []
  for (let i = 0; i < maxSteps; i++) {
    await page.waitForTimeout(700)
    const active = await walkActive(page)
    if (!active) { steps.push({ i, active: null, note: 'walk-active vanished' }); break }
    const [, stepIdxStr] = active.split(':')
    const stepIdx = active.endsWith(':done') ? null : Number(stepIdxStr)
    const meta = stepIdx !== null ? walkStepMeta(walkId, stepIdx) : null
    const ringed = await page.locator('.walk-ring').count()
    let ringTarget = null
    if (ringed) {
      ringTarget = await page.evaluate(() => {
        const ring = document.querySelector('.walk-ring')
        if (!ring) return null
        const r = ring.getBoundingClientRect()
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const el = document.elementFromPoint(cx, cy)
        const anchorEl = el?.closest('[data-walk],[data-intel]')
        return anchorEl ? { tag: anchorEl.tagName, anchor: anchorEl.getAttribute('data-walk') || anchorEl.getAttribute('data-intel'), text: anchorEl.textContent.trim().slice(0, 60) } : null
      })
    }
    const done = active.endsWith(':done')
    const anchorMatch = meta && ringTarget ? ringTarget.anchor === meta.anchor : null
    steps.push({ i, active, expectedAnchor: meta?.anchor, ringed: !!ringed, ringTarget, anchorMatch, advanceOn: meta?.on, done })
    if (done) break
    const card = page.locator('[data-walk-card]')
    const nextBtn = card.locator('button.walk-btn-primary')
    if (meta?.on === 'click' && ringed && ringTarget?.anchor) {
      const clickable = page.locator(`[data-walk="${ringTarget.anchor}"], [data-intel="${ringTarget.anchor}"]`).first()
      const clicked = await clickable.click({ timeout: 3000 }).then(() => true).catch(() => false)
      if (!clicked && await nextBtn.count()) await nextBtn.click({ timeout: 3000 }).catch(() => {})
    } else if (await nextBtn.count()) {
      await nextBtn.click({ timeout: 3000 }).catch(() => {})
    } else if (ringed && ringTarget?.anchor) {
      // step timed out unanchored-to-Next fallback, or click-step with no Next button rendered: try the anchor
      const clickable = page.locator(`[data-walk="${ringTarget.anchor}"], [data-intel="${ringTarget.anchor}"]`).first()
      await clickable.click({ timeout: 3000 }).catch(() => {})
    } else break
  }
  return steps
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const results = { base: BASE, at: new Date().toISOString(), runs: {} }

for (const acctKey of ACCOUNT_KEYS) {
  const email = ACCOUNTS[acctKey]
  const session = await mint(email)
  for (const width of WIDTHS) {
    const key = `${acctKey}__${width}`
    console.log(`\n=== ${key} — ${email}`)
    const ctx = await browser.newContext({ viewport: VIEWPORTS[width] })
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
    const page = await ctx.newPage()
    const rec = { email, nodeKind: null, nodeUrl: null, entries: [] }
    results.runs[key] = rec
    try {
      await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await settle(page, 2500)
      rec.landingUrl = page.url()
      // try to read node kind from any org page reached
      const orgMatch = page.url().match(/\/org\/([^/?]+)/)
      if (orgMatch) rec.nodeId = orgMatch[1]

      for (const entry of leaderEntries) {
        const clips = clipsFor(entry, 'leader')
        const row = { id: entry.id, place: entry.place, hasClip: clips.length > 0, walkIds: clips }
        rec.entries.push(row)
        if (!clips.length) { row.showMe = 'no-clip-button-expected'; row.takeMeThere = 'not-tested'; continue }

        // --- Show me ---
        await page.goto(`${BASE}/schools/handbook?entry=${entry.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await settle(page, SETTLE_MS)
        const btn = page.locator(`#hb-${entry.id} [data-walk-offer]`).first()
        if (!(await btn.count())) { row.showMe = 'button-not-rendered'; }
        else {
          await btn.scrollIntoViewIfNeeded().catch(() => {})
          await btn.click({ timeout: 8000, noWaitAfter: true }).catch((e) => { row.showMe = 'click-failed: ' + e.message.slice(0, 80) })
          if (!row.showMe) {
            const active = await waitWalk(page, 8000)
            row.landedUrlAfterShowMe = page.url()
            if (!active) row.showMe = 'never-started'
            else {
              row.startUrl = page.url()
              const walkId = active.split(':')[0]
              const steps = await stepThrough(page, walkId, 14)
              row.steps = steps
              const last = steps[steps.length - 1]
              row.showMe = last?.done ? 'reached-terminal' : (steps.some(s => s.note) ? 'stalled' : 'incomplete-maxsteps')
              row.anchoredSteps = steps.filter(s => s.ringed).length
              row.unanchoredSteps = steps.filter(s => !s.ringed && !s.done).length
              row.anchorMismatches = steps.filter(s => s.anchorMatch === false).length
            }
          }
          await page.keyboard.press('Escape').catch(() => {})
        }

        // --- Take me there ---
        await page.goto(`${BASE}/schools/handbook?entry=${entry.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await settle(page, 1200)
        const gotoBtn = page.locator(`#hb-${entry.id} a.entry-goto`).first()
        if (!(await gotoBtn.count())) { row.takeMeThere = 'button-absent' }
        else {
          const href = await gotoBtn.getAttribute('href').catch(() => null)
          row.takeMeThereHref = href
          await gotoBtn.click({ timeout: 8000, noWaitAfter: true }).catch(() => {})
          await settle(page, 1500)
          row.takeMeThereLandedUrl = page.url()
          const expected = PLACE_LINKS[entry.place.route] ? PLACE_LINKS[entry.place.route](rec.nodeId || '') : null
          row.takeMeThereExpected = expected
          if (!expected) row.takeMeThere = 'no-node-id-available'
          else {
            const gotPath = new URL(page.url()).pathname + new URL(page.url()).search
            row.takeMeThere = gotPath.startsWith(expected.split('?')[0]) ? 'landed-as-expected' : `mismatch (got ${gotPath})`
          }
          // does the entry's own anchor exist on that page?
          const anchorPresent = await page.locator(`[data-walk="${entry.anchor}"], [data-intel="${entry.anchor}"]`).count().catch(() => 0)
          row.anchorPresentOnPage = anchorPresent > 0
        }
        console.log(`  ${entry.id}: showMe=${row.showMe} takeMeThere=${row.takeMeThere}`)
      }
    } catch (e) {
      rec.error = e.message.slice(0, 400)
      console.log('  ERROR', e.message.slice(0, 400))
    } finally { await ctx.close() }
  }
}
await browser.close()
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
console.log('\nresults ->', path.join(OUT, 'results.json'))
