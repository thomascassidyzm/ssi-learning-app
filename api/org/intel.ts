/**
 * GET /api/org/intel?nodeId=<group id | school id | class id> — the ORG
 * intelligence read: the three questions a school or group leader has, answered
 * for their own node and nothing beyond it.
 *
 * WHY THIS EXISTS (Tom, 2026-09-10): "this intelligence in the dashboard is
 * great for ssi admin / but why not make it for orgs as well / they have the
 * same basic needs apart from the marketing side of things of ssi as a product
 * / They still need to know adherence, drop-off places / which users do what,
 * after when and for how long etc." The ten admin questions (api/intel/*) are
 * gated on verifyAdmin and count the whole estate; a leader needs three of
 * them, scoped to their own subtree. Those three are written down once in
 * packages/player-vue/src/intel/orgQuestions.ts:
 *
 *   PRACTISING  How many of your classes practised together this week, and is
 *               that more or fewer than last week?            (adherence)
 *   QUIET       Which classes have gone quiet, and which have never started?
 *                                                              (who is NOT)
 *   JOURNEY     How far through the course have your classes got, and where do
 *               they stop?                                     (drop-off)
 *
 * and the rows under Practising are "who did what, when, and for how long":
 * every class with its phrases this week, when it last practised together and
 * where it is; every person with an own account, their minutes this week and
 * when they last practised.
 *
 * SCOPE IS DECIDED HERE, ON THE SERVER, FROM THE CALLER'S OWN IDENTITY. The
 * browser NAMES a node; resolveGroupTreeCaller + callerCanSeeGroup — the same
 * predicate the node home, the structure tree and the write paths enforce —
 * decide whether that node is inside the caller's own subtree, and answer 403
 * before a single class row is read. A teacher is not a leader and gets 403
 * from the caller resolver, as on every other node surface; the teacher lens
 * (/teacher-insights) is theirs. No second scope model, no RLS policy touched.
 *
 * COVERAGE: same rule as api/school/rate-compare.ts — a node anchored on a
 * school whose platform coverage has lapsed answers 403 coverage_expired; a
 * plain group node does not (owner's ruling in schoolCoverageGate.ts).
 *
 * WHAT IS COUNTED, AND WHAT IS HONESTLY NOT. Whole-class practice lives ONLY in
 * player_events (api/_utils/classPractice.ts, job #159): the class account
 * cannot write the playback ledger and its session rows are absent for real
 * lessons. So a class is measured in PHRASES SPOKEN, never minutes, and minutes
 * appear only for people's own logins, off the ledger. No proxy stands in for
 * whole-class time. "This week" is the last seven days by timestamp — the
 * identical rule the node home's phrases7d uses, so Overview and Insights can
 * never disagree about the number.
 *
 * POSITION IS THE LEGO LAST PLAYED, never a seed number on screen: each class
 * carries its position as the LEGO's own text in both languages. Milestones in
 * the journey are phrased as "sentence N of M" — a seed IS one sentence — and
 * labelled with the first LEGO of that sentence when every class shares one
 * course.
 *
 * NOTHING HERE COMPARES THIS NODE WITH ANY OTHER. Every figure is the node's
 * own subtree. The anonymous, k-floored rate comparison lives in
 * rate-compare.ts and stays there.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveGroupTreeCaller, callerCanSeeGroup } from '../_utils/groupTreeAuth'
import { ensureSchoolNode } from '../_utils/schoolNode'
import { chunk, ownSchoolIdForNode } from '../_utils/schoolScope'
import { schoolIdsForNodeSubtree } from '../_utils/vadVisibility'
import { descendantIds, type ParentLinked } from '../_utils/groupSubtree'
import { isEntityCoverageExpired } from '../_utils/schoolCoverageGate'
import {
  loadClassPractice,
  ownAccountLearners,
  ownAccountLedgerByPerson,
  CLASS_PRACTICE_WINDOW_DAYS,
  type ClassPracticeFacts,
} from '../_utils/classPractice'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const DAY_MS = 86_400_000
/** The line and the "gone for how long" buckets look back four weeks. */
export const LOOKBACK_DAYS = 28
/** Sentence milestones for the journey funnel. */
const MILESTONES = [2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377]

