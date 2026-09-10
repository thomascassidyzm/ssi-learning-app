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
 *   node tools/walkthrough/compile.mjs --check   # gate: source vs the SERVED pack, no writes
 *   node tools/walkthrough/compile.mjs --build   # always writes, never fails on prose
 *   node tools/walkthrough/compile.mjs --reconfirm ["<anchor>" [--unchanged]]
 *   node tools/walkthrough/compile.mjs --reconfirm-walks ["<walk-id>:<anchor>[#step]" [--unchanged]]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGates, assemblePack, comparePack, indexAnchors } from './lib.mjs'
import {
  parseHandbookBlocks, fingerprintCapability, stampChecked, proseFingerprint,
  checkedCode, checkedProse, anchorFingerprint, stepProseFingerprint,
} from './handbookSource.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CHECK_ONLY = process.argv.includes('--check')
// --build is the mode the Vercel build runs in: it ALWAYS writes the pack, and
// it never fails on prose. That inversion is the point (job #289). The pack is
// generated from source at build time, so the page can no longer serve a stale
// artefact at all — the whole staleness class is gone rather than gated. What
// prose gates remain are advisory here and hard in --check, because a sentence
// somebody forgot to rewrite must never be what stops a fix reaching learners
// on a Monday morning.
const BUILD = process.argv.includes('--build')
// --reconfirm is the REPAIR TOOL for the freshness gate. A gate with no
// one-step repair gets routed around, so this is one command: re-read the
// sentence against the code, then stamp it. With an anchor id it re-pins one
// capability; bare, it re-pins every one of them.
const RECONFIRM = process.argv.includes('--reconfirm')
const RECONFIRM_ONLY = process.argv[process.argv.indexOf('--reconfirm') + 1]?.startsWith('-') === false
  ? process.argv[process.argv.indexOf('--reconfirm') + 1]
  : null
