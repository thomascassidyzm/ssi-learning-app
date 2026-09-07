#!/usr/bin/env node
/**
 * Walkthrough compiler CLI (archive/docs-retired-2026-08-24/walkthrough-engine-scout.md §3).
 *
 * Reads the hand-authored walks (tools/walkthrough/walks/*.json), runs the
 * drift gates in lib.mjs against the live Vue source, and emits the static
 * pack the player bundles. A broken anchor, a member walk pointing at an
 * admin-only element, a click-advance step on a destructive verb — each
 * FAILS the compile. Zero runtime tokens; this CLI is the only refresh path.
 *
 *   node tools/walkthrough/compile.mjs           # write pack.json + docs render
 *   node tools/walkthrough/compile.mjs --check   # validate only, no writes
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGates, assemblePack } from './lib.mjs'
import { parseHandbookBlocks, fingerprintCapability, stampChecked } from './handbookSource.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CHECK_ONLY = process.argv.includes('--check')
// --reconfirm is the REPAIR TOOL for the freshness gate. A gate with no
// one-step repair gets routed around, so this is one command: re-read the
// sentence against the code, then stamp it. With an anchor id it re-pins one
// capability; bare, it re-pins every one of them.
const RECONFIRM = process.argv.includes('--reconfirm')
const RECONFIRM_ONLY = process.argv[process.argv.indexOf('--reconfirm') + 1]?.startsWith('-') === false
  ? process.argv[process.argv.indexOf('--reconfirm') + 1]
  : null

function vueFilesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...vueFilesUnder(full))
    else if (entry.endsWith('.vue')) out.push({ path: full.slice(ROOT.length + 1), src: readFileSync(full, 'utf8') })
  }
  return out
}

const vueFiles = vueFilesUnder(join(ROOT, 'packages/player-vue/src'))

// THE HANDBOOK'S SOURCE IS THE .vue FILES (Tom's ruling 2026-09-07): the
// description of a capability lives in an HTML comment directly above the
// element that is the capability, so the agent changing behaviour is already
// looking at the sentence.
const parsed = vueFiles.map(({ path, src }) => ({ path, src, ...parseHandbookBlocks(path, src) }))
const entries = parsed.flatMap((p) => p.entries)
const parseErrors = parsed.flatMap((p) => p.errors)
const srcByPath = new Map(vueFiles.map(({ path, src }) => [path, src]))
const fingerprintOf = (e) => fingerprintCapability(srcByPath.get(e.path), e.tag, e.tagStart)

if (RECONFIRM) {
  let stamped = 0
  for (const { path, entries: fileEntries } of parsed) {
    const targets = fileEntries
      .filter((e) => !RECONFIRM_ONLY || e.anchor === RECONFIRM_ONLY)
      .filter((e) => e.checked !== fingerprintOf(e))
    if (!targets.length) continue
    let src = readFileSync(join(ROOT, path), 'utf8')
    // Back to front, so earlier offsets stay valid.
    for (const e of [...targets].sort((a, b) => b.blockStart - a.blockStart)) {
      src = stampChecked(src, e, fingerprintOf(e))
      console.log(`  ✓ re-pinned "${e.title}" — ${path}`)
      stamped += 1
    }
    writeFileSync(join(ROOT, path), src)
  }
  console.log(stamped
    ? `[walkthrough] ${stamped} description${stamped === 1 ? '' : 's'} re-pinned to the code they describe.`
    : '[walkthrough] nothing to re-pin — every description is already pinned to its current capability.')
  process.exit(0)
}

const walksDir = join(HERE, 'walks')
const walkFiles = readdirSync(walksDir).filter((f) => f.endsWith('.json')).sort()
const walks = walkFiles.map((f) => JSON.parse(readFileSync(join(walksDir, f), 'utf8')))

const { failures, warnings } = runGates({
  walks,
  entries,
  fingerprintOf,
  vueFiles,
  runtimeSrc: readFileSync(join(ROOT, 'packages/player-vue/src/walkthrough/useWalkthrough.ts'), 'utf8'),
  rulesJson: JSON.parse(readFileSync(join(ROOT, 'tools/explainer/rules.json'), 'utf8')),
  evaluateRulesSrc: readFileSync(join(ROOT, 'packages/player-vue/src/explainer/evaluateRules.ts'), 'utf8'),
  handbookSrc: readFileSync(join(ROOT, 'packages/player-vue/src/walkthrough/handbook.ts'), 'utf8'),
})

for (const w of warnings) console.log(`  ⚠ ${w}`)
failures.unshift(...parseErrors)
if (failures.length) {
  console.error('\n[walkthrough] COMPILE FAILED — a walk would lie about the product:')
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error(
    '\nFix the anchor, the role, the place — or the SENTENCE. A description lives in an\n' +
    'HTML comment directly above the element it describes; if the capability changed,\n' +
    'rewrite the sentence there and then run: node tools/walkthrough/compile.mjs --reconfirm'
  )
  process.exit(1)
}

const pack = assemblePack(walks, entries)
const content = JSON.stringify(pack)
const versioned = {
  version: createHash('sha256').update(content).digest('hex').slice(0, 12),
  generatedAt: new Date().toISOString().slice(0, 10),
  ...pack,
}

if (CHECK_ONLY) {
  console.log(`[walkthrough] check OK — pack version would be ${versioned.version} (${pack.walks.length} walks · ${pack.walks.reduce((n, w) => n + w.steps.length, 0)} steps · ${pack.handbook.length} handbook entries)`)
  process.exit(0)
}

writeFileSync(join(ROOT, 'packages/player-vue/src/walkthrough/pack.json'), JSON.stringify(versioned, null, 2) + '\n')

const md = [
  '# Walkthrough pack — compiled render',
  '',
  `**Version \`${versioned.version}\` · generated ${versioned.generatedAt} by \`tools/walkthrough/compile.mjs\`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**`,
  '',
  ...versioned.walks.flatMap((w) => [
    `## ${w.id} — ${w.title}`,
    '',
    `Personas: ${w.personas.join(', ')} · place: ${w.place.route}${w.place.kinds ? ` (${w.place.kinds.join('/')})` : ''}`,
    '',
    ...w.steps.map((s, i) => `${i + 1}. [\`${s.anchor}\` · ${s.advance.on}] ${s.say}${s.terminal ? `\n   - terminal: ${s.terminal}` : ''}`),
    '',
  ]),
].join('\n')
writeFileSync(join(ROOT, 'docs/walkthrough-pack.md'), md)

const handbookMd = [
  '# Handbook — compiled render',
  '',
  `**Version \`${versioned.version}\` · generated ${versioned.generatedAt} by \`tools/walkthrough/compile.mjs\`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**`,
  '',
  ...versioned.handbook.flatMap((e) => [
    `## ${e.title}`,
    '',
    `Section: ${e.section} · roles: ${e.personas.join(', ')} · anchor: \`${e.anchor}\`${e.walk ? ' · has a walk' : ''}`,
    '',
    `**What it's for.** ${e.what}`,
    '',
    `**Where it is.** ${e.where}`,
    '',
    ...e.how.map((h, i) => `${i + 1}. ${h}`),
    '',
    ...(e.note ? [`**Worth knowing.** ${e.note}`, ''] : []),
  ]),
].join('\n')
writeFileSync(join(ROOT, 'docs/handbook-pack.md'), handbookMd)

console.log(`[walkthrough] pack ${versioned.version} written — ${pack.walks.length} walks · ${pack.handbook.length} handbook entries`)
console.log('  → packages/player-vue/src/walkthrough/pack.json')
console.log('  → docs/walkthrough-pack.md')
console.log('  → docs/handbook-pack.md')
