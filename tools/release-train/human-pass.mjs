#!/usr/bin/env node
/**
 * human-pass.mjs — the human test pass that a staging→main promotion must have.
 *
 * FOUNDER RULING (2026-09-10, "10 — gate it"): one human pass on a fixed sheet
 * is a REQUIRED GATE before any staging→main promotion, not advice. This file
 * is the decision; tools/release-train/promote.sh is the limb that obeys it.
 *
 *   node tools/release-train/human-pass.mjs check              # would the ship be allowed?
 *   node tools/release-train/human-pass.mjs check --accept-drift "why"
 *
 * THE ASYMMETRY, and it is the whole design. Every status fails towards STILL
 * OPEN. A step with no answer is `not checked`, never `pass`. A `fail` blocks. A
 * `not checked` blocks. A missing run blocks. Only a full sheet of `pass` on
 * BOTH runs — web and Android — releases the gate. Silence is never consent.
 *
 * THERE IS NO ENVIRONMENT-VARIABLE ESCAPE HATCH, deliberately. An emergency
 * already has its own lane: CLAUDE.md's hotfix lane goes straight to main on a
 * hotfix/ branch and never touches promote.sh at all. A bypass flag on the
 * ordinary path becomes the ordinary path inside a month.
 *
 * DRIFT. Staging keeps moving after a pass is taken. The recorded sha must be
 * the current origin/staging tip, or an ancestor of it. An ancestor still
 * refuses, naming every commit that has landed since the pass — releasable only
 * by `--accept-drift "<reason>"`, which WRITES the reason into the pass file. So
 * accepting drift is a deliberate, written act and not a shrug.
 *
 * Passes are recorded by tools/release-train/record-pass.mjs and committed, so
 * the record of why a ship was allowed survives a fresh clone.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PASSES_DIR = join(HERE, 'passes')

/** The fixed sheet. Changing this list changes what a pass MEANS — say so in the
 *  commit, and expect every pass recorded against the old sheet to stop counting. */
export const SHEET = 'colombo-pass-v1'
export const SHEET_STEPS = Object.freeze([
  'first-belt-change',
  'subscription-wall-and-maybe-later',
  'past-the-wall-pause-and-resume',
  'settings-page',
  'background-five-minutes',
  'wifi-off-mid-round',
])
export const RUNS = Object.freeze(['web', 'android'])
export const VERDICTS = Object.freeze(['pass', 'fail', 'not checked'])

/** A blank pass, every step failing towards still-open. What record-pass starts from. */
export function blankPass(sha, extra = {}) {
  const runs = {}
  for (const run of RUNS) {
    runs[run] = Object.fromEntries(SHEET_STEPS.map((s) => [s, 'not checked']))
  }
  return {
    sha,
    sheet: SHEET,
    tester: null,
    recorded_by: null,
    date: null,
    environment: 'https://staging.saysomethingin.app',
    runs,
    notes: '',
    drift_accepted: null,
    ...extra,
  }
}

/**
 * THE DECISION, pure. No git, no filesystem — so it is testable without either.
 *
 * @param passes      every recorded pass, already loaded
 * @param stagingSha  the sha this promotion would ship
 * @param isAncestor  (sha) => boolean, is sha an ancestor of stagingSha
 * @param acceptDrift a written reason, or null
 * @returns { ok, reasons[], pass, drift }
 */
