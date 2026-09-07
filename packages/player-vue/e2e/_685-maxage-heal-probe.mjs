// #685 step 2 — THE MEASURED QUESTION: does an ALREADY-POISONED browser
// profile heal itself once the HTTP entry's max-age=300 expires, with #676's
// `Vary: Authorization` in play and NOTHING cleared?
//
// Three readings, one profile, no storage clearing at any point:
//   A. signed out on the course — the 19-seed preview lands in IndexedDB
//      ('ssi-bundle-cache'), and we read the record it wrote.
//   B. the premium session appears in the SAME tab with NO reload — does the
//      in-memory `session` map keep serving the preview? (the residual hole)
//   C. after max-age has expired, still nothing cleared, ONE reload — what
//      does the app actually build?
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5680'
const OUT = process.env.OUT_DIR || (process.env.CS_SCRATCH + '/shots-685/')
const COURSE = process.env.COURSE || 'Chinese'
const CODE = process.env.CODE || 'zho_for_eng'
const FRAG = COURSE.toLowerCase()
mkdirSync(OUT, { recursive: true })
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const EMAIL = process.env.PROBE_EMAIL
const serviceKey = readFileSync(process.env.REPO + '/.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const WAIT_MS = Number(process.env.MAXAGE_WAIT_MS || 330000)

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({
  viewport: { width: 393, height: 851 },
  userAgent: 'Mozilla/5.0 (Linux; Android 16; sdk_gphone64_arm64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  isMobile: true, hasTouch: true, deviceScaleFactor: 2,
})
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => { const s = m.text(); if (/BundleScript|Bundle|belt|entitle/i.test(s)) logs.push(`[${m.type()}] ${s.slice(0, 220)}`) })
const bundleReqs = []
page.on('response', async (r) => {
  const u = r.url()
  if (!/\/api\/courses\/[a-z0-9_]+\/bundle/.test(u) || u.includes('head=1')) return
  const auth = (r.request().headers()['authorization'] || '') ? 'AUTH' : 'anon'
  let prev = '?'
  try { const j = await r.json(); prev = `previewOnly=${!!j.previewOnly} legos=${(j.legos || []).length}` } catch {}
  const line = `${r.status()} ${auth} ${prev} ${u.replace(BASE, '')}`
  bundleReqs.push(line)
  console.log('  [BUNDLE] ' + line)
})

const courseName = async () => ((await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || '').trim()
const readRecord = async (tag) => {
  const rec = await page.evaluate(async () => {
    try {
      const db = await new Promise((r) => { const q = indexedDB.open('ssi-bundle-cache'); q.onsuccess = () => r(q.result); q.onerror = () => r(null) })
      if (!db || !db.objectStoreNames.contains('bundles')) return 'no store'
      const vals = await new Promise((r) => { const q = db.transaction('bundles', 'readonly').objectStore('bundles').getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]) })
      return vals.map((v) => ({
        courseCode: v.courseCode, cacheKey: v.cacheKey,
        ownerId: Object.prototype.hasOwnProperty.call(v, 'ownerId') ? String(v.ownerId) : '(absent)',
        fetchedWithAuth: Object.prototype.hasOwnProperty.call(v, 'fetchedWithAuth') ? String(v.fetchedWithAuth) : '(absent)',
        previewOnly: !!(v.bundle || {}).previewOnly, legos: ((v.bundle || {}).legos || []).length,
      }))
    } catch (e) { return 'ERR ' + e.message }
  })
  console.log(`  [ssi-bundle-cache @ ${tag}] ${JSON.stringify(rec)}`)
  return rec
}
const selectCourse = async () => {
  await page.locator('.course-name--tappable').first().click()
  await page.waitForSelector('.course-row', { timeout: 20000 })
  let row = page.locator(`.course-row:has-text("${COURSE}")`).first()
  if (await row.evaluate((el) => el.classList.contains('has-variants')).catch(() => false)) {
    await row.click(); await page.waitForSelector('.course-row.variant', { timeout: 5000 }); row = page.locator('.course-row.variant').first()
  }
  await row.click()
  const t0 = Date.now()
  for (;;) { if ((await courseName()).toLowerCase().includes(FRAG) && await page.locator('.belt-badge').isVisible().catch(() => false)) break; if (Date.now() - t0 > 90000) throw new Error('ready timeout'); await page.waitForTimeout(100) }
}
const startPlayer = async () => {
  await page.locator('.play-button, button[aria-label*="Play" i], .play-pause').first().click({ timeout: 8000 })
    .catch(async () => { await page.locator('body').click({ position: { x: 196, y: 520 } }) })
  await page.waitForSelector('.belt-timer-unified:not([disabled])', { timeout: 60000 }).catch(() => {})
}
const belt = async () => ((await page.locator('.belt-badge, .belt-name').first().textContent().catch(() => '')) || '').trim()

