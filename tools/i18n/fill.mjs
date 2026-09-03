#!/usr/bin/env node
/**
 * pnpm i18n:fill — fill every locale file with the keys English has and it doesn't.
 *
 * The gates landed first: locale parity (useI18n.localeParity.test.ts) and the
 * bare-English directory scan (i18n/noBareEnglish.test.ts). A gate that only ever
 * blocks people is a gate that gets deleted, so this is the tool that satisfies them.
 *
 * Two passes, in this order, because the first one is free:
 *
 *   1. HARVEST — for each missing key, take its ENGLISH value and look for that same
 *      English sentence under ANY key path, in this branch's own locale files and in
 *      the harvest refs below. Matching on the English source text rather than the key
 *      path is the whole trick: key names get renamed between branches, the English
 *      sentence does not. On 2026-09-03 a key-name match found 91 of 311; a value
 *      match found 251.
 *
 *   2. TRANSLATE — only what harvest could not reach goes to a model, one headless
 *      `claude -p` process per locale, each in its own scratch directory with no write
 *      path into the repo at all. The orchestrator is the single writer.
 *
 * Standing rules this tool enforces on itself:
 *   - eng.json is NEVER written. Asserted below.
 *   - Placeholders ({count}, {language}, ...) come through a translation unchanged.
 *   - Strings on i18n/untranslatable.ts are copied verbatim, never translated.
 *   - languages.* is exempt (per-file endonym conventions; parity exempts it too).
 *   - pending-translation.json is only ever SHRUNK, only for keys this run actually
 *     filled into every locale, and every removal is printed. The parity ratchet
 *     fails on a stale entry, so leaving a filled key enrolled is itself a red test.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCALES = join(ROOT, 'packages/player-vue/src/locales')
const LOCALES_REL = 'packages/player-vue/src/locales'
const PENDING_REL = 'packages/player-vue/src/i18n/pending-translation.json'
const PENDING = join(ROOT, PENDING_REL)
const UNTRANSLATABLE_TS = join(ROOT, 'packages/player-vue/src/i18n/untranslatable.ts')
const SOURCE = 'eng.json'
const EXEMPT_PREFIX = 'languages.'

/**
 * Where harvest looks for an English sentence somebody has already translated.
 * A short visible list, deliberately not a discovery algorithm — a developer should
 * be able to add a branch to it in five seconds. Read with `git show`; never checked
 * out, never merged. Missing refs are skipped with a note, not an error.
 */
const HARVEST_REFS = [
  'origin/dev',
  'origin/feat/i18n-full-localisation-2026-09-02',
  'origin/i18n/311-fill-2026-09-03',
  'origin/i18n/311-ara-aze-ben',
  'origin/i18n/311-cym-deu-fra',
  'origin/i18n/311-gle-guj-hin',
  'origin/i18n/311-ita-jpn-kor',
  'origin/i18n/311-kan',
  'origin/i18n/311-lit-pan-por',
  'origin/i18n/311-mar',
  'origin/i18n/311-sin-spa-tam-urd-yor-zho',
  'origin/i18n/311-tel',
]

const CONCURRENCY = 4 // this box caps our scope at 4 CPUs; do not reason from nproc
const CLAUDE = process.env.CLAUDE_BIN || '/usr/local/bin/claude'

// ---------------------------------------------------------------- helpers

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  )

