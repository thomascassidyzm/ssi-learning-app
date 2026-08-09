// EASY SYLLABLE-CAP PROBE — Tom's ruling, 2026-08-07, checked on a real deploy
// rather than by reading the test suite.
//
//   "And no longer phrases. In fact we should probably just skip all phrases
//    that are more than X number of syllables."  →  Easy caps at 20 target
//    syllables, Fast has no cap at all.
//
// WHAT IT MEASURES, AND WHY THIS WAY
//
// The obvious probe — play a session and read the phrases off the screen — is
// USELESS here, and that is worth stating rather than discovering twice. A
// round shows about seven phrases, chosen shortest-first, and a fresh learner
// starts at LEGO 1 where every phrase is short. Four minutes of real play in
// each mode surfaced a maximum of ten syllables in BOTH: the cap had nothing
// to bite on, so "Easy skipped the long ones" was unprovable that way. The
// production deep link that would jump deeper does not take effect for a
// signed-out learner, so that route is closed too.
//
// So this probe reads the artefact the cap actually operates on: the FULL
// generated script the player writes to IndexedDB (`ssi-script-cache`) after
// boot — every round of the course, not the handful a short session reaches.
// That is the real output of `generateLearningScript` on the deployed build,
// per mode, and it is what the player plays from. Roughly 3,900 rounds and
// 86,000 target phrases for spa_for_eng.
//
// Spanish is the course to run this on: 20 was MEASURED against spa_for_eng
// (15.4% of its phrases fall above it) and fra_for_eng (0.65% — near-inert).
// French would make the whole thing vacuous.
//
//   BASE_URL=https://staging.saysomethingin.app COURSE=spa_for_eng \
//     node e2e/easy-syllable-cap-probe.mjs
//
// Prints PASS/FAIL per assertion, exits 1 on any fail. An assertion that could
// not be MEASURED prints INCONCLUSIVE and also exits 1 — a vacuous pass is the
// failure mode this file exists to avoid.
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { countSyllables, syllableLangOf, hasSyllableCounter } from '@ssi/core'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/tmp/easy-syllable-cap/'
const COURSE = process.env.COURSE || 'spa_for_eng'
const TARGET_LANG = process.env.TARGET_LANG || COURSE.split('_')[0]
const CAP = Number(process.env.CAP || 20)
const SETTLE_MS = Number(process.env.SETTLE_MS || 75000)
const READY_MS = Number(process.env.READY_TIMEOUT_MS || 45000)
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}
const inconclusive = (label, detail = '') => {
  console.log(`INCONCLUSIVE — ${label}${detail ? ` :: ${detail}` : ''}`)
  failures++
}

// Pulls every target phrase out of the cached script. Shape is defensive: the
// cycle carries `target.text`, but review/pod items have been spelled
// `targetText` at different times and a missed shape would silently shrink the
// population being judged — which is exactly how a cap probe fakes a pass.
const READ_SCRIPT = async () => {
  const out = { keys: [], rounds: 0, targets: [], err: null }
  try {
    const db = await new Promise((ok, no) => {
      const r = indexedDB.open('ssi-script-cache')
      r.onsuccess = () => ok(r.result)
      r.onerror = () => no(r.error)
    })
    const keys = await new Promise((ok) => {
      const r = db.transaction('scripts', 'readonly').objectStore('scripts').getAllKeys()
      r.onsuccess = () => ok(r.result)
    })
    out.keys = keys
    if (!keys.length) return out
    const val = await new Promise((ok) => {
      const r = db.transaction('scripts', 'readonly').objectStore('scripts').get(keys[0])
      r.onsuccess = () => ok(r.result)
    })
    const rounds = val?.rounds || []
    out.rounds = rounds.length
    for (const rd of rounds) {
      for (const cy of (rd.cycles || rd.items || [])) {
        const t = cy?.target?.text || cy?.targetText
        if (t) out.targets.push(t)
      }
    }
  } catch (e) {
    out.err = String(e)
  }
  return out
}

async function runMode(mode) {
  const browser = await chromium.launch(
    process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
  )
  // A FRESH context per mode is the whole design: the script cache is keyed by
  // course, not by mode, so a shared profile would hand the second mode the
  // first mode's script and the comparison would be of one script with itself.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  const warns = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.text().includes('[phrase-cap]')) warns.push(m.text()) })

  await page.addInitScript(([course, m]) => {
    try {
      localStorage.setItem('ssi-last-course', course)
      localStorage.setItem('ssi-learning-mode', m)
    } catch { /* ignore */ }
  }, [COURSE, mode])

  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
  await page.locator('.mode-switch').first().waitFor({ state: 'visible', timeout: READY_MS }).catch(() => {})
  const selected = await page.locator(`.mode-switch-btn:has-text("${mode === 'easy' ? 'Easy' : 'Fast'}")`)
    .first().getAttribute('aria-pressed').catch(() => null)

  // Play for real: the script is generated and cached on the play path, not on
  // mere page load.
  const play = page.locator('.center-btn').first()
  await play.waitFor({ state: 'visible', timeout: READY_MS }).catch(() => {})
  for (let i = 0; i < 30; i++) {
    const cls = (await play.getAttribute('class').catch(() => '')) || ''
    if (!cls.includes('is-disabled')) break
    await page.waitForTimeout(1000)
  }
  await play.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(SETTLE_MS)
  await page.screenshot({ path: `${OUT}${mode}-playing.png` })

  const script = await page.evaluate(READ_SCRIPT)
  await browser.close()
  return { script, selected, errors, warns }
}

