// #676 — HYPOTHESIS: the client script/roundmap caches are keyed by
// (SCRIPT_VERSION, courseCode) with NO previewOnly flag and NO owner identity
// (unlike useCourseBundle, hardened for exactly this). So a 19-seed PREVIEW
// script cached by a signed-out visit is served forever to the same device,
// including to a signed-in premium learner — Orange Belt permanently "not on
// this device yet".
//
// Phase A: visit COURSE signed OUT, let the preview script cache.
// Phase B: inject a premium session into the SAME context, reload, tap Orange.
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || (process.env.CS_SCRATCH + '/shots-poison/')
const COURSE = process.env.COURSE || 'Chinese'
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
page.on('console', (m) => { const s = m.text(); if (/ScriptCache|Bundle|progressiveLoad|rror|belt/i.test(s)) logs.push(`[${m.type()}] ${s.slice(0,260)}`) })

page.on('response', async (r) => {
  const u = r.url()
  if (!/\/api\/courses\/[a-z_]+\/bundle/.test(u)) return
  const auth = (r.request().headers()['authorization'] || '').slice(0, 40) || 'NONE'
  const h = r.headers()
  const meta = `vercel=${h['x-vercel-cache']||'-'} cc=${(h['cache-control']||'-').slice(0,40)} sw=${r.fromServiceWorker()}`
  let prev = '?'
  try { if (!u.includes('head=1')) { const j = await r.json(); prev = String(!!j.previewOnly) + ' legos=' + (j.legos||[]).length } } catch {}
  console.log(`  [BUNDLE] ${r.status()} previewOnly=${prev} ${meta}\n           auth=${auth} ${u.replace(BASE,'')}`)
})

const courseName = async () => ((await page.locator('.course-name--tappable').first().textContent().catch(()=>'')) || '').trim()
const dumpCaches = async (tag) => {
  const out = await page.evaluate(async () => {
    const res = { script: null, ls: [] }
    try {
      const db = await new Promise((r) => { const q = indexedDB.open('ssi-script-cache'); q.onsuccess = () => r(q.result); q.onerror = () => r(null) })
      if (db && db.objectStoreNames.contains('scripts')) {
        const tx = db.transaction('scripts', 'readonly').objectStore('scripts')
        const keys = await new Promise((r) => { const q = tx.getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => r([]) })
        const vals = await new Promise((r) => { const tx2 = db.transaction('scripts','readonly').objectStore('scripts'); const q = tx2.getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]) })
        res.script = keys.map((k, i) => {
          const v = vals[i] || {}
          const rounds = v.rounds || []
          const seeds = rounds.map((r) => parseInt(String(r.seedId||'').slice(1), 10)).filter(Number.isFinite)
          return { key: k, rounds: rounds.length, maxSeed: seeds.length ? Math.max(...seeds) : null, totalSeeds: v.totalSeeds, mainLoopRoundCount: v.mainLoopRoundCount }
        })
      }
    } catch (e) { res.script = 'ERR ' + e.message }
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && /instant-playback|content-version/.test(k)) res.ls.push(k + ' = ' + (localStorage.getItem(k)||'').slice(0,60)) }
    return res
  })
  console.log(`  [caches @ ${tag}]`, JSON.stringify(out).slice(0, 1400))
}
const selectCourse = async () => {
  await page.locator('.course-name--tappable').first().click()
  await page.waitForSelector('.course-row', { timeout: 20000 })
  let row = page.locator(`.course-row:has-text("${COURSE}")`).first()
  if (await row.evaluate((el)=>el.classList.contains('has-variants')).catch(()=>false)) {
    await row.click(); await page.waitForSelector('.course-row.variant', { timeout: 5000 }); row = page.locator('.course-row.variant').first()
  }
  await row.click()
  const t0 = Date.now()
  for (;;) { if ((await courseName()).toLowerCase().includes(FRAG) && await page.locator('.belt-badge').isVisible().catch(()=>false)) break; if (Date.now()-t0>90000) throw new Error('ready timeout'); await page.waitForTimeout(100) }
}
const startPlayer = async () => {
  await page.locator('.play-button, button[aria-label*="Play" i], .play-pause').first().click({ timeout: 8000 }).catch(async () => { await page.locator('body').click({ position: { x: 196, y: 520 } }) })
  await page.waitForSelector('.belt-timer-unified:not([disabled])', { timeout: 60000 })
}

// ── PHASE A: signed out, cache the preview script ────────────────────────────
console.log('===== PHASE A: signed OUT visit to ' + COURSE + ' =====')
await page.addInitScript(() => { try { localStorage.setItem('ssi-has-played','true') } catch {} })
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(Number(process.env.BOOT_MS || 6000))
if (!(await courseName()).toLowerCase().includes(FRAG)) await selectCourse()
console.log('  on', await courseName())
await startPlayer()
await page.waitForTimeout(25000)   // let the script generate + cache
await dumpCaches('A end')
await page.screenshot({ path: `${OUT}A-signedout.png` })