export interface OrgIntelPosition {
  legoId: string
  /** Which sentence of the course the class has reached, 1-based. */
  sentence: number
  knownText: string | null
  targetText: string | null
}

export interface OrgIntelClassRow {
  id: string
  name: string
  courseCode: string | null
  phrasesThisWeek: number
  phrasesLastWeek: number
  /** Newest evidence the class practised together — a clip or the cursor stamp. */
  lastPractisedAt: string | null
  daysSincePractice: number | null
  position: OrgIntelPosition | null
}

export interface OrgIntelPersonRow {
  learnerId: string
  name: string
  minutesThisWeek: number
  minutesLastWeek: number
  /** ISO day they last practised on their own account, within the look-back. */
  lastPractisedDay: string | null
}

export type QuietBucketId = 'this-week' | 'gone-a-week' | 'gone-two-weeks' | 'gone-three-weeks' | 'gone-a-month' | 'never'

export interface OrgIntelResponse {
  node: { id: string; name: string; kind: 'group' | 'school' | 'class' }
  windowDays: number
  lookbackDays: number
  countedAt: string
  practising: {
    classCount: number
    classesThisWeek: number
    classesLastWeek: number
    phrasesThisWeek: number
    phrasesLastWeek: number
    peopleCount: number
    peopleThisWeek: number
    peopleLastWeek: number
    ownMinutesThisWeek: number
    ownMinutesLastWeek: number
  }
  /** Phrases spoken and classes practising per UTC day, oldest first, LOOKBACK_DAYS long. */
  byDay: { day: string; phrases: number; classes: number }[]
  quiet: {
    quietCount: number
    neverCount: number
    buckets: { id: QuietBucketId; classes: number }[]
  }
  journey: {
    /** Every course the node's classes are on, with its length in sentences. */
    courses: { code: string; sentences: number }[]
    /** Cumulative: classes that have reached at least this stage. The first stage is "started". */
    stages: { id: string; sentence: number | null; label: OrgIntelPosition | null; classes: number }[]
  }
  classes: OrgIntelClassRow[]
  people: OrgIntelPersonRow[]
}

interface ClassRow {
  id: string
  class_name: string | null
  course_code: string | null
  school_id: string | null
  group_id: string | null
  teacher_user_id: string | null
  class_learner_id: string | null
}

const seedOf = (legoId: string | null | undefined): number | null => {
  const m = typeof legoId === 'string' ? legoId.match(/S(\d+)L\d+/) : null
  return m ? parseInt(m[1], 10) : null
}

/** How many phrases in `times` fall in [from, to). Exported for the test. */
export function phrasesBetween(times: number[], from: number, to: number): number {
  let n = 0
  for (const t of times) if (t >= from && t < to) n += 1
  return n
}

/** The "gone for how long" bucket for a class. Exported for the test. */
export function quietBucket(lastPractisedAt: string | null, now: number): QuietBucketId {
  if (!lastPractisedAt) return 'never'
  const days = (now - new Date(lastPractisedAt).getTime()) / DAY_MS
  if (days < 7) return 'this-week'
  if (days < 14) return 'gone-a-week'
  if (days < 21) return 'gone-two-weeks'
  if (days < 28) return 'gone-three-weeks'
  return 'gone-a-month'
}

/**
 * Cumulative journey stages: "started", then each milestone sentence up to
 * the first one nobody has reached (kept, so the funnel shows where they
 * stop), never past the course's own length. Exported for the test.
 */