// ── A: signed OUT — poison the profile ───────────────────────────────────────
console.log('===== A: signed OUT on ' + COURSE + ' (' + CODE + ') =====')
await page.addInitScript(() => { try { localStorage.setItem('ssi-has-played', 'true') } catch {} })
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
if (!(await courseName()).toLowerCase().includes(FRAG)) await selectCourse()
await startPlayer()
await page.waitForTimeout(20000)
const poisonedAt = Date.now()
const recA = await readRecord('A: after a signed-out visit')
console.log('  belt:', await belt())
await page.screenshot({ path: `${OUT}A-poisoned.png` })

// ── B: premium session in the SAME tab, NO reload ────────────────────────────
console.log('\n===== B: premium session appears in the same tab, NO reload =====')
const gl = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }).then((r) => r.json())
const session = await fetch(`${SB_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: gl.hashed_token }) }).then((r) => r.json())
if (!session.access_token) throw new Error('no session: ' + JSON.stringify(session).slice(0, 200))
const ref = new URL(SB_URL).hostname.split('.')[0]
const before = bundleReqs.length
await page.evaluate(([k, s]) => { localStorage.setItem(k, JSON.stringify(s)); window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: JSON.stringify(s) })) }, [`sb-${ref}-auth-token`, session])
await page.waitForTimeout(30000)
const recB = await readRecord('B: 30s after the session appeared, no reload')
console.log('  new /bundle requests since the session appeared:', bundleReqs.length - before)
console.log('  belt:', await belt())
await page.screenshot({ path: `${OUT}B-session-no-reload.png` })

// ── C: wait out max-age=300, clear NOTHING, one reload ───────────────────────
const remain = Math.max(0, WAIT_MS - (Date.now() - poisonedAt))
console.log(`\n===== C: waiting ${Math.round(remain / 1000)}s for max-age=300 to expire — clearing NOTHING =====`)
await page.waitForTimeout(remain)
logs.length = 0
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
if (!(await courseName()).toLowerCase().includes(FRAG)) await selectCourse()
await startPlayer()
await page.waitForTimeout(20000)
const recC = await readRecord('C: after max-age expiry + one reload')
console.log('  belt:', await belt())
await page.screenshot({ path: `${OUT}C-after-maxage.png` })
console.log('\n--- BundleScript lines ---')
logs.filter((l) => /BundleScript/.test(l)).slice(-6).forEach((l) => console.log('  ' + l))
console.log('\n--- VERDICT ---')
const f = (r) => (Array.isArray(r) ? (r.find((x) => x.courseCode === CODE) || r[0]) : r)
console.log('A (signed out):        ', JSON.stringify(f(recA)))
console.log('B (session, no reload):', JSON.stringify(f(recB)))
console.log('C (max-age + reload):  ', JSON.stringify(f(recC)))
console.log('all /bundle fetches:'); bundleReqs.forEach((l) => console.log('   ' + l))
await browser.close()
