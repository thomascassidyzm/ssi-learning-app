/**
 * A-265 verification probe: the self-hosted fonts actually rasterise text, and
 * nothing in the app's boot path touches a font host.
 *
 * Ground truth is CDP `CSS.getPlatformFontsForNode` — Chrome naming the font
 * files it really used per node. `document.fonts.check()` lies (it answers for
 * the whole font list, so a Greek run in a Latin-only font still reports true).
 *
 * Run from packages/player-vue, against a `serve`d dist/:
 *   LD_LIBRARY_PATH=/home/tomcassidy/.pwlibs/root/usr/lib/x86_64-linux-gnu:/home/tomcassidy/cslibs/root/usr/lib/x86_64-linux-gnu \
 *   CHROME_BIN=/home/tomcassidy/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
 *   BASE=http://localhost:5199 node e2e/selfhost-font-probe.mjs
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'

const BASE = process.env.BASE || 'http://localhost:5199'

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()

const requests = []
page.on('request', r => requests.push(r.url()))

await page.goto(`${BASE}/fonts-probe.html`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)

const client = await page.context().newCDPSession(page)
await client.send('DOM.enable')
await client.send('CSS.enable')
const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true })

const out = []
for (const id of ['brand', 'coverage-greek', 'coverage-cyrillic', 'coverage-devanagari', 'mono']) {
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` })
  const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId })
  out.push({ id, fonts: fonts.map(f => `${f.familyName} × ${f.glyphCount}`) })
}

console.log(JSON.stringify({ nodes: out }, null, 2))
console.log('third-party font requests:', requests.filter(u => /fonts\.(googleapis|gstatic)\.com/.test(u)))
console.log('local font files fetched:', requests.filter(u => u.includes('/fonts/')).map(u => u.replace(BASE, '')))

await browser.close()
