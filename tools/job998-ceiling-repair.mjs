/**
 * Job #998 — the three single-row ceiling repairs the job #644 diagnosis names
 * (/d/a61a3891, "How many carry the mark"): three enrollments whose
 * highest_completed_* ceiling was ratcheted to the course's final LEGO by the
 * deleted PriorityRoundLoader's sparse queue, with zero belt skips.
 *
 * The ceiling cannot be lowered by an ordinary UPDATE: the
 * course_enrollments_ratchet_highest_round trigger honours only an explicit
 * reset to NULL, then re-lifts from the cursor. So each row is repaired in one
 * transaction: NULL the two ceiling columns, then re-touch the cursor so the
 * trigger lifts the ceiling back to exactly where the learner actually is.
 *
 * DRY_RUN=1 (default) rolls back instead of committing.
 */
import fs from 'node:fs'
import pg from '/home/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg/lib/index.js'
const DRY = process.env.DRY_RUN !== '0'
const url = fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql','utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()

const ROWS = [
  { who:'nba4191',       course:'lit_for_eng', cursorLego:'S0029L01', cursorRound:85 },
  { who:'knightghost1',  course:'hrv_for_eng', cursorLego:'S0006L02', cursorRound:16 },
  { who:'silverjfangio', course:'hye_for_eng', cursorLego:'S0026L01', cursorRound:68 },
]
const log = []
await c.query('BEGIN')
try {
  for (const r of ROWS) {
    const { rows } = await c.query(
      `SELECT e.id, e.learner_id, e.last_completed_lego_id, e.last_completed_round_index,
              e.highest_completed_lego_id, e.highest_completed_round_index
         FROM course_enrollments e JOIN learners l ON l.id = e.learner_id
        WHERE lower(l.display_name) = lower($1) AND e.course_id = $2`, [r.who, r.course])
    if (rows.length !== 1) throw new Error(`${r.who}/${r.course}: expected 1 row, got ${rows.length}`)
    const cur = rows[0]
    if (cur.last_completed_lego_id !== r.cursorLego || cur.last_completed_round_index !== r.cursorRound)
      throw new Error(`${r.who}: cursor drifted — ${cur.last_completed_lego_id}/${cur.last_completed_round_index}`)
    if (cur.highest_completed_lego_id !== 'S0300L02')
      throw new Error(`${r.who}: ceiling is not the defect's ${'S0300L02'} — ${cur.highest_completed_lego_id}`)
    await c.query(`UPDATE course_enrollments SET highest_completed_lego_id = NULL, highest_completed_round_index = NULL WHERE id = $1`, [cur.id])
    // With the ceiling NULL, prev_high is NULL and the trigger lifts it to the
    // cursor — but only if NEW.highest_* is non-null, otherwise it reads the
    // write as another explicit reset. So name the cursor values here; the
    // trigger writes exactly them.
    await c.query(`UPDATE course_enrollments SET highest_completed_lego_id = $2, highest_completed_round_index = $3 WHERE id = $1`, [cur.id, cur.last_completed_lego_id, cur.last_completed_round_index])
    const { rows:[after] } = await c.query(`SELECT highest_completed_lego_id, highest_completed_round_index, last_completed_lego_id, last_completed_round_index FROM course_enrollments WHERE id = $1`, [cur.id])
    if (after.highest_completed_lego_id !== r.cursorLego || after.highest_completed_round_index !== r.cursorRound)
      throw new Error(`${r.who}: repair did not land — ${JSON.stringify(after)}`)
    console.log(`${DRY?'[dry-run] ':''}${r.who} ${r.course}: ceiling ${cur.highest_completed_lego_id}/${cur.highest_completed_round_index} -> ${after.highest_completed_lego_id}/${after.highest_completed_round_index}`)
    log.push({ enrollment_id:cur.id, learner_id:cur.learner_id, who:r.who, course:r.course,
      before:{ highest_completed_lego_id:cur.highest_completed_lego_id, highest_completed_round_index:cur.highest_completed_round_index },
      after:{ highest_completed_lego_id:after.highest_completed_lego_id, highest_completed_round_index:after.highest_completed_round_index },
      cursor:{ last_completed_lego_id:after.last_completed_lego_id, last_completed_round_index:after.last_completed_round_index },
      applied:!DRY, at:new Date().toISOString() })
  }
  await c.query(DRY ? 'ROLLBACK' : 'COMMIT')
  console.log(DRY ? 'rolled back (dry run)' : 'committed')
} catch (e) {
  await c.query('ROLLBACK'); console.error('ABORTED, rolled back:', e.message); process.exitCode = 1
}
await c.end()
fs.writeFileSync(DRY ? 'tools/job998-ceiling-repair-dryrun-log.json' : 'tools/job998-ceiling-repair-applied-log.json', JSON.stringify(log, null, 2) + '\n')
