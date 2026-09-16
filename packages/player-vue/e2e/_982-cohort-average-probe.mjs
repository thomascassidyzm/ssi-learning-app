// Job #979 finish — the class insights average is self-inclusive and its cohort is fixed.
// Signs in as the Chepstow school-admin persona, opens two classes' insights pages at
// phone width (390px) and asserts the caption names the full cohort and that the school
// average reads identically from both classes.
//   set -a; . ~/.secrets/ssi-dashboard.env; set +a
//   EXPECT_BUILD=08fc230 node e2e/_982-cohort-average-probe.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const SB_URL = process.env.SUPABASE_URL.replace(/\/$/, ''), SB_KEY = process.env.SUPABASE_SERVICE_KEY
const EMAIL = process.env.LEADER_EMAIL || 'thomas.cassidy+e2e-admin@gmail.com'
const CLASS_A = process.env.CLASS_A || '9cbef56d-baf7-4e22-bdc1-9e38f98b1e17' // 10P
const CLASS_B = process.env.CLASS_B || '1a89495d-564e-43ed-80d5-dd49b07fb742' // 11P
const OUT = process.env.OUT_DIR || '/home/tomcassidy/.tmpbig/979shots'
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const version = await (await fetch(`${BASE}/version.json`, { cache: 'no-store' })).json()
check('served build is the promoted commit', version.buildNumber === process.env.EXPECT_BUILD, JSON.stringify(version))

const j = await (await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
const sess = await (await fetch(`${SB_URL}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: j.hashed_token }) })).json()
check('minted a session for the Chepstow leader', !!sess.access_token, sess.error || sess.msg || '')
const KEY = `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const KEYV = JSON.stringify(sess)
const errors = []
const apiLog = []

async function openInsights(id, tag) {
  // A fresh context per class: the same page navigating node to node sometimes
  // lands back on the org list, and a stale SPA state is not what we are testing.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, KEYV])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  const bodies = []
  page.on('response', async (r) => {
    const u = new URL(r.url())
    if (!u.pathname.startsWith('/api/')) return
    apiLog.push(`${tag} ${r.status()} ${u.pathname}${u.search}`)
    if (!u.pathname.includes('rate-compare')) return
    try { bodies.push(await r.json()) } catch { /* non-json */ }
  })
  await page.goto(`${BASE}/org/${id}/insights`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(9000)
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await later.first().click().catch(() => {})
  await page.waitForTimeout(4000)
  const caption = page.locator('.rc-stat-cohort-size')
  const captionText = (await caption.count()) ? (await caption.first().innerText()).replace(/\s+/g, ' ').trim() : null
  await page.screenshot({ path: `${OUT}/979-${tag}-page.png`, fullPage: true })
  const card = page.locator('.rc-headline').first()
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(700)
    await card.screenshot({ path: `${OUT}/979-${tag}-card.png` }).catch(() => {})
    await page.screenshot({ path: `${OUT}/979-${tag}.png` })
  } else {
    await page.screenshot({ path: `${OUT}/979-${tag}.png` })
  }
  const url = page.url()
  await ctx.close()
  return { captionText, body: bodies.find((b) => b && b.average), url }
}

const a = await openInsights(CLASS_A, 'class-10P')
const b = await openInsights(CLASS_B, 'class-11P')

check('10P shows a cohort-size caption under the average', !!a.captionText, a.captionText || 'absent')
check('11P shows a cohort-size caption under the average', !!b.captionText, b.captionText || 'absent')
check('the caption names the full cohort, not the active subset', /all \d+ classes/.test(a.captionText || ''), a.captionText || '')
check('10P cohort size is the whole school on this course', a.body?.cohortSize >= 30, `cohortSize=${a.body?.cohortSize}`)
check('the two classes report the SAME cohort size', a.body?.cohortSize === b.body?.cohortSize, `${a.body?.cohortSize} vs ${b.body?.cohortSize}`)
check('the two classes report the SAME average', a.body?.average?.value === b.body?.average?.value, `${a.body?.average?.value} vs ${b.body?.average?.value}`)
check('each class is inside its own cohort (percentile > 0)', (a.body?.percentile ?? 0) > 0 && (b.body?.percentile ?? 0) > 0, `${a.body?.percentile} / ${b.body?.percentile}`)
check('no page errors', errors.length === 0, errors.join(' | '))

console.log('landed:', a.url, '|', b.url)
console.log('api calls:', apiLog.filter((l) => !l.includes('/api/audio/')).join('\n  '))
console.log('10P caption:', a.captionText)
console.log('11P caption:', b.captionText)
console.log('10P:', JSON.stringify({ entity: a.body?.entity?.value, avg: a.body?.average?.value, label: a.body?.average?.label, cohortSize: a.body?.cohortSize, applied: a.body?.applied }))
console.log('11P:', JSON.stringify({ entity: b.body?.entity?.value, avg: b.body?.average?.value, label: b.body?.average?.label, cohortSize: b.body?.cohortSize, applied: b.body?.applied }))

await browser.close()
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
