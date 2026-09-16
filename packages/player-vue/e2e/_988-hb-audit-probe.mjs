// Job #988 — Handbook Show-me / Take-me-there audit, admin + intel + learner.
// READ-ONLY. Signs in via magiclink, walks the Handbook, taps every Show-me,
// steps through the resulting walk recording ring/anchor state per step,
// checks Take-me-there landing, and (for admin) repeats under view-as.
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const OUT = process.env.OUT || path.join(process.env.CS_SCRATCH || '/tmp', 'hb-audit')
fs.mkdirSync(OUT, { recursive: true })
const SUPABASE_URL = process.env.VITE_SUPABASE_URL.trim()
const ANON = process.env.VITE_SUPABASE_ANON_KEY.trim()
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]

const ROLE = process.env.ROLE || 'admin' // admin | learner
const WIDTHS = (process.env.WIDTHS || 'desktop,phone').split(',')
const VIEWAS = process.env.VIEWAS === '1'
const VIEWAS_ROLE = process.env.VIEWAS_ROLE || 'teacher'
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : Infinity

const ACCOUNTS = {
  admin: 'thomas.cassidy+ssi@gmail.com',
  learner: 'thomas.cassidy+e2e-learner@gmail.com',
}
const VIEWPORTS = {
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
}

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!glj.email_otp) throw new Error('generate_link: ' + JSON.stringify(glj).slice(0, 200))
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!vj.access_token) throw new Error('verify: ' + JSON.stringify(vj).slice(0, 200)); return vj
}
const settle = async (p, ms = 1200) => { await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(ms) }
const walkActive = (p) => p.evaluate(() => document.documentElement.getAttribute('data-walk-active'))

async function stepThroughWalk(page, maxSteps = 16) {
  const steps = []
  for (let i = 0; i < maxSteps; i++) {
    const active = await walkActive(page)
    if (!active) { steps.push({ i, note: 'walk ended (no data-walk-active)' }); break }
    const [walkId, idxRaw, done] = active.split(':')
    if (done === 'done') { steps.push({ i, walkId, idx: idxRaw, terminal: true });
      // click Done
      const doneBtn = page.locator('[data-walk-card] .walk-btn-primary').first()
      if (await doneBtn.count()) await doneBtn.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(400)
      const after = await walkActive(page)
      if (!after) { steps.push({ i: i + 0.5, note: 'ended after Done click' }); break }
      continue
    }
    await page.waitForTimeout(600) // let anchor resolve/poll settle a beat
    const ring = page.locator('.walk-ring').first()
    const ringCount = await ring.count()
    let ringInfo = null
    if (ringCount) {
      ringInfo = await page.evaluate(() => {
        const r = document.querySelector('.walk-ring')
        if (!r) return null
        const box = r.getBoundingClientRect()
        return { top: box.top, left: box.left, w: box.width, h: box.height }
      })
    }
    // Which real element is under the ring (best-effort): read anchor via data-walk-active step index against pack step anchors is done offline; here just record ring geometry + whether an element sits there.
    const card = page.locator('[data-walk-card]')
    const cardText = (await card.locator('.walk-say').first().innerText().catch(() => '')).slice(0, 80)
    const isClickStep = await page.evaluate(() => !document.querySelector('[data-walk-card] .walk-btn-primary'))
    steps.push({ i, walkId, idx: idxRaw, ring: !!ringCount, ringInfo, cardText, isClickStep })
    if (ringCount && isClickStep) {
      // click the actual anchored element, not the (pointer-events:none) ring
      const clicked = await page.evaluate(() => {
        const r = document.querySelector('.walk-ring')
        if (!r) return false
        const box = r.getBoundingClientRect()
        const cx = box.left + box.width / 2, cy = box.top + box.height / 2
        const el = document.elementFromPoint(cx, cy)
        if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true }
        return false
      })
      if (!clicked) {
        const nextBtn = page.locator('[data-walk-card] .walk-btn-primary').first()
        if (await nextBtn.count()) await nextBtn.click({ timeout: 3000 }).catch(() => {})
      }
    } else {
      const nextBtn = page.locator('[data-walk-card] .walk-btn-primary').first()
      if (await nextBtn.count()) await nextBtn.click({ timeout: 3000 }).catch(() => {})
      else { steps[steps.length - 1].note = 'no Next button and not a resolvable click step — stuck'; break }
    }
    await page.waitForTimeout(500)
  }
  return steps
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const results = { base: BASE, role: ROLE, viewAs: VIEWAS ? VIEWAS_ROLE : null, at: new Date().toISOString(), widths: {} }

