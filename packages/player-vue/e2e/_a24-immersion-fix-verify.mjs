// VERIFICATION PROBE — a7158431 / 9a184539: fusion-continuation sentences
// (single-word first sentence in a turn) must render as their own card in
// Immersion, must still fuse into the anchor card in Drill, and must
// reappear when switching back to Immersion. Change no code/data.
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/_a24-immersion-fix-verify.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/tmp/a24-immersion-verify/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const LIB_PATHS = [
  `${process.env.HOME}/.ssi-sentinel-libs`,
  `${process.env.HOME}/.pwlibs/root/usr/lib/x86_64-linux-gnu`,
  `${process.env.HOME}/cslibs/root/usr/lib/x86_64-linux-gnu`,
]
const fs = await import('node:fs')
const existingLib = LIB_PATHS.find((p) => fs.existsSync(p))
if (existingLib) {
  process.env.LD_LIBRARY_PATH = `${existingLib}:${process.env.LD_LIBRARY_PATH || ''}`
}

// Find chromium executable
const glob = await import('node:child_process')
const chromePath = glob.execSync(
  `ls ${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -1`
).toString().trim()
console.log('chrome exec:', chromePath, '| LD_LIBRARY_PATH:', process.env.LD_LIBRARY_PATH)

const browser = await chromium.launch({
  executablePath: chromePath || undefined,
  args: ['--no-sandbox'],
})

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const page = await ctx.newPage()
  const consoleMsgs = []
  page.on('console', (m) => consoleMsgs.push(m.text()))
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page, consoleMsgs, errors }
}

async function selectCourse(page, searchTerm) {
  // Open course picker: tap the current-course name/chevron on the home screen
  const picker = page.locator('.course-selector')
  if (await picker.count() === 0) {
    const nameTrigger = page.locator('.course-name--tappable').first()
    await nameTrigger.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1000)
  }
  const searchInput = page.locator('.course-search-input')
  if (await searchInput.count() === 0) {
    return false
  }
  await searchInput.fill(searchTerm)
  await page.waitForTimeout(800)
  const row = page.locator('.course-row', { hasText: new RegExp(searchTerm.split(' ')[0], 'i') }).first()
  const rowCount = await row.count()
  if (rowCount === 0) return false
  await row.click().catch(() => {})
  await page.waitForTimeout(2500)
  // Course selector might show a group needing a second click (language variants)
  if (await page.locator('.course-selector').count() > 0) {
    const anyRow = page.locator('.course-row').first()
    await anyRow.click().catch(() => {})
    await page.waitForTimeout(2000)
  }
  return true
}

async function openListeningDialogues(page, sceneLabel) {
  // open mode tray
  const trigger = page.locator('.mode-trigger')
  await trigger.first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(700)
  const listeningRow = page.locator('.tray-item', { hasText: /listening mode/i }).first()
  await listeningRow.click().catch(() => {})
  await page.waitForTimeout(3000)

  // switch to Dialogues (pods) tab
  const dialoguesTab = page.locator('.view-tab', { hasText: /dialogues/i }).first()
  await dialoguesTab.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(2000)

  // pick the scene
  const sceneCard = page.locator('.scene-card', { hasText: sceneLabel }).first()
  await sceneCard.click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(2500)
}

async function getMode(page) {
  return page.evaluate(() => localStorage.getItem('ssi-listening-mode'))
}

async function setModeViaToggle(page, mode) {
  // ListeningModeToggle — find button/tab labeled Immersion or Drill
  const label = mode === 'drill' ? 'Drill' : 'Immersion'
  const btn = page.locator('button, [role="tab"], .mode-toggle-option', { hasText: new RegExp(`^${label}$`, 'i') }).first()
  await btn.click({ timeout: 5000 }).catch(async () => {
    // fallback: any element with exact text
    await page.getByText(label, { exact: true }).first().click().catch(() => {})
  })
  await page.waitForTimeout(2000)
}

async function dumpText(page) {
  return page.evaluate(() => document.body.innerText)
}

