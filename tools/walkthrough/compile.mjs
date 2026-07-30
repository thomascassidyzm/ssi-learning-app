#!/usr/bin/env node
/**
 * Walkthrough compiler CLI (docs/walkthrough-engine-scout.md §3).
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

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CHECK_ONLY = process.argv.includes('--check')

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

const walksDir = join(HERE, 'walks')
const walkFiles = readdirSync(walksDir).filter((f) => f.endsWith('.json')).sort()
const walks = walkFiles.map((f) => JSON.parse(readFileSync(join(walksDir, f), 'utf8')))

const { failures, warnings } = runGates({
  walks,
  vueFiles: vueFilesUnder(join(ROOT, 'packages/player-vue/src')),
  runtimeSrc: readFileSync(join(ROOT, 'packages/player-vue/src/walkthrough/useWalkthrough.ts'), 'utf8'),
  rulesJson: JSON.parse(readFileSync(join(ROOT, 'tools/explainer/rules.json'), 'utf8')),
  evaluateRulesSrc: readFileSync(join(ROOT, 'packages/player-vue/src/explainer/evaluateRules.ts'), 'utf8'),
})

for (const w of warnings) console.log(`  ⚠ ${w}`)
if (failures.length) {
  console.error('\n[walkthrough] COMPILE FAILED — a walk would lie about the product:')
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('\nFix the anchor/persona/place, or re-author the walk, then re-run.')
  process.exit(1)
}

const pack = assemblePack(walks)
const content = JSON.stringify(pack)
const versioned = {
  version: createHash('sha256').update(content).digest('hex').slice(0, 12),
  generatedAt: new Date().toISOString().slice(0, 10),
  ...pack,
}

if (CHECK_ONLY) {
  console.log(`[walkthrough] check OK — pack version would be ${versioned.version} (${walks.length} walks · ${walks.reduce((n, w) => n + w.steps.length, 0)} steps)`)
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

console.log(`[walkthrough] pack ${versioned.version} written — ${walks.length} walks`)
console.log('  → packages/player-vue/src/walkthrough/pack.json')
console.log('  → docs/walkthrough-pack.md')
