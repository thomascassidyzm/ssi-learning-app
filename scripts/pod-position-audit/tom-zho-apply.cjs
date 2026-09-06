#!/usr/bin/env node
/**
 * tom-zho-apply.cjs — job #706's ONE write.
 *
 * THE RAIL, DELIBERATELY BYPASSED. pod-ratchet-restore.cjs writes through
 * greatest() so it can only ever RAISE a counter, because taking listening
 * away from a learner who did it is the worst thing this family of scripts
 * could do. This one LOWERS, and it is authorised exactly once:
 *
 *   Tom, 2026-09-06 — "Shall I correct your Chinese counter to what you
 *   actually earned?" → "1 - yes".
 *
 * That ruling covers learner 81987d60 (tom.cassidy, thomas.cassidy+ssi@gmail
 * .com) on course zho_for_eng and NOTHING ELSE. Both are hardcoded here; there
 * is no --learner, no --course and no --fleet, on purpose. Every other learner
 * in the #704 census has more real laps than counter — genuinely earned.
 *
 * Only `completed_pod_rounds` is in the SET list. Not pod_activation_round,
 * not rounds_since_pod (#649's work-debt counter), not the main-flow cursor,
 * not learner_pod_state.
 *
 * Idempotent: no-ops when the row already holds the derived value or less.
 * Dry-run by default; --apply to write. The per-row applied log IS the
 * rollback.
 *
 * Usage: node scripts/pod-position-audit/tom-zho-apply.cjs [--apply]
 */
const path = require('path')
const fs = require('fs')
const DASH = '/home/tomcassidy/ssi-dashboard-v7-clean'
require(path.join(DASH, 'node_modules', 'dotenv')).config({ path: path.join(DASH, '.env.psql'), quiet: true })
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))
const { derive, LEARNER, COURSE } = require('./tom-zho-target.cjs')

const REPO = path.resolve(__dirname, '..', '..')
const APPLY = process.argv.includes('--apply')
const LOG = path.join(REPO, 'docs/pod-position-audit/pod-ratchet-correction-applied-log.json')

const SELECT = `select learner_id, course_id, completed_pod_rounds, pod_activation_round,
       rounds_since_pod, updated_at, highest_completed_seed, highest_completed_lego_id, current_mode
  from course_enrollments where learner_id = $1 and course_id = $2`

;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const before = (await c.query(SELECT, [LEARNER, COURSE])).rows[0]
  if (!before) throw new Error('no enrollment row')
  const d = await derive(c)

  const record = {
    job: 706,
    ruling: 'Tom, 2026-09-06: "Shall I correct your Chinese counter to what you actually earned?" — "1 - yes". One account, one course.',
    root_cause:
      '#657 derived laps as max(podRound) over every pod_lap_end, and a Layer-1 seed cup emits that event with podRound = the MAIN ROUND. A cup at main round 459 became 459 laps and wrote 460 to a row that was 0. Fixed in podLapTelemetry.ts, pinned by podLapTelemetry.test.ts.',
    generated_at: new Date().toISOString(),
    learner_id: LEARNER,
    display_name: 'Tom',
    course_id: COURSE,
    before: {
      completed_pod_rounds: before.completed_pod_rounds,
      pod_activation_round: before.pod_activation_round,
      rounds_since_pod: before.rounds_since_pod,
      updated_at: before.updated_at,
      highest_completed_seed: before.highest_completed_seed,
      highest_completed_lego_id: before.highest_completed_lego_id,
      current_mode: before.current_mode,
    },
    derivation: d,
    target_completed_pod_rounds: d.target,
    lowering: true,
    applied: false,
  }

  if (!APPLY) {
    console.log('DRY RUN — no write')
    console.log(JSON.stringify(record, null, 2))
    await c.end()
    return
  }
  if (before.completed_pod_rounds <= d.target) {
    record.no_op = true
    console.log('NO-OP — row already at or below the derived value:', before.completed_pod_rounds, '<=', d.target)
    await c.end()
    return
  }

  const after = (await c.query(
    `update course_enrollments set completed_pod_rounds = $3::int, updated_at = now()
      where learner_id = $1 and course_id = $2
      returning completed_pod_rounds, pod_activation_round, rounds_since_pod, updated_at`,
    [LEARNER, COURSE, d.target],
  )).rows[0]
  record.applied = true
  record.after = {
    completed_pod_rounds: after.completed_pod_rounds,
    pod_activation_round: after.pod_activation_round,
    rounds_since_pod: after.rounds_since_pod,
    updated_at: after.updated_at,
  }
  // RETURNING is not the verification — read the live row again, independently.
  const reread = (await c.query(SELECT, [LEARNER, COURSE])).rows[0]
  record.reread = {
    completed_pod_rounds: reread.completed_pod_rounds,
    pod_activation_round: reread.pod_activation_round,
    rounds_since_pod: reread.rounds_since_pod,
    highest_completed_seed: reread.highest_completed_seed,
    highest_completed_lego_id: reread.highest_completed_lego_id,
    current_mode: reread.current_mode,
  }
  record.reread_matches_target = reread.completed_pod_rounds === d.target
  record.everything_else_untouched =
    reread.pod_activation_round === before.pod_activation_round &&
    reread.highest_completed_seed === before.highest_completed_seed &&
    reread.highest_completed_lego_id === before.highest_completed_lego_id &&
    reread.current_mode === before.current_mode

  const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : []
  log.push(record)
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n')
  console.log(JSON.stringify(record, null, 2))
  console.log('applied log →', LOG)
  await c.end()
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
