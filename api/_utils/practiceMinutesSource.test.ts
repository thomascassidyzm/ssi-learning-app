/**
 * ONE DEFINITION OF A MINUTE — the admin/schools practice-minutes RPCs must
 * read the playback ledger, not the sessions table.
 *
 * WHY THIS EXISTS. Founder ruling 2026-08-19: time counts as in-app time when
 * the app is PLAYING, and the measurement must be made accurate rather than
 * clamped. `learner_speaking_opportunities.play_seconds` is that measurement.
 * `sessions.duration_seconds` was wall clock until the 2026-08-20 fix: on rows
 * whose accumulator never closed it equals `ended_at - started_at` exactly, so
 * a tab left open banked the whole time it was open. Measured against
 * production 2026-09-08, the sessions-sourced RPC returns 121,537 minutes for
 * real learners where the ledger holds 25,647.
 *
 * The learner's own Total Time tile was repointed at the ledger in August; the
 * admin and schools surfaces were not, so the same person read 43h to
 * themselves and 437h to an admin. 20260908c closed that.
 *
 * This test guards the RULE, not one file: it finds the LATEST migration that
 * defines each function and asserts that definition sources from the ledger.
 * Re-point either RPC back at `sessions` in a future migration and this goes
 * red.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

/** Body of the last migration in filename order that defines `fn`. */
function latestDefinition(fn: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  let found: string | null = null
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    const marker = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`,
      'i'
    )
    const m = marker.exec(sql)
    if (m) found = sql.slice(m.index)
  }
  if (!found) throw new Error(`no migration defines public.${fn}`)
  return found
}

/** The function body only — everything before the next top-level statement. */
function bodyOf(fn: string): string {
  const def = latestDefinition(fn)
  const end = def.indexOf('$$;')
  return end === -1 ? def : def.slice(0, end)
}

/** Body of the last migration in filename order that defines view `v`. */
function latestViewDefinition(v: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  let found: string | null = null
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    const m = new RegExp(`create\\s+or\\s+replace\\s+view\\s+public\\.${v}\\b`, 'i').exec(sql)
    if (m) found = sql.slice(m.index)
  }
  if (!found) throw new Error(`no migration defines view public.${v}`)
  return found
}

describe('practice minutes read the playback ledger, not wall-clock sessions', () => {
  for (const fn of ['admin_practice_minutes', 'admin_practice_minutes_by_course']) {
    it(`${fn} sums learner_speaking_opportunities.play_seconds`, () => {
      const body = bodyOf(fn)
      expect(body).toMatch(/from\s+learner_speaking_opportunities/i)
      expect(body).toMatch(/sum\(\s*lso\.play_seconds\s*\)/i)
    })

    it(`${fn} does not sum sessions.duration_seconds`, () => {
      const body = bodyOf(fn)
      expect(body).not.toMatch(/from\s+sessions\b/i)
      expect(body).not.toMatch(/duration_seconds/i)
    })
  }

  it('the class roster reads practice seconds from the ledger too', () => {
    // class_student_progress feeds the teacher dashboard and the teachers
    // page. Left on sessions it recreates the very disagreement the rpcs
    // above exist to end — a teacher reading a bigger number for a pupil
    // than the pupil reads for themselves.
    const def = latestViewDefinition('class_student_progress')
    const practice = def.slice(0, def.indexOf('AS total_practice_seconds'))
    const lastSum = practice.lastIndexOf('sum(')
    expect(practice.slice(lastSum)).toMatch(/learner_speaking_opportunities/i)
    expect(practice.slice(lastSum)).not.toMatch(/duration_seconds/i)
  })

  it('the platform-wide by_course call keeps its ssi_admin guard', () => {
    expect(bodyOf('admin_practice_minutes_by_course')).toContain('public.is_ssi_admin()')
  })
})
