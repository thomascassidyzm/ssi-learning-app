/**
 * Vendor the web fonts, subset-for-subset, into public/fonts/.
 *
 * WHY THIS EXISTS (2026-08-26, Tom's ruling A-265)
 * ------------------------------------------------
 * The fonts used to be fetched from fonts.googleapis.com at runtime. On a weak
 * signal that request is accepted and then hangs forever — which on 2026-08-25
 * gave Tom a permanent white screen at an airport (see utils/loadWebFonts.ts
 * for the full account). The non-blocking media="print" loader shipped in
 * a0b26680 stops a hang from blocking paint, and stays. This script closes the
 * other half: once the font files live in our own build output and the service
 * worker has precached them, there is NO third party in the font path at all.
 *
 * WHAT MUST NOT REGRESS
 * ---------------------
 * Google serves each family split by `unicode-range`, so a learner downloads
 * only the subsets their own language actually uses. That per-language economy
 * is the reason the fonts were left on Google in the first place, and it is
 * preserved exactly: this script keeps Google's own @font-face blocks, keeps
 * every `unicode-range` verbatim, and only rewrites the `src` url to a local
 * path. styles/fontGlyphCoverage.test.ts asserts the generated stylesheet still
 * carries every family a design token names.
 *
 * WHAT IS DELIBERATELY DROPPED
 * ----------------------------
 * 1. The Japanese subsets of Noto Sans JP — 620 files, 25.5 MB. Noto Sans JP is
 *    --font-display, i.e. UI headings in a Latin interface; no course in the
 *    estate renders Japanese (see styles/coverageLanguages.ts — Han is on the
 *    NO_COVERED_FONT list already). unicode-range means the browser never
 *    fetched those files anyway, so dropping them changes nothing a learner
 *    sees. Same reasoning retires Open Sans's hebrew/math/symbols subsets.
 * 2. Static per-weight files, in favour of Google's VARIABLE builds over the
 *    same weight range (`wght@400..700` instead of `wght@400;500;600;700`).
 *    Identical weight coverage, one file per subset instead of four:
 *    3.66 MB → 1.16 MB across the kept subsets.
 *
 * TIERS
 * -----
 * public/fonts/core/ — the faces every learner's UI is actually made of, latin
 *   + latin-ext. Precached by the service worker (~200 KB), so a cold offline
 *   boot is fully typeset with zero network.
 * public/fonts/ext/  — everything else: the per-language coverage subsets
 *   (Cyrillic, Greek, Devanagari, Vietnamese) and the schools-only faces.
 *   Vendored and same-origin, but NOT precached — same doctrine as the schools
 *   and echarts chunks in vite.config.js: a learner never pays install weight
 *   for a surface they may never open. Runtime CacheFirst picks them up on
 *   first use.
 *
 * RUN IT:  node scripts/vendor-fonts.mjs
 * Then commit public/fonts/. The build itself never touches the network.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../public/fonts')

/** A modern desktop Chrome, so Google serves woff2 rather than a legacy format. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * The two stylesheets the app used to request at runtime, restated as variable
 * ranges over the SAME weights. Keep these in step with the design tokens in
 * styles/design-tokens.css.
 */
const SHEETS = [
  // App faces: DM Sans (brand body), Noto Sans (per-language glyph coverage),
  // JetBrains Mono (code + the player's known line), Noto Sans JP (display),
  // Space Mono (no variable build exists — static 400/700).
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400..700' +
    '&family=Noto+Sans:wght@400..700' +
    '&family=JetBrains+Mono:wght@300..600' +
    '&family=Noto+Sans+JP:wght@300..900' +
    '&family=Space+Mono:wght@400;700&display=swap',
  // Schools faces, used only inside .schools-surface.
  'https://fonts.googleapis.com/css2?family=Arsenal:ital,wght@0,400;0,700;1,400' +
    '&family=Open+Sans:ital,wght@0,400..700;1,400&display=swap',
]

/**
 * Subsets any language in the estate can actually need. Everything else is
 * dropped — see the header. `[0]`-style names are Noto Sans JP's Japanese
 * shards and never match.
 */
