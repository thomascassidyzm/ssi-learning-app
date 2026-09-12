// Job #430: artefact probe for the Immersion stack (timed AND untimed lines) on a deployed
// build. Signs in by injecting a minted Supabase session, pins the course,
// opens Listening Mode → Dialogues → the requested scene in Immersion, taps
// the requested row, and shoots a timed strip of phone-sized screenshots while
// the lit breath group's fill walks with the clip. Also records the tracker's
// DOM state per frame (which group is .live and its --fill) and the drill
// render of the same row for the "untouched" check.
//
// Env: PROBE_URL, SESSION_JSON, COURSE, SCENE (1-based scene_number), ROW_TEXT
// (substring of the target row to tap), OUT_DIR, TAG, CHROME_BIN, FRAMES,
// FRAME_MS.
import { chromium } from '@playwright/test'
import fs from 'fs'

const URL = process.env.PROBE_URL || 'https://staging.saysomethingin.app/'
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const COURSE = process.env.COURSE || 'spa_for_eng'
const SCENE = Number(process.env.SCENE || '1')
const ROW_TEXT = process.env.ROW_TEXT || ''
const GROUP = process.env.GROUP || ''
const OUT_DIR = process.env.OUT_DIR || '.'
const TAG = process.env.TAG || 'probe'
const FRAMES = Number(process.env.FRAMES || '10')
const FRAME_MS = Number(process.env.FRAME_MS || '900')

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(({ ref, sess, course }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess))
  localStorage.setItem('ssi-last-course', course)
  localStorage.setItem('ssi-last-course-origin', 'chosen')
  localStorage.setItem('ssi-listening-mode', 'immersion')
  localStorage.removeItem('ssi-listening-gloss-immersion')
}, { ref: REF, sess: session, course: COURSE })
const page = await ctx.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
const out = { url: URL, course: COURSE, scene: SCENE, rowText: ROW_TEXT, frames: [] }
const clipReads = []
page.on('response', async (r) => {
  const u = r.url()
  if (/rest\/v1\/course_audio/.test(u)) {
    let body = ''
    try { body = await r.text() } catch {}
    clipReads.push({ select: (u.match(/select=([^&]+)/) || [])[1], status: r.status(), len: body.length, hasWb: body.includes('word_boundaries'), wbNonNull: (body.match(/"word_boundaries":\[/g) || []).length })
  }
})

const trackerState = () => page.evaluate(() => {
  const cur = document.querySelector('.listening-overlay .phrase-row.current')
  if (!cur) return null
  const groups = [...cur.querySelectorAll('.breath-group')]
  const a = document.querySelector('audio')
  return {
    hasStack: !!cur.querySelector('.breath-stack'),
    untimedStack: !!cur.querySelector('.breath-stack.untimed'),
    fillPainted: groups.some((g) => getComputedStyle(g.querySelector('.breath-fill') || g).backgroundClip === 'text' || getComputedStyle(g.querySelector('.breath-fill') || g).webkitBackgroundClip === 'text'),
    groups: groups.map((g) => ({
      text: g.textContent.trim().slice(0, 40),
      state: g.classList.contains('live') ? 'live' : g.classList.contains('said') ? 'said' : g.classList.contains('ahead') ? 'ahead' : g.classList.contains('untimed') ? 'untimed' : 'none',
      fill: g.style.getPropertyValue('--fill') || null,
    })),
    gloss: !!cur.querySelector('.phrase-known'),
    target: cur.querySelector('.phrase-target')?.textContent.trim().slice(0, 60) ?? null,
    audioTime: a ? Math.round((a.currentTime || 0) * 100) / 100 : null,
    audioPaused: a ? a.paused : null,
  }
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
const trig = page.locator('.mode-trigger').first()
out.modeTriggerFound = await trig.count()
if (out.modeTriggerFound) {
  await trig.click({ timeout: 5000 }).catch((e) => (out.trigError = String(e).slice(0, 150)))
  await page.waitForTimeout(1500)
  const listen = page.locator('.tray-item').filter({ hasText: /listen/i }).first()
  if (await listen.count()) await listen.click({ timeout: 5000 }).catch((e) => (out.listenError = String(e).slice(0, 150)))
  await page.locator('.scene-card, .scene-empty, .scene-list-wrap .error').first()
    .waitFor({ state: 'visible', timeout: 90000 }).catch((e) => (out.listWaitError = String(e).slice(0, 120)))
  await page.waitForTimeout(1000)
  // #457: the build opens Dialogues on pod cards; tap the first card to reach the scene list.
  const podCard = page.locator('.pod-card').first()
  out.podCards = await podCard.count()
  if (out.podCards) { await podCard.click({ timeout: 5000 }).catch((e) => (out.podError = String(e).slice(0, 120))); await page.waitForTimeout(1500) }
  out.groupHeadings = await page.locator('.scene-group-heading').allInnerTexts().catch(() => [])
  out.sceneCards = await page.locator('.scene-card').count()
  // Open the scene by its number chip, inside the named pod group (cards are
  // flat siblings after their group heading).
  out.cardNums = await page.locator('.scene-card-num').allInnerTexts().catch(() => [])
  out.listShape = await page.evaluate(() => {
    const card = document.querySelector('.scene-card')
    return card ? { parent: card.parentElement?.className, grand: card.parentElement?.parentElement?.className } : null
  })
  out.sceneCardFound = await page.evaluate(({ group, scene }) => {
    const card0 = document.querySelector('.scene-card')
    const kids = [...(card0?.parentElement?.children || [])]
    window.__diag = kids.slice(0, 12).map((el) => `${el.className}:${el.querySelector('.scene-card-num')?.textContent.trim() ?? '-'}:${JSON.stringify(String(scene))}`)
    let inGroup = !group
    for (const el of kids) {
      if (el.classList.contains('scene-group-heading')) { inGroup = el.textContent.includes(group); continue }
      if (inGroup && el.classList.contains('scene-card') && el.querySelector('.scene-card-num')?.textContent.trim() === String(scene)) {
        el.scrollIntoView(); el.click(); return 1
      }
    }
    return 0
  }, { group: GROUP, scene: SCENE })
  out.diag = await page.evaluate(() => window.__diag)
  if (out.sceneCardFound) {
    await page.locator('.listening-overlay .phrase-row').first().waitFor({ state: 'visible', timeout: 30000 }).catch((e) => (out.rowsWaitError = String(e).slice(0, 120)))
    await page.waitForTimeout(800)
    out.sceneStrip = await page.locator('.scene-strip').innerText().catch(() => null)
    out.modeDesc = await page.locator('.listen-mode-desc').innerText().catch(() => null)
    out.rowCount = await page.locator('.listening-overlay .phrase-row').count()
    // Ensure Immersion is the selected mode (the toggle's first option).
    const immersionBtn = page.locator('.listening-overlay button', { hasText: /^Immersion$/ }).first()
    if (await immersionBtn.count()) await immersionBtn.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)
    // Tap the requested row (a non-current row jumps + plays).
    const row = ROW_TEXT
      ? page.locator('.listening-overlay .phrase-row').filter({ hasText: ROW_TEXT }).first()
      : page.locator('.listening-overlay .phrase-row').first()
    out.rowFound = await row.count()
    // The teleprompter windows 7 rows; step forward through the scene until
    // the requested row is mounted (each tap of the last visible row jumps there).
    for (let step = 0; step < 40 && !(await row.count()); step++) {
      await page.locator('.listening-overlay .phrase-row').last().click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(350)
    }
    out.rowFound = await row.count()
    out.stepsTaken = out.rowFound ? 'found' : 'not found after stepping'
    if (out.rowFound) {
      await row.scrollIntoViewIfNeeded().catch(() => {})
      await row.click({ timeout: 5000 }).catch((e) => (out.rowError = String(e).slice(0, 150)))
      for (let i = 0; i < FRAMES; i++) {
        await page.waitForTimeout(FRAME_MS)
        const st = await trackerState().catch((e) => ({ error: String(e).slice(0, 100) }))
        out.frames.push({ t: (i + 1) * FRAME_MS, ...st })
        await page.screenshot({ path: `${OUT_DIR}/${TAG}-f${String(i + 1).padStart(2, '0')}.png` }).catch(() => {})
      }
      // Pause, then tap the current card: the one-line reveal.
      const stopBtn = page.locator('.listening-overlay .transport-bar button').nth(1)
      await page.locator('.listening-overlay .teleprompter').first().click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {})
      void stopBtn
      await page.waitForTimeout(500)
      const cur = page.locator('.listening-overlay .phrase-row.current').first()
      out.beforeReveal = await trackerState().catch(() => null)
      await cur.click({ timeout: 3000 }).catch((e) => (out.revealError = String(e).slice(0, 150)))
      await page.waitForTimeout(500)
      out.afterReveal = await trackerState().catch(() => null)
      await page.screenshot({ path: `${OUT_DIR}/${TAG}-reveal.png` }).catch(() => {})
      // Drill render of the same row for the untouched check.
      const drillBtn = page.locator('.listening-overlay button', { hasText: /^Drill$/ }).first()
      if (await drillBtn.count()) {
        await drillBtn.click({ timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(800)
        const drow = page.locator('.listening-overlay .phrase-row').filter({ hasText: ROW_TEXT }).first()
        if (await drow.count()) {
          await drow.click({ timeout: 3000 }).catch(() => {})
          await page.waitForTimeout(1500)
          out.drill = await trackerState().catch(() => null)
          await page.screenshot({ path: `${OUT_DIR}/${TAG}-drill.png` }).catch(() => {})
        }
      }
    }
  }
}
out.jsErrors = jsErrors
out.clipReads = clipReads.slice(0, 12)
console.log(JSON.stringify(out, null, 1))
await browser.close()