const summarise = ({ script }) => {
  const lang = syllableLangOf(TARGET_LANG)
  const distinct = [...new Set(script.targets)]
  const counted = distinct.map((text) => ({ text, syl: countSyllables(text, lang) }))
  const over = counted.filter((c) => c.syl > CAP).sort((a, b) => b.syl - a.syl)
  return {
    rounds: script.rounds,
    phraseSlots: script.targets.length,
    distinct: distinct.length,
    maxSyllables: counted.reduce((m, c) => Math.max(m, c.syl), 0),
    overCap: over.length,
    overShare: distinct.length ? +(100 * over.length / distinct.length).toFixed(2) : 0,
    overExamples: over.slice(0, 3),
    counted,
  }
}

console.log(`BASE_URL = ${BASE}`)
console.log(`course   = ${COURSE} · target lang ${TARGET_LANG} → counter '${syllableLangOf(TARGET_LANG)}'`)
console.log(`cap      = ${CAP} syllables (Easy) · Fast uncapped`)
console.log(`source   = the FULL generated script each mode cached to IndexedDB\n`)

if (!hasSyllableCounter(syllableLangOf(TARGET_LANG))) {
  console.log(`ABORT — no syllable counter for '${TARGET_LANG}'. The cap is inert on this course by design; pick a covered one.`)
  process.exit(1)
}

const fast = await runMode('fast')
const easy = await runMode('easy')
const F = summarise(fast)
const E = summarise(easy)

const brief = (s) => ({ rounds: s.rounds, slots: s.phraseSlots, distinct: s.distinct, maxSyl: s.maxSyllables, overCap: s.overCap, overPct: s.overShare })
console.log('FAST:', JSON.stringify(brief(F)), 'mode selected:', fast.selected)
console.log('EASY:', JSON.stringify(brief(E)), 'mode selected:', easy.selected)
if (F.overExamples.length) console.log('Fast keeps, longest:', JSON.stringify(F.overExamples))
if (E.overExamples.length) console.log('EASY ABOVE CAP (should be none):', JSON.stringify(E.overExamples))
console.log('')

writeFileSync(`${OUT}scripts.json`, JSON.stringify({
  course: COURSE, cap: CAP,
  fast: { ...brief(F), over: F.overExamples },
  easy: { ...brief(E), over: E.overExamples },
}, null, 2))

check('a full script was generated and cached in Fast', F.rounds > 100, `${F.rounds} rounds, ${F.distinct} distinct phrases`)
check('a full script was generated and cached in Easy', E.rounds > 100, `${E.rounds} rounds, ${E.distinct} distinct phrases`)
check('the two modes were really the two modes', fast.selected === 'true' && easy.selected === 'true',
  `fast aria-pressed=${fast.selected}, easy=${easy.selected}`)

if (F.overCap === 0) {
  inconclusive(
    `Fast's own script holds no phrase above ${CAP} syllables, so "Easy dropped them" is unproven`,
    `fast max ${F.maxSyllables} over ${F.distinct} distinct — wrong course for this check`,
  )
} else {
  check(`Fast keeps phrases above the ${CAP}-syllable cap (it is uncapped)`,
    F.overCap > 0, `${F.overCap} of ${F.distinct} distinct (${F.overShare}%), longest ${F.maxSyllables}`)

  // NOT "Easy holds zero over-cap phrases" — that assertion is WRONG, and
  // asserting it would have failed a working feature. The methodology floors
  // (>=4 BUILD / >=5 USE) outrank the cap by design: capPhrasesByLength falls
  // back to `sorted.slice(0, minKeep)` — the SHORTEST N — whenever the cap
  // would leave a LEGO below its floor, and those shortest N can still be over
  // the cap on a LEGO whose phrases are all long. Measured on spa_for_eng:
  // 2,147 over-cap distinct in Fast → 581 in Easy, of which 553 are exactly
  // that floor fallback. So the honest assertion is the SIZE of the cut.
  check(`Easy cuts most of what is above the ${CAP}-syllable cap`,
    E.overCap < F.overCap * 0.4,
    `fast ${F.overCap} over-cap distinct → easy ${E.overCap} (${(100 * (1 - E.overCap / F.overCap)).toFixed(1)}% removed); ` +
    'residue is the >=4 BUILD / >=5 USE floor, which outranks the cap by design')
  check(`Easy's over-cap share is a fraction of Fast's`,
    E.overShare < F.overShare / 2, `easy ${E.overShare}% vs fast ${F.overShare}% of distinct phrases`)
  check('Easy really is a SMALLER phrase set than Fast (the cap removed something)',
    E.distinct < F.distinct, `easy ${E.distinct} vs fast ${F.distinct} distinct phrases`)
  // The floors (>=4 BUILD / >=5 USE) are a hard rail the cap must not breach.
  check('the cap did not gut the course — Easy keeps most of its rounds',
    E.rounds >= F.rounds * 0.9, `easy ${E.rounds} rounds vs fast ${F.rounds}`)
}

check('no uncaught page errors in Fast', fast.errors.length === 0, fast.errors.join(' | '))
check('no uncaught page errors in Easy', easy.errors.length === 0, easy.errors.join(' | '))

if (fast.warns.length || easy.warns.length) {
  console.log('\nphrase-cap console lines:', JSON.stringify([...new Set([...fast.warns, ...easy.warns])].slice(0, 4)))
}
console.log(`\nDump: ${OUT}scripts.json · screenshots in ${OUT}`)
process.exit(failures > 0 ? 1 : 0)
