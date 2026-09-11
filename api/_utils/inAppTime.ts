/**
 * IN-APP SESSION TIME — the school practice-time metric.
 *
 * Founder ruling, Tom 2026-09-10 (~21:45Z, after the phrases-spoken board
 * landed): "we actually want in-app time, because gap time is important — and
 * also, in-app time is in-class time, they want to know that precisely."
 *
 * So a school's TIME figure is wall-clock time spent in the app, INCLUDING the
 * gaps between clips — the pause the learner speaks into, the thinking time,
 * the teacher talking over the top of a whole-class lesson. That is the lesson.
 * Summed clip duration (`learner_speaking_opportunities.play_seconds`, the
 * audio-played ledger) understates it and is DEMOTED to a secondary figure —
 * kept, never deleted.
 *
 * HOW IT IS MEASURED. Sessionised from the diary (`player_events.occurred_at`)
 * per learner id: consecutive events closer together than IDLE_CUTOFF_SECONDS
 * belong to one block; a longer silence ends the block, and the gap is not
 * counted. A block is worth last-event minus first-event, capped at
 * BLOCK_CAP_SECONDS. Two things this deliberately is NOT:
 *   - `sessions.duration_seconds` — ended_at minus started_at on rows whose
 *     timer was frequently never closed; it once reported a single 128-hour
 *     sitting and 437h where the truth was 43h (2026-08-19). Never again.
 *   - `player_events.session_id` grouping — a session id that is never closed
 *     is the same trap. Timestamps plus an idle gap are the method; the
 *     session id is at most corroboration.
 *
 * WHO IS COUNTED. Any learner id — a person's own account or a class's own
 * account (`classes.class_learner_id`, THE-MODEL I6). The class account writes
 * the diary like everyone else (verified live, job #159), so whole-class play
 * is measured here for the first time. A learner id is sessionised once, so a
 * student's own play and the class account's play are distinct learner ids
 * and can never double-count into one figure.
 *
 * DEFAULTS (Tom named neither number; both are dials, not rulings):
 *   IDLE_CUTOFF_SECONDS = 300 — five minutes. Ysgol Cas-gwent, Mon 7 – Thu 10
 *     Sept 2026, read live: 308 min at 2 min, 338 min at 5 min, 389 min at
 *     10 min. The 5-minute figure is what shipped.
 *   BLOCK_CAP_SECONDS = 3h — no real block came near it (longest 17 min).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'

export const IDLE_CUTOFF_SECONDS = 300
export const BLOCK_CAP_SECONDS = 3 * 3600
/** PostgREST caps a single response at 1,000 rows; page the diary read. */
const DIARY_PAGE = 1000
const DIARY_MAX_PAGES = 50

export interface SessioniseOptions {
  idleCutoffSeconds?: number
  blockCapSeconds?: number
}

/**
 * Pure: seconds of in-app time from one learner's event timestamps (epoch ms,
 * any order). Exported so the rule is testable without a database.
 */
export function sessioniseSeconds(timestampsMs: number[], opts: SessioniseOptions = {}): number {
  const idle = (opts.idleCutoffSeconds ?? IDLE_CUTOFF_SECONDS) * 1000
  const cap = (opts.blockCapSeconds ?? BLOCK_CAP_SECONDS) * 1000
  const ts = timestampsMs.filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
  if (ts.length === 0) return 0
  let total = 0
  let blockStart = ts[0]
  let prev = ts[0]
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i]
    if (t - prev > idle) {
      total += Math.min(prev - blockStart, cap)
      blockStart = t
    }
    prev = t
  }
  total += Math.min(prev - blockStart, cap)
  return Math.round(total / 1000)
}

/**
 * Pure: the distinct UTC days (YYYY-MM-DD) on which a learner has any event —
 * "how many of the last seven days the class practised on", the sentence the
 * Handbook already uses for a class's health mark. A day with one clip counts:
 * presence, not length, is the question here.
 */
export function activeDays(timestampsMs: number[]): string[] {
  const days = new Set<string>()
  for (const t of timestampsMs) {
    if (!Number.isFinite(t)) continue
    days.add(new Date(t).toISOString().slice(0, 10))
  }
  return [...days].sort()
}

export interface InAppTime {
  /** Sessionised in-app seconds (sessioniseSeconds). */
  seconds: number
  /** Distinct UTC days with any event in the window, ascending. */
  days: string[]
  /** Sessionised seconds per UTC day (YYYY-MM-DD) — the class list's activity sparkline (job #265). */
  secondsByDay: Record<string, number>
}

/** Pure: sessionised seconds per UTC day. A block never spans midnight here — each day's stamps are sessionised alone. */
export function sessioniseSecondsByDay(timestampsMs: number[], opts: SessioniseOptions = {}): Record<string, number> {
  const byDay = new Map<string, number[]>()
  for (const t of timestampsMs) {
    if (!Number.isFinite(t)) continue
    const day = new Date(t).toISOString().slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(t)
  }
  const out: Record<string, number> = {}
  for (const [day, ts] of byDay) out[day] = sessioniseSeconds(ts, opts)
  return out
}

/**
 * In-app seconds per learner id over [sinceIso, now), off the diary. A learner
 * with no events in the window is absent from the map (read as 0).
 */
export async function inAppSecondsByLearner(
  svc: SupabaseClient,
  learnerIds: string[],
  sinceIso: string,
  opts: SessioniseOptions = {},
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const [lid, t] of await inAppTimeByLearner(svc, learnerIds, sinceIso, opts)) out.set(lid, t.seconds)
  return out
}

/**
 * In-app time AND active days per learner id over [sinceIso, now), from ONE
 * diary read — the days ride on the same timestamps the seconds are
 * sessionised from, so a caller that wants both never pays for the diary twice.
 */
export async function inAppTimeByLearner(
  svc: SupabaseClient,
  learnerIds: string[],
  sinceIso: string,
  opts: SessioniseOptions = {},
): Promise<Map<string, InAppTime>> {
  const out = new Map<string, InAppTime>()
  const ids = [...new Set(learnerIds.filter(Boolean))]
  if (ids.length === 0) return out
  const stamps = new Map<string, number[]>()
  await Promise.all(
    chunk(ids).map(async (batch) => {
      for (let page = 0; page < DIARY_MAX_PAGES; page++) {
        const { data } = await svc
          .from('player_events')
          .select('learner_id, occurred_at')
          .in('learner_id', batch)
          .gte('occurred_at', sinceIso)
          .order('occurred_at', { ascending: true })
          .order('id', { ascending: true })
          .range(page * DIARY_PAGE, page * DIARY_PAGE + DIARY_PAGE - 1)
        const rows = data ?? []
        for (const r of rows) {
          const lid = String((r as any).learner_id)
          const t = new Date(String((r as any).occurred_at)).getTime()
          if (!stamps.has(lid)) stamps.set(lid, [])
          stamps.get(lid)!.push(t)
        }
        if (rows.length < DIARY_PAGE) break
      }
    }),
  )
  for (const [lid, ts] of stamps) out.set(lid, { seconds: sessioniseSeconds(ts, opts), days: activeDays(ts), secondsByDay: sessioniseSecondsByDay(ts, opts) })
  return out
}
