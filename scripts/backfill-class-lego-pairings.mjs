#!/usr/bin/env node
/**
 * Replay the class co-firing history into learner_lego_pairings (job #59).
 *
 * WHY. Job #52 found that class play never reached this table at all:
 * `record_lego_pairings` is SECURITY INVOKER and `learner_lego_pairings`
 * carries own-row RLS, and a class entity's user_id is the literal
 * `class-learner:<classId>` — nobody's login — so every class flush was
 * refused and the player only console.warned it. The table held ONE row for
 * every class in every school against 5,432 class audio_play events. #52 fixed
 * the write path, forward only. Tom's ruling: the class is the only way
 * schools play, so this telemetry must be complete — hence this replay.
 *
 * THE RECONSTRUCTION IS DETERMINISTIC, NOT A GUESS.
 *   * A completed cycle is a `target2` audio_play row. SimplePlayer emits
 *     `cycle_completed` at the top of advanceCycle(), which runs after every
 *     full 4-phase traversal — including an Easy-mode repeat — and a skipped
 *     cycle never reaches it. One target2 play, one fire: exactly the rule
 *     LearningPlayer.vue applies live.
 *   * The cycle's PHRASE is named by the audio it played:
 *     payload.url = /api/audio/<audioId>, and that id is
 *     course_practice_phrases.{known,target1,target2}_audio_id. This is an
 *     identity, not an inference — `payload.cycleId` carries only a per-round
 *     ordinal ("S0002L01_build_04_build_1") which would have to be re-derived
 *     by replaying the round builder.
 *   * The fired LEGOs are the cycle's own lego_id plus the bound legoIds of
 *     the phrase's `decomposition` — the same derivation
 *     backendCyclesToRounds.toPlayerCycle() does into `componentLegoIds`, and
 *     the same expansion LearningPlayer.vue does before recording.
 *   * The pairing rule itself is IMPORTED, not reimplemented: `buildPairs`
 *     from packages/player-vue/src/composables/buildLegoPairs.ts, which
 *     usePairingsTelemetry re-exports and uses live.
 *
 * INTRO and DEBUT cycles fire no pairs, by construction and not by omission:
 * api/courses/[code]/cycles.ts gives them no `decomposition`, so
 * componentLegoIds is undefined, the fired set is one LEGO, and buildPairs
 * returns []. They are counted and reported, never treated as a gap.
 *
 * REVERSIBLE. Every replayed fire is banked in `backfill_fire_count` under
 * `backfill_tag`, and the pre-backfill `first_fired_at` is remembered
 * (migration 20260917_lego_pairings_backfill_marker.sql). --revert puts the
 * table back exactly. Re-running REPLACES this tag's contribution rather than
 * adding to it, so the script is idempotent.
 *
 * Usage:
 *   node scripts/backfill-class-lego-pairings.mjs                # DRY RUN (default)
 *   node scripts/backfill-class-lego-pairings.mjs --apply        # write, in one txn
 *   node scripts/backfill-class-lego-pairings.mjs --revert       # undo the tag, in one txn
 *   --tag NAME     backfill tag (default backfill-2026-09-17)
 *   --class ID     restrict to one class id
 *   --log PATH     per-class log (default $CS_SCRATCH or cwd)
 *
 * Read-only by default and it prints what it would write: per school, per
 * class, cycles / phrases / pairs, and every cycle whose phrase could not be
 * resolved — reported as a gap, never guessed at.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildPairs, expandFiredLegoIds } from '../packages/player-vue/src/composables/buildLegoPairs.ts'

const require = createRequire(import.meta.url)
const DASH = process.env.DASH || '/home/tomcassidy/SSi/ssi-dashboard-v7-clean'
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const APPLY = flag('--apply')
const REVERT = flag('--revert')
const TAG = opt('--tag', 'backfill-2026-09-17')
const ONLY_CLASS = opt('--class', null)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const MODE = REVERT ? 'revert' : APPLY ? 'applied' : 'dryrun'
const LOG = opt('--log', path.join(process.env.CS_SCRATCH || process.cwd(),
  `backfill-class-lego-pairings-${MODE}-${stamp}.json`))

const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1]

/**
 * Every class-entity audio_play that completed a cycle, with the class it
 * belongs to, its school, and the audio id it played. `is_demo` is carried
 * for the report only: the live write path (/api/school/class-progress) has
 * no demo exclusion, so neither has this — excluding here would make the
 * replay disagree with the path it is replaying.
 */
