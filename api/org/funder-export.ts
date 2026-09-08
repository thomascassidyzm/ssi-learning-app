/**
 * Funder export — GET /api/org/funder-export
 * ==========================================
 *
 * The monthly return for a funded cohort. Built for the National Centre for
 * Learning Welsh, parameterised for any org that has an org_enrolment_policies
 * row.
 *
 * Three windows, the same six measures in each, plus a separate 16-24
 * breakdown of every one of them:
 *   * the month asked for,
 *   * all time (which, for this cohort, means since enrolment — see below),
 *   * since the funding-year baseline, 1 April by default and NEVER hardcoded
 *     to a year.
 *
 * WHAT "ALL TIME" MEANS HERE. Kai's ruling: a clean break. This cohort's
 * reporting starts at each learner's own enrolment date and pre-cutover
 * history is not imported. Nothing is deleted to achieve it — the playback
 * ledger keeps every row — so an older total stays retrievable by asking for
 * a window that starts earlier. The break is org_enrolments.reporting_from,
 * applied inside secondsByLearner and nowhere else.
 *
 * WHAT THIS EXPORT DOES NOT CONTAIN: any learner id, any email, any name, any
 * per-person row. It is counts and averages. The age tick is reported only as
 * a cohort size, never attached to a person. That is deliberate and asserted
 * by a test — the 16-24 answer was collected as a tick precisely so that the
 * app never has to hold a birth date, and the export must not undo that by
 * handing the funder an identifiable list of who ticked.
 *
 * Authz: ssi_admin, or the leader of the group (or of an ancestor of it) —
 * the same resolveGroupTreeCaller / callerCanSeeGroup pair every other node
 * read endpoint uses, so this surface cannot drift from those.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyCors } from '../_utils/cors'
import { resolveGroupTreeCaller, callerCanSeeGroup } from '../_utils/groupTreeAuth'
import { fetchSubtree } from '../_utils/groupSubtree'
import {
  monthWindow,
  baselineWindow,
  fundingYearStart,
  measureWindow,
  measureWindowFromTotals,
  toCsv,
  type CourseTotal,
  type EnrolledLearner,
  type LedgerDay,
  type WindowResult,
  type Window,
} from '../_utils/orgFunderExport'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const PAGE = 1000

/**
 * The point at which the raw-ledger fallback stops and says so.
 *
 * The fallback exists only for the window between this code shipping and
 * migration 20260908e being applied. It drags per-day rows into memory, which
 * is precisely the shape that made the old system's fetches time out once its
 * groups grew, so it is bounded: past this many rows it refuses and returns a
 * 503 naming the missing function, rather than timing out or — far worse —
 * quietly returning a number computed from a truncated read.
 */
const FALLBACK_ROW_CEILING = 200_000

/** The previous COMPLETE month — a report pulled on the 3rd should not be a stub of the 3rd. */
export function defaultMonth(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * One row per PERSON, even when they hold several enrolments.
 *
 * A learner can end up enrolled under two cohorts of the same org — the old
 * one and a new one, a re-enrolment, a sibling group. They are one registered
 * person and must be counted once. The earliest enrolment wins, because that
 * is when they actually registered and it is the baseline that keeps the most
 * of their honest history. The age band is true if they ticked it anywhere:
 * a person is in the band or is not, and a later untick is not evidence they
 * aged out mid-year.
 */
export function dedupeRoster(
  rows: Array<{
    learner_id: string
    enrolled_at: string
    reporting_from: string
    age_band_16_24: boolean
  }>,
): { roster: EnrolledLearner[]; duplicateEnrolments: number } {
  const byLearner = new Map<string, EnrolledLearner>()
  let duplicates = 0
  for (const r of rows) {
    const enrolledOn = String(r.enrolled_at).slice(0, 10)
    const existing = byLearner.get(r.learner_id)
    if (!existing) {
      byLearner.set(r.learner_id, {
        learner_id: r.learner_id,
        reporting_from: String(r.reporting_from).slice(0, 10),
        enrolled_on: enrolledOn,
        age_band_16_24: !!r.age_band_16_24,
      })
      continue
    }
    duplicates++
    if (enrolledOn < existing.enrolled_on) {
      existing.enrolled_on = enrolledOn
      existing.reporting_from = String(r.reporting_from).slice(0, 10)
    }
    existing.age_band_16_24 = existing.age_band_16_24 || !!r.age_band_16_24
  }
  return { roster: [...byLearner.values()], duplicateEnrolments: duplicates }
}

/**
 * "Is this a missing function, or a real error?"
 *
 * Same test api/code/redeem.ts uses for claim_invite_code_use: PGRST202 /
 * 42883 / a schema-cache miss mean the migration has not been applied yet and
 * the caller should fall back. Anything else is a genuine failure and must not
 * be silently downgraded into a slower path that hides it.
 */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|schema cache/i.test(error.message || '')
  )
}

