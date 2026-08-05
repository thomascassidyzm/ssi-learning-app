// SCHOOLS NAV UNIFICATION PROBE — govt_admin tabs land on THE VIEW
// (founder-found 2026-07-29: Schools tab → old flat list, Analytics → dead
// 'No classes yet'). Signs in via the IME Programme Leader PERSONAL link
// (the link IS the login), then walks: landing = node home with the
// WHERE-YOU-ARE rail → every top-nav tab lands on a new-generation view
// with the rail → Insights shows real scoped numbers → the retired URLs
// /schools/all and /schools/analytics redirect to the node surface.
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/schools-nav-unification-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const LEADER_LINK = process.env.LEADER_LINK || `${BASE}/group/QJM-868`
const OUT = process.env.OUT_DIR || '/tmp/schools-nav-unification/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// 1. Personal link → signed in, role-matched landing on the node home
await page.goto(LEADER_LINK, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4000)
check('leader link lands on a node surface', page.url().includes('/org/'), page.url())
check('WHERE-YOU-ARE rail present on landing', await page.locator('.rail-col').count() >= 1)
await page.screenshot({ path: `${OUT}1-landing.png` })
const orgMatch = page.url().match(/\/schools\/org\/([^/?#]+)/)
const groupId = orgMatch?.[1] || ''
check('group id resolvable from landing url', !!groupId, groupId)

// 2. Tab set: exactly Schools + Insights, both pointed at the node surface
const tabHrefs = await page.locator('.tabs a').evaluateAll((els) => els.map((e) => [e.textContent.trim(), e.getAttribute('href')]))
console.log(`INFO — tabs: ${JSON.stringify(tabHrefs)}`)
check('two tabs (Schools + Insights)', tabHrefs.length === 2 && tabHrefs[0][0] === 'Schools' && tabHrefs[1][0] === 'Insights')
check('no door to /schools/all or /schools/analytics', !tabHrefs.some(([, h]) => h === '/schools/all' || h === '/schools/analytics'))

// 3. Schools tab → node home, schools lens, rail present
await page.locator('.tabs a', { hasText: 'Schools' }).first().click()
await page.waitForTimeout(2500)
check('Schools tab → node home with schools lens', page.url().includes(`/org/${groupId}`) && page.url().includes('lens=schools'), page.url())
check('rail present under schools lens', await page.locator('.rail-col').count() >= 1)
await page.screenshot({ path: `${OUT}2-schools-lens.png` })

// 4. Insights tab → node insights, rail present, REAL scoped state — the
//    account whose dashboard shows practising classes must never see the
//    teacher tool's 'No classes yet'.
await page.locator('.tabs a', { hasText: 'Insights' }).first().click()
await page.waitForTimeout(6000)
check('Insights tab → node insights', page.url().includes(`/org/${groupId}/insights`), page.url())
check('rail present on insights', await page.locator('.rail-col').count() >= 1)
const bodyText = await page.locator('body').innerText()
check("no 'No classes yet' dead end", !bodyText.includes('No classes yet'))
check('insights shows the node engine (kicker present)', /Insights/i.test(bodyText))
await page.screenshot({ path: `${OUT}3-insights.png` })

// 5. Retired URL /schools/all → redirect to node home + schools lens
await page.goto(`${BASE}/schools/all`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4000)
check('/schools/all redirects to node home + schools lens', page.url().includes(`/org/${groupId}`) && page.url().includes('lens=schools'), page.url())
await page.screenshot({ path: `${OUT}4-all-redirect.png` })

// 6. Retired URL /schools/analytics → redirect to node insights
await page.goto(`${BASE}/schools/analytics`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4000)
check('/schools/analytics redirects to node insights', page.url().includes(`/org/${groupId}/insights`), page.url())
await page.screenshot({ path: `${OUT}5-analytics-redirect.png` })

// 7. Brand /schools landing also resolves to the node home (DashboardView redirect)
await page.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4000)
check('/schools lands on the node home', page.url().includes(`/org/${groupId}`), page.url())

check('no page errors', errors.length === 0, errors.join('; ').slice(0, 300))
await browser.close()
console.log(failures ? `\n${failures} FAIL` : '\nALL PASS')
process.exit(failures ? 1 : 0)