// ── PHASE B: same device, now a premium session ──────────────────────────────
console.log('\n===== PHASE B: same browser profile, now signed in as ' + EMAIL + ' =====')
const gl = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method:'POST', headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'}, body: JSON.stringify({type:'magiclink',email:EMAIL}) }).then(r=>r.json())
const session = await fetch(`${SB_URL}/auth/v1/verify`, { method:'POST', headers:{apikey:ANON_KEY,'Content-Type':'application/json'}, body: JSON.stringify({type:'magiclink',token_hash: gl.hashed_token}) }).then(r=>r.json())
if (!session.access_token) throw new Error('no session')

// CLEAR_ONLY=script|ls|none — isolate which poisoned cache causes the refusal.
const CLEAR = process.env.CLEAR_ONLY || 'none'
if (CLEAR !== 'none') {
  await page.evaluate(async (which) => {
    if (which === 'script') { await new Promise((r) => { const q = indexedDB.deleteDatabase('ssi-script-cache'); q.onsuccess = q.onerror = q.onblocked = () => r() }) }
    if (which === 'ls') { const kill = []; for (let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if (k && /instant-playback/.test(k)) kill.push(k)} kill.forEach(k=>localStorage.removeItem(k)) }
  }, CLEAR)
  console.log('  [cleared: ' + CLEAR + ']')
}
const ref = new URL(SB_URL).hostname.split('.')[0]
await page.evaluate(([k, s]) => { localStorage.setItem(k, JSON.stringify(s)) }, [`sb-${ref}-auth-token`, session])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
if (!(await courseName()).toLowerCase().includes(FRAG)) await selectCourse()
console.log('  on', await courseName())
await startPlayer()
await page.waitForTimeout(15000)
await dumpCaches('B end')

logs.length = 0
await page.locator('.belt-timer-unified').click()
await page.waitForSelector('.map-chip', { timeout: 15000 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}B-beltmodal.png` })
const chips = await page.locator('.map-chip').evaluateAll((els) => els.map((e) => ({ cls: e.className, title: e.getAttribute('title') })))
chips.forEach((c,i)=>console.log(`  chip${i}: ${c.cls} | ${c.title}`))
const oi = chips.findIndex((c) => /orange/i.test(c.title||''))
await page.locator('.map-chip').nth(oi).click()
// The waiting toast shows for 8s from the first unlanded attempt — shoot it
// while it is up, with the belt pill and the Easy/Fast control both on screen.
await page.waitForTimeout(2500)
const tip = page.locator('.belt-waiting-tip, .mode-tip').first()
if (await tip.count()) {
  const box = await tip.boundingBox()
  console.log('WAITING TOAST:', JSON.stringify(await tip.textContent()))
  console.log('  box:', JSON.stringify(box), 'viewport 393x851')
  const clipped = await tip.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
  const z = await tip.evaluate((el) => getComputedStyle(el).zIndex)
  console.log('  clipped:', clipped, '| z-index:', z)
  const covered = await tip.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    return hit === el || el.contains(hit) ? null : (hit?.className || hit?.tagName || 'unknown')
  })
  console.log('  covered by:', covered ?? 'nothing — the toast is the topmost element at its own centre')
} else { console.log('WAITING TOAST: not shown') }
await page.screenshot({ path: `${OUT}B-waiting-toast.png` })
await page.waitForTimeout(12500)
await page.screenshot({ path: `${OUT}B-after-orange.png` })

// ACCEPTANCE: does Orange-belt content actually DOWNLOAD and PLAY?
const plays = []
page.on('response', (r) => { if (/\/api\/audio\//.test(r.url())) plays.push(`${r.status()} ${r.url().split('/api/audio/')[1].slice(0,40)}`) })
await page.locator('.play-button, button[aria-label*="Play" i], .play-pause').first().click({ timeout: 8000 }).catch(async () => { await page.locator('body').click({ position: { x: 196, y: 520 } }) })
await page.waitForTimeout(35000)
await page.screenshot({ path: `${OUT}B-playing.png` })
console.log('BELT NOW:', ((await page.locator('.belt-badge, .belt-name').first().textContent().catch(()=>'')) || '').trim())
console.log('PLAYING SCREEN:', (await page.locator('body').innerText().catch(()=>'')).replace(/\n+/g,' | ').slice(0,400))
console.log(`AUDIO CLIPS FETCHED WHILE PLAYING: ${plays.length}`); plays.slice(0,8).forEach(x=>console.log('   '+x))
console.log('SCREEN:', (await page.locator('body').innerText().catch(()=>'')).replace(/\n+/g,' | ').slice(0,700))
console.log('--- console ---'); logs.slice(-40).forEach(l=>console.log('  '+l))
await browser.close()