// ── STEP 1+2: Italian, Scene 1 ─────────────────────────────────────────
{
  const { ctx, page, consoleMsgs, errors } = await freshPage()
  await page.goto(`${BASE}/?reset=1`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3000)

  console.log('\n=== ITALIAN — page URL after load:', page.url())
  await page.screenshot({ path: `${OUT}0-landing.png` })

  const picked = await selectCourse(page, 'Italian for English')
  check('Italian for English speakers selectable', picked)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}1-course-selected.png` })

  await openListeningDialogues(page, 'Scene 1').catch(async (e) => {
    console.log('openListeningDialogues error:', e.message)
  })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}2-scene1-immersion.png` })

  const mode = await getMode(page)
  console.log('current listening mode from localStorage:', mode)
  if (mode !== 'immersion') {
    await setModeViaToggle(page, 'immersion')
    await page.screenshot({ path: `${OUT}2b-forced-immersion.png` })
  }

  const text1 = await dumpText(page)
  console.log('\n--- IMMERSION body innerText ---\n' + text1 + '\n---end---\n')
  check('Immersion contains "Come stai"', /Come stai/i.test(text1))
  check('Immersion contains "Buongiorno, Sarah"', /Buongiorno,?\s*Sarah/i.test(text1))
  check('Immersion contains "Sto molto bene"', /Sto molto bene/i.test(text1))
  check('Immersion contains "Vai a lavorare"', /Vai a lavorare/i.test(text1))

  // STEP 2: switch to Drill
  await setModeViaToggle(page, 'drill')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}3-scene1-drill.png` })
  const textDrill = await dumpText(page)
  console.log('\n--- DRILL body innerText ---\n' + textDrill + '\n---end---\n')
  const drillModeNow = await getMode(page)
  check('mode switched to drill', drillModeNow === 'drill', drillModeNow)

  // Switch back to Immersion
  await setModeViaToggle(page, 'immersion')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}4-scene1-immersion-again.png` })
  const textImmersionAgain = await dumpText(page)
  console.log('\n--- IMMERSION-AGAIN body innerText ---\n' + textImmersionAgain + '\n---end---\n')
  check('Immersion-after-Drill contains "Come stai" (rebuild on crossing)', /Come stai/i.test(textImmersionAgain))

  console.log('\nconsole msgs matching fusion/continuation/split/stale/ListeningMeta:')
  consoleMsgs.filter((m) => /fusion|continuation|splitRowUnits|ListeningMeta|stale/i.test(m)).forEach((m) => console.log('  ' + m))
  console.log('page errors:', errors)

  await ctx.close()
}

// ── STEP 3: second course (Romanian, fallback list) ────────────────────
{
  const { ctx, page, consoleMsgs, errors } = await freshPage()
  await page.goto(`${BASE}/?reset=1`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3000)

  let courseUsed = null
  const candidates = ['Romanian', 'Portuguese', 'Brazilian Portuguese', 'Icelandic', 'Spanish', 'French', 'German', 'Swedish', 'Dutch', 'Croatian', 'Korean']
  for (const cand of candidates) {
    const picked = await selectCourse(page, cand)
    if (picked) {
      const url = page.url()
      const bodyTxt = await dumpText(page).catch(() => '')
      if (!/no results|not.*found/i.test(bodyTxt)) {
        courseUsed = cand
        break
      }
    }
  }
  check('second course selectable', !!courseUsed, courseUsed || 'NONE WORKED')
  console.log('Second course used:', courseUsed)
  await page.screenshot({ path: `${OUT}5-second-course-selected.png` })

  if (courseUsed) {
    await openListeningDialogues(page, 'Scene 7').catch(async (e) => {
      console.log('openListeningDialogues (scene7) error:', e.message)
    })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT}6-second-course-scene.png` })

    // TeleprompterScroll virtualizes to a window around currentIndex — walk
    // forward by clicking the bottom-most visible row until the target
    // sentence (or its anchor "Bineinteles") appears, or we give up.
    let text2 = await dumpText(page)
    let steps = 0
    const targetRe = courseUsed === 'Romanian' ? /Dori[țt]i\s+s[ăa]\s+sta[țt]i/i : null
    while (steps < 40 && !/Bine[iî]n[țt]eles/i.test(text2)) {
      const rows = page.locator('.phrase-row')
      const n = await rows.count()
      if (n === 0) break
      await rows.nth(n - 1).click().catch(() => {})
      await page.waitForTimeout(400)
      text2 = await dumpText(page)
      steps++
    }
    console.log(`\n--- SECOND COURSE body innerText (after ${steps} advance-clicks, anchor found=${/Bine[iî]n[țt]eles/i.test(text2)}) ---\n` + text2 + '\n---end---\n')
    // one more small advance in case the continuation is just past the window edge
    if (targetRe && !targetRe.test(text2)) {
      const rows = page.locator('.phrase-row')
      const n = await rows.count()
      if (n > 0) {
        await rows.nth(n - 1).click().catch(() => {})
        await page.waitForTimeout(400)
        text2 = await dumpText(page)
        console.log('\n--- SECOND COURSE body innerText (one more advance) ---\n' + text2 + '\n---end---\n')
      }
    }
    await page.screenshot({ path: `${OUT}7-second-course-scrolled.png` })
    if (courseUsed === 'Romanian') {
      check('Romanian contains "Bineinteles"', /Bine[iî]n[țt]eles/i.test(text2))
      check('Romanian contains "Doriti sa stati"', targetRe.test(text2))
    } else {
      console.log('NOTE: not Romanian — manual read of dump above required to confirm continuation sentence renders')
    }
  }

  console.log('\nconsole msgs matching fusion/continuation/split/stale/ListeningMeta (2nd course):')
  consoleMsgs.filter((m) => /fusion|continuation|splitRowUnits|ListeningMeta|stale/i.test(m)).forEach((m) => console.log('  ' + m))
  console.log('page errors (2nd course):', errors)

  await ctx.close()
}

await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
process.exit(failures ? 1 : 0)