const EVENTS = `
  select pe.id, pe.occurred_at, pe.course_code,
         pe.user_id as learner_id,
         l.user_id as class_learner_key,
         c.id as class_id, c.class_name,
         s.id as school_id, s.school_name, s.is_demo,
         pe.payload->>'legoId'   as lego_id,
         pe.payload->>'cycleId'  as cycle_id,
         pe.payload->>'cycleType' as cycle_type,
         split_part(replace(pe.payload->>'url', '/api/audio/', ''), '.', 1) as audio_id
  from player_events pe
  join learners l on l.id = pe.user_id
  left join classes c on ('class-learner:' || c.id::text) = l.user_id
  left join schools s on s.id = c.school_id
  where pe.event_type = 'audio_play'
    and l.user_id like 'class-learner:%'
    and pe.payload->>'role' = 'target2'
    ${ONLY_CLASS ? "and l.user_id = 'class-learner:' || $1" : ''}
  order by pe.occurred_at
`

/** audio id -> the phrase rows that carry it, with their decomposition. */
const PHRASES = `
  select p.id as phrase_id, p.lego_id, p.course_code, p.phrase_role, p.decomposition, x.aid
  from course_practice_phrases p
  join (select distinct unnest($1::uuid[]) as aid) x
    on x.aid in (p.known_audio_id, p.target1_audio_id, p.target2_audio_id)
  where p.decomposition is not null
`

function fail(msg) { console.error(`\n  FAILED: ${msg}\n`); process.exit(1) }

async function revert(db) {
  await db.query('begin')
  const before = await db.query(
    'select count(*)::int n, coalesce(sum(backfill_fire_count),0)::int fires from learner_lego_pairings where backfill_tag = $1', [TAG])
  const upd = await db.query(`
    update learner_lego_pairings
       set fire_count = fire_count - backfill_fire_count,
           first_fired_at = coalesce(backfill_prev_first_fired_at, first_fired_at),
           backfill_fire_count = 0,
           backfill_tag = null,
           backfill_prev_first_fired_at = null
     where backfill_tag = $1`, [TAG])
  const del = await db.query('delete from learner_lego_pairings where fire_count <= 0')
  await db.query('commit')
  console.log(`\nREVERT ${TAG}: ${before.rows[0].n} rows carried ${before.rows[0].fires} replayed fires; ` +
    `${upd.rowCount} rows unwound, ${del.rowCount} rows that existed only because of the backfill deleted.`)
  fs.writeFileSync(LOG, JSON.stringify({ mode: 'revert', tag: TAG, ...before.rows[0], unwound: upd.rowCount, deleted: del.rowCount }, null, 2))
  console.log(`log: ${LOG}`)
}