/** The roster as one row per person, or null when the aggregate is not deployed. */
async function rpcRoster(supabase: SupabaseClient, groupIds: string[]): Promise<EnrolledLearner[] | null> {
  const out: EnrolledLearner[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .rpc('org_enrolment_roster', { p_group_ids: groupIds })
      .range(offset, offset + PAGE - 1)
    if (error) {
      if (isMissingFunction(error)) return null
      throw new Error(`org_enrolment_roster failed: ${error.message}`)
    }
    const rows = (data ?? []) as Array<{ learner_id: string; enrolled_on: string; reporting_from: string; age_band_16_24: boolean }>
    for (const r of rows) {
      out.push({
        learner_id: r.learner_id,
        enrolled_on: String(r.enrolled_on).slice(0, 10),
        reporting_from: String(r.reporting_from).slice(0, 10),
        age_band_16_24: !!r.age_band_16_24,
      })
    }
    if (rows.length < PAGE) break
  }
  return out
}

/** Per-learner-per-course seconds for one window, or null when not deployed. */
async function windowTotals(
  supabase: SupabaseClient,
  groupIds: string[],
  w: Window,
): Promise<CourseTotal[] | null> {
  const out: CourseTotal[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .rpc('org_enrolment_window_seconds', { p_group_ids: groupIds, p_from: w.from, p_to: w.to })
      .range(offset, offset + PAGE - 1)
    if (error) {
      if (isMissingFunction(error)) return null
      throw new Error(`org_enrolment_window_seconds failed: ${error.message}`)
    }
    const rows = (data ?? []) as Array<{ learner_id: string; course_code: string; seconds: number | string }>
    for (const r of rows) {
      out.push({ learner_id: r.learner_id, course_code: r.course_code, seconds: Number(r.seconds) || 0 })
    }
    if (rows.length < PAGE) break
  }
  return out
}

