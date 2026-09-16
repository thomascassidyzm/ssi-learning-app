// Job #985 — School Leader Handbook Show-me/Take-me-there audit, READ-ONLY.
// Two modes: genuine (real school_admin login) and viewas (ssi_admin +
// sessionStorage view-as overlay onto a real school_admin). One width per
// run (WIDTH=desktop|phone). Walks the "Just what I can do" scope, and for
// each entry: expands it, records Show-me start + first-step ring status,
// then (if DEEP=1) walks every step to completion; and Take-me-there
// landing + anchor presence. Writes JSON to OUT.
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'node:fs'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const MODE = process.env.MODE || 'genuine' // genuine | viewas
const WIDTH = process.env.WIDTH || 'desktop' // desktop | phone
const DEEP = process.env.DEEP === '1'
const ENTRY_IDS = (process.env.ENTRY_IDS || '').split(',').filter(Boolean) // empty = all
const OUT = process.env.OUT
if (!OUT) { console.error('OUT required'); process.exit(2) }

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]

const GENUINE_EMAIL = 'thomas.cassidy+chepstowtest-leader@gmail.com'
const ADMIN_EMAIL = 'thomas.cassidy+ssi@gmail.com'
const SCHOOL_ADMIN_PERSONA = { key: 'user:1b13d17a-8b6a-4458-9ce1-28e72f0d03a3', userId: '1b13d17a-8b6a-4458-9ce1-28e72f0d03a3', role: 'school_admin', name: 'Angharad ZZ Test' }

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!v.ok || !vj.access_token) throw new Error(`verify ${v.status} ${JSON.stringify(vj).slice(0,200)}`); return vj
}

const pack = JSON.parse(fs.readFileSync(new URL('../src/walkthrough/pack.json', import.meta.url)))
const PERSONA = 'school_admin'
function clipsFor(entry) {
  const stepping = pack.walks.filter((w) => w.steps.some((s) => s.anchor === entry.anchor)).map((w) => w.id)
  const ids = [...new Set([...(entry.walk ? [entry.walk] : []), ...stepping])]
  return ids.filter((id) => pack.walks.find((w) => w.id === id)?.personas.includes(PERSONA))
}
let entries = pack.handbook.filter((e) => (e.surface ?? 'schools') === 'schools' && e.personas.includes(PERSONA))
if (ENTRY_IDS.length) entries = entries.filter((e) => ENTRY_IDS.includes(e.id))
console.log('entries to test:', entries.length, 'mode', MODE, 'width', WIDTH, 'deep', DEEP)

const viewport = WIDTH === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 800 }
const isMobile = WIDTH === 'phone'

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile })

if (MODE === 'genuine') {
  const session = await mint(GENUINE_EMAIL)
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
} else {
  const session = await mint(ADMIN_EMAIL)
  await ctx.addInitScript(([k, v, pk, pv]) => { try { localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} },
    [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(SCHOOL_ADMIN_PERSONA)])
}

const page = await ctx.newPage()
const settle = async (ms = 1500) => { await page.waitForTimeout(ms) }

async function walkActiveState() {
  return page.evaluate(() => document.documentElement.getAttribute('data-walk-active'))
}

async function stepDetail(anchorWanted) {
  const ring = page.locator('.walk-ring')
  const ringCount = await ring.count().catch(() => 0)
  // Find the actual element the anchor selector matches, and whether it's in viewport
  const anchored = await page.evaluate((anchor) => {
    const el = document.querySelector(`[data-walk="${anchor}"], [data-intel="${anchor}"]`)
    if (!el) return { exists: false }
    const box = el.getBoundingClientRect()
    const inViewport = box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth && box.width > 0 && box.height > 0
    return { exists: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 60), box: { x: box.x, y: box.y, w: box.width, h: box.height }, inViewport }
  }, anchorWanted)
  const cardCount = await page.locator('[data-walk-card]').count()
  return { anchorWanted, ringCount, anchored, cardPresent: cardCount > 0 }
}

const results = []
await page.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await settle(4000)
// switch to "Just what I can do" scope
const scopeBtns = page.locator('.scope-option')
const scopeCount = await scopeBtns.count()
if (scopeCount >= 2) { await scopeBtns.nth(1).click().catch(() => {}); await page.waitForTimeout(600) }

