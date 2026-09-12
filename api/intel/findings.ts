/**
 * GET /api/intel/findings — the nightly Discovery findings, sorted onto the
 * question each one concerns.
 *
 * The engine stays; the destination goes (design §2). scripts/insight-
 * discovery.cjs runs once a night at 03:15 UTC from the watson-1 systemd
 * timer ssi-insight-discovery.timer (command-surface ops/insight-discovery-
 * nightly.sh; moved off Tom's Mac 2026-09-12, job #295), reads the month's
 * telemetry, asks Claude for findings and writes one insight_discoveries row. This endpoint reads the newest row
 * and hands each finding to the question its metric belongs to, so the
 * Discovery feed becomes cards at the top of the question rather than a
 * page of its own.
 *
 * THE SILENCE IS LOUD. The job is nightly, so two missed nights mean it is
 * dead rather than late; past that the response says `silent: true` and
 * every page shows the findings in the alarm tone with their real age, never
 * as if fresh. Nothing here can repair the job — the wrapper on watson-1
 * posts its own red notice — but nothing here will let its silence be quiet
 * either.
 *
 * Reads the table directly under the service role: the god-gated RPC the
 * old page used checks the caller's own row, which a service-role read has
 * no need of, and verifyAdmin above already answers "may this person see
 * it". No population rule applies — these are sentences, not counts; the
 * numbers inside them were the job's own, under its own exclusion, and are
 * shown as text.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Two missed nightly runs. Past this the feed is dead, not late. */
export const SILENT_AFTER_HOURS = 36

/**
 * Which question each Insight Engine metric answers. A finding whose metric
 * is unknown lands on the pulse rather than vanishing — a finding is never
 * dropped for want of a home.
 */
export const METRIC_TO_QUESTION: Record<string, string> = {
  health: 'working',
  retention: 'leaving',
  difficultyTurns: 'leaving',
  contentFriction: 'weak-points',
  courseValue: 'courses',
  trialConversion: 'paying',
  coverage: 'organisations',
}

export interface Finding {
  title: string
  story: string
  tone: 'neutral' | 'good' | 'warn' | 'alarm'
  metric: string | null
  question: string
}

export interface FindingsResponse {
  /** ISO instant of the newest run, or null when there has never been one. */
  generatedAt: string | null
  ageHours: number | null
  silent: boolean
  windowDays: number | null
  byQuestion: Record<string, Finding[]>
  countedAt: string
}

type Raw = { title?: unknown; story?: unknown; tone?: unknown; metric?: unknown }

export function sortFindings(raw: unknown, now = Date.now(), generatedAt: string | null = null): Pick<FindingsResponse, 'byQuestion' | 'ageHours' | 'silent'> {
  const byQuestion: Record<string, Finding[]> = {}
  for (const f of (Array.isArray(raw) ? raw : []) as Raw[]) {
    const metric = typeof f.metric === 'string' ? f.metric : null
    const question = (metric && METRIC_TO_QUESTION[metric]) || 'pulse'
    const tone = (['neutral', 'good', 'warn', 'alarm'] as const).find((t) => t === f.tone) ?? 'neutral'
    const finding: Finding = {
      title: typeof f.title === 'string' ? f.title : '',
      story: typeof f.story === 'string' ? f.story : '',
      tone,
      metric,
      question,
    }
    if (!finding.title) continue
    ;(byQuestion[question] ??= []).push(finding)
  }
  const then = generatedAt ? new Date(generatedAt).getTime() : NaN
  const ageHours = Number.isNaN(then) ? null : Math.round(((now - then) / 3_600_000) * 10) / 10
  const silent = ageHours === null ? true : ageHours > SILENT_AFTER_HOURS
  return { byQuestion, ageHours, silent }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const { data, error } = await svc
    .from('insight_discoveries')
    .select('generated_at, window_days, findings')
    .eq('source', 'real')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: 'Could not read the findings' })
    return
  }

  const generatedAt = (data?.generated_at as string | undefined) ?? null
  const sorted = sortFindings(data?.findings, Date.now(), generatedAt)
  const body: FindingsResponse = {
    generatedAt,
    windowDays: (data?.window_days as number | null | undefined) ?? null,
    ...sorted,
    countedAt: new Date().toISOString(),
  }
  res.status(200).json(body)
}