// --unchanged is the ONLY way to re-pin a capability whose sentence you did
// not touch, and it takes one anchor at a time. Before job #289 a bare
// --reconfirm stamped every stale capability in the tree in one keystroke,
// with no sentence anywhere required to change: a gate with a silent bulk
// mute is not a gate. Now the stamp records the prose it was made against, so
// the tool can tell "I rewrote it" from "I read it and it still holds" — and
// the second one has to be said out loud, per capability.
const UNCHANGED = process.argv.includes('--unchanged')
// --reconfirm-walks is the same repair tool for the CLIPS. A walk step is a
// sentence about a button too; it just lives in walks/*.json rather than
// beside the code, so the stamp is a field on the step and the repair names
// the step: "<walk-id>:<anchor>", with "#2" on the end when one walk points at
// the same anchor twice.
const RECONFIRM_WALKS = process.argv.includes('--reconfirm-walks')
const RECONFIRM_WALKS_ONLY = process.argv[process.argv.indexOf('--reconfirm-walks') + 1]?.startsWith('-') === false
  ? process.argv[process.argv.indexOf('--reconfirm-walks') + 1]
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
  const refused = []
  for (const { path, entries: fileEntries } of parsed) {
    const stale = fileEntries
      .filter((e) => !RECONFIRM_ONLY || e.anchor === RECONFIRM_ONLY)
      // Stale code, or a one-part stamp from before the prose half existed —
      // the second is a free migration: the capability has not changed, so
      // recording the prose alongside it asks nobody to decide anything.
      .filter((e) => checkedCode(e.checked) !== fingerprintOf(e) || (e.checked && !checkedProse(e.checked)))
    // INTENT, PER CAPABILITY. A stale entry whose prose is byte-identical to
    // the prose the last stamp was made against is somebody silencing the
    // gate, not somebody repairing it — unless they name that one anchor and
    // say --unchanged, which is the assertion "I read it and it still holds".
    const targets = []
    for (const e of stale) {
      const untouched = checkedProse(e.checked) && checkedProse(e.checked) === proseFingerprint(e)
      if (untouched && !(RECONFIRM_ONLY === e.anchor && UNCHANGED)) refused.push(e)
      else targets.push(e)
    }
    if (!targets.length) continue
    let src = readFileSync(join(ROOT, path), 'utf8')
    // Back to front, so earlier offsets stay valid.
    for (const e of [...targets].sort((a, b) => b.blockStart - a.blockStart)) {
      src = stampChecked(src, e, `${fingerprintOf(e)}.${proseFingerprint(e)}`)
      console.log(`  ✓ re-pinned "${e.title}" — ${path}`)
      stamped += 1
    }
    writeFileSync(join(ROOT, path), src)
  }
  console.log(stamped
    ? `[walkthrough] ${stamped} description${stamped === 1 ? '' : 's'} re-pinned to the code they describe.`
    : '[walkthrough] nothing to re-pin — every description is already pinned to its current capability.')
  if (refused.length) {
    console.error(`\n[walkthrough] NOT RE-PINNED — ${refused.length} capabilit${refused.length === 1 ? 'y' : 'ies'} changed and ${refused.length === 1 ? 'its sentence' : 'their sentences'} did not:`)
    for (const e of refused) console.error(`  ✗ ${e.path}:${e.line} — "${e.title}"`)
    console.error(
      '\nRead each sentence against the code it now sits above, and either:\n' +
      '  - rewrite it, then run: node tools/walkthrough/compile.mjs --reconfirm\n' +
      '  - or, if it is still true as written, say so for that one capability:\n' +
      '      node tools/walkthrough/compile.mjs --reconfirm "<anchor-id>" --unchanged\n'
    )
  }
  // ONE COMMAND, NOT TWO. Re-pinning without recompiling leaves pack.json —
  // which IS what the Handbook page renders — holding the old sentence, so the
  // build goes green while the page still lies. Recompile in the same breath;
  // a repair that needs a second command someone has to remember is a repair
  // that will be half-done at 3am.
  const self = fileURLToPath(import.meta.url)
  const res = spawnSync(process.execPath, [self], { encoding: 'utf8', stdio: 'inherit' })
  process.exit(refused.length ? 1 : res.status ?? 1)
}

// A gate that fails without showing the shape of a good answer teaches nothing.
// This quotes a REAL entry — the shortest complete one in the tree — so the
// example can never drift from what the compiler actually accepts.
function exampleBlock() {
  const complete = entries.filter((e) => e.what && e.where && e.how.length && e.checked)
  if (!complete.length) return ''
  const e = complete.reduce((a, b) => (b.raw.length < a.raw.length ? b : a))
  // Dedent to the block's own left edge first — an example that arrives with
  // somebody else's indentation reads as a mess rather than as a template.
  const rawLines = e.raw.split('\n')
  const pad = Math.min(...rawLines.slice(1).filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length))
  const quoted = rawLines.map((l, i) => `     ${i === 0 ? l : l.slice(pad)}`).join('\n')
  return (
    `\nA GOOD ONE, quoted verbatim from ${e.path}:${e.line} — copy this shape:\n\n` +
    quoted + '\n\n' +
    `     …and the element it sits above carries data-walk="${e.anchor}".\n` +
    '     The checked: line is not yours to write — --reconfirm stamps it.\n'
  )
}

const walksDir = join(HERE, 'walks')
const walkFiles = readdirSync(walksDir).filter((f) => f.endsWith('.json')).sort()
const walks = walkFiles.map((f) => JSON.parse(readFileSync(join(walksDir, f), 'utf8')))
// Which file each walk came from, so a gate failure opens the file the reader
// has to edit rather than making them grep 18 of them for an id.
const walkFileOf = new Map(walkFiles.map((f, i) => [walks[i].id, `tools/walkthrough/walks/${f}`]))
const walkPathOf = (w) => walkFileOf.get(w.id) ?? `walk "${w.id}"`

