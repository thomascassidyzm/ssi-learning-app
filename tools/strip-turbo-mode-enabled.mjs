#!/usr/bin/env node
/**
 * Turbo retirement sweep: strip the dead `turbo_mode_enabled` key from every
 * `learners.preferences` JSONB blob.
 *
 * WHY THIS IS SAFE. Turbo was retired as a learner choice on 2026-08-06
 * (Aran's two-mode ruling: there is exactly `easy` and `fast`). The preference
 * key outlived the feature. Censused live 2026-08-07: 1,092 of 1,092 learner
 * rows carry the key and it is FALSE on every single one — so removing it is
 * behaviourally a no-op, and that is precisely the safety argument. The script
 * ABORTS if it ever sees a true value, because that would mean the census was
 * wrong and a learner would be silently changed.
 *
 * WHAT IT GUARANTEES PER ROW. The key is removed and EVERY OTHER key in the
 * blob is left byte-identical. That is asserted per row before the write (the
 * before-state assertion) and re-read after, so a concurrent writer touching a
 * row mid-sweep aborts the run rather than being clobbered.
 *
 * COMPANION CHANGE — do not run this without it. The `learners.preferences`
 * COLUMN DEFAULT also carried the key, so sweeping the rows alone would let
 * every newly-created learner reintroduce it and the sweep would silently undo
 * itself. supabase/migrations/20260807_retire_turbo_residue.sql drops it from
 * the default (and deletes the dead `turbo_boost` row from algorithm_config).
 *
 * NOT TOUCHED, DELIBERATELY: `algorithm_config.normal_mode` is NOT Turbo
 * residue — it is fast_mode's live promotion-window fallback alias. And the
 * 'turbo_toggle' player_events rows stay: they are historical behavioural
 * evidence, and deleting them would rewrite the past.
 *
 * Usage:
 *   DRY_RUN=1 node tools/strip-turbo-mode-enabled.mjs   # writes nothing
 *   node tools/strip-turbo-mode-enabled.mjs             # applies
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (service role required).')
  process.exit(1)
}
const DRY_RUN = process.env.DRY_RUN === '1'
const KEY = 'turbo_mode_enabled'
const db = createClient(url, key)

/** Page the whole learners table; the sweep must see every row, not a page. */
const readAll = async () => {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('learners').select('id,preferences').range(from, from + 999)
    if (error) throw new Error(`learners read failed: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

const rows = await readAll()
const affected = rows.filter((r) => r.preferences && Object.prototype.hasOwnProperty.call(r.preferences, KEY))
const truthy = affected.filter((r) => r.preferences[KEY] === true)

console.log(`[census] learners=${rows.length} carrying '${KEY}'=${affected.length} value-true=${truthy.length}`)

// ABORT GATE. A true value means a learner really was on Turbo and the
// no-op argument collapses. Stop and let a human rule on it.
if (truthy.length > 0) {
  console.error(`ABORT: ${truthy.length} learner(s) have ${KEY}=true. The sweep is only safe because every value is false.`)
  console.error('Learner ids:', truthy.map((r) => r.id).join(', '))
  process.exit(2)
}

const log = []
let written = 0
for (const row of affected) {
  const before = row.preferences
  const after = { ...before }
  delete after[KEY]

  // Before-state assertion: everything except the doomed key must survive
  // untouched. If this ever fails the transform is wrong — abort the run.
  const beforeRest = { ...before }
  delete beforeRest[KEY]
  if (JSON.stringify(beforeRest) !== JSON.stringify(after)) {
    console.error(`ABORT: transform would alter more than '${KEY}' on learner ${row.id}`)
    process.exit(3)
  }

  log.push({ id: row.id, before, after })

  if (!DRY_RUN) {
    // Re-read immediately before the write and abort on drift, so a
    // concurrent writer is never silently clobbered.
    const { data: fresh, error: reErr } = await db.from('learners').select('preferences').eq('id', row.id).single()
    if (reErr) { console.error(`ABORT: re-read failed for ${row.id}: ${reErr.message}`); process.exit(4) }
    if (JSON.stringify(fresh.preferences) !== JSON.stringify(before)) {
      console.error(`ABORT: drift on learner ${row.id} — preferences changed since census.`)
      process.exit(5)
    }
    const { error: wErr } = await db.from('learners').update({ preferences: after }).eq('id', row.id)
    if (wErr) { console.error(`ABORT: write failed for ${row.id}: ${wErr.message}`); process.exit(6) }
    written++
  }
}

const file = `tools/strip-turbo-mode-enabled-${DRY_RUN ? 'dryrun' : 'applied'}-log.json`
writeFileSync(file, JSON.stringify({
  ran_at_utc: new Date().toISOString(),
  dry_run: DRY_RUN,
  learners_total: rows.length,
  carrying_key_before: affected.length,
  value_true: truthy.length,
  rows_written: written,
  rows: log,
}, null, 2))
console.log(`[${DRY_RUN ? 'DRY RUN' : 'APPLIED'}] rows_written=${written} log=${file}`)

// Reconcile: re-count from the live table and require it to be exactly zero
// (or unchanged on a dry run). Anything else means stop and investigate.
const after = await readAll()
const stillCarrying = after.filter((r) => r.preferences && Object.prototype.hasOwnProperty.call(r.preferences, KEY)).length
console.log(`[reconcile] carrying '${KEY}' before=${affected.length} after=${stillCarrying} (expected ${DRY_RUN ? affected.length : 0})`)
if (!DRY_RUN && stillCarrying !== 0) {
  console.error('RECONCILE FAILED: key still present on some rows.')
  process.exit(7)
}
