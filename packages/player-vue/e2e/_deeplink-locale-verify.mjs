/**
 * Deep-link localisation, checked in a real browser at phone size.
 *
 * The unit tests pin the decision; this pins what a visitor actually sees,
 * because the one bug that mattered was invisible to the unit tests — boot
 * re-saving an inferred locale through setLocale's 'chosen' default, which
 * promoted a guess to a choice and locked the interface language against
 * every later link. It only showed up as case 4 failing on staging.
 *
 * Run against any deploy:  BASE=https://staging.saysomethingin.app node e2e/_deeplink-locale-verify.mjs
 *
 * Note on the screenshots: Tamil, Bengali, Arabic, Hangul and Han rely on OS
 * fallback fonts by design (styles/coverageLanguages.ts, NO_COVERED_FONT), so
 * they render as tofu on a headless Linux box that has none installed. Judge
 * those cases by the reported DOM text, not the picture.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'
const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT || '/tmp/deeplink-locale-shots'
mkdirSync(OUT, { recursive: true })

const cases = [
  { name: '1-hindi-known',   url: `${BASE}/?course=eng_for_hin`, seed: null,
    why: 'English-for-Hindi-speakers, fresh visitor → interface should be Hindi' },
  { name: '2-english-known', url: `${BASE}/?course=spa_for_eng`, seed: null,
    why: 'Spanish-for-English-speakers → nothing changes, stays English' },
  { name: '3-chosen-wins',   url: `${BASE}/?course=eng_for_hin`, seed: { locale: 'cym', source: 'chosen' },
    why: 'visitor chose Welsh → deep link must NOT override' },
  { name: '4-inferred-replaced', url: `${BASE}/?course=eng_for_tam`, seed: { locale: 'hin', source: 'inferred' },
    why: 'earlier link guessed Hindi → a later link may replace it with Tamil' },
  { name: '5-no-ui-language', url: `${BASE}/?course=eng_for_kan`, seed: null,
    why: 'Kannada — we ship no interface for it → honest no-op, stays English' },
]

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

for (const c of cases) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
  })
  const page = await ctx.newPage()
  if (c.seed) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.evaluate((s) => {
      localStorage.setItem('ssi-locale', s.locale)
      localStorage.setItem('ssi-locale-source', s.source)
    }, c.seed)
  }
  await page.goto(c.url, { waitUntil: 'networkidle', timeout: 90000 })
  await new Promise(r => setTimeout(r, 6000))
  const state = await page.evaluate(() => ({
    locale: localStorage.getItem('ssi-locale'),
    source: localStorage.getItem('ssi-locale-source'),
    htmlLang: document.documentElement.lang,
    sampleText: Array.from(document.querySelectorAll('button, h1, h2, p, span'))
      .map(e => (e.textContent || '').trim()).filter(t => t && t.length > 2 && t.length < 60).slice(0, 12),
  }))
  console.log(JSON.stringify({ case: c.name, why: c.why, ...state }, null, 1))
  await page.screenshot({ path: `${OUT}/${c.name}.png` })
  await ctx.close()
}
await browser.close()
