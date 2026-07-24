// GUIDED MISSION E2E — "find the struggling student", canon node surface.
// Drives the mission end-to-end on THE VIEW (owner styling ruling 2026-07-24):
// deep-link entry relocates to the school node home (classes lens), class node
// homes render the canon cards + flat student rows, the completion condition
// does NOT fire from unrelated navigation (healthy student's row, other class)
// and DOES fire on the target student's row.
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

// 1. Deep-link entry — relocates to the canon school node home, classes lens
await page.goto(`${BASE}/schools?mission=find-struggling-student`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(1500)
const card = page.locator('.mission-card')
check('mission card visible on entry', await card.count() === 1, page.url())
check('card carries the brief', /quietly struggling/.test(await card.textContent().catch(() => '') || ''))
check('deep link relocated to the canon node surface', page.url().includes('/schools/org/demo-mission-school'), page.url())
let bodyText = (await page.textContent('body').catch(() => '')) || ''
check('canon chrome: WHERE-YOU-ARE rail', bodyText.includes('Where you are'))
check('demo world rendered (both classes)', bodyText.includes('Year 6 Spanish') && bodyText.includes('Year 5 French'))
check('demo persona school in place', bodyText.includes('Harbour View Primary'))
await page.screenshot({ path: `${OUT}1-mission-start-school-home.png` })

// 2. Card collapses and never blocks
await page.locator('.mission-min').click()
check('card collapses to pill', await page.locator('.mission-pill').count() === 1)
await page.locator('.mission-pill').click()

// 3. A healthy class first — canon class home, no completion
await page.locator('.child-row', { hasText: 'Year 5 French' }).locator('button.child-btn').click()
await page.waitForTimeout(900)
bodyText = (await page.textContent('body').catch(() => '')) || ''
check('class node home renders the canon cards', bodyText.includes('Class practice') && bodyText.includes('Course journey') && bodyText.includes('Belt distribution'))
check('healthy class shows no needs-attention row', !bodyText.includes('needs attention'))
await page.screenshot({ path: `${OUT}2-class-y5-canon.png` })

// healthy student's row must NOT complete the mission
await page.locator('.child-row', { hasText: 'Elin Thomas' }).locator('button.child-btn').click()
await page.waitForTimeout(600)
check('healthy student row does NOT complete', !/Mission complete/.test((await card.textContent().catch(() => '')) || ''), page.url())

// 4. Back up the rail to the school, across to Year 6 Spanish
await page.locator('.map-rail').getByText('Harbour View Primary').first().click()
await page.waitForTimeout(900)
await page.locator('.chip', { hasText: 'All classes' }).click()
await page.waitForTimeout(900)
await page.locator('.child-row', { hasText: 'Year 6 Spanish' }).locator('button.child-btn').click()
await page.waitForTimeout(900)
bodyText = (await page.textContent('body').catch(() => '')) || ''
check('Year 6 student rows render (flat, with Seren)', bodyText.includes('Seren Williams'))
check('exactly one needs-attention student', (bodyText.match(/needs attention/g) || []).length === 1)
await page.screenshot({ path: `${OUT}3-class-y6-canon.png` })

// another healthy student's row on the target class — still no completion
await page.locator('.child-row', { hasText: 'Osian Hughes' }).locator('button.child-btn').click()
await page.waitForTimeout(600)
check('healthy row on target class does NOT complete', !/Mission complete/.test((await card.textContent().catch(() => '')) || ''), page.url())

// 5. The target student completes it
await page.locator('.child-row', { hasText: 'Seren Williams' }).locator('button.child-btn').click()
await page.waitForTimeout(600)
const cardText = (await card.textContent().catch(() => '')) || ''
check('mission completes on the target student', /Mission complete/.test(cardText), page.url())
check('closing note present', /You noticed/.test(cardText))
check('methodology link present', await card.locator('a[href*="how-we-listen"]').count() === 1)
await page.screenshot({ path: `${OUT}4-mission-complete.png` })

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
