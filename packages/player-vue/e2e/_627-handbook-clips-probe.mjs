/**
 * Job #627 probe: does the Handbook play clips, or show prose?
 *
 * Signs in on a deployed build as each persona in turn, opens every help
 * entry point, records for every Handbook entry whether it offers a clip or
 * prose only, taps every clip offer and watches whether a walk actually
 * starts on the destination page (data-walk-active on <html>), and shoots the
 * screens. READ-ONLY apart from the sign-in itself. Writes a census JSON.
 *
 *   set -a; . .env.local; . ~/.ssi-sentinel.env; set +a
 *   TMPDIR=/tmp LD_LIBRARY_PATH=~/.pw-libs/usr/lib/x86_64-linux-gnu:~/.ssi-sentinel-libs \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   SHOTS=$CS_SCRATCH/before node packages/player-vue/e2e/_627-handbook-clips-probe.mjs
 *
 * BASE defaults to staging. PERSONAS=leader,teacher,learner,govt narrows the run.
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || path.join(process.env.TMPDIR || '/tmp', 'shots-627')
fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = process.env.VITE_SUPABASE_URL.trim()
const ANON = process.env.VITE_SUPABASE_ANON_KEY.trim()
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]

const ACCOUNTS = {
  leader: 'thomas.cassidy+chepstowtest-leader@gmail.com', // school_admin, ZZ Test Chepstow scenario
  govt: 'thomas.cassidy+bumface@gmail.com', // govt_admin — reads as "leader" persona
  teacher: 'thomas.cassidy+chepstowtest-cover@gmail.com', // teacher at the same school
  learner: 'thomas.cassidy+e2e-learner@gmail.com', // plain learner
}
const PERSONAS = (process.env.PERSONAS || 'leader,govt,teacher,learner').split(',')

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!glj.email_otp) throw new Error('generate_link: ' + JSON.stringify(glj).slice(0, 200))
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!vj.access_token) throw new Error('verify: ' + JSON.stringify(vj).slice(0, 200)); return vj
}
const settle = async (p, ms = 1500) => { await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(ms) }
const walkActive = (p) => p.evaluate(() => document.documentElement.getAttribute('data-walk-active'))
async function waitWalk(p, ms = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const a = await walkActive(p); if (a) return a; await p.waitForTimeout(250) }
  return null
}

const version = await fetch(`${BASE}/version.json`).then((r) => r.json()).catch(() => null)
console.log('build', JSON.stringify(version))
const census = { base: BASE, version, at: new Date().toISOString(), personas: {} }

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
for (const persona of PERSONAS) {
  const email = ACCOUNTS[persona]
  const session = await mint(email)
  console.log(`\n=== ${persona} — ${email}`)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
  const page = await ctx.newPage()
  const shot = async (name) => { const f = path.join(SHOTS, `${persona}--${name}.png`); await page.screenshot({ path: f, fullPage: name.includes('full') }); return f }
  const rec = { email, entries: [], plays: [], notes: [] }
  census.personas[persona] = rec
  try {
    if (persona === 'learner') {
      // The learner has no Handbook: the help door is the Library's How-this-works hub.
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 3000)
      rec.notes.push(`landing url=${page.url()}`)
      await page.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 2000)
      rec.notes.push(`/schools/handbook as a learner -> ${page.url()}`)
      await shot('schools-handbook-redirect')
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 3000)
      // The Library is an overlay on the player: the first pill in the bottom nav opens it.
      const lib = page.locator('.nav-content .pill-btn').first()
      if (await lib.count()) { await lib.click({ timeout: 10000 }); await page.waitForTimeout(1500) }
      await shot('library')
      const toggle = page.locator('.hl-toggle').first()
      const hasToggle = await toggle.count()
      rec.notes.push(`library How-this-works toggle count=${hasToggle}`)
      if (hasToggle) {
        await toggle.scrollIntoViewIfNeeded().catch(() => {})
        await toggle.click({ timeout: 10000 }); await page.waitForTimeout(800)
        await shot('library-htw-open')
        const offers = page.locator('[data-walk-offer]')
        const ids = await offers.evaluateAll((els) => els.map((e) => [e.getAttribute('data-walk-offer'), e.textContent.trim()]))
        rec.entries = ids.map(([id, label]) => ({ id, label, clip: true }))
        console.log('  library offers:', ids.map((x) => x[0]).join(', '))
        for (const [id] of ids) {
          await page.locator(`[data-walk-offer="${id}"]`).first().click({ timeout: 5000 }).catch((e) => rec.notes.push(`tap ${id} failed: ${e.message.slice(0, 80)}`))
          const active = await waitWalk(page, 6000)
          rec.plays.push({ id, active, url: page.url() })
          console.log(`  tap ${id} -> walk active: ${active}`)
          await shot(`walk-${id}`)
          await page.keyboard.press('Escape'); await page.waitForTimeout(300)
          await page.evaluate(() => window.scrollTo(0, 0))
          const t2 = page.locator('.hl-toggle').first()
          if (!(await page.locator('[data-walk-offer]').count())) { await t2.click().catch(() => {}); await page.waitForTimeout(500) }
        }
      }
      continue
    }

    // Dashboard personas: the Handbook page.
    await page.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 3000)
    rec.notes.push(`handbook url=${page.url()}`)
    await shot('handbook-top')
    const lede = await page.locator('.handbook-lede').first().innerText().catch(() => '')
    rec.notes.push(`lede: ${lede}`)
    // Open the lot so every entry body is inspectable.
    const readLot = page.locator('button:has-text("Read the lot"), button:has-text("Show me the lot")').first()
    if (await readLot.count()) { await readLot.click(); await page.waitForTimeout(800) }
    const entries = await page.locator('.entry').evaluateAll((els) => els.map((el) => ({
      id: el.id.replace(/^hb-/, ''),
      title: el.querySelector('.entry-title')?.textContent.trim(),
      badges: [...el.querySelectorAll('.entry-badges .status-pill')].map((b) => b.textContent.trim()),
      open: el.classList.contains('is-open'),
      clip: !!el.querySelector('[data-walk-offer]'),
      clipId: el.querySelector('[data-walk-offer]')?.getAttribute('data-walk-offer') || null,
      proseHeadings: [...el.querySelectorAll('.entry-h')].map((h) => h.textContent.trim()),
      firstControl: el.querySelector('.entry-body > *')?.className || null,
    })))
    rec.entries = entries
    const clips = entries.filter((e) => e.clip)
    console.log(`  entries=${entries.length} with clip offer=${clips.length} prose-only=${entries.length - clips.length}`)
    for (const e of clips) console.log(`   clip: ${e.id} -> ${e.clipId} (first control: ${e.firstControl})`)
    await shot('handbook-all-open-full')
    // A prose-only entry, opened, for the record.
    const proseOnly = entries.find((e) => !e.clip)
    if (proseOnly) {
      await page.evaluate((id) => document.getElementById(`hb-${id}`)?.scrollIntoView({ block: 'start' }), proseOnly.id)
      await page.waitForTimeout(300); await shot(`prose-entry-${proseOnly.id}`)
    }
    // Tap every clip offer and watch whether the walk actually starts.
    for (const e of clips) {
      await page.goto(`${BASE}/schools/handbook?entry=${e.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 2000)
      const btn = page.locator(`#hb-${e.id} [data-walk-offer]`).first()
      if (!(await btn.count())) { rec.plays.push({ id: e.id, walk: e.clipId, active: null, note: 'offer not rendered on deep link' }); continue }
      await btn.scrollIntoViewIfNeeded().catch(() => {})
      await shot(`clip-entry-${e.id}`)
      await btn.click({ timeout: 10000 })
      await page.waitForTimeout(1500)
      const active = await waitWalk(page, 12000)
      const url = page.url()
      rec.plays.push({ id: e.id, walk: e.clipId, active, url })
      console.log(`   tap ${e.id} -> ${url.replace(BASE, '')} walk active: ${active}`)
      await shot(`after-tap-${e.id}`)
      await page.keyboard.press('Escape').catch(() => {})
    }
    // The other door: How this works on the home node / class page.
    const home = persona === 'teacher' ? `${BASE}/schools/classes` : `${BASE}/schools`
    await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 3000)
    rec.notes.push(`home -> ${page.url()}`)
    if (persona === 'teacher') {
      const row = page.locator('[data-walk="classes-row"]').first()
      if (await row.count()) { await row.click(); await settle(page, 3000); rec.notes.push(`class page -> ${page.url()}`) }
    }
    const htw = page.locator('.htw-toggle').first()
    if (await htw.count()) {
      await htw.scrollIntoViewIfNeeded().catch(() => {}); await htw.click(); await page.waitForTimeout(800)
      const offers = await page.locator('[data-walk-offer]').evaluateAll((els) => els.map((e) => e.getAttribute('data-walk-offer')))
      rec.notes.push(`How-this-works offers on ${page.url().replace(BASE, '')}: ${offers.join(', ') || 'none'}`)
      console.log('  HTW offers:', offers.join(', ') || 'none')
      await shot('htw-open')
    } else rec.notes.push(`no How-this-works toggle on ${page.url().replace(BASE, '')}`)
  } catch (e) {
    rec.notes.push(`ERROR ${e.message.slice(0, 300)}`)
    console.log('  ERROR', e.message.slice(0, 300))
    await shot('error').catch(() => {})
  } finally { await ctx.close() }
}
await browser.close()
fs.writeFileSync(path.join(SHOTS, 'census.json'), JSON.stringify(census, null, 2))
console.log('\ncensus ->', path.join(SHOTS, 'census.json'))
