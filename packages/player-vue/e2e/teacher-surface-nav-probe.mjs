// TEACHER SURFACE NAV PROBE — the schools nav persists in the player
// (founder staging test 2026-07-30: play-as-class/missions "took over" with
// no visible way back; the playing-as banner swelled the bar; "Try a
// mission" wording; End session stranded the teacher). Signs in via the IME
// Teacher PERSONAL link (the link IS the login), then walks:
//   landing = teacher dashboard, tabs Dashboard/Students/Insights, the
//   guided-look affordance (no "mission" wording) → Play as class keeps the
//   full top nav with the SLIM playing-as chip → End session returns to the
//   schools dashboard → the guided look runs in the schools shell and its
//   exit lands back on /schools.
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/teacher-surface-nav-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const TEACHER_LINK = process.env.TEACHER_LINK || `${BASE}/redeem/ZKD-834`
const OUT = process.env.OUT_DIR || '/tmp/teacher-surface-nav/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// 1. Personal link → signed in on the teacher dashboard, unified tab labels
await page.goto(TEACHER_LINK, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(5000)
check('teacher link lands on the schools surface', page.url().includes('/schools'), page.url())
const tabLabels = await page.locator('.tabs a').evaluateAll((els) => els.map((e) => e.textContent.trim()))
console.log(`INFO — tabs: ${JSON.stringify(tabLabels)}`)
check('teacher tabs = Dashboard/Students/Insights', JSON.stringify(tabLabels) === JSON.stringify(['Dashboard', 'Students', 'Insights']), JSON.stringify(tabLabels))
const bodyText = await page.locator('body').innerText()
check("guided-look affordance, not 'Try a mission'", !/try a mission/i.test(bodyText))
check("no user-facing 'mission' wording on the dashboard", !/\bmission\b/i.test(bodyText))
await page.screenshot({ path: `${OUT}1-teacher-dashboard.png` })

// 2. Play as class → slim in-nav chip, tabs KEPT, Learn dropped
const playBtn = page.locator('button', { hasText: /Play as class/ }).first()
check('a Play as class button is on the dashboard', await playBtn.count() >= 1)
await playBtn.click()
await page.waitForURL(/\/schools\/play\?class=/, { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(4000)
check('Play as class lands on /schools/play?class=', /\/schools\/play\?class=/.test(page.url()), page.url())
check('playing-as chip names the class', (await page.locator('.pac-class').count()) === 1, await page.locator('.pac-class').first().textContent().catch(() => ''))
check('section tabs KEPT while playing (nav persists)', (await page.locator('.schools-topbar nav.tabs').count()) === 1)
check('tabs still carry the way home (Dashboard)', (await page.locator('.schools-topbar nav.tabs a', { hasText: 'Dashboard' }).count()) === 1)
check('self-practice Learn launcher dropped mid-session', (await page.locator('.schools-topbar a.learn-btn').count()) === 0)
// Slim = the chip fits the bar: the whole topbar stays its standard height.
const barBox = await page.locator('.schools-topbar').boundingBox()
check('topbar stays slim (<=60px) with the chip in it', !!barBox && barBox.height <= 60, `height=${barBox?.height}`)
await page.screenshot({ path: `${OUT}2-playing-as-chip.png` })

// 3. End session → back on the schools DASHBOARD, not the classes list, not the player
await page.locator('.pac-exit').first().click()
await page.waitForTimeout(3000)
check('End session returns to the schools dashboard (/schools)', /\/schools(\?|#|$)/.test(page.url()), page.url())
check('chip gone after exit', (await page.locator('.pac-class').count()) === 0)
await page.screenshot({ path: `${OUT}3-after-end-session.png` })

// 4. Guided look (the de-missioned mission): runs in the schools shell,
//    card wording carries no "mission", exit lands back on /schools.
const guidedBtn = page.locator('button', { hasText: /Take a guided look/ }).first()
check('guided-look affordance present on the dashboard', await guidedBtn.count() >= 1)
await guidedBtn.click()
await page.waitForTimeout(4000)
check('guided look relocates to the canon node surface', page.url().includes('/schools/org/demo-mission-school'), page.url())
check('schools top bar still present in the guided look', (await page.locator('.schools-topbar').count()) === 1)
const cardText = (await page.locator('.mission-card').innerText().catch(() => '')) || ''
check('guided-look card renders', cardText.length > 0)
check("card wording carries no 'mission'", !/\bmission\b/i.test(cardText), cardText.slice(0, 120))
check("card exit says 'Back to dashboard'", /Back to dashboard/.test(cardText))
await page.screenshot({ path: `${OUT}4-guided-look.png` })

// 5. Back to dashboard → full reload onto /schools (never the bare player '/')
await page.locator('.mission-exit').first().click()
await page.waitForTimeout(5000)
check('guided-look exit lands on /schools, not the bare player', /\/schools(\?|#|$)/.test(page.url()), page.url())
check('signed-in teacher dashboard restored after exit', (await page.locator('.schools-topbar').count()) === 1)
await page.screenshot({ path: `${OUT}5-after-guided-exit.png` })

check('no page errors', errors.length === 0, errors.join('; ').slice(0, 300))
await browser.close()
console.log(failures ? `\n${failures} FAIL` : '\nALL PASS')
process.exit(failures ? 1 : 0)