async function main() {
  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  try {
    if (REVERT) return await revert(db)

    const ev = await db.query(EVENTS, ONLY_CLASS ? [ONLY_CLASS] : [])
    if (ev.rows.length === 0) fail('no class audio_play cycles found')

    const aids = [...new Set(ev.rows.map(r => r.audio_id).filter(a => /^[0-9a-f-]{36}$/.test(a)))]
    const ph = await db.query(PHRASES, [aids])

    // audio id -> phrase rows. An audio id shared by two phrases (identical
    // text recorded once) is resolved by the cycle's own lego_id; if that
    // still leaves two DIFFERENT decompositions, the cycle is unresolved and
    // reported, not guessed at.
    const byAid = new Map()
    for (const p of ph.rows) {
      if (!byAid.has(p.aid)) byAid.set(p.aid, [])
      byAid.get(p.aid).push(p)
    }

    const classes = new Map()   // class key -> report + tally
    const unresolved = []
    let introDebutCycles = 0

    for (const r of ev.rows) {
      const key = r.learner_id
      if (!classes.has(key)) {
        classes.set(key, {
          learner_id: r.learner_id, class_id: r.class_id, class_name: r.class_name,
          school_id: r.school_id, school_name: r.school_name, is_demo: r.is_demo,
          cycles: 0, pairing_cycles: 0, phrases: new Set(), unresolved: 0,
          tally: new Map(),   // `${course}|${a}|${b}` -> {course, a, b, count, first, last}
        })
      }
      const cl = classes.get(key)
      cl.cycles++

      let cands = (byAid.get(r.audio_id) || []).filter(p => p.course_code === r.course_code)
      if (cands.length > 1) {
        const narrowed = cands.filter(p => p.lego_id === r.lego_id)
        if (narrowed.length > 0) cands = narrowed
      }
      const decs = new Set(cands.map(p => JSON.stringify(p.decomposition)))
      if (cands.length === 0 || decs.size > 1) {
        // An intro/debut cycle has no phrase and no decomposition by design —
        // the fired set is one LEGO and buildPairs returns []. Not a gap.
        if (r.cycle_type === 'intro' || r.cycle_type === 'debut') { introDebutCycles++; continue }
        cl.unresolved++
        unresolved.push({
          class_id: r.class_id, class_name: r.class_name, school_name: r.school_name,
          occurred_at: r.occurred_at, course_code: r.course_code, cycle_id: r.cycle_id,
          cycle_type: r.cycle_type, lego_id: r.lego_id, audio_id: r.audio_id,
          reason: cands.length === 0 ? 'no phrase carries this audio id'
                                     : 'audio id shared by phrases with different decompositions',
        })
        continue
      }
      const phrase = cands[0]
      cl.phrases.add(phrase.phrase_id)

      // The live derivation, step for step: bound decomposition entries become
      // componentLegoIds (backendCyclesToRounds), then LearningPlayer prepends
      // the cycle's own legoId and drops any component equal to it.
      const componentLegoIds = (phrase.decomposition || []).filter(d => !!d.legoId).map(d => d.legoId)
      const pairs = buildPairs(expandFiredLegoIds(r.lego_id, componentLegoIds))
      if (pairs.length === 0) continue
      cl.pairing_cycles++
      const ts = new Date(r.occurred_at).toISOString()
      for (const [x, y] of pairs) {
        const a = x < y ? x : y
        const b = x < y ? y : x
        const k = `${r.course_code}|${a}|${b}`
        const e = cl.tally.get(k)
        if (e) { e.count++; if (ts < e.first) e.first = ts; if (ts > e.last) e.last = ts }
        else cl.tally.set(k, { course: r.course_code, a, b, count: 1, first: ts, last: ts })
      }
    }

    // ---- report ------------------------------------------------------------
    const bySchool = new Map()
    for (const cl of classes.values()) {
      const sk = cl.school_id || '(no school)'
      if (!bySchool.has(sk)) bySchool.set(sk, { name: cl.school_name || '(orphan class)', is_demo: cl.is_demo, classes: [] })
      bySchool.get(sk).classes.push(cl)
    }
    const sorted = [...bySchool.values()].sort((a, b) =>
      b.classes.reduce((s, c) => s + c.tally.size, 0) - a.classes.reduce((s, c) => s + c.tally.size, 0))

    console.log(`\n${MODE.toUpperCase()}  tag=${TAG}`)
    console.log(`${ev.rows.length} completed class cycles (target2 plays) across ${classes.size} class entities.`)
    console.log(`${introDebutCycles} of them are intro/debut cycles, which fire no pairs by construction.\n`)
    let totCycles = 0, totPairRows = 0, totFires = 0, totPhrases = 0
    for (const s of sorted) {
      console.log(`SCHOOL  ${s.name}${s.is_demo ? '  [demo]' : ''}`)
      for (const cl of s.classes.sort((a, b) => b.tally.size - a.tally.size)) {
        const fires = [...cl.tally.values()].reduce((n, e) => n + e.count, 0)
        totCycles += cl.cycles; totPairRows += cl.tally.size; totFires += fires; totPhrases += cl.phrases.size
        console.log(`  ${(cl.class_name || '(deleted class)').padEnd(28)} ` +
          `cycles ${String(cl.cycles).padStart(4)}  phrases ${String(cl.phrases.size).padStart(3)}  ` +
          `pairs ${String(cl.tally.size).padStart(4)}  fires ${String(fires).padStart(5)}  ` +
          `unresolved ${cl.unresolved}`)
      }
    }
    console.log(`\nTOTAL  cycles ${totCycles}  distinct phrases ${totPhrases}  pair rows ${totPairRows}  fires ${totFires}`)
    console.log(`UNRESOLVED CYCLES: ${unresolved.length}` + (unresolved.length ? '  (listed in the log; not guessed at)' : ''))
    for (const u of unresolved.slice(0, 15)) {
      console.log(`  ! ${u.school_name} / ${u.class_name}  ${u.cycle_id}  ${u.reason}`)
    }
    if (unresolved.length > 15) console.log(`  ... and ${unresolved.length - 15} more`)

    const log = {
      mode: MODE, tag: TAG, generated_at: new Date().toISOString(),
      totals: { cycles: totCycles, intro_debut_cycles: introDebutCycles, phrases: totPhrases, pair_rows: totPairRows, fires: totFires, unresolved: unresolved.length },
      classes: [...classes.values()].map(cl => ({
        learner_id: cl.learner_id, class_id: cl.class_id, class_name: cl.class_name,
        school_name: cl.school_name, is_demo: cl.is_demo,
        cycles: cl.cycles, pairing_cycles: cl.pairing_cycles, phrases: cl.phrases.size,
        pair_rows: cl.tally.size, fires: [...cl.tally.values()].reduce((n, e) => n + e.count, 0),
        unresolved: cl.unresolved,
      })),
      unresolved,
    }

    if (!APPLY) {
      fs.writeFileSync(LOG, JSON.stringify(log, null, 2))
      console.log(`\nDRY RUN — nothing written. log: ${LOG}`)
      console.log(`Apply with --apply; reverse with --revert --tag ${TAG}`)
      return
    }

    // ---- write -------------------------------------------------------------
    await db.query('begin')
    let calls = 0
    for (const cl of classes.values()) {
      const byCourse = new Map()
      for (const e of cl.tally.values()) {
        if (!byCourse.has(e.course)) byCourse.set(e.course, [])
        byCourse.get(e.course).push(e)
      }
      for (const [course, entries] of byCourse) {
        // One call per (class, course) — the RPC sums within a call and the
        // tally is already canonicalised, so first/last are the window of the
        // whole course's replay for this class.
        const first = entries.reduce((m, e) => (e.first < m ? e.first : m), entries[0].first)
        const last = entries.reduce((m, e) => (e.last > m ? e.last : m), entries[0].last)
        await db.query(
          'select record_lego_pairings_backfill($1,$2,$3,$4,$5,$6,$7)',
          [cl.learner_id, course, entries.map(e => [e.a, e.b]), entries.map(e => e.count), TAG, first, last])
        calls++
      }
    }
    const after = await db.query(
      'select count(*)::int rows, coalesce(sum(backfill_fire_count),0)::int fires from learner_lego_pairings where backfill_tag = $1', [TAG])
    if (after.rows[0].rows !== totPairRows || after.rows[0].fires !== totFires) {
      await db.query('rollback')
      fail(`written state disagrees with the dry run: ${after.rows[0].rows} rows / ${after.rows[0].fires} fires ` +
           `vs ${totPairRows} / ${totFires}. Rolled back, nothing changed.`)
    }
    await db.query('commit')
    log.written = { rpc_calls: calls, ...after.rows[0] }
    fs.writeFileSync(LOG, JSON.stringify(log, null, 2))
    console.log(`\nAPPLIED in one txn: ${after.rows[0].rows} pair rows carrying ${after.rows[0].fires} replayed fires, ${calls} RPC calls.`)
    console.log(`log: ${LOG}`)
    console.log(`Reverse with: node scripts/backfill-class-lego-pairings.mjs --revert --tag ${TAG}`)
  } finally {
    await db.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