export function journeyStages(sentences: (number | null)[], courseLength: number | null): { sentence: number | null; classes: number }[] {
  const reached = sentences.filter((s): s is number => s !== null && s > 0)
  const stages: { sentence: number | null; classes: number }[] = [{ sentence: null, classes: reached.length }]
  if (reached.length === 0) return stages
  for (const m of MILESTONES) {
    if (courseLength !== null && m > courseLength) break
    const n = reached.filter((s) => s >= m).length
    stages.push({ sentence: m, classes: n })
    if (n === 0) break
  }
  return stages
}

async function loadCourseLengths(svc: SupabaseClient, codes: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  await Promise.all(codes.map(async (code) => {
    const { data } = await svc
      .from('course_legos')
      .select('seed_number')
      .eq('course_code', code)
      .order('seed_number', { ascending: false })
      .limit(1)
    const top = (data ?? [])[0] as { seed_number?: number } | undefined
    if (top?.seed_number) out.set(code, top.seed_number)
  }))
  return out
}

/** course_code → lego_id → text, for the ids asked for plus each milestone's first LEGO. */
async function loadLegoText(
  svc: SupabaseClient,
  wanted: { course: string; legoId: string }[],
): Promise<Map<string, { known: string | null; target: string | null }>> {
  const out = new Map<string, { known: string | null; target: string | null }>()
  const byCourse = new Map<string, Set<string>>()
  for (const w of wanted) {
    let set = byCourse.get(w.course)
    if (!set) { set = new Set(); byCourse.set(w.course, set) }
    set.add(w.legoId)
  }
  await Promise.all([...byCourse.entries()].flatMap(([course, ids]) =>
    chunk([...ids]).map(async (batch) => {
      const { data } = await svc
        .from('course_legos')
        .select('lego_id, known_text, target_text')
        .eq('course_code', course)
        .in('lego_id', batch)
      for (const r of (data ?? []) as { lego_id: string; known_text: string | null; target_text: string | null }[]) {
        out.set(`${course}:${r.lego_id}`, { known: r.known_text, target: r.target_text })
      }
    }),
  ))
  return out
}

/**
 * The read itself, for a node the caller has ALREADY been allowed to see.
 * Split from the handler so the live proof can run it against a real node
 * with the service role, and so the scoping and the counting are visibly two
 * different steps.
 */