// Every anchored element, in every namespace, indexed once — this is what the
// walk-step stamp is taken against, and it is the same scan the anchor gate uses.
const anchorSites = indexAnchors(vueFiles)
const fingerprintOfAnchor = (id) => anchorFingerprint(anchorSites.get(id))

if (RECONFIRM_WALKS) {
  // "<walk-id>:<anchor>" selects a step; "#2" on the end picks one when a walk
  // points at the same anchor twice. A bare --reconfirm-walks re-stamps every
  // step whose words changed — and, exactly as for the Handbook, no step whose
  // words did NOT change, because that is silencing rather than repairing.
  const [selWalk, selRest] = (RECONFIRM_WALKS_ONLY ?? '').split(':')
  const [selAnchor, selStep] = (selRest ?? '').split('#')
  const selects = (walk, step, i) => !RECONFIRM_WALKS_ONLY || (
    walk.id === selWalk
    && (!selAnchor || step.anchor === selAnchor)
    && (!selStep || String(i + 1) === selStep)
  )

  let stamped = 0
  const refused = []
  for (const [i, walk] of walks.entries()) {
    const file = walkFiles[i]
    let touched = false
    for (const [j, step] of (walk.steps ?? []).entries()) {
      if (!selects(walk, step, j)) continue
      const now = fingerprintOfAnchor(step.anchor)
      // A missing anchor is gateAnchors' hard failure, not something to stamp over.
      if (!now) continue
      const fresh = checkedCode(step.checked) === now && checkedProse(step.checked)
      if (fresh) continue
      const untouched = checkedProse(step.checked) && checkedProse(step.checked) === stepProseFingerprint(step)
      const named = RECONFIRM_WALKS_ONLY && selWalk === walk.id && selAnchor === step.anchor
      if (untouched && !(named && UNCHANGED)) {
        refused.push({ walk, step, n: j + 1, file })
        continue
      }
      step.checked = `${now}.${stepProseFingerprint(step)}`
      console.log(`  ✓ re-pinned "${walk.id}" step ${j + 1} — ${step.anchor}`)
      stamped += 1
      touched = true
    }
    if (touched) writeFileSync(join(walksDir, file), JSON.stringify(walk, null, 2) + '\n')
  }
  console.log(stamped
    ? `[walkthrough] ${stamped} walk step${stamped === 1 ? '' : 's'} re-pinned to what ${stamped === 1 ? 'it points' : 'they point'} at.`
    : '[walkthrough] nothing to re-pin — every walk step is already pinned to its current capability.')
  if (refused.length) {
    console.error(`\n[walkthrough] NOT RE-PINNED — ${refused.length} step${refused.length === 1 ? '' : 's'} point at something that changed, and ${refused.length === 1 ? 'its wording' : 'their wording'} did not:`)
    for (const r of refused) console.error(`  ✗ ${r.file} — walk "${r.walk.id}" step ${r.n}, anchor "${r.step.anchor}"`)
    console.error(
      '\nRead each step against the code it now points at, and either:\n' +
      '  - rewrite what it says, then run: node tools/walkthrough/compile.mjs --reconfirm-walks\n' +
      '  - or, if it is still true as written, say so for that one step:\n' +
      '      node tools/walkthrough/compile.mjs --reconfirm-walks "<walk-id>:<anchor>" --unchanged\n'
    )
  }
  // ONE COMMAND, NOT TWO — the same reason as --reconfirm: re-pinning without
  // recompiling leaves pack.json holding the old clip.
  const self = fileURLToPath(import.meta.url)
  const res = spawnSync(process.execPath, [self], { encoding: 'utf8', stdio: 'inherit' })
  process.exit(refused.length ? 1 : res.status ?? 1)
}

const { failures, warnings } = runGates({
  walks,
  entries,
  fingerprintOf,
  walkPathOf,
  vueFiles,
  runtimeSrc: readFileSync(join(ROOT, 'packages/player-vue/src/walkthrough/useWalkthrough.ts'), 'utf8'),
  rulesJson: JSON.parse(readFileSync(join(ROOT, 'tools/explainer/rules.json'), 'utf8')),
  evaluateRulesSrc: readFileSync(join(ROOT, 'packages/player-vue/src/explainer/evaluateRules.ts'), 'utf8'),
  handbookSrc: readFileSync(join(ROOT, 'packages/player-vue/src/walkthrough/handbook.ts'), 'utf8'),
})