async function pagedSelect<T>(
  build: (from: number, to: number) => any,
): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)

  const caller = await resolveGroupTreeCaller(req, res, supabase)
  if (!caller) return // resolveGroupTreeCaller already answered 401/403

  const groupId = String(req.query.groupId || '').trim()
  if (!groupId) {
    res.status(400).json({ error: 'groupId is required' })
    return
  }
  if (!(await callerCanSeeGroup(supabase, caller, groupId))) {
    res.status(403).json({ error: 'Not your group' })
    return
  }

  const month = String(req.query.month || '').trim() || defaultMonth()
  let month_window
  try {
    month_window = monthWindow(month)
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Bad month' })
    return
  }
  const baselineFrom = String(req.query.baselineFrom || '').trim() || fundingYearStart(new Date(`${month_window.to}T00:00:00Z`))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baselineFrom)) {
    res.status(400).json({ error: 'baselineFrom must be YYYY-MM-DD' })
    return
  }

  try {
    const { data: policy } = await supabase
      .from('org_enrolment_policies')
      .select('org_display_name, course_family_map')
      .eq('group_id', groupId)
      .maybeSingle()

    const familyMap = ((policy as any)?.course_family_map ?? {}) as Record<string, string>

    // The org's whole subtree: a cohort split into child groups is still one
    // org, and its learners are counted once across all of them.
    const subtree = await fetchSubtree(supabase, groupId)
    const groupIds = subtree.length ? subtree.map((g) => g.id) : [groupId]

    // The roster, deduped to one row per PERSON. Tried as an aggregate first —
    // a person holding three cohorts of the same org is three rows on the wire
    // otherwise, and a large cohort pays that on every pull.
    let roster: EnrolledLearner[]
    let duplicateEnrolments = 0
    const rosterRpc = await rpcRoster(supabase, groupIds)
    if (rosterRpc) {
      roster = rosterRpc
    } else {
      const enrolRows = await pagedSelect<{
        learner_id: string
        enrolled_at: string
        reporting_from: string
        age_band_16_24: boolean
      }>((from, to) =>
        supabase
          .from('org_enrolments')
          .select('learner_id, enrolled_at, reporting_from, age_band_16_24')
          .in('group_id', groupIds)
          .order('enrolled_at', { ascending: true })
          .range(from, to),
      )
      const deduped = dedupeRoster(enrolRows)
      roster = deduped.roster
      duplicateEnrolments = deduped.duplicateEnrolments
    }

    // Windows. All three end at the same instant — the end of the month being
    // reported — so a report pulled twice for the same month is identical, and
    // the three columns are internally consistent with each other.
    const earliestBaseline = roster.reduce<string>(
      (min, r) => (r.reporting_from < min ? r.reporting_from : min),
      month_window.to,
    )
    const windows = [
      month_window,
      baselineWindow(earliestBaseline, month_window.to, 'all_time'),
      baselineWindow(baselineFrom, month_window.to, `since_${baselineFrom}`),
    ]

    // ── The measurement ────────────────────────────────────────────────────
    //
    // THE LARGE-COHORT PATH, and it is the default. Each window is one
    // aggregate call: the database sums the days and hands back one row per
    // learner per course. A 10,000-strong cohort is ~20,000 rows a window
    // rather than the ~2,000,000 its raw ledger would be, and that number does
    // not grow as the reporting year lengthens.
    //
    // This is the specific failure Kai named from the old system — the cohort
    // cap was raised and the fetches began timing out — so the aggregate is
    // not an optimisation to reach for later, it is the path.
    const results: WindowResult[] = []
    const unmapped = new Set<string>()
    let aggregated = true
    let rowsRead = 0

    for (const w of windows) {
      const totals = await windowTotals(supabase, groupIds, w)
      if (totals === null) {
        aggregated = false
        break
      }
      rowsRead += totals.length
      const { result, unmappedCourses } = measureWindowFromTotals(totals, roster, w, familyMap)
      results.push(result)
      unmappedCourses.forEach((c) => unmapped.add(c))
    }

    if (!aggregated) {
      // Pre-migration only. Bounded, and loud when the bound is reached.
      results.length = 0
      unmapped.clear()
      rowsRead = 0
      const learnerIds = roster.map((r) => r.learner_id)
      let ledger: LedgerDay[] = []
      if (learnerIds.length) {
        const widestFrom = windows.reduce<string>((min, w) => (w.from < min ? w.from : min), month_window.from)
        for (let i = 0; i < learnerIds.length; i += 200) {
          const chunk = learnerIds.slice(i, i + 200)
          const rows = await pagedSelect<LedgerDay>((from, to) =>
            supabase
              .from('learner_speaking_opportunities')
              .select('learner_id, course_code, day, play_seconds')
              .in('learner_id', chunk)
              .gte('day', widestFrom)
              .lte('day', month_window.to)
              .range(from, to),
          )
          ledger = ledger.concat(rows)
          if (ledger.length > FALLBACK_ROW_CEILING) {
            console.error(
              '[org/funder-export] REFUSING a raw-ledger read of',
              ledger.length,
              'rows for',
              learnerIds.length,
              'learners — apply migration 20260908e_org_enrolments.sql',
            )
            res.status(503).json({
              error:
                'This cohort is too large to export without the database aggregate. Apply migration 20260908e_org_enrolments.sql, which adds org_enrolment_window_seconds, and retry.',
              cohortSize: learnerIds.length,
              rowsReadBeforeStopping: ledger.length,
            })
            return
          }
        }
      }
      rowsRead = ledger.length
      for (const w of windows) {
        const { result, unmappedCourses } = measureWindow(ledger, roster, w, familyMap)
        results.push(result)
        unmappedCourses.forEach((c) => unmapped.add(c))
      }
    }

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="funder-export-${month}.csv"`)
      res.status(200).send(toCsv(results))
      return
    }

    res.status(200).json({
      org: (policy as any)?.org_display_name ?? null,
      groupId,
      groupsIncluded: groupIds.length,
      month,
      baselineFrom,
      generatedAt: new Date().toISOString(),
      minutesDefinition:
        'Minutes in which the app was playing audio to the learner (learner_speaking_opportunities.play_seconds). Not wall clock. A learner who has studied both Welsh dialects is counted once, at the higher dialect total, never the sum.',
      windows: results,
      // How the numbers were produced, and how much was read to produce them.
      // A funder export that cannot say which path it took is an export nobody
      // can debug at the moment it matters.
      measurement: {
        path: aggregated ? 'database-aggregate' : 'raw-ledger-fallback',
        rowsRead,
        cohortSize: roster.length,
      },
      // Loud, never silent: a Welsh course code the family map has never heard
      // of would otherwise be dropped from every figure without a word.
      unmappedCourseCodes: [...unmapped].sort(),
      duplicateEnrolmentsCollapsed: duplicateEnrolments,
    })
  } catch (error: any) {
    console.error('[org/funder-export] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