for (const width of WIDTHS) {
  const email = ACCOUNTS[ROLE]
  const session = await mint(email)
  const vp = VIEWPORTS[width]
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.isMobile ? 2 : 1 })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
  const page = await ctx.newPage()
  const rec = { entries: [] }
  results.widths[width] = rec
  try {
    if (ROLE === 'learner') {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 2500)
      const lib = page.locator('.nav-content .pill-btn').first()
      if (await lib.count()) { await lib.click({ timeout: 10000 }); await page.waitForTimeout(1200) }
      const toggle = page.locator('.hl-toggle').first()
      const hasToggle = await toggle.count()
      rec.hasToggle = hasToggle
      if (hasToggle) {
        await toggle.click({ timeout: 10000 }); await page.waitForTimeout(700)
        const offers = await page.locator('[data-walk-offer]').evaluateAll((els) => els.map((e) => e.getAttribute('data-walk-offer')))
        rec.offers = offers
        for (const id of offers.slice(0, LIMIT)) {
          const before = page.url()
          await page.locator(`[data-walk-offer="${id}"]`).first().click({ timeout: 5000 }).catch((e) => rec.entries.push({ id, error: e.message.slice(0, 100) }))
          await page.waitForTimeout(1000)
          const active = await walkActive(page)
          const steps = active ? await stepThroughWalk(page) : []
          rec.entries.push({ id, startUrl: before, started: !!active, steps })
          await page.keyboard.press('Escape').catch(() => {})
          await page.waitForTimeout(300)
          await page.evaluate(() => window.scrollTo(0, 0))
          if (!(await page.locator('[data-walk-offer]').count())) {
            const t2 = page.locator('.hl-toggle').first()
            if (await t2.count()) { await t2.click().catch(() => {}); await page.waitForTimeout(500) }
          }
        }
      }
    } else {
      // admin persona: Handbook page, schools surface, then intel surface
      await page.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 2500)
      rec.handbookUrl = page.url()
      if (VIEWAS) {
        const open = page.locator('[data-testid="view-as-open"]').first()
        if (await open.count()) {
          await open.click({ timeout: 5000 }).catch(() => {})
          await page.waitForTimeout(500)
          const roleBtn = page.locator(`[data-testid="view-as-role-${VIEWAS_ROLE}"]`).first()
          if (await roleBtn.count()) { await roleBtn.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500) }
          else rec.viewAsNote = `no [data-testid="view-as-role-${VIEWAS_ROLE}"] found`
        } else rec.viewAsNote = 'no view-as-open control on handbook page'
      }
      const readLot = page.locator('button:has-text("Read the lot"), button:has-text("Show me the lot")').first()
      if (await readLot.count()) { await readLot.click(); await page.waitForTimeout(800) }
      const entries = await page.locator('.entry').evaluateAll((els) => els.map((el) => ({
        id: el.id.replace(/^hb-/, ''),
        title: el.querySelector('.entry-title')?.textContent.trim(),
        clip: !!el.querySelector('[data-walk-offer]'),
        clipId: el.querySelector('[data-walk-offer]')?.getAttribute('data-walk-offer') || null,
        hasGoto: !!el.querySelector('.entry-goto'),
        gotoHref: el.querySelector('.entry-goto')?.getAttribute('href') || null,
      })))
      rec.entryCount = entries.length
      const withClip = entries.filter((e) => e.clip)
      rec.withClipCount = withClip.length
      const target = withClip.slice(0, LIMIT)
      for (const e of target) {
        await page.goto(`${BASE}/schools/handbook?entry=${e.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
        await settle(page, 1500)
        // Take me there first (doesn't disturb Show-me)
        let gotoResult = null
        const gotoBtn = page.locator(`#hb-${e.id} .entry-goto`).first()
        if (await gotoBtn.count()) {
          const href = await gotoBtn.getAttribute('href').catch(() => null)
          gotoResult = { href }
        } else gotoResult = { href: null, note: 'no Take-me-there link rendered' }
        // Show me
        const btn = page.locator(`#hb-${e.id} [data-walk-offer]`).first()
        let entryRec = { id: e.id, title: e.title, clipId: e.clipId, goto: gotoResult }
        if (!(await btn.count())) { entryRec.showMe = { error: 'offer button not rendered' } }
        else {
          await btn.scrollIntoViewIfNeeded().catch(() => {})
          await btn.click({ timeout: 10000 }).catch((err) => { entryRec.showMe = { error: err.message.slice(0, 120) } })
          await page.waitForTimeout(1200)
          const active = await walkActive(page)
          const url = page.url()
          const steps = active ? await stepThroughWalk(page) : []
          entryRec.showMe = { started: !!active, url, steps }
        }
        rec.entries.push(entryRec)
        await page.keyboard.press('Escape').catch(() => {})
      }
    }
  } catch (e) {
    rec.error = e.message.slice(0, 400)
    console.log(`ERROR (${width}):`, e.message.slice(0, 400))
  } finally { await ctx.close() }
  console.log(`done width=${width} entries=${rec.entries?.length}`)
}
await browser.close()
const fname = `${ROLE}${VIEWAS ? '-viewas-' + VIEWAS_ROLE : ''}.json`
fs.writeFileSync(path.join(OUT, fname), JSON.stringify(results, null, 2))
console.log('wrote', path.join(OUT, fname))
