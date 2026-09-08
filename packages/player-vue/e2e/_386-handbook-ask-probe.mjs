// Run from a directory that has playwright installed (ssi-dashboard-v7-clean-prod), with LD_LIBRARY_PATH per memory, TMPDIR=/tmp,
// against a local vite build of this branch: BASE=http://127.0.0.1:5386. Job #386.
// job #386 — the ASK loop end to end on the LOCAL worktree build + local route shim against the live DB.
// Writes ONE real handbook_questions row (env=dev) as the ZZ Probe leader; answers it as the ssi_admin; reads it back.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const BASE = process.env.BASE || 'http://127.0.0.1:5386'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env', 'utf8').match(/^SUPABASE_ANON_KEY=(.+)/m)[1].trim()
const OUT = process.env.OUT || (process.env.CS_SCRATCH + '/ask')
fs.mkdirSync(OUT, { recursive: true })
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
async function sessionFor(email) {
  const link = await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email }) }).then((r) => r.json())
  if (!link.hashed_token) throw new Error('no hashed_token ' + JSON.stringify(link).slice(0, 200))
  const v = await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }) }).then((r) => r.json())
  if (!v.access_token) throw new Error('verify failed ' + JSON.stringify(v).slice(0, 200))
  return { access_token: v.access_token, refresh_token: v.refresh_token, expires_in: v.expires_in, expires_at: Math.floor(Date.now() / 1000) + (v.expires_in || 3600), token_type: 'bearer', user: v.user }
}
let fails = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ' :: ' + detail : ''}`); if (!ok) fails++ }
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
async function pageAs(email) {
  const s = await sessionFor(email)
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
  await ctx.addInitScript(([k, v]) => window.localStorage.setItem(k, JSON.stringify(v)), ['sb-swfvymspfxmnfhevgdkg-auth-token', s])
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 140)) })
  return page
}
const STAMP = new Date().toISOString().slice(11, 19)
const QUESTION = `How do I let a supply teacher cover a class for one week? probe ${STAMP}`

// ── 1. The reader asks ──
const reader = await pageAs('zz-probe-147-1788786910@ssi-probe.test')
await reader.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded' })
await reader.waitForSelector('[data-handbook-ask]', { timeout: 30000 })
await reader.waitForTimeout(1500)
check('the ask box is on the page', (await reader.locator('[data-handbook-ask]').count()) === 1)
await reader.fill('.handbook-search', 'purple elephants trampoline')
await reader.waitForTimeout(400)
const askAbout = reader.locator('[data-handbook-ask-about]')
check('a search that finds nothing offers "Not in here? Ask"', (await askAbout.count()) === 1)
await askAbout.click()
await reader.waitForTimeout(700)
check('the words are carried into the box', (await reader.locator('.hb-ask-box').inputValue()) === 'purple elephants trampoline')
await reader.screenshot({ path: `${OUT}/1-carried.png` })
await reader.fill('.handbook-search', '')
await reader.fill('.hb-ask-box', 'how do I remove a teacher from my school')
await reader.waitForTimeout(400)
const deflect = reader.locator('[data-handbook-deflection]')
check('a strong local match deflects before anything is written', (await deflect.count()) === 1, (await deflect.innerText()).replace(/\s+/g, ' ').slice(0, 120))
await reader.screenshot({ path: `${OUT}/2-deflection.png` })
await deflect.locator('button', { hasText: 'Open it' }).click()
await reader.waitForTimeout(700)
check('Open it opens the matching entry', (await reader.locator('#hb-remove-a-teacher-from-your-school.is-open').count()) === 1)
await reader.fill('.hb-ask-box', QUESTION)
await reader.waitForTimeout(400)
if (await deflect.count()) { console.log('  deflection offered:', (await deflect.innerText()).replace(/\s+/g, ' ').slice(0, 80)); await deflect.locator('button', { hasText: 'Ask anyway' }).click(); await reader.waitForTimeout(300) }
const [resp] = await Promise.all([
  reader.waitForResponse((r) => r.url().includes('/api/handbook-questions') && r.request().method() === 'POST'),
  reader.locator('[data-handbook-ask-submit]').click(),
])
check('the ask is written through the server route', resp.status() === 201, `HTTP ${resp.status()}`)
if (resp.status() !== 201) { await reader.waitForTimeout(400); console.log('  reader saw:', await reader.locator('.hb-ask-fail').innerText().catch(() => '-')); await browser.close(); process.exit(1) }
const created = (await resp.json()).question
await reader.waitForTimeout(500)
check('the reader is told the truth about what happens next', (await reader.locator('.hb-ask-sent').count()) === 1, await reader.locator('.hb-ask-sent').innerText().catch(() => ''))
check('"Your questions" shows it as not answered yet', (await reader.locator(`.hb-q[data-question-status="new"]`, { hasText: STAMP }).count()) === 1, await reader.locator('.hb-q', { hasText: STAMP }).locator('.hb-q-status').innerText().catch(() => ''))
await reader.screenshot({ path: `${OUT}/3-asked.png` })

// ── 2. An admin answers ──
const admin = await pageAs('thomas.cassidy+admin001@gmail.com')
await admin.goto(`${BASE}/admin/handbook-questions`, { waitUntil: 'domcontentloaded' })
await admin.waitForSelector(`[data-question-id="${created.id}"]`, { timeout: 30000 })
await admin.locator('.hbq-toggle input').check(); await admin.waitForTimeout(300)
const card = admin.locator(`[data-question-id="${created.id}"]`)
check('the question is waiting on the admin page', (await card.count()) === 1, (await card.locator('.hbq-meta').innerText()).slice(0, 100))
await card.locator('.hbq-answer').fill('Open the class, tap **Add another teacher**, and use the link underneath to invite them if they are not at your school yet. Take them off the class again when the week is over.')
await Promise.all([admin.waitForResponse((r) => r.request().method() === 'PATCH'), card.locator('button', { hasText: 'Answer' }).click()])
await admin.waitForTimeout(500)
check('answered from the admin page', (await card.locator('.status-pill').innerText()).trim() === 'answered')
await admin.screenshot({ path: `${OUT}/4-admin-answered.png` })

// ── 3. The reader sees the answer, honestly tiered ──
await reader.reload({ waitUntil: 'domcontentloaded' })
await reader.waitForSelector('.hb-q', { timeout: 30000 })
const row = reader.locator('.hb-q', { hasText: STAMP })
check('the answer renders on the reader’s page', (await row.locator('.hb-q-answer').count()) === 1, (await row.locator('.hb-q-answer').innerText().catch(() => '')).slice(0, 80))
const tier = await row.locator('.hb-q-unchecked').innerText().catch(() => '')
check('and says it is not yet checked into the handbook, with the date', /Answered on \d+ \w+, not yet checked into the handbook\./.test(tier), tier)
await row.scrollIntoViewIfNeeded(); await reader.screenshot({ path: `${OUT}/5-reader-answered.png` })

// ── 4. The admin marks it as in the page ──
await card.locator('.hbq-select').selectOption('invite-a-teacher-who-isn-t-here-yet')
await admin.waitForTimeout(300)
console.log('  select value:', await card.locator('.hbq-select').inputValue())
const patchP = admin.waitForResponse((r) => r.request().method() === 'PATCH', { timeout: 8000 }).catch(() => null)
await card.locator('button', { hasText: 'In the page now' }).click()
const patched = await patchP
console.log('  PATCH:', patched ? patched.status() : 'none', '| error banner:', await admin.locator('.hbq-error').innerText().catch(() => '-'))
await admin.screenshot({ path: `${OUT}/4b-inpage.png` })
await admin.waitForTimeout(400)
await reader.reload({ waitUntil: 'domcontentloaded' })
await reader.waitForSelector('.hb-q', { timeout: 30000 })
const row2 = reader.locator('.hb-q', { hasText: STAMP })
check('once in the page, the reader is linked to the entry', (await row2.locator('.hb-q-link').count()) === 1, await row2.locator('.hb-q-link').innerText().catch(() => ''))
await row2.locator('.hb-q-link').click()
const opened = await reader.waitForSelector('#hb-invite-a-teacher-who-isn-t-here-yet.is-open', { timeout: 5000 }).then(() => true).catch(() => false)
check('tapping it opens that entry', opened)
await reader.screenshot({ path: `${OUT}/6-linked.png` })
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS', '— row', created.id)
process.exit(fails ? 1 : 0)
