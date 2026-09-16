/**
 * Job #987 audit: teacher persona Handbook Show-me / Take-me-there sweep.
 * READ-ONLY. Genuine teacher account, desktop width, staging.
 *
 *   set -a; . .env.local; . ~/.ssi-sentinel.env; set +a
 *   TMPDIR=$CS_SCRATCH LD_LIBRARY_PATH=~/.pw-libs/usr/lib/x86_64-linux-gnu:~/.ssi-sentinel-libs \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   node packages/player-vue/e2e/_987-handbook-teacher-audit.mjs
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'
import pack from '../src/walkthrough/pack.json' with { type: 'json' }

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const OUT = process.env.OUT || path.join(process.env.CS_SCRATCH || '/tmp', 'hb-teacher-audit')
fs.mkdirSync(OUT, { recursive: true })
const SUPABASE_URL = process.env.VITE_SUPABASE_URL.trim()
const ANON = process.env.VITE_SUPABASE_ANON_KEY.trim()
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const EMAIL = process.env.EMAIL || 'thomas.cassidy+chepstowtest-cover@gmail.com'
const PERSONA = 'teacher'

const PLACE_LINKS = {
  'node-home': (n) => (n ? `/org/${n}` : null),
  'node-insights': (n) => (n ? `/org/${n}/insights` : null),
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

const handbook = pack.handbook.filter((e) => (e.surface || 'schools') === 'schools')
const walks = pack.walks
function clipsFor(entry) {
  const stepping = walks.filter((w) => w.steps.some((s) => s.anchor === entry.anchor)).map((w) => w.id)
  const ids = [...new Set([...(entry.walk ? [entry.walk] : []), ...stepping])]
  return ids.filter((id) => walks.find((w) => w.id === id)?.personas.includes(PERSONA))
}
const mine = handbook.filter((e) => e.personas.includes(PERSONA))
const rows = mine.map((e) => ({ id: e.id, title: e.title, section: e.section, anchor: e.anchor, place: e.place.route, clips: clipsFor(e) }))
console.log(`teacher entries: ${rows.length}, with clip: ${rows.filter((r) => r.clips.length).length}, prose-only: ${rows.filter((r) => !r.clips.length).length}`)

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

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const session = await mint(EMAIL)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
const page = await ctx.newPage()

const results = []
const DEADLINE = Date.now() + 22 * 60 * 1000 // hard stop inside the 30-min budget

for (const entry of rows) {
  if (Date.now() > DEADLINE) { results.push({ id: entry.id, skipped: true, reason: 'time budget exhausted' }); continue }
  const r = { id: entry.id, title: entry.title, place: entry.place, anchor: entry.anchor, clips: entry.clips }
  try {
    await page.goto(`${BASE}/schools/handbook?entry=${entry.id}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await settle(page, 1200)
    const btn = page.locator(`#hb-${entry.id} [data-walk-offer]`).first()
    const gotoBtn = page.locator(`#hb-${entry.id} .entry-goto`).first()
    r.showMeRendered = (await btn.count()) > 0
    r.takeMeThereRendered = (await gotoBtn.count()) > 0

    // --- Show me ---
    if (r.showMeRendered) {
      await btn.scrollIntoViewIfNeeded().catch(() => {})
      await btn.click({ timeout: 8000 }).catch((e) => { r.showMeClickError = e.message.slice(0, 120) })
      await page.waitForTimeout(800)
      const active = await waitWalk(page, 9000)
      r.showMeStartUrl = page.url().replace(BASE, '')
      r.showMeStarted = !!active
      r.showMeWalk = active ? active.split(':')[0] : null
      if (active) {
        // Drive up to 8 steps, recording ring/anchor state each time.
        const steps = []
        let guard = 0
        while (guard++ < 8) {
          const a = await walkActive(page)
          if (!a || a.endsWith(':done')) { steps.push({ terminal: true, raw: a }); break }
          const [wid, idxStr] = a.split(':')
          const idx = Number(idxStr)
          const walkDef = walks.find((w) => w.id === wid)
          const stepDef = walkDef?.steps?.[idx]
          const ringCount = await page.locator('.walk-ring').count()
          const cardCount = await page.locator('[data-walk-card]').count()
          const ringedEl = ringCount ? await page.locator('.walk-ring').first().evaluate((el) => ({ tag: el.tagName, walkAttr: el.getAttribute('data-walk') || el.getAttribute('data-intel'), text: (el.textContent || '').trim().slice(0, 40) })).catch(() => null) : null
          steps.push({ idx, wantedAnchor: stepDef?.anchor, on: stepDef?.advance?.on, ringPresent: ringCount > 0, ringedAnchor: ringedEl?.walkAttr, ringedTag: ringedEl?.tag, cardPresent: cardCount > 0 })
          // advance
          if (ringCount > 0 && stepDef?.advance?.on === 'click') {
            await page.locator('.walk-ring').first().click({ timeout: 4000 }).catch(() => {})
          } else {
            const nextBtn = page.locator('[data-walk-card] button:has-text("Next"), [data-walk-card] button:has-text("Got it"), [data-walk-card] button:has-text("Done")').first()
            if (await nextBtn.count()) await nextBtn.click({ timeout: 4000 }).catch(() => {})
            else break
          }
          await page.waitForTimeout(600)
        }
        r.steps = steps
        r.reachedTerminal = steps.some((s) => s.terminal)
      }
      // close any active walk overlay before continuing
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(300)
    }

    // --- Take me there ---
    if (r.takeMeThereRendered) {
      await page.goto(`${BASE}/schools/handbook?entry=${entry.id}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await settle(page, 1000)
      const gb = page.locator(`#hb-${entry.id} .entry-goto`).first()
      const href = await gb.getAttribute('href').catch(() => null)
      r.takeMeThereHref = href
      const expected = PLACE_LINKS[entry.place]
      r.expectedRoute = expected ? expected('') : null
      await gb.click({ timeout: 8000 }).catch((e) => { r.gotoClickError = e.message.slice(0, 120) })
      await settle(page, 1200)
      r.takeMeThereLandedUrl = page.url().replace(BASE, '')
      const anchorPresent = await page.locator(`[data-walk="${entry.anchor}"], [data-intel="${entry.anchor}"]`).count()
      r.anchorPresentOnLandedPage = anchorPresent > 0
    }
  } catch (e) {
    r.error = e.message.slice(0, 200)
  }
  results.push(r)
  console.log(`${entry.id} | showMe=${r.showMeStarted} terminal=${r.reachedTerminal} | goto=${r.takeMeThereLandedUrl} anchorOk=${r.anchorPresentOnLandedPage}`)
}

fs.writeFileSync(path.join(OUT, 'teacher-genuine-desktop-results.json'), JSON.stringify(results, null, 2))
console.log('\n-> ', path.join(OUT, 'teacher-genuine-desktop-results.json'))
await browser.close()
