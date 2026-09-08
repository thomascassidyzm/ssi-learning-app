/**
 * Print the welcome pack to A4 — the Canolfan's primary artefact.
 *
 *   TMPDIR=/tmp \
 *   LD_LIBRARY_PATH=~/.ssi-sentinel-libs \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
 *   node tools/croeso/pdf.mjs
 *
 * ONE SOURCE, TWO OUTPUTS. The PDF is printed from the same
 * public/croeso/index.html the web page serves — it is never authored
 * separately. Two hand-kept copies diverge, and the one that gets emailed to
 * three thousand learners is always the stale one.
 *
 * Run build.py first if the template or the screenshots changed; this script
 * refuses to run against a missing page rather than printing yesterday's.
 *
 * It CHECKS what can honestly be checked: every picture decoded before the
 * shutter, nothing fetched from outside the file, and every picture actually
 * embedded in the PDF on disk afterwards. A PDF whose images have silently
 * vanished is worse than no PDF, because nobody looks. It also asserts one
 * sheet, one page — a sheet that has outgrown its page splits, and that shows
 * up as a surplus page. Whether a page READS well is still read by a human.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Playwright is not resolvable from this repo's root in every checkout, and a
 *  worktree's node_modules is a symlink to the main one. Try the normal
 *  specifier, then PLAYWRIGHT_MODULE, and say plainly what to set. */
async function loadChromium() {
  for (const spec of ['@playwright/test', process.env.PLAYWRIGHT_MODULE].filter(Boolean)) {
    try { return (await import(spec)).chromium } catch { /* try the next one */ }
  }
  console.error('cannot resolve @playwright/test — set PLAYWRIGHT_MODULE to its index.mjs')
  process.exit(1)
}
const chromium = await loadChromium()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const PAGE = path.join(ROOT, 'packages', 'player-vue', 'public', 'croeso', 'index.html')
// Written next to the page it was printed from, and served from there, so the
// Canolfan can EITHER attach the file or link it — and the linked one can never
// be a stale copy of the page, because it is regenerated from it.
const OUT = process.env.OUT_PDF ||
  path.join(ROOT, 'packages', 'player-vue', 'public', 'croeso', 'Pecyn-Croeso.pdf')

if (!fs.existsSync(PAGE)) {
  console.error(`no page at ${PAGE} — run: python3 tools/croeso/build.py`)
  process.exit(1)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await (await browser.newContext()).newPage()
const external = []
page.on('request', (r) => {
  if (!r.url().startsWith('file://') && !r.url().startsWith('data:')) external.push(r.url())
})
await page.goto('file://' + PAGE, { waitUntil: 'networkidle' })

// Nothing may be pending when the shutter falls. Images here are data: URIs
// and nothing is lazy, but assert it rather than assume it.
const imgs = await page.evaluate(() => {
  const list = [...document.images]
  return { count: list.length, broken: list.filter((i) => !i.naturalWidth).map((i) => i.alt) }
})
if (imgs.broken.length) {
  console.error('pictures did not decode:', imgs.broken)
  process.exit(1)
}
if (external.length) {
  console.error('the page fetched something from outside itself:', external)
  process.exit(1)
}

// Counted while the page is still open; compared with the printed page count below.
const sheets = await page.evaluate(() => document.querySelectorAll('section.sheet').length)

await page.emulateMedia({ media: 'print' })

const foot = `
  <div style="width:100%;font:8pt -apple-system,Arial,sans-serif;color:#555;
              padding:0 14mm;display:flex;justify-content:space-between">
    <span>Pecyn Croeso &middot; Say Something in Welsh &middot; saysomethingin.app/croeso</span>
    <span>Tudalen <span class="pageNumber"></span> o <span class="totalPages"></span></span>
  </div>`

await page.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: foot,
  margin: { top: '14mm', bottom: '18mm', left: '14mm', right: '14mm' },
})
await browser.close()

// The stated fear is a PDF whose pictures have silently vanished. Count the
// image objects in the file itself rather than trusting that the page had
// them: /Subtype /Image is what an embedded picture looks like on disk.
const pdfBytes = fs.readFileSync(OUT)
const embedded = (pdfBytes.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length
const pages = (pdfBytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
if (embedded < imgs.count) {
  console.error(`only ${embedded} of ${imgs.count} pictures reached the PDF`)
  process.exit(1)
}
// ONE SHEET, ONE PAGE — and that IS machine-checkable, because the print
// stylesheet starts every sheet on fresh paper. So the printed page count must
// be exactly one (the masthead's own page) plus the number of sheets. A sheet
// that has outgrown its page shows up here as a surplus page, which is the
// defect the first pass had to find by eye. It does NOT replace reading the
// thing: "this step reads badly" still has no automatic test.
if (pages !== sheets + 1) {
  console.error(`${pages} pages for ${sheets} sheets — expected ${sheets + 1}.`)
  console.error('A sheet has outgrown its page and split. Split it in the template.')
  process.exit(1)
}

const bytes = fs.statSync(OUT).size
console.log(`${OUT}\n${pages} A4 pages, ${embedded} pictures embedded, ${(bytes / 1024 / 1024).toFixed(2)} MB`)
