/**
 * Does the staleness line actually appear on screen inside a Capacitor-shaped
 * WebView — and stay away when the app is current?
 *
 * WHY THIS HARNESS AND NOT AN EMULATOR. This box has no /dev/kvm and no vmx or
 * svm flags, so a hardware-accelerated AVD is impossible and a software one is
 * hours (`emulator -accel-check` refuses; job #525 recorded the same). What
 * this probe reproduces is precisely the thing the defect is about: the page
 * origin is https://localhost and every https://localhost/* request is served
 * from the BUILT android assets, which is exactly what Capacitor's
 * shouldInterceptRequest does. So the question "which origin does
 * /version.json resolve against" is modelled faithfully — and that question IS
 * the bug. It does NOT exercise the Android System WebView binary itself.
 *
 * Both directions, because a check only ever seen green is not a check:
 *   STALE   — the API origin reports a later build; the line must appear, and
 *             be genuinely hit-testable (in the viewport, nothing over it).
 *   CURRENT — the API origin reports this very build; the line must be absent.
 *
 * Usage: node e2e/staleness-line-webview-probe.mjs <distDir> <outDir>
 */
import { chromium } from '@playwright/test'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ASSETS = process.argv[2]
const OUT = process.argv[3] || '.'
const API_ORIGIN = 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2',
  '.webmanifest':'application/manifest+json', '.ico':'image/x-icon', '.jpg':'image/jpeg', '.webp':'image/webp' }

const running = JSON.parse(readFileSync(join(ASSETS, 'version.json'), 'utf8'))
const STALE_ANSWER = { buildNumber: 'f00dfeed', buildTime: new Date(Date.parse(running.buildTime) + 3600e3).toISOString() }
const CURRENT_ANSWER = { buildNumber: running.buildNumber.replace(/^local-/, ''), buildTime: running.buildTime }

async function run(label, versionAnswer) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } })
  const versionRequests = []
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/version.json') {
      versionRequests.push(url.href)
      // The API origin's answer. A request to https://localhost/version.json
      // would be the frozen in-APK copy — recorded, so we can see which was
      // actually asked.
      if (url.origin === API_ORIGIN) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(versionAnswer) })
      }
    }
    if (url.origin === 'https://localhost') {
      let p = join(ASSETS, decodeURIComponent(url.pathname))
      if (url.pathname === '/' || (existsSync(p) && statSync(p).isDirectory())) p = join(ASSETS, 'index.html')
      if (!existsSync(p)) return route.fulfill({ status: 404, body: 'not in assets' })
      return route.fulfill({ status: 200, contentType: TYPES[extname(p)] || 'application/octet-stream', body: readFileSync(p) })
    }
    return route.continue()
  })
  const page = await ctx.newPage()
  await page.goto('https://localhost/?screen=settings', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)

  const line = page.locator('.build-stale')
  const present = await line.count() > 0 && await line.first().isVisible().catch(() => false)

  let text = null
  let hitTest = null
  if (present) {
    text = (await line.first().innerText()).trim()
    hitTest = await page.evaluate(() => {
      const el = document.querySelector('.build-stale')
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const top = document.elementFromPoint(cx, cy)
      const inset = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--sat') || '0') || 0
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        clearOfSafeAreaTop: r.top >= inset,
        topElementIsTheLine: top === el || el.contains(top),
        topElementTag: top ? `${top.tagName}.${top.className}` : null,
        // A description, never a gate: nothing tappable, no handler.
        isPlainText: el.tagName === 'P' && !el.onclick && el.closest('button') === null,
      }
    })
  }
  await page.screenshot({ path: join(OUT, `staleness-${label}.png`) })
  await browser.close()
  return { label, running, versionAnswer, versionRequests, present, text, hitTest }
}

const stale = await run('stale', STALE_ANSWER)
const current = await run('current', CURRENT_ANSWER)
const verdict = {
  staleFires: stale.present === true,
  staleAskedTheApiOrigin: stale.versionRequests.some((u) => u.startsWith(API_ORIGIN)),
  staleNeverAskedItself: !stale.versionRequests.some((u) => u.startsWith('https://localhost')),
  staleIsHittable: !!stale.hitTest?.topElementIsTheLine && !!stale.hitTest?.inViewport && !!stale.hitTest?.clearOfSafeAreaTop,
  staleIsNotAGate: stale.hitTest?.isPlainText === true,
  currentIsSilent: current.present === false,
}
console.log(JSON.stringify({ stale, current, verdict }, null, 2))
process.exit(Object.values(verdict).every(Boolean) ? 0 : 1)