export function evaluatePass({ passes, stagingSha, isAncestor, acceptDrift = null }) {
  const reasons = []

  const exact = passes.find((p) => p.sha === stagingSha)
  const ancestors = passes.filter((p) => p.sha !== stagingSha && isAncestor(p.sha))
  const pass = exact || ancestors[ancestors.length - 1] || null

  if (!pass) {
    reasons.push(
      'NO HUMAN PASS IS RECORDED against this staging commit or any of its ancestors.'
    )
    return { ok: false, reasons, pass: null, drift: false }
  }

  if (pass.sheet !== SHEET) {
    reasons.push(
      `the pass was taken against sheet "${pass.sheet}", and the sheet is now "${SHEET}" — ` +
      'the steps changed, so the pass no longer says what it needs to say.'
    )
  }

  // The asymmetry. Anything that is not the word "pass" blocks, including absence.
  for (const run of RUNS) {
    const answers = pass.runs?.[run]
    if (!answers) {
      reasons.push(`the ${run} run is missing entirely — a run with no answers is not a pass.`)
      continue
    }
    for (const step of SHEET_STEPS) {
      const verdict = answers[step]
      if (verdict === 'pass') continue
      reasons.push(
        `${run} · ${step}: ${verdict === undefined ? 'no answer recorded' : verdict}`
      )
    }
  }

  const drift = pass.sha !== stagingSha
  if (drift) {
    if (acceptDrift) {
      pass.drift_accepted = {
        staging_sha: stagingSha,
        reason: acceptDrift,
        accepted_at: new Date().toISOString(),
      }
    } else {
      reasons.push(
        `the pass was taken against ${pass.sha.slice(0, 7)}, and staging has moved on to ` +
        `${stagingSha.slice(0, 7)} since. Commits landed after the pass were never tested by a human.`
      )
    }
  }

  return { ok: reasons.length === 0, reasons, pass, drift }
}

// ------------------------------------------------------------------- loading

export function loadPasses(dir = PASSES_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8'))
      } catch (e) {
        throw new Error(`unreadable pass file ${f}: ${e.message}`)
      }
    })
    .filter((p) => p && typeof p.sha === 'string')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

export function passPath(sha, dir = PASSES_DIR) {
  return join(dir, `${sha.slice(0, 7)}.json`)
}

// ----------------------------------------------------------------------- CLI

function main() {
  const argv = process.argv.slice(2)
  if (argv[0] !== 'check') {
    console.error('usage: human-pass.mjs check [--staging <sha>] [--accept-drift "<reason>"]')
    process.exit(2)
  }
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? null : argv[i + 1] ?? null
  }
  const git = (...args) => execFileSync('git', args, { cwd: join(HERE, '../..'), encoding: 'utf8' }).trim()

  const stagingSha = flag('staging') || git('rev-parse', 'origin/staging')
  const acceptDrift = flag('accept-drift')
  const isAncestor = (sha) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, stagingSha], { cwd: join(HERE, '../..') })
      return true
    } catch { return false }
  }

  const passes = loadPasses()
  const { ok, reasons, pass, drift } = evaluatePass({ passes, stagingSha, isAncestor, acceptDrift })

  if (ok) {
    console.log(
      `Human pass: ${pass.tester || 'unnamed tester'}, ${pass.date || 'undated'}, ` +
      `on ${pass.environment}, against ${pass.sha.slice(0, 7)}` +
      (drift ? ' — DRIFT ACCEPTED IN WRITING' : '') + '.'
    )
    if (drift && pass.drift_accepted) {
      writeFileSync(passPath(pass.sha), JSON.stringify(pass, null, 2) + '\n')
      console.log(`Drift reason written into ${passPath(pass.sha)} — commit it with the ship.`)
      console.log(`  reason: ${pass.drift_accepted.reason}`)
    }
    process.exit(0)
  }

  console.error('REFUSING: the human test pass gate is not satisfied.')
  for (const r of reasons) console.error(`  - ${r}`)
  if (drift && !acceptDrift) {
    console.error('\nCommits landed since the pass was taken:')
    try {
      console.error(git('log', '--oneline', '--no-merges', `${pass.sha}..${stagingSha}`))
    } catch { /* a sha we cannot resolve; the reason above already says enough */ }
    console.error('\nEither take a fresh pass, or accept the drift in writing:')
    console.error('  ./tools/release-train/promote.sh --go --accept-drift "why this is safe"')
  } else if (!pass) {
    console.error('\nRecord one once Dulmini has worked the sheet:')
    console.error('  node tools/release-train/record-pass.mjs --sha <staging sha> --tester "Dulmini" ...')
  }
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
