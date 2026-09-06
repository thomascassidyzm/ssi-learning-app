// #685 ACCEPTANCE — an ALREADY-POISONED profile plays Orange Belt, with no
// storage clearing of any kind at any point.
//
// Phase A poisons the profile exactly as #676's probe does: a signed-out visit
// to the course, which caches the 19-seed free preview. Phase B puts the real
// premium session on the same profile — no ?reset=1, no IndexedDB delete, no
// new context — reloads once, taps Orange, and counts the audio that actually
// downloads while it plays.
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5680'
const OUT = process.env.OUT_DIR || (process.env.CS_SCRATCH + '/shots-685-acc/')
const COURSE = process.env.COURSE || 'Chinese'
const CODE = process.env.CODE || 'zho_for_eng'
const FRAG = COURSE.toLowerCase()
mkdirSync(OUT, { recursive: true })
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const EMAIL = process.env.PROBE_EMAIL
const serviceKey = readFileSync(process.env.REPO + '/.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({
  viewport: { width: 393, height: 851 },
  userAgent: 'Mozilla/5.0 (Linux; Android 16; sdk_gphone64_arm64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  isMobile: true, hasTouch: true, deviceScaleFactor: 2,
})
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => { const s = m.text(); if (/BundleScript|belt|Bundle/i.test(s)) logs.push(s.slice(0, 200)) })
page.on('response', async (r) => {
  const u = r.url()
  if (!/\/api\/courses\/[a-z0-9_]+\/bundle/.test(u) || u.includes('head=1')) return
  const auth = r.request().headers()['authorization'] ? 'AUTH' : 'anon'
  let prev = '?'
  try { const j = await r.json(); prev = `previewOnly=${!!j.previewOnly} legos=${(j.legos || []).length}` } catch {}
  console.log(`  [BUNDLE] ${r.status()} ${auth} ${prev} vary=${r.headers()['vary'] || '-'}`)
})
const plays = []
page.on('response', (r) => { if (/\/api\/audio\//.test(r.url())) plays.push(r.status()) })

const courseName = async () => ((await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || '').trim()
const belt = async () => ((await page.locator('.belt-badge, .belt-name').first().textContent().catch(() => '')) || '').trim()
const readRecord = async (tag) => {
  const rec = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('ssi-bundle-cache'); q.onsuccess = () => r(q.result); q.onerror = () => r(null) })
    if (!db || !db.objectStoreNames.contains('bundles')) return 'no store'
    const vals = await new Promise((r) => { const q = db.transaction('bundles', 'readonly').objectStore('bundles').getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]) })
    return vals.map((v) => ({ courseCode: v.courseCode, tier: v.tier ?? '(absent)', fetchedWithAuth: String(v.fetchedWithAuth), ownerId: String(v.ownerId), previewOnly: !!(v.bundle || {}).previewOnly, legos: ((v.bundle || {}).legos || []).length }))
  })
  console.log(`  [record @ ${tag}] ${JSON.stringify(rec)}`)
  return rec
}
const startPlayer = async () => {
  await page.locator('.play-button, button[aria-label*="Play" i], .play-pause').first().click({ timeout: 8000 })
    .catch(async () => { await page.locator('body').click({ position: { x: 196, y: 520 } }) })
  await page.waitForSelector('.belt-timer-unified:not([disabled])', { timeout: 60000 }).catch(() => {})
}

console.log('===== A: POISON — signed-out visit to ' + COURSE + ' =====')
await page.addInitScript(() => { try { localStorage.setItem('ssi-has-played', 'true') } catch {} })
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
console.log('  on', await courseName())
await startPlayer()
await page.waitForTimeout(20000)
await readRecord('A: poisoned')
console.log('  belt:', await belt())
console.log('  script:', logs.filter((l) => /BundleScript/.test(l)).slice(-1)[0] || '(none)')
await page.screenshot({ path: `${OUT}A-poisoned.png` })

console.log('\n===== B: the real premium session on the SAME profile — nothing cleared =====')
const gl = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }).then((r) => r.json())
const session = await fetch(`${SB_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: gl.hashed_token }) }).then((r) => r.json())
if (!session.access_token) throw new Error('no session')
const ref = new URL(SB_URL).hostname.split('.')[0]
await page.evaluate(([k, s]) => { localStorage.setItem(k, JSON.stringify(s)) }, [`sb-${ref}-auth-token`, session])
logs.length = 0
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
console.log('  on', await courseName())
await startPlayer()
await page.waitForTimeout(15000)
await readRecord('B: after the session arrived')
console.log('  script:', logs.filter((l) => /BundleScript/.test(l)).slice(-1)[0] || '(none)')
await page.screenshot({ path: `${OUT}B-healed.png` })

console.log('\n===== C: tap ORANGE and play =====')
await page.locator('.belt-timer-unified').click()
await page.waitForSelector('.map-chip', { timeout: 15000 })
const chips = await page.locator('.map-chip').evaluateAll((els) => els.map((e) => ({ cls: e.className, title: e.getAttribute('title') })))
chips.forEach((c, i) => console.log(`  chip${i}: ${c.cls} | ${c.title}`))
const oi = chips.findIndex((c) => /orange/i.test(c.title || ''))
if (oi < 0) throw new Error('no orange chip')
await page.locator('.map-chip').nth(oi).click()
await page.waitForTimeout(12000)
await page.screenshot({ path: `${OUT}C-after-orange.png` })
plays.length = 0
await page.locator('.play-button, button[aria-label*="Play" i], .play-pause').first().click({ timeout: 8000 })
  .catch(async () => { await page.locator('body').click({ position: { x: 196, y: 520 } }) })
await page.waitForTimeout(35000)
await page.screenshot({ path: `${OUT}C-playing.png` })
console.log('  belt now:', await belt())
console.log('  screen:', (await page.locator('body').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 300))
console.log(`  AUDIO CLIPS FETCHED WHILE PLAYING: ${plays.length} (statuses: ${[...new Set(plays)].join(',')})`)
console.log('  script:', logs.filter((l) => /BundleScript/.test(l)).slice(-1)[0] || '(none)')
await browser.close()
