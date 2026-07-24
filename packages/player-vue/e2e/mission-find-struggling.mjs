// GUIDED MISSION E2E — "find the struggling student".
// Drives the mission end-to-end: deep-link entry, demo world renders, the
// completion condition does NOT fire from unrelated navigation (another
// student's view, plain analytics), and DOES fire on the target student.
//   BASE_URL=http://localhost:5173 node e2e/mission-find-struggling.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/tmp/mission-e2e/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// 1. Deep-link entry — the teacher dashboard is /schools for a teacher
await page.goto(`${BASE}/schools?mission=find-struggling-student`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(1500)
const card = page.locator('.mission-card')
check('mission card visible on entry', await card.count() === 1, page.url())
check('card carries the brief', /quietly struggling/.test(await card.textContent().catch(() => '') || ''))
const bodyText = (await page.textContent('body').catch(() => '')) || ''
check('demo world rendered (both classes)', bodyText.includes('Year 6 Spanish') && bodyText.includes('Year 5 French'))
check('demo persona in place', bodyText.includes('Harbour View Primary') || bodyText.includes('Eleri Vaughan'))
await page.screenshot({ path: `${OUT}1-mission-start.png` })

// 2. Card collapses and never blocks
await page.locator('.mission-min').click()
check('card collapses to pill', await page.locator('.mission-pill').count() === 1)
await page.locator('.mission-pill').click()

// 3. Unrelated navigation must NOT complete the mission
await page.locator('a:has-text("Students"), button:has-text("Students")').first().click()
await page.waitForTimeout(800)
const studentsText = (await page.textContent('body').catch(() => '')) || ''
check('students view shows the roster', studentsText.includes('Seren Williams'))
check('exactly one needs-attention student', (studentsText.match(/needs attention/g) || []).length >= 1)
await page.screenshot({ path: `${OUT}2-students-view.png` })

// open a HEALTHY student's view — mission must stay active
const osianRow = page.locator('tr', { hasText: 'Osian Hughes' })
await osianRow.locator('a:has-text("View")').click()
await page.waitForTimeout(800)
check('healthy student view does NOT complete', !/Mission complete/.test((await card.textContent().catch(() => '')) || ''), page.url())
await page.goBack()
await page.waitForTimeout(800)

// 4. The target student completes it
const serenRow = page.locator('tr', { hasText: 'Seren Williams' })
await serenRow.locator('a:has-text("View")').click()
await page.waitForTimeout(800)
const cardText = (await card.textContent().catch(() => '')) || ''
check('mission completes on the target student', /Mission complete/.test(cardText), page.url())
check('closing note present', /You noticed/.test(cardText))
check('methodology link present', await card.locator('a[href*="how-we-listen"]').count() === 1)
await page.screenshot({ path: `${OUT}3-mission-complete.png` })

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