const KEEP_SUBSETS = new Set([
  'latin',
  'latin-ext',
  'cyrillic',
  'cyrillic-ext',
  'greek',
  'greek-ext',
  'devanagari',
  'vietnamese',
])

/** Precached: the UI's own faces, Latin only. Everything else is runtime. */
const CORE_FAMILIES = new Set(['DM Sans', 'JetBrains Mono', 'Space Mono', 'Noto Sans JP'])
const CORE_SUBSETS = new Set(['latin', 'latin-ext'])

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

/** Google emits `/* subset *\/ @font-face { ... }` pairs, in that order. */
function parseFaces(css) {
  const faces = []
  const re = /\/\*\s*([a-z0-9[\]-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g
  for (const m of css.matchAll(re)) {
    const body = m[2]
    const pick = key => (body.match(new RegExp(`${key}:\\s*([^;]+);`)) || [])[1]?.trim()
    faces.push({
      subset: m[1],
      family: (pick('font-family') || '').replace(/^['"]|['"]$/g, ''),
      style: pick('font-style') || 'normal',
      weight: pick('font-weight') || '400',
      stretch: pick('font-stretch'),
      unicodeRange: pick('unicode-range'),
      url: (body.match(/url\((https:\/\/[^)]+)\)/) || [])[1],
    })
  }
  return faces
}

const main = async () => {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(resolve(OUT, 'core'), { recursive: true })
  await mkdir(resolve(OUT, 'ext'), { recursive: true })

  const all = []
  for (const sheet of SHEETS) all.push(...parseFaces(await fetchText(sheet)))

  const kept = all.filter(f => KEEP_SUBSETS.has(f.subset) && f.url && f.unicodeRange)
  if (!kept.length) throw new Error('parsed no @font-face blocks — did the css2 format change?')

  const bytes = { core: 0, ext: 0 }
  const blocks = []
  const seen = new Set()

  for (const f of kept) {
    const tier = CORE_FAMILIES.has(f.family) && CORE_SUBSETS.has(f.subset) ? 'core' : 'ext'
    const name =
      `${slug(f.family)}-${f.subset}-${slug(f.weight)}` +
      `${f.style === 'italic' ? '-italic' : ''}.woff2`
    if (seen.has(name)) throw new Error(`duplicate output name ${name}`)
    seen.add(name)

    const res = await fetch(f.url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`${res.status} for ${f.url}`)
    const buf = Buffer.from(await res.arrayBuffer())
    bytes[tier] += buf.length
    await writeFile(resolve(OUT, tier, name), buf)

    blocks.push(
      [
        `/* ${f.family} · ${f.subset} */`,
        `@font-face {`,
        `  font-family: '${f.family}';`,
        `  font-style: ${f.style};`,
        `  font-weight: ${f.weight};`,
        f.stretch ? `  font-stretch: ${f.stretch};` : null,
        `  font-display: swap;`,
        `  src: url('/fonts/${tier}/${name}') format('woff2');`,
        `  unicode-range: ${f.unicodeRange};`,
        `}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  const kb = n => `${(n / 1024).toFixed(1)} KB`
  const header = [
    '/*',
    ' * GENERATED by scripts/vendor-fonts.mjs — do not hand-edit.',
    ' *',
    ' * Self-hosted web fonts, split by unicode-range exactly as Google served',
    ' * them, so a learner still downloads only the subsets their own language',
    ' * uses. Loaded non-render-blocking from utils/loadWebFonts.ts.',
    ' *',
    ` * core/ ${kb(bytes.core)} — precached by the service worker.`,
    ` * ext/  ${kb(bytes.ext)} — same-origin, runtime CacheFirst, not precached.`,
    ' */',
    '',
  ].join('\n')

  await writeFile(resolve(OUT, 'fonts.css'), header + blocks.join('\n\n') + '\n')
  console.log(`core: ${kb(bytes.core)}   ext: ${kb(bytes.ext)}   faces: ${kept.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
