// EMPTY-POD-HIDDEN PROBE — a real learner's seat, not the data layer.
// Loads the app on a course, opens Listening Mode through the mode tray the
// way a learner does, and prints the tabs that are actually on screen.
//
// Three fixtures, because there are three ways a course can end up with no
// dialogues and a learner must not be able to tell them apart:
//   glg_for_eng    EMPTY  — pod row exists, no sentences behind it → no tab.
//   cym_n_for_eng  HELD   — pod row and 231 sentences exist, but the pod is
//                           visibility='held' (2026-08-23 gate), so RLS hides
//                           both from the anon key → no tab. Tom's ruling: a
//                           held pod is invisible, not a greyed tab, not an
//                           empty pod, not "coming soon".
//   spa_for_eng    LIVE   — the control. If this loses its tab, the gate has
//                           over-reached and taken a released course with it.
//
// FIXTURES GO STALE, AND THIS ONE DID. Until 2026-08-23 the EMPTY fixture was
// cym_s_for_eng, described in this header as "empty pod-0". It has since been
// recorded and released — 231 sentences, tab present — so the probe was
// asserting nothing about the case it was written for, and nobody noticed
// because it only ever printed. Repointed to glg_for_eng (one of 26 courses
// whose serving pod has zero sentences as of 2026-08-23, checked with the ANON
// key). Re-check the fixtures before trusting a green run.
//
// Likewise the HELD fixture is only meaningful while cym_n_for_eng:pod-0 is
// actually held. Releasing it turns that row into a second LIVE case — the
// probe says so rather than failing silently, because a probe that passes for
// the wrong reason is worse than no probe.
//
// The LIVE control exists for exactly this reason. On the first run of this
// version the app never booted (no .env.local in the worktree), every course
// reported "no tabs on screen", and both no-dialogues fixtures went green on
// an app that had not loaded. The control was what failed and caught it.
//
//   BASE_URL=http://localhost:5199 node e2e/empty-pod-hidden-probe.mjs
//   BASE_URL=http://localhost:5199 COURSES=cym_n_for_eng node e2e/…   # one course
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const OUT = process.env.OUT_DIR || '/tmp/empty-pod-hidden/'
mkdirSync(OUT, { recursive: true })

/** course → what a learner must see. `dialogues: false` means NO tab at all. */
const FIXTURES = {
  glg_for_eng: { why: 'EMPTY — pod row, zero sentences', dialogues: false },
  cym_n_for_eng: { why: 'HELD — visibility=held, sentences hidden by RLS', dialogues: false },
  spa_for_eng: { why: 'LIVE — control, must keep its tab', dialogues: true },
}

// COURSE (singular) kept for compatibility with the original invocation.
const COURSES = (process.env.COURSES || process.env.COURSE || Object.keys(FIXTURES).join(','))
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean)

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)

