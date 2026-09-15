// Job #652: does the Choose Your Course sheet scroll on a Chromebook?
// Opens production with ?openCourses=1 at Chromebook-ish viewports under a
// ChromeOS Chrome UA, touch and non-touch, measures the scroll containers,
// scrolls by wheel and by touch-drag, and screenshots the bottom.
import { chromium } from '@playwright/test'

const URL = process.env.PROBE_URL || 'https://saysomethingin.app/?openCourses=1'
const OUT = process.env.OUT_DIR || process.env.CS_SCRATCH
const UA = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
const cases = [
  { name: '1366x768-mouse', w: 1366, h: 768, touch: false, ispeak: 'eng' },
  { name: '1280x720-touch', w: 1280, h: 720, touch: true, ispeak: 'eng' },
  { name: '1616x842-mouse-zho', w: 1616, h: 842, touch: false, ispeak: 'zho' },
  { name: '1616x842-mouse-eng', w: 1616, h: 842, touch: false, ispeak: 'eng' },
  { name: '390x844-phone', w: 390, h: 844, touch: true, ispeak: 'eng', mobile: true },
]
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--autoplay-policy=no-user-gesture-required'] })
const results = []
for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, hasTouch: c.touch, isMobile: !!c.mobile, userAgent: UA })
  await ctx.addInitScript((v) => { try { localStorage.setItem('ssi-i-speak', v) } catch {} }, c.ispeak)
  const page = await ctx.newPage()
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const panel = page.locator('.selector-panel')
  const ok = await panel.waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(4000)
  const measure = () => page.evaluate(() => {
    const m = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, overflowY: cs.overflowY, height: cs.height, maxHeight: cs.maxHeight } }
    return { panel: m('.selector-panel'), content: m('.sheet-content'), body: { overflow: getComputedStyle(document.body).overflowY, scrollTop: document.scrollingElement.scrollTop, scrollHeight: document.scrollingElement.scrollHeight, clientHeight: document.scrollingElement.clientHeight }, rows: document.querySelectorAll('.selector-panel .target-card, .selector-panel [class*="course-row"], .selector-panel button.row').length, lastRowBottom: (() => { const rows = document.querySelectorAll('.sheet-content > *'); const last = rows[rows.length - 1]; return last ? last.getBoundingClientRect().bottom : null })(), innerH: innerHeight }
  })
  const before = await measure()
  await page.screenshot({ path: `${OUT}/652-${c.name}-top.png` })
  const box = await panel.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 4000)
  await page.waitForTimeout(800)
  const afterWheel = await measure()
  let afterTouch = null
  if (c.touch) {
    const cdp = await ctx.newCDPSession(page)
    const x = box.x + box.width / 2, y0 = box.y + box.height * 0.8
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
    for (let i = 1; i <= 20; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 25 }] }); await page.waitForTimeout(16) }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(800)
    afterTouch = await measure()
  }
  await page.screenshot({ path: `${OUT}/652-${c.name}-bottom.png` })
  results.push({ case: c.name, panelFound: ok, before, afterWheel, afterTouch, errs })
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify(results, null, 1))
