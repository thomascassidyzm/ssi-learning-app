#!/usr/bin/env node
/**
 * pod-carry-restore.cjs — diff a course's 08-22 pod-switchover prospective log against the
 * live `learner_pod_state` table, and (with --apply) restore destroyed carried positions.
 *
 * Context: job #651, executing R1/R2 of docs/pod-position-audit/stranded-pod-positions-2026-09-05.md
 * (job #648). The 2026-08-24 re-flip destroyed carried learner positions (proved row-by-row for
 * German: 14 of 17 carried rows deleted, all `:sN` split-unit keys). An orphan check CANNOT see
 * this harm — a deleted row leaves no key to fail resolution — so this tool diffs each course
 * against its own 08-22 prospective log (docs/pods/<code>-pod0-switchover-prospective-2026-08-22.json
 * in ssi-dashboard-v7-clean), which records every carried row: learner, key, exposures, heard text.
 *
 * Method, per carry action in the prospective log:
 *   1. Take the slot part of its `to` key (e.g. `SC01-S002:s0`), re-key onto the slug the course
 *      serves today (listening_pods where visibility='live').
 *   2. Verify the sentence exists in today's canon AND its known_text equals the recorded `heard`
 *      text. If the slot's text changed, content-match the heard text across today's canon
 *      (the migration protocol's own rule: progress follows CONTENT, not slot). Exactly one
 *      match → that is the target; zero → the sentence left the canon (a legitimate drop, not
 *      destruction); >1 → ambiguous, report only.
 *   3. For `:sN` split keys, verify N < today's split count (array_length(sentence_audio_ids)).
 *      A changed split shape is reported, never restored — a different split index would credit
 *      the learner with audio they never heard.
 *   4. Classify: present_ok (exposures >= recorded) / present_lower / MISSING / text_absent_today /
 *      ambiguous_text / split_shape_changed.
 *
 * --apply restores MISSING and present_lower rows via the estate's own upsert shape
 * (pod-switchover.cjs ~line 565): on conflict do update set exposures = greatest(existing, recorded)
 * — so no learner's maturity can ever go backwards. A per-row applied log is written as JSON
 * (the *-applied-log.json estate convention); the log is also the rollback: it names every
 * inserted key and its before-state.
 *
 * Dependencies are required from the ssi-dashboard-v7-clean checkout (pg, dotenv) — this repo's
 * worktrees never run pnpm install (standing estate rule), and the DB credentials live there
 * (.env.psql → DATABASE_URL).
 *
 * Usage:
 *   node scripts/pod-position-audit/pod-carry-restore.cjs --course=deu            # dry-run diff
 *   node scripts/pod-position-audit/pod-carry-restore.cjs --course=deu --apply    # restore + log
 *   node scripts/pod-position-audit/pod-carry-restore.cjs --prospective=/path.json --apply
 */

const fs = require('fs')
const path = require('path')

const DASH = '/home/tomcassidy/ssi-dashboard-v7-clean'
require(path.join(DASH, 'node_modules', 'dotenv')).config({ path: path.join(DASH, '.env.psql'), quiet: true })
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]
}))

const APPLY = !!args.apply
const PROSPECTIVE = args.prospective ||
  (args.course && path.join(DASH, 'docs', 'pods', `${args.course}-pod0-switchover-prospective-2026-08-22.json`))
if (!PROSPECTIVE) { console.error('need --course=<code> or --prospective=<path>'); process.exit(1) }

const norm = (t) => (t || '').replace(/\s+/g, ' ').trim()
const splitOf = (id) => { const m = /:s(\d+)$/.exec(id); return m ? Number(m[1]) : null }
const baseOf = (id) => id.replace(/:s\d+$/, '')
const slotOf = (id) => id.split(':').slice(2).join(':')   // <course>:<slug>:SCxx-Syyy[:sN] → SCxx-Syyy[:sN]

