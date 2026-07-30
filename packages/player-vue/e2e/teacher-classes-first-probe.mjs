// TEACHER CLASSES-FIRST PROBE — founder ruling 2026-07-30: "teacher logs in -
// all their classes are what they see first with PAC buttons prominent."
// Signs in via the IME Teacher PERSONAL link, then asserts, in BOTH density
// modes: the classes render before any stats, Play-as-Class is the primary
// affordance (detailed = full-width hero button), the old 4-tile stat strip
// is gone for teachers (one quiet stat line sits BELOW the classes), and a
// PAC tap still rides the shared launch path to /schools/play and back.
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/teacher-classes-first-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const TEACHER_LINK = process.env.TEACHER_LINK || `${BASE}/redeem/ZKD-834`
const OUT = process.env.OUT_DIR || '/tmp/teacher-classes-first/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// 1. Personal link → teacher dashboard (compact is the stored default)
await page.goto(TEACHER_LINK, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(5000)
check('teacher link lands on the schools surface', page.url().includes('/schools'), page.url())

async function classesFirstChecks(mode, classesSelector) {
  const classes = page.locator(classesSelector)
  check(`[${mode}] classes block renders`, (await classes.count()) === 1)
  check(`[${mode}] NO stat-strip tiles on the teacher home`, (await page.locator('.stat-strip').count()) === 0)
  // Classes precede the stat line in the DOM = on the screen.
  const order = await page.evaluate((sel) => {
    const cls = document.querySelector(sel)
    const stats = document.querySelector('.teacher-stat-line')
    if (!cls || !stats) return 'missing'
    return cls.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING ? 'classes-first' : 'stats-first'
  }, classesSelector)
  check(`[${mode}] classes come BEFORE the stat line`, order === 'classes-first', order)
  const pac = page.locator('button.btn-play', { hasText: /Play as class/ })
  check(`[${mode}] Play-as-Class button per class`, (await pac.count()) >= 1, `count=${await pac.count()}`)
}

await classesFirstChecks('compact', '.teacher-compact')
await page.screenshot({ path: `${OUT}1-compact.png`, fullPage: true })

// 2. Detailed density → hero cards, full-width PAC
await page.evaluate(() => localStorage.setItem('ssi-schools-density', 'detailed'))
await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4000)
await classesFirstChecks('detailed', '.class-grid')
const hero = page.locator('.pac-hero').first()
check('[detailed] hero PAC button present', (await hero.count()) >= 1)
const heroBox = await hero.boundingBox()
const cardBox = await page.locator('.class-panel').first().boundingBox()
check('[detailed] PAC is full-width in its card', !!heroBox && !!cardBox && heroBox.width > cardBox.width * 0.8, `pac=${heroBox?.width} card=${cardBox?.width}`)
check('[detailed] PAC is a generous target (>=44px tall)', !!heroBox && heroBox.height >= 44, `h=${heroBox?.height}`)
await page.screenshot({ path: `${OUT}2-detailed.png`, fullPage: true })

// 3. PAC tap → shared launch path → /schools/play, then End session home
await hero.click()
await page.waitForURL(/\/schools\/play\?class=/, { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(4000)
check('PAC lands on /schools/play?class=', /\/schools\/play\?class=/.test(page.url()), page.url())
await page.screenshot({ path: `${OUT}3-playing.png` })
await page.locator('.pac-exit').first().click().catch(() => {})
await page.waitForTimeout(3000)
check('End session returns to /schools', /\/schools(\?|#|$)/.test(page.url()), page.url())

// restore the default density for the shared demo account's next visitor
await page.evaluate(() => localStorage.setItem('ssi-schools-density', 'compact'))

check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200))
await browser.close()
console.log(failures ? `RESULT: ${failures} FAILURES` : 'RESULT: ALL PASS')
process.exit(failures ? 1 : 0)
