// WELSH SUBTITLE PROBE — Jonathan's staging report (2026-08-07): the course
// subtitle renders "Islandeg i siaradwyr English" — Welsh template, English
// speaker-language name. Loads a base URL with the Welsh interface locale and
// an Icelandic-for-English course already chosen, then prints every visible
// course-name / subtitle string it can find.
//
//   BASE_URL=https://staging.saysomethingin.app node e2e/_welsh-subtitle-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const LOCALE = process.env.LOCALE || 'cym'
const COURSE = process.env.COURSE || 'isl_for_eng'
const OUT = process.env.OUT_DIR || '/tmp/welsh-subtitle/'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.addInitScript(([locale, course, killIntl]) => {
  try {
    localStorage.setItem('ssi-locale', locale)
    localStorage.setItem('ssi-last-course', course)
  } catch { /* ignore */ }
  // KILL_INTL=1 simulates a browser whose ICU has no display-name data for
  // the interface language — the app must then fall back to its own locale
  // JSON, which carries curated names for every language it ships.
  if (killIntl) {
    // eslint-disable-next-line no-undef
    Intl.DisplayNames = function () { throw new Error('no ICU') }
  }
}, [LOCALE, COURSE, process.env.KILL_INTL === '1'])

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12000)

const dump = await page.evaluate(() => {
  const out = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue
    const txt = (el.textContent || '').trim()
    if (!txt || txt.length > 120 || seen.has(txt)) continue
    seen.add(txt)
    out.push(`${el.tagName.toLowerCase()}.${el.className || ''} :: ${txt}`)
  }
  const grab = (sel) => (document.querySelector(sel)?.textContent || '').trim()
  return {
    courseName: grab('.course-name'),
    courseSubtitle: grab('.course-subtitle'),
    locale: localStorage.getItem('ssi-locale'),
    lastCourse: localStorage.getItem('ssi-last-course'),
    // What Intl itself says in this browser, for the two codes in play.
    intl: (() => {
      try {
        const d = new Intl.DisplayNames(['cy'], { type: 'language' })
        return { is: d.of('is'), en: d.of('en') }
      } catch (e) { return { err: String(e) } }
    })(),
    text: out,
  }
})

console.log('BASE      :', BASE)
console.log('locale    :', dump.locale, '| course:', dump.lastCourse)
console.log('Intl(cy)  :', JSON.stringify(dump.intl))
console.log('TITLE     :', JSON.stringify(dump.courseName))
console.log('SUBTITLE  :', JSON.stringify(dump.courseSubtitle))
console.log('--- visible leaf text ---')
for (const line of dump.text) console.log(line)
if (errors.length) console.log('--- page errors ---\n' + errors.join('\n'))

await page.screenshot({ path: `${OUT}${new URL(BASE).hostname}.png`, fullPage: true })
await browser.close()