const setPath = (obj, path, value) => {
  const parts = path.split('.')
  let node = obj
  for (const p of parts.slice(0, -1)) {
    if (node[p] === undefined || typeof node[p] !== 'object' || Array.isArray(node[p])) node[p] = {}
    node = node[p]
  }
  node[parts[parts.length - 1]] = value
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase()
const placeholders = (s) => (String(s).match(/\{[^{}]*\}/g) || []).sort()
const samePlaceholders = (a, b) => placeholders(a).join(' ') === placeholders(b).join(' ')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n')

const showRef = (ref, relPath) => {
  try {
    return execFileSync('git', ['show', `${ref}:${relPath}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64e6,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

const untranslatableSet = () => {
  const src = readFileSync(UNTRANSLATABLE_TS, 'utf8')
  const body = src.slice(src.indexOf('['), src.indexOf(']'))
  return new Set([...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")))
}

// ---------------------------------------------------------------- cli

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const a = argv.find((x) => x.startsWith(f + '='))
  return a ? a.slice(f.length + 1) : null
}

if (has('--help') || has('-h')) {
  console.log(`
pnpm i18n:fill — fill every locale file with the keys eng.json has and it doesn't.

  pnpm i18n:fill                 harvest, then translate the residue, then write
  pnpm i18n:fill --dry-run       report the diff and the harvest/translate split, write nothing
  pnpm i18n:fill --only=cym,deu  restrict to some locales
  pnpm i18n:fill --no-model      harvest only; leave the residue for a later run
  pnpm i18n:fill --help          this

What it does
  1. Diffs eng.json against every locale file on the CURRENT branch.
  2. HARVEST: matches each missing key's ENGLISH VALUE against every key path in
     this branch and in the harvest refs listed at the top of tools/i18n/fill.mjs,
     and takes the corresponding translation. Free, and it beats a model call.
  3. TRANSLATE: the residue only, one headless \`claude -p\` per locale, each in its
     own scratch dir with no write path into the repo. Output is rejected unless it
     is valid JSON, adds only the requested keys, has no empty strings, and carries
     every {placeholder} through unchanged.

What it will not do
  - Write eng.json. Not one byte; asserted at exit.
  - Touch languages.* — per-file endonym conventions, and parity exempts it.
  - Translate a string on i18n/untranslatable.ts; those are copied verbatim.
  - Silently un-enrol a key from i18n/pending-translation.json. It removes ONLY keys
    this run filled into every locale — which the parity ratchet requires, since an
    enrolled-but-translated key fails the test — and prints every removal.

What it cannot do without a human
  - Judge whether a name is a product name or a description. Brand marks stay Latin
    because untranslatable.ts says so; a new one needs a line added there, with a reason.
  - Vouch for a translation in a language nobody here reads. Model output is checked
    mechanically, not for taste.
`)
  process.exit(0)
}

const DRY = has('--dry-run')
const NO_MODEL = has('--no-model')
const ONLY = val('--only')
  ?.split(',')
  .map((s) => s.trim().replace(/\.json$/, ''))

// ---------------------------------------------------------------- the diff

const englishBefore = readFileSync(join(LOCALES, SOURCE))
const english = new Map(flatten(readJson(join(LOCALES, SOURCE))))
const untranslatable = untranslatableSet()

const allLocaleFiles = readdirSync(LOCALES)
  .filter((f) => f.endsWith('.json') && f !== SOURCE)
  .sort()
const localeFiles = ONLY ? allLocaleFiles.filter((f) => ONLY.includes(f.replace('.json', ''))) : allLocaleFiles

const englishUiKeys = [...english.keys()].filter((k) => !k.startsWith(EXEMPT_PREFIX))

const missingByLocale = new Map()
for (const file of localeFiles) {
  const have = new Map(flatten(readJson(join(LOCALES, file))))
  const missing = englishUiKeys.filter((k) => !have.has(k))
  if (missing.length) missingByLocale.set(file, missing)
}

const totalMissing = [...missingByLocale.values()].reduce((a, b) => a + b.length, 0)
console.log(`eng.json: ${english.size} keys (${englishUiKeys.length} translatable)`)
console.log(`${localeFiles.length} locales, ${missingByLocale.size} short, ${totalMissing} key-slots missing\n`)
if (!totalMissing) {
  console.log('Nothing to fill.')
  process.exit(0)
}

// ---------------------------------------------------------------- pass 1: harvest

const sources = []

const indexSource = (label, engText, localeText) => {
  if (!engText) return
  const engByValue = new Map()
  for (const [k, v] of flatten(JSON.parse(engText))) {
    if (typeof v !== 'string') continue
    const n = norm(v)
    if (!engByValue.has(n)) engByValue.set(n, [])
    engByValue.get(n).push(k)
  }
  const locales = new Map()
  for (const [file, text] of localeText) {
    try {
      locales.set(file, new Map(flatten(JSON.parse(text))))
    } catch {
      /* a malformed file on some branch is not this tool's problem */
    }
  }
  sources.push({ label, engByValue, locales })
}

// this branch itself: a key renamed within the branch is already translated here
indexSource(
  'HEAD (this branch)',
  readFileSync(join(LOCALES, SOURCE), 'utf8'),
  localeFiles.map((f) => [f, readFileSync(join(LOCALES, f), 'utf8')]),
)

for (const ref of HARVEST_REFS) {
  const engText = showRef(ref, `${LOCALES_REL}/${SOURCE}`)
  if (!engText) {
    console.log(`  harvest ref unavailable, skipped: ${ref}`)
    continue
  }
  const localeText = []
  for (const f of localeFiles) {
    const t = showRef(ref, `${LOCALES_REL}/${f}`)
    if (t) localeText.push([f, t])
  }
  indexSource(ref, engText, localeText)
}
console.log(`harvest sources indexed: ${sources.length}\n`)

/** file -> key -> value, the single write buffer */
const filled = new Map(localeFiles.map((f) => [f, new Map()]))
const harvestCredit = new Map()
const residual = new Map(localeFiles.map((f) => [f, []]))

for (const [file, missing] of missingByLocale) {
  for (const key of missing) {
    const englishValue = english.get(key)

    if (typeof englishValue !== 'string') {
      filled.get(file).set(key, englishValue)
      continue
    }
    if (untranslatable.has(englishValue.replace(/\s+/g, ' ').trim())) {
      filled.get(file).set(key, englishValue)
      const label = 'untranslatable.ts (copied verbatim)'
      harvestCredit.set(label, (harvestCredit.get(label) || 0) + 1)
      continue
    }

    let hit = null
    for (const src of sources) {
      const candidates = src.engByValue.get(norm(englishValue))
      if (!candidates) continue
      const loc = src.locales.get(file)
      if (!loc) continue
      // Every candidate key must agree, or we do not guess: an over-eager match that
      // lands the wrong sentence is worse than a miss.
      const values = [
        ...new Set(candidates.map((c) => loc.get(c)).filter((v) => typeof v === 'string' && v.trim())),
      ]
      if (values.length !== 1) continue
      if (!samePlaceholders(englishValue, values[0])) continue
      hit = { value: values[0], from: src.label }
      break
    }

    if (hit) {
      filled.get(file).set(key, hit.value)
      harvestCredit.set(hit.from, (harvestCredit.get(hit.from) || 0) + 1)
    } else {
      residual.get(file).push(key)
    }
  }
}

const harvested = [...filled.values()].reduce((a, m) => a + m.size, 0)
const toTranslate = [...residual.values()].reduce((a, b) => a + b.length, 0)
console.log(`HARVESTED  ${harvested}`)
for (const [label, n] of [...harvestCredit].sort((a, b) => b[1] - a[1])) console.log(`    ${n}  ${label}`)
console.log(`TRANSLATE  ${toTranslate}`)
for (const [file, keys] of residual) if (keys.length) console.log(`    ${keys.length}  ${file}`)
console.log()

if (DRY) {
  console.log('--dry-run: nothing written.')
  process.exit(0)
}

// ---------------------------------------------------------------- pass 2: the model

/**
 * The single seam. Everything model-shaped is behind this one function, so swapping
 * the backend means rewriting it and nothing else. The child process gets its own
 * real-disk scratch directory as its cwd and no write path into the repo at all —
 * stronger isolation than a worktree, and fewer moving parts.
 */
async function translateBatch(file, keys, runDir) {
  const lang = file.replace('.json', '')
  const dir = join(runDir, lang)
  mkdirSync(dir, { recursive: true })

  const existing = new Map(flatten(readJson(join(LOCALES, file))))
  const sample = [...existing].filter(([k, v]) => typeof v === 'string' && !k.startsWith(EXEMPT_PREFIX)).slice(0, 60)
  const payload = Object.fromEntries(keys.map((k) => [k, english.get(k)]))

  const brief = `You are translating UI strings for the SaySomethingIn language-learning app into the language of the locale file ${file} (ISO 639-3 code "${lang}").

Here are ${sample.length} strings ALREADY in that file. Read them: they establish the register, the formality (tu/vous, du/Sie, ti/chi), the tone and the terminology this file uses. Match it. Do not pick a register of your own.

${JSON.stringify(Object.fromEntries(sample), null, 2)}

Now translate these ${keys.length} English strings into the same language and the same register:

${JSON.stringify(payload, null, 2)}

Rules, all hard:
- Output ONE JSON object and nothing else. No prose, no markdown fence. Keys exactly the ${keys.length} keys above, no more, no fewer.
- Every value is a non-empty translated string.
- Placeholders in curly braces such as {count}, {language} or {mins} are code. Copy each one through EXACTLY: same spelling, same number of them. Never translate what is inside the braces. You may move a placeholder to where the sentence needs it.
- "Say Something in", "SaySomethingIn" and "SSi" are the product's NAME. Leave them in Latin script inside your translated sentence, unchanged, even in a non-Latin-script language.
- These are short interface strings: buttons, labels, headings. Translate them as interface text, tersely, the way a native speaker's phone actually reads.`

  writeFileSync(join(dir, 'brief.md'), brief)

  const out = await new Promise((res, rej) => {
    const p = spawn(CLAUDE, ['-p', brief], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    let so = '',
      se = ''
    p.stdout.on('data', (d) => (so += d))
    p.stderr.on('data', (d) => (se += d))
    p.on('error', rej)
    p.on('close', (code) => (code === 0 ? res(so) : rej(new Error(`claude exited ${code}: ${se.slice(-400)}`))))
  })
  writeFileSync(join(dir, 'raw.txt'), out)

  const m = out.match(/\{[\s\S]*\}/)
  if (!m) throw new Error(`${file}: no JSON object in model output`)
  const parsed = JSON.parse(m[0])

  const accepted = new Map()
  const rejected = []
  for (const k of keys) {
    const v = parsed[k]
    if (typeof v !== 'string' || !v.trim()) {
      rejected.push(`${k}: missing or empty`)
      continue
    }
    if (!samePlaceholders(english.get(k), v)) {
      rejected.push(`${k}: placeholders changed (${placeholders(english.get(k))} -> ${placeholders(v)})`)
      continue
    }
    accepted.set(k, v)
  }
  for (const k of Object.keys(parsed)) if (!keys.includes(k)) rejected.push(`${k}: not requested, dropped`)
  return { accepted, rejected }
}

const failures = []
if (!NO_MODEL && toTranslate) {
  if (!existsSync(CLAUDE)) {
    console.error(`\nFATAL: no translation backend at ${CLAUDE}.`)
    console.error(`Harvest results were NOT written. Re-run with --no-model to write the harvest alone,`)
    console.error(`or set CLAUDE_BIN. Nothing has been changed.`)
    process.exit(1)
  }
  const runDir = join(process.env.HOME, '.cache', 'ssi-i18n-fill', String(Date.now()))
  mkdirSync(runDir, { recursive: true })
  console.log(`translating residue via ${CLAUDE}; briefs and raw output under ${runDir}\n`)

  const jobs = [...residual].filter(([, k]) => k.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const [file, keys] = jobs[cursor++]
        try {
          const { accepted, rejected } = await translateBatch(file, keys, runDir)
          for (const [k, v] of accepted) filled.get(file).set(k, v)
          console.log(
            `  ${file}: ${accepted.size}/${keys.length} accepted${rejected.length ? `, ${rejected.length} rejected` : ''}`,
          )
          for (const r of rejected) console.log(`      REJECTED ${r}`)
          if (rejected.length) failures.push(`${file}: ${rejected.length} value(s) rejected`)
        } catch (e) {
          console.log(`  ${file}: FAILED — ${e.message}`)
          failures.push(`${file}: ${e.message}`)
        }
      }
    }),
  )
  console.log()
}

// ---------------------------------------------------------------- write

let written = 0
for (const [file, values] of filled) {
  if (!values.size) continue
  const path = join(LOCALES, file)
  const doc = readJson(path)
  for (const [k, v] of values) setPath(doc, k, v)
  writeJson(path, doc)
  written += values.size
  console.log(`wrote ${values.size} key(s) -> ${LOCALES_REL}/${file}`)
}

// eng.json is never written. Assert it rather than trusting it.
if (!readFileSync(join(LOCALES, SOURCE)).equals(englishBefore)) {
  console.error('\nFATAL: eng.json changed. That must never happen — investigate before committing.')
  process.exit(1)
}

// ---------------------------------------------------------------- the register

const pendingDoc = readJson(PENDING)
const loadedAll = new Map(allLocaleFiles.map((f) => [f, new Map(flatten(readJson(join(LOCALES, f))))]))
const filledThisRun = new Set([...filled.values()].flatMap((m) => [...m.keys()]))
const unenrolled = pendingDoc.keys.filter(
  (k) => filledThisRun.has(k) && [...loadedAll.values()].every((m) => m.has(k)),
)

if (unenrolled.length) {
  pendingDoc.keys = pendingDoc.keys.filter((k) => !unenrolled.includes(k))
  writeJson(PENDING, pendingDoc)
  console.log(
    `\nun-enrolled ${unenrolled.length} key(s) from ${PENDING_REL} — this run filled them into every locale, and`,
  )
  console.log(`the parity ratchet fails on an enrolled key that is no longer missing anywhere:`)
  for (const k of unenrolled) console.log(`    ${k}`)
  console.log(`${pendingDoc.keys.length} key(s) still enrolled.`)
} else if (pendingDoc.keys.length) {
  console.log(`\n${pendingDoc.keys.length} key(s) remain enrolled in ${PENDING_REL}; none were un-enrolled.`)
}

console.log(`\nDONE — ${written} key-slot(s) filled: ${harvested} harvested, ${written - harvested} translated.`)
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`)
  for (const f of failures) console.log(`  ${f}`)
  console.log('Re-run to retry the residue; already-filled keys are skipped.')
  process.exit(1)
}
