#!/usr/bin/env node
/**
 * split-merge-restore-2026-09-05.cjs — second pass of job #651's fleet restore, for the one
 * residue class pod-carry-restore.cjs deliberately held out: recorded `:sN` split-unit
 * positions whose sentence exists in today's canon with identical text but NO split array
 * (the splits were removed by later canon work). Restoring the `:sN` key would orphan it;
 * the migration protocol's own rule for splits converging on one slot is MERGE with
 * Math.max of exposures (pod-state-migrate.cjs line ~213). So: upsert the WHOLE-TURN key
 * with greatest(existing, max over the recorded split exposures). 5 writes, 3 learners.
 *
 * Rows verified before writing: text matched against today's canon by pod-carry-restore.cjs
 * (a row only classifies split_shape_changed after its target sentence resolved by content).
 */
const path = require('path')
const fs = require('fs')
const DASH = '/home/tomcassidy/ssi-dashboard-v7-clean'
require(path.join(DASH, 'node_modules', 'dotenv')).config({ path: path.join(DASH, '.env.psql'), quiet: true })
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))

// max over the recorded split exposures per (learner, whole-turn target), from the
// 08-22 prospective logs (see the split_shape_changed lines in the dry-run outputs)
const MERGES = [
  { learner_id: '1f9a123c-55b5-4a81-8ebd-bb0430b307d4', course_code: 'fra_for_eng', target: 'fra_for_eng:pod-1:SC04-S003', exposures: 60 },
  { learner_id: '1f9a123c-55b5-4a81-8ebd-bb0430b307d4', course_code: 'fra_for_eng', target: 'fra_for_eng:pod-1:SC06-S012', exposures: 22 },
  { learner_id: '1f9a123c-55b5-4a81-8ebd-bb0430b307d4', course_code: 'fra_for_eng', target: 'fra_for_eng:pod-1:SC07-S005', exposures: 9 },
  { learner_id: 'a826c529-ac97-4bc9-8885-9b877fa4280a', course_code: 'fra_for_eng', target: 'fra_for_eng:pod-1:SC04-S003', exposures: 19 },
  { learner_id: '30d8027d-7921-4c50-84f3-fea58002e262', course_code: 'zho_for_eng', target: 'zho_for_eng:pod-1:SC02-S002', exposures: 3 },
]

async function main() {
  const APPLY = process.argv.includes('--apply')
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  const applied = []
  for (const m of MERGES) {
    const { rows: [s] } = await db.query('select id from listening_pod_sentences where id=$1', [m.target])
    if (!s) throw new Error(`target ${m.target} not in canon — refusing`)
    const { rows: [before] } = await db.query(
      'select exposures from learner_pod_state where learner_id=$1 and course_code=$2 and sentence_id=$3',
      [m.learner_id, m.course_code, m.target])
    console.log(`${APPLY ? 'apply' : 'DRY'}: ${m.learner_id.slice(0, 8)} ${m.target} ${before ? before.exposures : '∅'} -> greatest(existing, ${m.exposures})`)
    if (!APPLY) continue
    await db.query(
      `insert into learner_pod_state (learner_id, course_code, sentence_id, exposures)
       values ($1,$2,$3,$4)
       on conflict (learner_id, course_code, sentence_id)
       do update set exposures = greatest(learner_pod_state.exposures, excluded.exposures)`,
      [m.learner_id, m.course_code, m.target, m.exposures])
    const { rows: [after] } = await db.query(
      'select exposures from learner_pod_state where learner_id=$1 and course_code=$2 and sentence_id=$3',
      [m.learner_id, m.course_code, m.target])
    applied.push({ ...m, exposures_before: before ? before.exposures : null, exposures_after: after.exposures })
  }
  if (APPLY) {
    const logPath = path.join(__dirname, '..', '..', 'docs', 'pod-position-audit', 'split-merge-restore-2026-09-05-applied-log.json')
    fs.writeFileSync(logPath, JSON.stringify({ applied_at: new Date().toISOString(), applied }, null, 2))
    console.log(`applied log: ${logPath}`)
  }
  await db.end()
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