/** Drive one course from cold and report what is on screen. */
async function probeCourse(COURSE) {
  // A fresh context per course: localStorage carries `ssi-last-course` and the
  // listening meta cache, so a shared one would let course A's pod decide
  // course B's tab.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  const logs = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 160)}`))

  await page.addInitScript((course) => {
    try { localStorage.setItem('ssi-last-course', course) } catch { /* ignore */ }
  }, COURSE)

  await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(15000)
  await page.screenshot({ path: `${OUT}${COURSE}-1-landing.png` })

  // Start the course the way a learner does — the central transport button.
  await page.locator('.center-btn').first().click({ timeout: 15000 })
    .catch((e) => console.log('play click failed:', String(e).slice(0, 120)))
  await page.waitForTimeout(20000)
  await page.screenshot({ path: `${OUT}${COURSE}-2-player.png` })

  // Open the mode tray with a real click, then pick Listening Mode — the exact
  // two taps a learner makes.
  const trigger = page.locator('.mode-trigger').first()
  console.log('mode trigger visible:', await trigger.isVisible().catch(() => false))
  await trigger.click({ timeout: 10000 }).catch((e) => console.log('trigger click failed:', String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}${COURSE}-3-tray.png` })

  const listening = page.locator('.tray-item', { hasText: /listening/i }).first()
  console.log('listening tray item visible:', await listening.isVisible().catch(() => false))
  await listening.click({ timeout: 10000 }).catch((e) => console.log('listening click failed:', String(e).slice(0, 120)))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}${COURSE}-3b-just-after-click.png` })
  console.log('post-click DOM:', JSON.stringify(await page.evaluate(() => ({
    trigger: document.querySelector('.mode-trigger')?.className,
    overlayish: Array.from(document.querySelectorAll('[class*="overlay"]')).map((e) => e.className).slice(0, 10),
    viewTabs: document.querySelectorAll('.view-tab').length,
  }))))
  await page.waitForTimeout(7000)
  await page.screenshot({ path: `${OUT}${COURSE}-4-listening.png`, fullPage: false })

  const seat = await page.evaluate(() => {
    const overlay = document.querySelector('.listening-overlay, [class*="listening"]')
    const tabs = Array.from(document.querySelectorAll('.view-tab')).map((t) => ({
      label: (t.textContent || '').trim(),
      active: t.className.includes('active'),
    }))
    return {
      overlayPresent: !!overlay,
      tabs,
      // textContent, not innerText — headless Chrome returns '' for innerText here.
      overlayText: (document.querySelector('.listening-overlay')?.textContent || '')
        .replace(/\s+/g, ' ').slice(0, 400),
    }
  })

  const dialogues = seat.tabs.some((t) => /dialogue/i.test(t.label))
  const fixture = FIXTURES[COURSE]

  console.log('\n=== LEARNER SEAT:', COURSE, fixture ? `(${fixture.why})` : '(no fixture)', '===')
  console.log('overlay present :', seat.overlayPresent)
  console.log('tabs on screen  :', JSON.stringify(seat.tabs))
  console.log('DIALOGUES TAB   :', dialogues ? 'PRESENT' : 'ABSENT')
  console.log('overlay text    :', seat.overlayText)
  console.log('js errors       :', JSON.stringify(errors.slice(0, 5)))
  console.log('console tail    :\n  ' + logs.filter((l) => /listen|pod|overlay|error/i.test(l)).slice(-25).join('\n  '))

  // A held pod must leave NO trace in the seat — not just a missing tab. If its
  // sentences ever reach the client, they land in the overlay text.
  const overlayMentionsDialogues = /dialogue/i.test(seat.overlayText)

  await ctx.close()
  return { course: COURSE, dialogues, overlayMentionsDialogues, fixture, errors }
}

const results = []
for (const course of COURSES) {
  results.push(await probeCourse(course))
}
await browser.close()

console.log('\n=== VERDICT ===')
let failed = 0
for (const r of results) {
  if (!r.fixture) {
    console.log(`?  ${r.course}: dialogues ${r.dialogues ? 'PRESENT' : 'ABSENT'} — no fixture, nothing asserted`)
    continue
  }
  const ok = r.dialogues === r.fixture.dialogues && !(r.fixture.dialogues === false && r.overlayMentionsDialogues)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${r.course}: expected dialogues ${r.fixture.dialogues ? 'PRESENT' : 'ABSENT'}` +
      `, got ${r.dialogues ? 'PRESENT' : 'ABSENT'}  — ${r.fixture.why}`
  )
}

// A HELD fixture that has been released is not a pass. Say so loudly: the
// probe would otherwise keep printing green while testing nothing.
const held = results.find((r) => r.course === 'cym_n_for_eng')
if (held && held.dialogues) {
  console.log(
    '\nNOTE: cym_n_for_eng shows a Dialogues tab. Either the gate has failed, or\n' +
      "      that pod has been RELEASED and this file's HELD fixture is stale —\n" +
      '      repoint it at a currently-held pod before trusting a green run.'
  )
}

console.log(`\n${results.length - failed}/${results.length} as expected. screenshots: ${OUT}`)
process.exit(failed > 0 ? 1 : 0)
