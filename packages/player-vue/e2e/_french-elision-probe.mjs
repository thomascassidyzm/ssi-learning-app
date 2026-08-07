// FRENCH ELISION PROBE — the course subtitle in a French interface must read
// "pour les locuteurs d'Anglais", not "de Anglais". Loads a base URL with the
// French interface locale and an English-speaker course already chosen, then
// prints the rendered subtitle and every visible string containing "locuteurs".
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/_french-elision-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const LOCALE = process.env.LOCALE || 'fra'
const COURSE = process.env.COURSE || 'cym_for_eng'
const OUT = process.env.OUT_DIR || '/tmp/french-elision/'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.addInitScript(([locale, course]) => {
  try {
    localStorage.setItem('ssi-locale', locale)
    localStorage.setItem('ssi-last-course', course)
  } catch { /* ignore */ }
}, [LOCALE, COURSE])

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12000)

const dump = await page.evaluate(() => {
  const grab = (sel) => (document.querySelector(sel)?.textContent || '').trim()
  const hits = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue
    const txt = (el.textContent || '').trim()
    if (!txt || txt.length > 160 || seen.has(txt)) continue
    seen.add(txt)
    if (/locuteurs|speakers|hablantes|parlanti/i.test(txt)) hits.push(txt)
  }
  return {
    locale: localStorage.getItem('ssi-locale'),
    lastCourse: localStorage.getItem('ssi-last-course'),
    courseName: grab('.course-name'),
    courseSubtitle: grab('.course-subtitle'),
    hits,
  }
})

console.log('BASE      :', BASE)
console.log('locale    :', dump.locale, '| course:', dump.lastCourse)
console.log('TITLE     :', JSON.stringify(dump.courseName))
console.log('SUBTITLE  :', JSON.stringify(dump.courseSubtitle))
console.log('--- speaker-frame strings on screen ---')
for (const h of dump.hits) console.log(h)

const all = [dump.courseSubtitle, ...dump.hits].join(' | ')
const bad = /\bde [AEIOUYÀÂÉÈÊÎÔÛaeiouy]/.test(all)
console.log(bad ? 'RESULT: FAIL — unelided "de <vowel>" present' : 'RESULT: no unelided "de <vowel>"')

if (errors.length) console.log('--- page errors ---\n' + errors.join('\n'))
await page.screenshot({ path: `${OUT}${new URL(BASE).hostname}.png`, fullPage: true })
await browser.close()
