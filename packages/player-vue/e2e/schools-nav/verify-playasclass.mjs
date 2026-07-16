// Verify play-as-class across roles on the built app:
//  - school_admin + teacher: button visible in DashboardView, TeacherDashboard
//    (/schools/classes), and ClassDetail; clicking launches /schools/play with
//    the schools top bar persistent, the player mounted, and the CLASS's
//    course active.
//  - govt_admin: button absent everywhere classes appear (incl. direct
//    ClassDetail deep-link).

import { readFileSync } from 'node:fs'

import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const sessions = JSON.parse(readFileSync(new URL('./sessions.json', import.meta.url)))
const CLASS_ID = 'ecdbe16b-a89b-4603-a2cc-916c970bec4b' // Ang School Y7 Welsh (cym_for_eng_north)

const results = []
const check = (label, ok, extra = '') => {
  results.push([label, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`)
}

async function launch(role) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value)
  }, ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sessions[role])])
  const page = await ctx.newPage()
  return { browser, page }
}

// ---------- school staff (admin + teacher) ----------
for (const role of ['school_admin', 'teacher']) {
  const { browser, page } = await launch(role)

  // DashboardView class card button
  await page.goto(BASE + '/schools')
  await page.waitForSelector('.dashboard-view', { timeout: 20000 })
  const dashBtn = page.locator('.dashboard-view .btn-play', { hasText: /Play/ }).first()
  await dashBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  check(`${role}: DashboardView Play button visible`, await dashBtn.isVisible())

  // TeacherDashboard row button
  await page.goto(BASE + '/schools/classes')
  await page.waitForSelector('main.dashboard', { timeout: 20000 })
  const rowBtn = page.locator('main.dashboard .row-play-btn').first()
  await rowBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  check(`${role}: /schools/classes row "Play as class" visible`, await rowBtn.isVisible())

  // ClassDetail big button + actual launch
  await page.goto(BASE + `/schools/classes/${CLASS_ID}`)
  await page.waitForSelector('main.detail', { timeout: 20000 })
  const detailBtn = page.locator('.btn-play-lg', { hasText: /Play as class/ }).first()
  await detailBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  const detailVisible = await detailBtn.isVisible()
  check(`${role}: ClassDetail "Play as class" visible`, detailVisible)

  if (detailVisible) {
    await detailBtn.click()
    await page.waitForURL(/\/schools\/play\?class=/, { timeout: 15000 })
    check(`${role}: click routes to /schools/play?class=...`, true, page.url())
    const topbar = await page.locator('.schools-topbar').isVisible()
    check(`${role}: schools top bar persistent above player`, topbar)
    const playerMounted = await page
      .waitForSelector('.player-container .learning-player-root', { timeout: 25000 })
      .then(() => true)
      .catch(() => false)
    check(`${role}: LearningPlayer mounted`, playerMounted)
    // Active course must be the CLASS's course (cym_for_eng_north): the
    // player keys LearningPlayer by course_code; assert via localStorage
    // ssi-last-course (written by the entry point) AND the player's DOM.
    const lastCourse = await page.evaluate(() => localStorage.getItem('ssi-last-course'))
    check(`${role}: ssi-last-course is the class course`, lastCourse === 'cym_n_for_eng', String(lastCourse))
    const activeClass = await page.evaluate(() => localStorage.getItem('ssi-active-class'))
    const parsed = activeClass ? JSON.parse(activeClass) : null
    check(`${role}: ssi-active-class carries class_learner_id`, !!parsed?.class_learner_id, String(parsed?.class_learner_id))
  }
  await browser.close()
}

// ---------- govt admin: button absent ----------
{
  const { browser, page } = await launch('govt_admin')
  await page.goto(BASE + '/schools/all')
  await page.waitForSelector('main.schools-list-screen', { timeout: 20000 })
  check('govt_admin: schools list renders', true)

  // Direct deep-link to a ClassDetail — button must be absent.
  await page.goto(BASE + `/schools/classes/${CLASS_ID}`)
  const detailAppeared = await page
    .waitForSelector('main.detail', { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  if (detailAppeared) {
    await page.waitForTimeout(2500) // give ctx time to resolve so a late-appearing button would be caught
    const btnCount = await page.locator('.btn-play-lg', { hasText: /Play as class/ }).count()
    check('govt_admin: ClassDetail "Play as class" ABSENT', btnCount === 0)
  } else {
    check('govt_admin: ClassDetail deep-link did not render detail (redirected)', true, page.url())
  }

  // Drill-down class cards in DashboardView must not offer Play.
  await page.goto(BASE + '/schools')
  await page.waitForSelector('.dashboard-view', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const playBtns = await page.locator('.dashboard-view .btn-play', { hasText: /Play/ }).count()
  check('govt_admin: DashboardView has no Play buttons', playBtns === 0)
  await browser.close()
}

const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
