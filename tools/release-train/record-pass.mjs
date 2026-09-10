#!/usr/bin/env node
/**
 * record-pass.mjs — write down a human test pass, from somebody else's words.
 *
 * Dulmini works the sheet in Colombo and sends her answers back over WhatsApp,
 * through Imdad, to Tom. Whoever holds that message types it in here. It writes
 * the file. IT DOES NOT INVENT VERDICTS: anything not answered stays
 * `not checked`, and `not checked` blocks the ship exactly as `fail` does.
 *
 *   # start a blank sheet for the commit that will ship
 *   node tools/release-train/record-pass.mjs --sha $(git rev-parse origin/staging) \
 *        --tester "Dulmini" --recorded-by "Watson"
 *
 *   # then fill answers in, one run at a time, as they arrive
 *   node tools/release-train/record-pass.mjs --sha <sha> --run web \
 *        --step first-belt-change pass --step settings-page fail \
 *        --note "belt change showed nothing on the phone"
 *
 *   # or, when the whole run passed and she has said so plainly
 *   node tools/release-train/record-pass.mjs --sha <sha> --run android --all pass
 *
 *   node tools/release-train/record-pass.mjs --sha <sha> --show
 *
 * The file lands in tools/release-train/passes/<sha7>.json. COMMIT IT: it is the
 * record of why a ship was allowed, and it must survive a fresh clone.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  SHEET, SHEET_STEPS, RUNS, VERDICTS, blankPass, passPath,
} from './human-pass.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (argv[i + 1] ?? true)
}
const has = (name) => argv.includes(`--${name}`)

function die(msg) {
  console.error(`\n  ${msg}\n`)
  process.exit(1)
}

const sha = flag('sha')
if (!sha) {
  die('--sha <the staging commit that was tested> is required.\n' +
      '  git rev-parse origin/staging')
}

const file = passPath(sha)
mkdirSync(dirname(file), { recursive: true })
const pass = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : blankPass(sha)
pass.sha = sha
pass.sheet = SHEET

if (has('show')) {
  console.log(JSON.stringify(pass, null, 2))
  process.exit(0)
}

for (const [key, field] of [['tester', 'tester'], ['recorded-by', 'recorded_by'],
                            ['date', 'date'], ['environment', 'environment']]) {
  const v = flag(key)
  if (v) pass[field] = v
}
if (!pass.date) pass.date = new Date().toISOString().slice(0, 10)

const run = flag('run')
if (run) {
  if (!RUNS.includes(run)) die(`--run must be one of: ${RUNS.join(', ')}`)
  pass.runs[run] ||= Object.fromEntries(SHEET_STEPS.map((s) => [s, 'not checked']))

  const all = flag('all')
  if (all) {
    if (!VERDICTS.includes(all)) die(`--all must be one of: ${VERDICTS.map((v) => `"${v}"`).join(', ')}`)
    for (const s of SHEET_STEPS) pass.runs[run][s] = all
  }

  // --step <name> <verdict>, repeatable.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--step') continue
    const step = argv[i + 1]
    const verdict = argv[i + 2]
    if (!SHEET_STEPS.includes(step)) die(`unknown step "${step}" — one of:\n    ${SHEET_STEPS.join('\n    ')}`)
    if (!VERDICTS.includes(verdict)) die(`verdict for "${step}" must be one of: ${VERDICTS.map((v) => `"${v}"`).join(', ')}`)
    pass.runs[run][step] = verdict
  }
} else if (flag('all') || argv.includes('--step')) {
  die('--run web|android is required when recording answers.')
}

const note = flag('note')
if (note && note !== true) {
  pass.notes = pass.notes ? `${pass.notes}\n${note}` : String(note)
}

writeFileSync(file, JSON.stringify(pass, null, 2) + '\n')

const outstanding = []
for (const r of RUNS) {
  for (const s of SHEET_STEPS) {
    const v = pass.runs?.[r]?.[s]
    if (v !== 'pass') outstanding.push(`${r} · ${s}: ${v ?? 'no answer recorded'}`)
  }
}

console.log(`\nWritten: ${file}`)
console.log(`  tester ${pass.tester || '— not named —'}, recorded by ${pass.recorded_by || '— not named —'}, ${pass.date}`)
if (outstanding.length === 0) {
  console.log('  Every step passes on both runs. This pass RELEASES the gate.')
} else {
  console.log(`  Still open, so the gate still REFUSES — ${outstanding.length} of ${RUNS.length * SHEET_STEPS.length}:`)
  for (const o of outstanding) console.log(`    ${o}`)
}
console.log('\nCommit this file — it is the record of why the ship was allowed.\n')