for (const entry of entries) {
  const r = { id: entry.id, title: entry.title, anchor: entry.anchor, place: entry.place.route, clips: clipsFor(entry) }
  try {
    await page.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await settle(1500)
    if (scopeCount >= 2) { await scopeBtns.nth(1).click().catch(() => {}); await page.waitForTimeout(400) }
    const heading = page.locator('.entry-head', { hasText: entry.title }).first()
    const headCount = await heading.count()
    r.entryVisibleInScope = headCount > 0
    if (!headCount) { results.push(r); console.log(JSON.stringify(r)); continue }
    await heading.scrollIntoViewIfNeeded()
    await heading.click()
    await page.waitForTimeout(400)

    // Show me
    const showBtn = page.locator(`button.entry-showme`, { hasText: entry.title }).first()
    const showBtnAlt = page.locator(`#hb-${entry.id} button.entry-showme`).first()
    const sb1 = await showBtn.count(); const sb2 = await showBtnAlt.count()
    r.showMeButtonPresent = (sb1 + sb2) > 0
    if (r.showMeButtonPresent) {
      const btn = sb1 ? showBtn : showBtnAlt
      await btn.click({ timeout: 5000 }).catch((e) => { r.showMeClickError = String(e.message).slice(0, 150) })
      await page.waitForTimeout(2500)
      await settle(1500)
      r.urlAfterShowMe = page.url()
      r.walkActiveAfterShowMe = await walkActiveState()
      if (r.walkActiveAfterShowMe) {
        const walkId = r.walkActiveAfterShowMe.split(':')[0]
        const walkDef = pack.walks.find((w) => w.id === walkId)
        r.walkId = walkId
        const steps = []
        let guard = 0
        while (guard++ < 15) {
          console.log('  step-loop guard', guard, new Date().toISOString())
          const active = await walkActiveState()
          if (!active) { steps.push({ note: 'no active state — walk ended/lost' }); break }
          const [id, idxOrDone] = active.split(':')
          if (idxOrDone === 'done') { steps.push({ done: true }); break }
          const idx = Number(idxOrDone)
          const stepAnchor = walkDef?.steps?.[idx]?.anchor
          const detail = await stepDetail(stepAnchor)
          steps.push({ idx, ...detail })
          if (!DEEP && idx >= 1) { steps.push({ note: 'stopped after 2 steps (light pass)' }); break }
          // advance: click-advance steps have NO Next button (WalkOverlay
          // show-next="!isClickStep") — must click the REAL anchored element
          // (ring itself is pointer-events:none decoration). Else use Next.
          const nextBtn = page.locator('[data-walk-card] button', { hasText: /next|got it|done|^ok$/i })
          const hasNext = await nextBtn.count().catch(() => 0)
          if (hasNext) {
            await nextBtn.first().click({ timeout: 3000 }).catch((e) => { steps[steps.length - 1].advanceError = String(e.message).slice(0, 100) })
          } else if (stepAnchor) {
            const realEl = page.locator(`[data-walk="${stepAnchor}"], [data-intel="${stepAnchor}"]`).first()
            if (await realEl.count().catch(() => 0)) {
              await realEl.click({ timeout: 3000, force: true }).catch((e) => { steps[steps.length - 1].advanceError = String(e.message).slice(0, 100) })
            } else {
              steps.push({ note: 'click-advance step but real anchor element not found — cannot advance' }); break
            }
          } else {
            steps.push({ note: 'no Next button and no anchor named — stuck' }); break
          }
          await page.waitForTimeout(1000)
        }
        r.steps = steps
      }
    }
  } catch (e) {
    r.error = String(e.message || e).slice(0, 200)
  }

  // Take me there — separate pass from a fresh handbook load
  try {
    await page.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await settle(1500)
    if (scopeCount >= 2) { await scopeBtns.nth(1).click().catch(() => {}); await page.waitForTimeout(400) }
    const heading2 = page.locator('.entry-head', { hasText: entry.title }).first()
    if (await heading2.count()) {
      await heading2.scrollIntoViewIfNeeded()
      await heading2.click()
      await page.waitForTimeout(400)
      const gotoLink = page.locator(`#hb-${entry.id} a.entry-goto`).first()
      r.gotoLinkPresent = (await gotoLink.count()) > 0
      if (r.gotoLinkPresent) {
        r.gotoHref = await gotoLink.getAttribute('href').catch(() => null)
        await gotoLink.click({ timeout: 5000 }).catch((e) => { r.gotoClickError = String(e.message).slice(0, 150) })
        await settle(1500)
        r.urlAfterGoto = page.url()
        r.anchorExistsAfterGoto = await page.evaluate((a) => !!document.querySelector(`[data-walk="${a}"], [data-intel="${a}"]`), entry.anchor)
      }
    }
  } catch (e) {
    r.gotoError = String(e.message || e).slice(0, 200)
  }

  results.push(r)
  console.log(JSON.stringify(r))
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
await browser.close()
console.log('DONE', results.length, 'entries ->', OUT)