export async function computeOrgIntel(
  svc: SupabaseClient,
  node: { id: string; name: string; kind: 'group' | 'school' | 'class' },
  classes: ClassRow[],
  scope: { schoolIds: string[]; groupIds: string[] },
  now: number = Date.now(),
): Promise<OrgIntelResponse> {
  const weekAgo = now - CLASS_PRACTICE_WINDOW_DAYS * DAY_MS
  const twoWeeksAgo = now - 2 * CLASS_PRACTICE_WINDOW_DAYS * DAY_MS
  const classIds = classes.map((c) => c.id)
  const classLearnerIds = classes.map((c) => c.class_learner_id).filter((id): id is string => !!id)
  const courseCodes = [...new Set(classes.map((c) => c.course_code).filter((c): c is string => !!c))]

  const [practice, enrollments, people, courseLengths] = await Promise.all([
    loadClassPractice(svc, classes, now, LOOKBACK_DAYS),
    Promise.all(chunk(classLearnerIds).map(async (batch) => {
      const { data } = await svc
        .from('course_enrollments')
        .select('learner_id, course_id, highest_completed_lego_id, last_completed_lego_id, last_practiced_at')
        .in('learner_id', batch)
      return (data ?? []) as { learner_id: string; course_id: string | null; highest_completed_lego_id: string | null; last_completed_lego_id: string | null; last_practiced_at: string | null }[]
    })).then((pages) => pages.flat()),
    ownAccountLearners(svc, { schoolIds: scope.schoolIds, groupIds: scope.groupIds, classIds }),
    loadCourseLengths(svc, courseCodes),
  ])

  // Position per class: the highest LEGO played, else the last completed one.
  const positionByLearner = new Map<string, { course: string; legoId: string }>()
  for (const e of enrollments) {
    const legoId = e.highest_completed_lego_id || e.last_completed_lego_id
    if (!legoId) continue
    const course = e.course_id || ''
    const prev = positionByLearner.get(e.learner_id)
    // A class is on one course; if two enrollments exist keep the furthest.
    if (!prev || (seedOf(legoId) ?? 0) > (seedOf(prev.legoId) ?? 0)) positionByLearner.set(e.learner_id, { course, legoId })
  }

  const singleCourse = courseCodes.length === 1 ? courseCodes[0] : null
  const wantedText: { course: string; legoId: string }[] = [...positionByLearner.values()].filter((p) => p.course)
  const stageSentences = journeyStages(
    classes.map((c) => (c.class_learner_id ? seedOf(positionByLearner.get(c.class_learner_id)?.legoId) : null)),
    singleCourse ? courseLengths.get(singleCourse) ?? null : null,
  )
  if (singleCourse) {
    for (const s of stageSentences) if (s.sentence) wantedText.push({ course: singleCourse, legoId: `S${String(s.sentence).padStart(4, '0')}L01` })
  }
  const [legoText, ledger] = await Promise.all([
    loadLegoText(svc, wantedText),
    ownAccountLedgerByPerson(svc, [...people.keys()], LOOKBACK_DAYS, now),
  ])

  const positionFor = (c: ClassRow): OrgIntelPosition | null => {
    const p = c.class_learner_id ? positionByLearner.get(c.class_learner_id) : undefined
    if (!p) return null
    const sentence = seedOf(p.legoId)
    if (sentence === null) return null
    const t = legoText.get(`${p.course}:${p.legoId}`)
    return { legoId: p.legoId, sentence, knownText: t?.known ?? null, targetText: t?.target ?? null }
  }

  const classRows: OrgIntelClassRow[] = classes.map((c) => {
    const facts: ClassPracticeFacts | undefined = practice.get(c.id)
    const times = facts?.phraseTimes ?? []
    const last = facts?.lastPractisedAt ?? null
    return {
      id: c.id,
      name: c.class_name || 'Unnamed class',
      courseCode: c.course_code,
      phrasesThisWeek: phrasesBetween(times, weekAgo, Number.POSITIVE_INFINITY),
      phrasesLastWeek: phrasesBetween(times, twoWeeksAgo, weekAgo),
      lastPractisedAt: last,
      daysSincePractice: last ? Math.floor((now - new Date(last).getTime()) / DAY_MS) : null,
      position: positionFor(c),
    }
  }).sort((a, b) => b.phrasesThisWeek - a.phrasesThisWeek || (b.lastPractisedAt ?? '').localeCompare(a.lastPractisedAt ?? '') || a.name.localeCompare(b.name))

  // The four-week line, per UTC day.
  const byDay: { day: string; phrases: number; classes: number }[] = []
  const dayIndex = new Map<string, number>()
  for (let i = LOOKBACK_DAYS - 1; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10)
    dayIndex.set(day, byDay.length)
    byDay.push({ day, phrases: 0, classes: 0 })
  }
  for (const facts of practice.values()) {
    const seen = new Set<number>()
    for (const t of facts.phraseTimes) {
      const idx = dayIndex.get(new Date(t).toISOString().slice(0, 10))
      if (idx === undefined) continue
      byDay[idx].phrases += 1
      seen.add(idx)
    }
    for (const idx of seen) byDay[idx].classes += 1
  }

  // People on their own accounts, off the ledger.
  const weekAgoDay = new Date(weekAgo).toISOString().slice(0, 10)
  const twoWeeksAgoDay = new Date(twoWeeksAgo).toISOString().slice(0, 10)
  const personRows: OrgIntelPersonRow[] = [...people.entries()].map(([learnerId, name]) => {
    const days = ledger.get(learnerId)
    let thisWeek = 0
    let lastWeek = 0
    let lastDay: string | null = null
    for (const [day, seconds] of days ?? []) {
      if (day >= weekAgoDay) thisWeek += seconds
      else if (day >= twoWeeksAgoDay) lastWeek += seconds
      if (!lastDay || day > lastDay) lastDay = day
    }
    return {
      learnerId,
      name: name || 'Unnamed',
      minutesThisWeek: Math.round(thisWeek / 60),
      minutesLastWeek: Math.round(lastWeek / 60),
      lastPractisedDay: lastDay,
    }
  }).sort((a, b) => b.minutesThisWeek - a.minutesThisWeek || (b.lastPractisedDay ?? '').localeCompare(a.lastPractisedDay ?? '') || a.name.localeCompare(b.name))

  const bucketIds: QuietBucketId[] = ['this-week', 'gone-a-week', 'gone-two-weeks', 'gone-three-weeks', 'gone-a-month', 'never']
  const bucketCounts = new Map<QuietBucketId, number>(bucketIds.map((id) => [id, 0]))
  for (const c of classRows) {
    const b = quietBucket(c.lastPractisedAt, now)
    bucketCounts.set(b, (bucketCounts.get(b) || 0) + 1)
  }

  let ownThisWeek = 0
  let ownLastWeek = 0
  for (const p of personRows) { ownThisWeek += p.minutesThisWeek; ownLastWeek += p.minutesLastWeek }

  return {
    node,
    windowDays: CLASS_PRACTICE_WINDOW_DAYS,
    lookbackDays: LOOKBACK_DAYS,
    countedAt: new Date(now).toISOString(),
    practising: {
      classCount: classes.length,
      classesThisWeek: classRows.filter((c) => c.phrasesThisWeek > 0).length,
      classesLastWeek: classRows.filter((c) => c.phrasesLastWeek > 0).length,
      phrasesThisWeek: classRows.reduce((n, c) => n + c.phrasesThisWeek, 0),
      phrasesLastWeek: classRows.reduce((n, c) => n + c.phrasesLastWeek, 0),
      peopleCount: personRows.length,
      peopleThisWeek: personRows.filter((p) => p.minutesThisWeek > 0).length,
      peopleLastWeek: personRows.filter((p) => p.minutesLastWeek > 0).length,
      ownMinutesThisWeek: ownThisWeek,
      ownMinutesLastWeek: ownLastWeek,
    },
    byDay,
    quiet: {
      quietCount: classRows.filter((c) => c.lastPractisedAt !== null && quietBucket(c.lastPractisedAt, now) !== 'this-week').length,
      neverCount: bucketCounts.get('never') || 0,
      buckets: bucketIds.map((id) => ({ id, classes: bucketCounts.get(id) || 0 })),
    },
    journey: {
      courses: courseCodes.map((code) => ({ code, sentences: courseLengths.get(code) ?? 0 })),
      stages: stageSentences.map((s) => {
        const legoId = s.sentence ? `S${String(s.sentence).padStart(4, '0')}L01` : null
        const t = singleCourse && legoId ? legoText.get(`${singleCourse}:${legoId}`) : undefined
        return {
          id: s.sentence ? `sentence-${s.sentence}` : 'started',
          sentence: s.sentence,
          label: s.sentence && legoId ? { legoId, sentence: s.sentence, knownText: t?.known ?? null, targetText: t?.target ?? null } : null,
          classes: s.classes,
        }
      }),
    },
    classes: classRows,
    people: personRows,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }
  const rawId = String(req.query.nodeId || req.query.id || '').trim()
  if (!rawId) {
    res.status(400).json({ error: 'nodeId is required' })
    return
  }
  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Who is asking, and which of the three things is the id — one wave.
    const [caller, { data: asGroup }, { data: asSchool }, { data: asClass }, { data: forestData }] = await Promise.all([
      resolveGroupTreeCaller(req, res, svc),
      svc.from('groups').select('id, name').eq('id', rawId).maybeSingle(),
      svc.from('schools').select('id, school_name, group_id, node_group_id, is_demo, is_test').eq('id', rawId).maybeSingle(),
      svc.from('classes').select('id, class_name, course_code, school_id, group_id, teacher_user_id, class_learner_id').eq('id', rawId).maybeSingle(),
      svc.from('groups').select('id, parent_id'),
    ])
    if (!caller) return

    let nodeId: string | null = null
    let node: OrgIntelResponse['node'] | null = null
    let classRow: ClassRow | null = null
    if (asGroup) {
      nodeId = rawId
      node = { id: rawId, name: (asGroup as { name?: string }).name || 'Group', kind: 'group' }
    } else if (asSchool) {
      const s = asSchool as { school_name?: string; node_group_id?: string | null; is_demo?: boolean; is_test?: boolean }
      nodeId = s.node_group_id || (await ensureSchoolNode(svc, asSchool as never, { is_demo: !!s.is_demo, is_test: !!s.is_test }))
      node = nodeId ? { id: nodeId, name: s.school_name || 'School', kind: 'school' } : null
    } else if (asClass) {
      classRow = asClass as ClassRow
      if (classRow.school_id) {
        const { data: sch } = await svc
          .from('schools')
          .select('id, school_name, group_id, node_group_id, is_demo, is_test')
          .eq('id', classRow.school_id)
          .maybeSingle()
        const s = sch as { node_group_id?: string | null; is_demo?: boolean; is_test?: boolean } | null
        if (s) nodeId = s.node_group_id || (await ensureSchoolNode(svc, sch as never, { is_demo: !!s.is_demo, is_test: !!s.is_test }))
      }
      if (!nodeId && classRow.group_id) nodeId = classRow.group_id
      node = { id: classRow.id, name: classRow.class_name || 'Unnamed class', kind: 'class' }
    }
    if (!nodeId || !node) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    // THE GATE. The caller's own resolved subtree decides; the id they named
    // does not. Nothing below this line runs for a node outside it.
    if (!(await callerCanSeeGroup(svc, caller, nodeId))) {
      res.status(403).json({ error: 'You do not have access to this group' })
      return
    }

    // Coverage: a school-anchored node whose platform coverage has lapsed goes
    // dark, the same rule rate-compare applies; a plain group node is exempt.
    const ownSchoolId = classRow?.school_id ?? (await ownSchoolIdForNode(svc, nodeId))
    if (await isEntityCoverageExpired(svc, ownSchoolId)) {
      res.status(403).json({ error: 'coverage_expired', message: 'This school’s platform coverage has expired.' })
      return
    }

    const forest = (forestData ?? []) as ParentLinked[]
    const subtreeIds = descendantIds(forest, nodeId)
    let classes: ClassRow[]
    let schoolIds: string[]
    if (classRow) {
      classes = [classRow]
      schoolIds = classRow.school_id ? [classRow.school_id] : []
    } else {
      schoolIds = await schoolIdsForNodeSubtree(svc, nodeId)
      const seen = new Map<string, ClassRow>()
      const cols = 'id, class_name, course_code, school_id, group_id, teacher_user_id, class_learner_id'
      await Promise.all([
        ...chunk(schoolIds).map(async (batch) => {
          const { data } = await svc.from('classes').select(cols).in('school_id', batch).eq('is_active', true)
          for (const c of (data ?? []) as ClassRow[]) seen.set(c.id, c)
        }),
        ...chunk(subtreeIds).map(async (batch) => {
          const { data } = await svc.from('classes').select(cols).in('group_id', batch).eq('is_active', true)
          for (const c of (data ?? []) as ClassRow[]) seen.set(c.id, c)
        }),
      ])
      classes = [...seen.values()]
    }

    // A class lens counts its own teachers and students only — not the whole
    // school's staff — so the school ids are dropped from the people scope.
    const body = await computeOrgIntel(svc, node, classes, { schoolIds: classRow ? [] : schoolIds, groupIds: classRow ? [] : subtreeIds })
    res.status(200).json(body)
  } catch (err) {
    console.error('[org/intel] failed', err)
    res.status(500).json({ error: 'Could not read the organisation intelligence' })
  }
}