for (const w of warnings) console.log(`  ⚠ ${w}`)
failures.unshift(...parseErrors)
if (failures.length && BUILD) {
  console.error(`\n[walkthrough] HANDBOOK NOT VERIFIED — ${failures.length} gate failure${failures.length === 1 ? '' : 's'}, building anyway:`)
  for (const f of failures) console.error(`  ⚠ ${f}`)
  console.error('  These are advisory during a build. Run `node tools/walkthrough/compile.mjs --check` to see them fail properly.\n')
  failures.length = 0
}
if (failures.length) {
  console.error('\n[walkthrough] COMPILE FAILED — a walk would lie about the product:')
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error(
    '\nHOW TO FIX THIS, if you have never seen this gate before:\n' +
    '  1. Open the file:line named above. The description of a capability lives in an\n' +
    '     HTML comment directly above the element that IS the capability.\n' +
    '  2. Write it, or rewrite it so it tells the truth about what the code now does.\n' +
    '     British English, mechanism only, no parentheses.\n' +
    '  3. Run ONE command — it re-pins the sentence to the code and recompiles the pack:\n' +
    '       node tools/walkthrough/compile.mjs --reconfirm\n' +
    '     Add an anchor id to re-pin just one: --reconfirm "your-anchor-id"\n' +
    '  4. A STALE WALK STEP is the same thing in a clip: the words live in\n' +
    '     tools/walkthrough/walks/<walk>.json, on the step named above. Rewrite what\n' +
    '     the step says so it tells the truth about what that element now does, then:\n' +
    '       node tools/walkthrough/compile.mjs --reconfirm-walks\n' +
    '     Just one step: --reconfirm-walks "<walk-id>:<anchor>"\n' +
    exampleBlock()
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

const PACK_PATH = join(ROOT, 'packages/player-vue/src/walkthrough/pack.json')

if (CHECK_ONLY) {
  // COMPARE WHAT IS SERVED. Compiling a hypothetical pack and announcing its
  // size proves nothing about the file the page imports — that was the hollow
  // middle of this gate until job #289.
  let served = null
  try { served = JSON.parse(readFileSync(PACK_PATH, 'utf8')) } catch { served = null }
  const drift = comparePack(pack, served)
  if (drift.length) {
    console.error('\n[walkthrough] CHECK FAILED — the Handbook page is serving something the source does not say:')
    for (const d of drift) console.error(`  ✗ ${d}`)
    console.error(
      '\nThe page imports packages/player-vue/src/walkthrough/pack.json. Regenerate and commit it:\n' +
      '    node tools/walkthrough/compile.mjs\n'
    )
    process.exit(1)
  }
  console.log(`[walkthrough] check OK — served pack ${served.version} matches the source (${pack.walks.length} walks · ${pack.walks.reduce((n, w) => n + w.steps.length, 0)} steps · ${pack.handbook.length} handbook entries)`)
  process.exit(0)
}

writeFileSync(PACK_PATH, JSON.stringify(versioned, null, 2) + '\n')

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
  `**Version \`${versioned.version}\` · generated ${versioned.generatedAt} by \`tools/walkthrough/compile.mjs\`. DO NOT EDIT — each description lives in a HANDBOOK comment directly above the element it describes, in the .vue file named under its title. Edit it there, in the same change that alters the capability, then recompile.**`,
  '',
  ...versioned.handbook.flatMap((e) => [
    `## ${e.title}`,
    '',
    `Section: ${e.section} · roles: ${e.personas.join(', ')} · anchor: \`${e.anchor}\` · in \`${e.source}\`${e.walk ? ' · has a walk' : ''}`,
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