async function main() {
  const plan = JSON.parse(fs.readFileSync(PROSPECTIVE, 'utf8'))
  const COURSE = plan.course
  const carries = plan.actions.filter(a => a.action === 'carry')
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()

  // The player's shared slug resolver prefers pod-1 and falls back to pod-0; older themed
  // pods (e.g. spa_for_eng:music) can also be visibility=live but are never the served canon.
  const { rows: livePods } = await db.query(
    `select id from listening_pods where course_code=$1 and visibility='live'`, [COURSE])
  const preferred = livePods.find(p => p.id === `${COURSE}:pod-1`) ||
    livePods.find(p => p.id === `${COURSE}:pod-0`) ||
    (livePods.length === 1 ? livePods[0] : null)
  if (!preferred) {
    console.error(`${COURSE}: cannot resolve served pod among ${livePods.length} live pods — refusing`)
    await db.end(); process.exit(2)
  }
  const LIVE_POD = preferred.id
  const LIVE_SLUG = LIVE_POD.split(':')[1]

  const { rows: canon } = await db.query(
    `select id, known_text, coalesce(array_length(sentence_audio_ids,1),0) as splits
       from listening_pod_sentences where pod_id=$1 order by global_order`, [LIVE_POD])
  const canonById = new Map(canon.map(s => [s.id, s]))
  const canonByText = new Map()
  for (const s of canon) {
    const k = norm(s.known_text)
    canonByText.set(k, (canonByText.get(k) || []).concat(s))
  }

  const { rows: stateRows } = await db.query(
    `select learner_id, sentence_id, exposures, updated_at from learner_pod_state where course_code=$1`, [COURSE])
  const stateByKey = new Map(stateRows.map(r => [`${r.learner_id}|${r.sentence_id}`, r]))

  const results = []
  for (const a of carries) {
    const suffix = splitOf(a.to)
    const targetKeySameSlot = `${COURSE}:${LIVE_SLUG}:${slotOf(a.to)}`
    const heard = norm(a.heard)

    // resolve the target sentence in today's canon: same slot if text matches, else by content
    let target = null, note = null
    const slotSentence = canonById.get(baseOf(targetKeySameSlot))
    if (slotSentence && norm(slotSentence.known_text) === heard) {
      target = targetKeySameSlot
    } else {
      const matches = canonByText.get(heard) || []
      if (matches.length === 1) {
        target = matches[0].id + (suffix !== null ? `:s${suffix}` : '')
        note = `content-moved: ${slotOf(a.to)} -> ${slotOf(matches[0].id)}`
      } else if (matches.length === 0) {
        results.push({ ...row(a), status: 'text_absent_today' }); continue
      } else {
        results.push({ ...row(a), status: 'ambiguous_text', note: `${matches.length} candidates` }); continue
      }
    }
    if (suffix !== null) {
      const s = canonById.get(baseOf(target))
      if (suffix >= s.splits) {
        results.push({ ...row(a), target, status: 'split_shape_changed', note: `recorded :s${suffix}, today ${s.splits} splits` })
        continue
      }
    }
    const existing = stateByKey.get(`${a.learner_id}|${target}`)
    const status = !existing ? 'MISSING'
      : existing.exposures >= a.exposures ? 'present_ok' : 'present_lower'
    results.push({ ...row(a), target, status, note,
      existing_exposures: existing ? existing.exposures : null,
      existing_updated_at: existing ? existing.updated_at : null })
  }
  function row(a) {
    return { learner_id: a.learner_id, course_code: COURSE, recorded_key: a.to,
      recorded_exposures: a.exposures, heard: a.heard }
  }

  const tally = {}
  for (const r of results) tally[r.status] = (tally[r.status] || 0) + 1
  const destroyed = results.filter(r => r.status === 'MISSING')
  const lower = results.filter(r => r.status === 'present_lower')
  const learnersHit = new Set(destroyed.concat(lower).map(r => r.learner_id))

  console.log(`\n${COURSE} — live pod ${LIVE_POD} (${canon.length} sentences), ` +
    `prospective carries ${carries.length}, state rows today ${stateRows.length}`)
  console.log(`tally: ${JSON.stringify(tally)}`)
  console.log(`destroyed rows: ${destroyed.length}, under-credited rows: ${lower.length}, learners affected: ${learnersHit.size}`)
  for (const r of results.filter(r => r.status !== 'present_ok')) {
    console.log(`  [${r.status}] ${r.learner_id.slice(0, 8)} ${r.recorded_key} -> ${r.target || '-'} ` +
      `recorded=${r.recorded_exposures} existing=${r.existing_exposures ?? '-'}${r.note ? ' (' + r.note + ')' : ''}`)
  }

  const toWrite = destroyed.concat(lower)
  if (!APPLY) {
    if (toWrite.length) console.log(`\nDRY RUN — ${toWrite.length} row(s) would be restored (re-run with --apply).`)
    else console.log(`\nnothing to restore.`)
    await db.end()
    return
  }

  // apply: estate upsert shape — greatest() so nothing goes backwards
  const applied = []
  for (const r of toWrite) {
    const before = stateByKey.get(`${r.learner_id}|${r.target}`) || null
    await db.query(
      `insert into learner_pod_state (learner_id, course_code, sentence_id, exposures)
       values ($1,$2,$3,$4)
       on conflict (learner_id, course_code, sentence_id)
       do update set exposures = greatest(learner_pod_state.exposures, excluded.exposures)`,
      [r.learner_id, COURSE, r.target, r.recorded_exposures])
    const { rows: [after] } = await db.query(
      `select exposures from learner_pod_state where learner_id=$1 and course_code=$2 and sentence_id=$3`,
      [r.learner_id, COURSE, r.target])
    applied.push({ learner_id: r.learner_id, course_code: COURSE,
      recorded_key: r.recorded_key, target_key: r.target,
      recorded_exposures: r.recorded_exposures,
      exposures_before: before ? before.exposures : null,
      exposures_after: after.exposures,
      action: before ? 'topped_up' : 'inserted', heard: r.heard, note: r.note || null })
    console.log(`  applied ${before ? 'top-up' : 'insert'}: ${r.learner_id.slice(0, 8)} ${r.target} ` +
      `${before ? before.exposures : '∅'} -> ${after.exposures}`)
  }

  // verify: every carry now resolves and carries >= recorded exposures
  const { rows: verifyRows } = await db.query(
    `select learner_id, sentence_id, exposures from learner_pod_state where course_code=$1`, [COURSE])
  const vByKey = new Map(verifyRows.map(x => [`${x.learner_id}|${x.sentence_id}`, x]))
  let bad = 0
  for (const r of results.filter(x => ['MISSING', 'present_lower', 'present_ok'].includes(x.status))) {
    const v = vByKey.get(`${r.learner_id}|${r.target}`)
    if (!v || v.exposures < r.recorded_exposures) { bad++; console.error(`  VERIFY FAIL: ${r.learner_id} ${r.target}`) }
    if (v && !canonById.get(baseOf(r.target))) { bad++; console.error(`  VERIFY FAIL (unresolvable): ${r.target}`) }
  }
  console.log(`\nverify: ${bad === 0 ? 'PASS' : bad + ' FAILURES'} — course now holds ${verifyRows.length} state rows`)

  const logPath = args.log || path.join(__dirname, '..', '..', 'docs', 'pod-position-audit',
    `${COURSE}-carry-restore-2026-09-05-applied-log.json`)
  fs.writeFileSync(logPath, JSON.stringify({
    course: COURSE, live_pod: LIVE_POD, prospective: PROSPECTIVE,
    applied_at: new Date().toISOString(), tally, applied
  }, null, 2))
  console.log(`applied log: ${logPath}`)

  await db.end()
  if (bad > 0) process.exit(3)
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
