/**
 * GET /api/groups/:id/home — the NODE HOME payload (archive/docs-retired-2026-08-24/THE-VIEW.md).
 *
 * One endpoint serves the one recursive dashboard at every level. `:id` is
 * resolved in order: a group node id, a school id (bridged to its node via
 * schools.node_group_id — minted on demand, THE-MODEL I2), or a class id
 * (kind 'class'). The page's five parts map straight onto the payload:
 *   - MAP RAIL     → ancestors (root→parent), siblings, children
 *   - IDENTITY     → node {name, label, demo, commercial trial/paid state}
 *   - STATS ROW    → node.rollup (subtree totals via computeNodeExtras — the
 *                    SAME resolver as the tree/table lenses) + practiceHours
 *                    (subtree school_summary sum PLUS directly group-attached
 *                    people's sessions — a group with no school still has
 *                    practice, and learnerCount already counts those people)
 *   - BELOW THIS   → tree {nodes, classes, staff} — the containment structure
 *                    under this node, drawn nested by the client; plus
 *                    children (direct child nodes) for the rail. A ?lens=
 *                    request returns the legacy flat slice instead.
 *   - VERBS        → client-side, calling the existing invite/create endpoints
 *
 * Lenses (?lens=groups|schools|teachers|classes) are FILTERS over the one
 * view, never separate pages — each returns the matching subtree-wide list.
 *
 * Server-mediated, service-role; authz via resolveGroupTreeCaller +
 * callerCanSeeGroup (ssi_admin: whole forest; group leader: own subtree,
 * with ancestors/siblings trimmed to their visible scope).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveGroupTreeCaller, callerCanSeeGroup } from '../../_utils/groupTreeAuth'
import { computeNodeExtras, type NodeExtras } from '../../_utils/groupRollups'
import { ensureSchoolNode } from '../../_utils/schoolNode'
import { chunk } from '../../_utils/schoolScope'
import { SCHOOL_STAFF_ROLES } from '../../_utils/schoolStaff'
import { directMemberPracticeSeconds } from '../../_utils/directMemberPractice'
import { descendantIds } from '../../_utils/groupSubtree'
import { leadersForNodes } from '../../_utils/groupLeaderTag'
import { sortByName } from '../../_utils/alphaSort'
import { loadClassPractice, practisedSince, topPhrases, ownAccountLedgerSeconds, CLASS_PRACTICE_WINDOW_DAYS } from '../../_utils/classPractice'
import { applyCors } from '../../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface GroupRow {
  id: string
  name: string
  type: string
  parent_id: string | null
  path: string | null
  is_demo: boolean
  is_test: boolean
}

interface NodeRef { id: string; name: string; label: string; is_demo: boolean; hasSchool: boolean }

/**
 * A class row as the subtree fetch reads it. The BELOW-THIS tree draws classes
 * as leaves of the containment structure, so the one subtree fetch carries the
 * columns that draw them rather than only the ids the rollups need.
 */
const SUBTREE_CLASS_COLUMNS = 'id, class_name, school_id, group_id, teacher_user_id, class_learner_id'
interface SubtreeClassRow {
  id: string
  class_name: string
  school_id: string | null
  group_id: string | null
  teacher_user_id: string | null
  class_learner_id: string | null
}

function toRef(g: GroupRow, schoolNodeIds: Set<string>): NodeRef {
  return { id: g.id, name: g.name, label: g.type, is_demo: g.is_demo, hasSchool: schoolNodeIds.has(g.id) }
}

/**
 * LEGO ordinal for a `S{NNNN}L{NN}` position id within a course — the same
 * (seed_number, lego_index) row-number ordering analytics_class_sessions_scoped
 * uses, computed as two indexed head-counts. Returns 0 when the id doesn't
 * parse (null/legacy values), so callers can fall back.
 */
async function legoOrdinal(svc: SupabaseClient, courseCode: string, legoId: string | null | undefined): Promise<number> {
  const m = typeof legoId === 'string' ? legoId.match(/S(\d+)L(\d+)/) : null
  if (!m) return 0
  const seed = parseInt(m[1], 10)
  const lego = parseInt(m[2], 10)
  const [{ count: before }, { count: within }] = await Promise.all([
    svc.from('course_legos').select('id', { count: 'exact', head: true }).eq('course_code', courseCode).lt('seed_number', seed),
    svc.from('course_legos').select('id', { count: 'exact', head: true }).eq('course_code', courseCode).eq('seed_number', seed).lte('lego_index', lego),
  ])
  return (before ?? 0) + (within ?? 0)
}

/** Learner display names for a set of auth uids, via learners.user_id. */
async function namesForAuthUids(svc: SupabaseClient, uids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  await Promise.all(chunk(uids).map(async (batch) => {
    const { data } = await svc.from('learners').select('user_id, display_name').in('user_id', batch)
    for (const l of data ?? []) {
      const uid = (l as any).user_id as string
      // Multiple learner accounts per person are intentional — first name wins.
      if (!names.has(uid)) names.set(uid, (l as any).display_name || 'Unnamed')
    }
  }))
  return names
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'GET' })) return

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }
  const svc = createClient(supabaseUrl, supabaseServiceKey)

  const rawId = String(req.query.id || '')
  const lens = typeof req.query.lens === 'string' ? req.query.lens : null

  try {
    // ─── One opening wave: auth + all three :id interpretations + the forest
    // map every later step needs (the serial version paid one DB round trip
    // per await — with the DB an ocean away that was most of the latency). ───
    const [caller, { data: asGroup }, { data: asSchool }, { data: asClass }, { data: allGroupsData }] = await Promise.all([
      resolveGroupTreeCaller(req, res, svc),
      svc.from('groups').select('id').eq('id', rawId).maybeSingle(),
      svc.from('schools').select('id, school_name, group_id, node_group_id, is_demo, is_test').eq('id', rawId).maybeSingle(),
      svc.from('classes').select('id, class_name, course_code, school_id, group_id, teacher_user_id, current_seed, last_lego_id, class_learner_id').eq('id', rawId).maybeSingle(),
      svc.from('groups').select('id, name, type, parent_id, path, is_demo, is_test'),
    ])
    if (!caller) return

    // ─── Resolve :id → a group node (or a class), same precedence as before ───
    let nodeId: string | null = null
    let classRow: { id: string; class_name: string; course_code: string; school_id: string | null; group_id: string | null; teacher_user_id: string | null; current_seed: number | null; last_lego_id: string | null; class_learner_id: string | null } | null = null

    if (asGroup) {
      nodeId = rawId
    } else if (asSchool) {
      nodeId = (asSchool as any).node_group_id
        || (await ensureSchoolNode(svc, asSchool as any, { is_demo: (asSchool as any).is_demo, is_test: (asSchool as any).is_test }))
    } else if (asClass) {
      classRow = asClass as any
      if (classRow!.school_id) {
        const { data: sch } = await svc
          .from('schools')
          .select('id, school_name, group_id, node_group_id, is_demo, is_test')
          .eq('id', classRow!.school_id)
          .maybeSingle()
        if (sch) {
          nodeId = (sch as any).node_group_id
            || (await ensureSchoolNode(svc, sch as any, { is_demo: (sch as any).is_demo, is_test: (sch as any).is_test }))
        }
      }
      if (!nodeId && classRow!.group_id) nodeId = classRow!.group_id
    }
    if (!nodeId) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (!(await callerCanSeeGroup(svc, caller, nodeId))) {
      res.status(403).json({ error: 'You do not have access to this group' })
      return
    }

    // ─── Forest maps (already fetched in the opening wave) ───
    const allGroups = (allGroupsData ?? []) as GroupRow[]
    const byId = new Map(allGroups.map((g) => [g.id, g]))
    const nodeRow = byId.get(nodeId)
    if (!nodeRow) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    // Subtree membership + subtree school ids (node bridge ∪ legacy parent
    // attachment — same union groupRollups counts through). Membership walks
    // parent_id, never the slug path: two orgs of the same name share a slug,
    // and a path match then folds the other tenant into this one's numbers.
    const subtreeIds = descendantIds(allGroups, nodeId)
    const subtreeIdSet = new Set(subtreeIds)

    // BELOW THIS is DRAWN, not filtered (founder ruling 2026-09-07): a node
    // home renders the containment structure beneath it — child nodes nested,
    // their classes as leaves, staff with no class of their own — instead of
    // one flat filtered slice at a time. Lens payloads stay for the legacy
    // ?lens= URLs; the tree is what the page itself asks for.
    const drawsTree = !lens && !classRow

    const childRows = sortByName(
      allGroups.filter((g) => g.parent_id === nodeId),
      (g) => g.name,
    )

    // ─── Subtree schools + node/children rollups (the same shared resolver,
    // fed the forest already in hand) + practice hours: ONE concurrent wave.
    // Practice hours chains off the schools fetch it needs. ───
    const schoolRows: { id: string; school_name: string; node_group_id: string | null; group_id: string | null }[] = []
    const seenSchoolIds = new Set<string>()
    const schoolsPromise = Promise.all(chunk(subtreeIds).flatMap((batch) => [
      svc.from('schools').select('id, school_name, node_group_id, group_id').in('node_group_id', batch),
      svc.from('schools').select('id, school_name, node_group_id, group_id').in('group_id', batch),
    ])).then((results) => {
      for (const { data } of results) {
        for (const s of data ?? []) {
          if (!seenSchoolIds.has((s as any).id)) { seenSchoolIds.add((s as any).id); schoolRows.push(s as any) }
        }
      }
    })
    // Subtree classes — node-attached (group_id) ∪ legacy school-attached.
    // Shared by the class-practice rollup, the direct-member practice term and
    // the BELOW-THIS tree (a class is a leaf of the containment structure, so
    // the rows come off this one fetch rather than a second pass).
    const subtreeClassesPromise = schoolsPromise.then(async () => {
      const byId = new Map<string, SubtreeClassRow>()
      const add = (rows: any[] | null) => {
        for (const c of rows ?? []) if (!byId.has(c.id)) byId.set(c.id, c as SubtreeClassRow)
      }
      await Promise.all([
        ...chunk(subtreeIds).map(async (batch) => {
          const { data } = await svc.from('classes').select(SUBTREE_CLASS_COLUMNS).in('group_id', batch).eq('is_active', true)
          add(data)
        }),
        ...chunk(schoolRows.map((s) => s.id)).map(async (batch) => {
          const { data } = await svc.from('classes').select(SUBTREE_CLASS_COLUMNS).in('school_id', batch).eq('is_active', true)
          add(data)
        }),
      ])
      return [...byId.values()]
    })
    const classIdsPromise = subtreeClassesPromise.then((rows) => new Set(rows.map((c) => c.id)))
    // PRACTICE HOURS — subtree school_summary sum PLUS the practice of people
    // attached directly to the group nodes with no school/class under them.
    // Without that second term an org whose people were invited straight into
    // the group reports 0h forever while `learnerCount` says 1+, and the
    // explainer's org-not-started rule tells its leader nobody has practised
    // (live defect, 2026-08-06 — see api/_utils/directMemberPractice.ts).
    const practiceHoursPromise = schoolsPromise.then(async () => {
      let hours = 0
      const classIds = await classIdsPromise
      await Promise.all([
        ...chunk(schoolRows.map((s) => s.id)).map(async (batch) => {
          const { data } = await svc.from('school_summary').select('school_id, total_practice_hours').in('school_id', batch)
          for (const r of data ?? []) hours += Number((r as any).total_practice_hours) || 0
        }),
        directMemberPracticeSeconds(svc, {
          subtreeGroupIds: subtreeIds,
          subtreeSchoolIds: schoolRows.map((s) => s.id),
          subtreeClassIds: [...classIds],
        }).then((seconds) => { hours += seconds / 3600 }),
      ])
      return hours
    })
    // CLASS PRACTICE rollup — classes practising together across the subtree,
    // the primary school metric, read off the diary (`player_events` under
    // each class's own account) and the class enrollment cursor — NEVER
    // `class_sessions` (dead since 2026-08-19) and NEVER the class account's
    // `sessions.duration_seconds` (absent for real lessons: see
    // _utils/classPractice.ts). Whole-class play has no measured TIME in any
    // ledger, so this block carries none — it carries PHRASES SPOKEN (Tom's
    // term for cycles played) and the phrase-by-count list, plus the
    // own-account minutes of staff and students off the playback ledger, kept
    // as its own field so whole-class play is never folded into a minute
    // figure it did not earn (job #159, 2026-09-10).
    const classPracticeFactsPromise = subtreeClassesPromise.then((subtreeClasses) => loadClassPractice(svc, subtreeClasses))
    const classPracticePromise = Promise.all([subtreeClassesPromise, classPracticeFactsPromise, classIdsPromise]).then(async ([subtreeClasses, practice, classIds]) => {
      const weekAgo = Date.now() - CLASS_PRACTICE_WINDOW_DAYS * 86400000
      let phrases7d = 0
      let classesWithPhrases7d = 0
      let activeClasses7d = 0
      for (const facts of practice.values()) {
        phrases7d += facts.phrases
        if (facts.phrases > 0) classesWithPhrases7d += 1
        if (practisedSince(facts, weekAgo)) activeClasses7d += 1
      }
      const [topPhrases7d, own] = await Promise.all([
        topPhrases(svc, practice.values(), 12),
        ownAccountLedgerSeconds(svc, {
          schoolIds: schoolRows.map((s) => s.id),
          groupIds: subtreeIds,
          classIds: [...classIds],
        }),
      ])
      return {
        windowDays: CLASS_PRACTICE_WINDOW_DAYS,
        classCount: subtreeClasses.length,
        activeClasses7d,
        phrases7d,
        classesWithPhrases7d,
        topPhrases7d,
        ownAccountMinutes7d: Math.round(own.seconds / 60),
        ownAccountPeople7d: own.people,
      }
    })
    // WHO LEADS THIS NODE. The org page could name the leader of a group
    // nowhere at all: leadership lived only in govt_admins, which is authz and
    // is read by no lens. A creator therefore governed a group that listed no
    // manager (founder ruling 2026-08-06 — the creator IS the first manager).
    // Unioned across govt_admins + the leader membership tag so orgs created
    // before the ruling still name theirs.
    const leadersPromise = leadersForNodes(svc, [nodeId])
    // DOES THIS NODE REPORT TO A FUNDER? One primary-key lookup, and the whole
    // reason it lives here rather than behind its own endpoint: the node home
    // is already being built, and a leader must be able to find their own
    // numbers without an ssi_admin pulling them (job #572). Present only on
    // the org's OWN node — the policy row is keyed by group_id, so a child
    // node correctly reports nothing and the export stays a whole-org measure.
    const funderPolicyPromise = svc
      .from('org_enrolment_policies')
      .select('org_display_name, is_active')
      .eq('group_id', nodeId)
      .maybeSingle()
    const [, extras, practiceHours, classPractice, leadersByNode, funderPolicy] = await Promise.all([
      schoolsPromise,
      // The BELOW-THIS tree draws every node in the subtree, so it needs
      // their rollups; a lens request (or a class home) still pays only for
      // this node and its direct children.
      computeNodeExtras(svc, drawsTree ? subtreeIds : [nodeId, ...childRows.map((c) => c.id)], allGroups),
      practiceHoursPromise,
      classPracticePromise,
      leadersPromise,
      funderPolicyPromise,
    ])
    const leaderUids = [...(leadersByNode.get(nodeId) || [])]
    const leaderNames = await namesForAuthUids(svc, leaderUids)
    const leaders = leaderUids
      .map((uid) => ({ user_id: uid, name: leaderNames.get(uid) || 'Unnamed' }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const schoolNodeIds = new Set(schoolRows.map((s) => s.node_group_id).filter(Boolean) as string[])
    const subtreeSchoolIds = schoolRows.map((s) => s.id)

    // ─── Map rail: ancestors, siblings, children — trimmed to the caller's
    // visible scope (a leader never sees above their own governed group). ───
    const scopeRootId = caller.isAdmin ? null : caller.ownGroupId
    const ancestors: NodeRef[] = []
    if (!scopeRootId || nodeId !== scopeRootId) {
      let cursor = nodeRow.parent_id ? byId.get(nodeRow.parent_id) : undefined
      while (cursor) {
        ancestors.unshift(toRef(cursor, schoolNodeIds))
        if (scopeRootId && cursor.id === scopeRootId) break
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined
      }
      if (scopeRootId && !ancestors.some((a) => a.id === scopeRootId)) {
        // Node reachable but its chain never met the leader's root — hide the chain.
        ancestors.length = 0
      }
    }

    const parentVisible = caller.isAdmin
      || (scopeRootId !== null && nodeRow.parent_id !== null && ancestors.some((a) => a.id === nodeRow.parent_id))
    const siblings: NodeRef[] = parentVisible
      ? sortByName(
          allGroups.filter((g) => g.parent_id === nodeRow.parent_id && g.id !== nodeId),
          (g) => g.name,
        ).map((g) => toRef(g, schoolNodeIds))
      : []

    const withExtras = (g: GroupRow) => {
      const ex: NodeExtras = extras[g.id] || { rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0 }, commercial: null }
      return { ...toRef(g, schoolNodeIds), is_test: g.is_test, rollup: ex.rollup, commercial: ex.commercial }
    }

    // ─── Class kind — leaf home: teachers (read-only, co-teacher view) +
    // learners as children, carrying the teaching data the old roster had
    // (belt-bearing seeds/LEGO counts, last-7-days) so the class node home
    // is the page teachers teach from — the individual learner page is gone
    // (founder ruling 2026-07-19). No streaks anywhere: founder ruling
    // 2026-07-19, reasoning in archive/docs-retired-2026-08-24/gamification-done-right.md.
    if (classRow) {
      const [{ data: ct }, { data: csp }, { count: legoTotal }, { data: classStats }, classPracticeByClass, { data: classEnrollment }] = await Promise.all([
        svc.from('class_teachers').select('teacher_user_id, is_lead').eq('class_id', classRow.id),
        svc.from('class_student_progress').select('learner_id, student_name, seeds_completed, legos_mastered, total_practice_seconds, last_active_at, joined_class_at').eq('class_id', classRow.id),
        svc.from('course_legos').select('id', { count: 'exact', head: true }).eq('course_code', classRow.course_code),
        svc.from('class_activity_stats').select('total_practice_seconds, active_students, school_id, region_code, course_code').eq('class_id', classRow.id).maybeSingle(),
        // PLAY-AS-CLASS IS THE PRIMARY METRIC (founder ruling): the class's
        // own teacher-led sessions lead this page — off the class-entity
        // spine, not the dead `class_sessions` table (_utils/classPractice.ts).
        loadClassPractice(svc, [classRow]),
        // The class's OWN learning account (THE-MODEL I6) — its enrollment
        // cursor is what play-as-class advances, and is the journey source.
        classRow.class_learner_id
          ? svc.from('course_enrollments').select('highest_completed_lego_id, last_completed_lego_id, last_practiced_at, total_practice_minutes').eq('learner_id', classRow.class_learner_id).eq('course_id', classRow.course_code).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ])
      const teacherIds = new Set<string>((ct ?? []).map((t: any) => t.teacher_user_id))
      if (classRow.teacher_user_id) teacherIds.add(classRow.teacher_user_id)

      // Second wave — teacher names, per-student daily activity (last 14 days,
      // player_events-derived, same source StudentProgressView used) and the
      // benchmark demographics all only need wave 1: run them together.
      const learnerIds = (csp ?? []).map((s: any) => s.learner_id).filter(Boolean)
      const since = new Date()
      since.setDate(since.getDate() - 14)
      const sinceDay = since.toISOString().split('T')[0]
      const secondsByLearnerDay = new Map<string, Map<string, number>>()
      const [teacherNames, , { data: demographics }] = await Promise.all([
        namesForAuthUids(svc, [...teacherIds]),
        Promise.all(chunk(learnerIds).map(async (batch) => {
          const { data } = await svc
            .from('learner_speaking_opportunities')
            .select('learner_id, day, play_seconds')
            .in('learner_id', batch)
            .gte('day', sinceDay)
          for (const r of data ?? []) {
            const lid = (r as any).learner_id as string
            const day = String((r as any).day)
            if (!secondsByLearnerDay.has(lid)) secondsByLearnerDay.set(lid, new Map())
            const m = secondsByLearnerDay.get(lid)!
            m.set(day, (m.get(day) || 0) + (Number((r as any).play_seconds) || 0))
          }
        })),
        classStats
          ? svc
              .from('demographic_cycle_averages')
              .select('level, group_id, avg_cycles_per_session')
              .in('level', ['school', 'course'])
              .in('group_id', [(classStats as any).school_id, (classStats as any).course_code].filter(Boolean))
          : Promise.resolve({ data: null as any[] | null }),
      ])
      const teachers = [...teacherIds].map((uid) => ({
        user_id: uid,
        name: teacherNames.get(uid) || 'Unnamed',
        is_lead: uid === classRow!.teacher_user_id || (ct ?? []).some((t: any) => t.teacher_user_id === uid && t.is_lead),
      })).sort((a, b) => Number(b.is_lead) - Number(a.is_lead) || a.name.localeCompare(b.name))
      const dayKey = (offset: number): string => {
        const d = new Date()
        d.setDate(d.getDate() - offset)
        return d.toISOString().split('T')[0]
      }
      // Same roster as ClassDetail.vue's teacher-facing view (also name-
      // ordered) — this is an operational roster, not a ranking, so it stays
      // alphabetical rather than forking a second order for the same class.
      const students = sortByName(
        (csp ?? []).map((s: any) => {
          const days = secondsByLearnerDay.get(s.learner_id)
          const last7 = Array.from({ length: 7 }, (_, i) => Math.round(((days?.get(dayKey(6 - i)) || 0) / 60)))
          return {
            learner_id: s.learner_id,
            name: s.student_name || 'Unnamed',
            seeds_completed: Number(s.seeds_completed) || 0,
            legos_mastered: Number(s.legos_mastered) || 0,
            practice_hours: Math.round(((Number(s.total_practice_seconds) || 0) / 3600) * 10) / 10,
            last_active_at: s.last_active_at,
            joined_class_at: s.joined_class_at,
            last7_minutes: last7,
            week_minutes: last7.reduce((a, b) => a + b, 0),
          }
        }),
        (s) => s.name,
      )

      const classHours = (csp ?? []).reduce((sum: number, s: any) => sum + (Number(s.total_practice_seconds) || 0), 0) / 3600

      // ─── CLASS PRACTICE — the headline layer (founder ruling: play-as-class
      // is the only metric that matters in a school; students are the bonus).
      // Phrases spoken this week and the phrases themselves, off the diary;
      // no session count and no hours, because the class account's `sessions`
      // rows do not describe its lessons (_utils/classPractice.ts). ───
      const classFacts = classPracticeByClass.get(classRow.id)
      const classPractice = {
        windowDays: CLASS_PRACTICE_WINDOW_DAYS,
        phrases7d: classFacts?.phrases ?? 0,
        // The cursor stamp counts as evidence the class practised even when
        // the diary is empty, so "last practised" is never falsely blank.
        lastPractisedAt: classFacts?.lastPractisedAt ?? null,
        phrases: await topPhrases(svc, [classFacts], 40),
      }

      // Journey: how far the CLASS has travelled together — the class-entity's
      // play-as-class position (enrollment ceiling, falling back to the
      // enrollment's last completed LEGO, then classes.last_lego_id) — live
      // class enrollments carry the cursor but no ceiling — expressed as a
      // LEGO ordinal so it shares units with the course total. Only when no
      // class play exists at all do we fall back to the legacy current_seed
      // estimate (a seed count — kept so pre-play classes still show a bar).
      const journeyTotal = Number(legoTotal) || 0
      const journeyLegoId = (classEnrollment as any)?.highest_completed_lego_id
        || (classEnrollment as any)?.last_completed_lego_id
        || classRow.last_lego_id
        || null
      const journeyOrd = journeyLegoId ? await legoOrdinal(svc, classRow.course_code, journeyLegoId) : 0
      const journeySeedMatch = journeyLegoId?.match(/S(\d+)L/)
      const journeyDone = journeyOrd > 0
        ? Math.min(journeyTotal || journeyOrd, journeyOrd)
        : (journeyTotal > 0 ? Math.min(journeyTotal, classRow.current_seed || 0) : (classRow.current_seed || 0))

      // Practice min/student/week benchmark vs school + course averages
      // (the old page's Bench card, same formulas).
      let benchmark: { class: number; school: number; course: number } | null = null
      if (classStats) {
        const activeStudents = Number((classStats as any).active_students) || students.length || 1
        const classMin = Math.round((Number((classStats as any).total_practice_seconds) || 0) / 60 / Math.max(1, activeStudents))
        const avgFor = (level: string, groupId: string | null): number => {
          const d = (demographics ?? []).find((r: any) => r.level === level && r.group_id === groupId)
          return d ? Math.round((Number((d as any).avg_cycles_per_session) || 0) * 0.6) : 0
        }
        benchmark = {
          class: classMin,
          school: avgFor('school', (classStats as any).school_id),
          course: avgFor('course', (classStats as any).course_code),
        }
      }

      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({
        kind: 'class',
        node: {
          id: classRow.id,
          name: classRow.class_name,
          label: 'class',
          is_demo: nodeRow.is_demo,
          course_code: classRow.course_code,
          rollup: { childGroupCount: 0, teacherCount: teachers.length, classCount: 1, learnerCount: students.length },
          commercial: null,
        },
        // The class's school node is the last ancestor — the rail runs root →
        // … → school → class.
        ancestors: [...ancestors, toRef(nodeRow, schoolNodeIds)],
        siblings: [],
        children: [],
        teachers,
        students,
        journey: {
          done: journeyDone,
          total: journeyTotal,
          source: journeyOrd > 0 ? 'class-play' : 'estimate',
          legoId: journeyOrd > 0 ? journeyLegoId : null,
          seedNumber: journeyOrd > 0 && journeySeedMatch ? parseInt(journeySeedMatch[1], 10) : null,
        },
        benchmark,
        classPractice,
        practiceHours: Math.round(classHours * 10) / 10,
        schoolId: classRow.school_id,
        nodeId,
      })
      return
    }

    // ─── BELOW THIS, DRAWN — the containment structure under this node.
    // Flat arrays keyed by the node they hang under; the client nests them
    // (components/admin/belowTree.ts). Three kinds of row, and that is the
    // whole model: NODES (groups/schools, each with its subtree rollup),
    // CLASSES (leaves, on the node that holds them), STAFF (people in the
    // subtree who teach no class — drawn so an invited teacher with nothing
    // to teach yet is visible rather than missing). Learners are counts on
    // the nodes, never rows: a 400-pupil school is a number, not a list. ───
    let treePayload: Record<string, unknown> | null = null
    const classPracticeFacts = await classPracticeFactsPromise
    if (drawsTree) {
      const subtreeClasses = await subtreeClassesPromise
      const classIds = subtreeClasses.map((c) => c.id)
      const schoolById = new Map(schoolRows.map((s) => [s.id, s]))
      // A class hangs under its own group node, or under the node its school
      // bridges to (schools.node_group_id ?? schools.group_id). Anything that
      // resolves outside this subtree hangs under the node being viewed.
      const nodeForClass = (c: SubtreeClassRow): string => {
        if (c.group_id && subtreeIdSet.has(c.group_id)) return c.group_id
        const sch = c.school_id ? schoolById.get(c.school_id) : undefined
        const viaSchool = sch?.node_group_id || sch?.group_id || null
        if (viaSchool && subtreeIdSet.has(viaSchool)) return viaSchool
        return nodeId!
      }

      const teachersByClass = new Map<string, Set<string>>()
      const studentCountByClass = new Map<string, number>()
      const staffNodeByUid = new Map<string, string>()
      await Promise.all([
        ...chunk(classIds).map(async (batch) => {
          const { data } = await svc.from('class_teachers').select('class_id, teacher_user_id').in('class_id', batch)
          for (const t of data ?? []) {
            const cid = (t as any).class_id as string
            if (!teachersByClass.has(cid)) teachersByClass.set(cid, new Set())
            teachersByClass.get(cid)!.add((t as any).teacher_user_id)
          }
        }),
        ...chunk(classIds).map(async (batch) => {
          const { data } = await svc.from('class_student_progress').select('class_id').in('class_id', batch)
          for (const r of data ?? []) {
            const cid = (r as any).class_id as string
            studentCountByClass.set(cid, (studentCountByClass.get(cid) || 0) + 1)
          }
        }),
        // Staff tags — the same union the teachers lens reads (school staff =
        // teacher OR admin), remembered against the node they sit on.
        ...chunk(subtreeSchoolIds).map(async (batch) => {
          const { data } = await svc
            .from('user_tags').select('user_id, tag_value')
            .eq('tag_type', 'school').in('role_in_context', SCHOOL_STAFF_ROLES).is('removed_at', null)
            .in('tag_value', batch.map((id) => `SCHOOL:${id}`))
          for (const t of data ?? []) {
            const schoolId = String((t as any).tag_value).replace('SCHOOL:', '')
            const sch = schoolById.get(schoolId)
            const node = sch?.node_group_id || sch?.group_id || null
            if (node && subtreeIdSet.has(node)) staffNodeByUid.set((t as any).user_id, node)
          }
        }),
        ...chunk(subtreeIds).map(async (batch) => {
          const { data } = await svc
            .from('user_tags').select('user_id, tag_value')
            .eq('tag_type', 'group').eq('role_in_context', 'teacher').is('removed_at', null)
            .in('tag_value', batch.map((id) => `GROUP:${id}`))
          for (const t of data ?? []) {
            const node = String((t as any).tag_value).replace('GROUP:', '')
            if (subtreeIdSet.has(node)) staffNodeByUid.set((t as any).user_id, node)
          }
        }),
      ])
      // The class's own lead pointer counts as a teacher of it.
      for (const c of subtreeClasses) {
        if (c.teacher_user_id) {
          if (!teachersByClass.has(c.id)) teachersByClass.set(c.id, new Set())
          teachersByClass.get(c.id)!.add(c.teacher_user_id)
        }
      }
      // Every teacher below, on the node they sit on — a teacher with classes
      // sits on the node of the first class they teach, one without classes on
      // the node they were tagged into. The tree draws them as people because
      // the verbs that belong to a person (assign to a class, mint an access
      // code) need a row to live on.
      for (const c of subtreeClasses) {
        for (const uid of teachersByClass.get(c.id) || []) {
          if (!staffNodeByUid.has(uid)) staffNodeByUid.set(uid, nodeForClass(c))
        }
      }
      const staffUids = [...staffNodeByUid.keys()]
      const names = await namesForAuthUids(svc, staffUids)

      treePayload = {
        tree: {
          nodes: sortByName(
            allGroups.filter((g) => subtreeIdSet.has(g.id) && g.id !== nodeId),
            (g) => g.name,
          ).map((g) => ({
            ...toRef(g, schoolNodeIds),
            parentId: g.parent_id,
            rollup: extras[g.id]?.rollup ?? null,
            commercial: extras[g.id]?.commercial ?? null,
          })),
          classes: subtreeClasses
            .map((c) => ({
              id: c.id,
              name: c.class_name,
              nodeId: nodeForClass(c),
              teachers: [...(teachersByClass.get(c.id) || [])].map((uid) => names.get(uid) || 'Unnamed').sort(),
              studentCount: studentCountByClass.get(c.id) || 0,
              // Whole-class play this week, per class — the row a head of
              // department reads on a Monday: who did it, who has gone quiet.
              phrases7d: classPracticeFacts.get(c.id)?.phrases ?? 0,
              lastPractisedAt: classPracticeFacts.get(c.id)?.lastPractisedAt ?? null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          staff: staffUids
            .map((uid) => ({
              user_id: uid,
              name: names.get(uid) || 'Unnamed',
              nodeId: staffNodeByUid.get(uid)!,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        },
      }
    }

    // ─── Lens payloads (subtree-wide filters over the one view) ───
    let lensPayload: Record<string, unknown> | null = null

    if (lens === 'groups') {
      // Alphabetical by name (founder ruling 2026-07-30: same consistent
      // order as every other structural list) — was path-ordered, which
      // grouped by tree position instead of matching the flat "All schools"/
      // "All teachers" lenses' order.
      const descendants = sortByName(
        allGroups.filter((g) => subtreeIdSet.has(g.id) && g.id !== nodeId),
        (g) => g.name,
      )
      const descExtras = await computeNodeExtras(svc, descendants.map((d) => d.id), allGroups)
      lensPayload = {
        groups: descendants.map((g) => ({
          ...toRef(g, schoolNodeIds),
          parentName: g.parent_id ? byId.get(g.parent_id)?.name || null : null,
          depth: nodeRow.path && g.path ? g.path.split('/').length - nodeRow.path.split('/').length : 1,
          rollup: descExtras[g.id]?.rollup,
          commercial: descExtras[g.id]?.commercial,
        })),
      }
    } else if (lens === 'schools') {
      // Summaries + teacher tags only need school ids — one parallel wave.
      const summaries = new Map<string, any>()
      const teacherUidsBySchool = new Map<string, Set<string>>()
      await Promise.all([
        ...chunk(subtreeSchoolIds).map(async (batch) => {
          const { data } = await svc.from('school_summary').select('*').in('school_id', batch)
          for (const r of data ?? []) summaries.set((r as any).school_id, r)
        }),
        // Teachers per school (names, for the "with teachers" lens promise).
        // STAFF = teacher OR admin — a school's own admin is one of the
        // people a leader means by "who works at this school" (and the only
        // one at a school that has not yet invited a teacher).
        ...chunk(subtreeSchoolIds).map(async (batch) => {
          const { data } = await svc
            .from('user_tags')
            .select('tag_value, user_id')
            .eq('tag_type', 'school').in('role_in_context', SCHOOL_STAFF_ROLES).is('removed_at', null)
            .in('tag_value', batch.map((id) => `SCHOOL:${id}`))
          for (const t of data ?? []) {
            const sid = ((t as any).tag_value as string).replace('SCHOOL:', '')
            if (!teacherUidsBySchool.has(sid)) teacherUidsBySchool.set(sid, new Set())
            teacherUidsBySchool.get(sid)!.add((t as any).user_id)
          }
        }),
      ])
      const allUids = [...new Set([...teacherUidsBySchool.values()].flatMap((s) => [...s]))]
      const names = await namesForAuthUids(svc, allUids)
      // Alphabetical by name (founder ruling 2026-07-30: "the schools are
      // listed in a different order from the groups and the everything
      // directly below") — this used to rank by practised hours, the exact
      // same-schools-different-order defect the ruling closes off. Practice
      // hours is still shown as a column; it just no longer drives the order.
      lensPayload = {
        schools: sortByName(
          schoolRows.map((s) => {
            const sum = summaries.get(s.id)
            return {
              schoolId: s.id,
              nodeId: s.node_group_id,
              name: sum?.school_name || s.school_name,
              teacherCount: Number(sum?.teacher_count) || 0,
              classCount: Number(sum?.class_count) || 0,
              studentCount: Number(sum?.student_count) || 0,
              practiceHours: Math.round((Number(sum?.total_practice_hours) || 0) * 10) / 10,
              hasAdmin: Boolean(sum?.has_admin),
              teachers: [...(teacherUidsBySchool.get(s.id) || [])].map((uid) => names.get(uid) || 'Unnamed').sort(),
            }
          }),
          (s) => s.name,
        ),
      }
    } else if (lens === 'teachers' || lens === 'classes') {
      // Subtree classes: node-attached (group_id) ∪ legacy school-attached —
      // both arms of the union in one parallel wave, plus (teachers lens) the
      // school/group teacher tags that don't need class ids.
      const classes: { id: string; class_name: string; school_id: string | null; group_id: string | null; teacher_user_id: string | null; class_learner_id: string | null }[] = []
      const seenClassIds = new Set<string>()
      const addClasses = (rows: any[] | null) => {
        for (const c of rows ?? []) if (!seenClassIds.has(c.id)) { seenClassIds.add(c.id); classes.push(c) }
      }
      const taggedTeacherUids = new Set<string>()
      await Promise.all([
        ...chunk(subtreeIds).map(async (batch) => {
          const { data } = await svc.from('classes').select('id, class_name, school_id, group_id, teacher_user_id, class_learner_id').in('group_id', batch).eq('is_active', true)
          addClasses(data)
        }),
        ...chunk(subtreeSchoolIds).map(async (batch) => {
          const { data } = await svc.from('classes').select('id, class_name, school_id, group_id, teacher_user_id, class_learner_id').in('school_id', batch).eq('is_active', true)
          addClasses(data)
        }),
        ...(lens === 'teachers'
          ? [
              ...chunk(subtreeSchoolIds).map(async (batch) => {
                const { data } = await svc
                  .from('user_tags').select('user_id')
                  .eq('tag_type', 'school').in('role_in_context', SCHOOL_STAFF_ROLES).is('removed_at', null)
                  .in('tag_value', batch.map((id) => `SCHOOL:${id}`))
                for (const t of data ?? []) taggedTeacherUids.add((t as any).user_id)
              }),
              ...chunk(subtreeIds).map(async (batch) => {
                const { data } = await svc
                  .from('user_tags').select('user_id')
                  .eq('tag_type', 'group').eq('role_in_context', 'teacher').is('removed_at', null)
                  .in('tag_value', batch.map((id) => `GROUP:${id}`))
                for (const t of data ?? []) taggedTeacherUids.add((t as any).user_id)
              }),
            ]
          : []),
      ])
      const classIds = classes.map((c) => c.id)

      // Teacher↔class (source of truth) + students/hours per class — both only
      // need class ids: one parallel wave.
      const teachersByClass = new Map<string, Set<string>>()
      const studentCountByClass = new Map<string, number>()
      const hoursByClass = new Map<string, number>()
      const phrasesByClass = new Map<string, number>()
      const lastClassSessionByClass = new Map<string, string>()
      await Promise.all([
        ...chunk(classIds).map(async (batch) => {
          const { data } = await svc.from('class_teachers').select('class_id, teacher_user_id').in('class_id', batch)
          for (const t of data ?? []) {
            const cid = (t as any).class_id as string
            if (!teachersByClass.has(cid)) teachersByClass.set(cid, new Set())
            teachersByClass.get(cid)!.add((t as any).teacher_user_id)
          }
        }),
        ...chunk(classIds).map(async (batch) => {
          const { data } = await svc.from('class_student_progress').select('class_id, total_practice_seconds').in('class_id', batch)
          for (const r of data ?? []) {
            const cid = (r as any).class_id as string
            studentCountByClass.set(cid, (studentCountByClass.get(cid) || 0) + 1)
            hoursByClass.set(cid, (hoursByClass.get(cid) || 0) + (Number((r as any).total_practice_seconds) || 0) / 3600)
          }
        }),
        // Class practice per class (the primary metric) — classes lens only.
        // Same live spine as the subtree rollup: _utils/classPractice.ts.
        ...(lens === 'classes'
          ? [
              loadClassPractice(svc, classes).then((practice) => {
                for (const [cid, facts] of practice) {
                  phrasesByClass.set(cid, facts.phrases)
                  if (facts.lastPractisedAt) lastClassSessionByClass.set(cid, facts.lastPractisedAt)
                }
              }),
            ]
          : []),
      ])
      // Lead pointer unioned in after the wave.
      for (const c of classes) {
        if (c.teacher_user_id) {
          if (!teachersByClass.has(c.id)) teachersByClass.set(c.id, new Set())
          teachersByClass.get(c.id)!.add(c.teacher_user_id)
        }
      }

      const schoolNameById = new Map(schoolRows.map((s) => [s.id, s.school_name]))
      const homeName = (c: { school_id: string | null; group_id: string | null }) =>
        (c.school_id && schoolNameById.get(c.school_id)) || (c.group_id && byId.get(c.group_id)?.name) || null

      if (lens === 'classes') {
        const allUids = [...new Set([...teachersByClass.values()].flatMap((s) => [...s]))]
        const names = await namesForAuthUids(svc, allUids)
        lensPayload = {
          classes: classes.map((c) => ({
            id: c.id,
            name: c.class_name,
            home: homeName(c),
            teachers: [...(teachersByClass.get(c.id) || [])].map((uid) => names.get(uid) || 'Unnamed').sort(),
            studentCount: studentCountByClass.get(c.id) || 0,
            practiceHours: Math.round((hoursByClass.get(c.id) || 0) * 10) / 10,
            phrases7d: phrasesByClass.get(c.id) || 0,
            lastClassSessionAt: lastClassSessionByClass.get(c.id) || null,
          })).sort((a, b) => (a.home || '').localeCompare(b.home || '') || a.name.localeCompare(b.name)),
        }
      } else {
        // teachers lens: every teacher below (school + group tags, fetched in
        // the first wave), with their classes in this subtree.
        const teacherUids = new Set<string>(taggedTeacherUids)
        for (const uids of teachersByClass.values()) for (const uid of uids) teacherUids.add(uid)

        const classesByTeacher = new Map<string, { id: string; name: string; home: string | null }[]>()
        for (const c of classes) {
          for (const uid of teachersByClass.get(c.id) || []) {
            if (!classesByTeacher.has(uid)) classesByTeacher.set(uid, [])
            classesByTeacher.get(uid)!.push({ id: c.id, name: c.class_name, home: homeName(c) })
          }
        }
        const names = await namesForAuthUids(svc, [...teacherUids])
        lensPayload = {
          teachers: [...teacherUids].map((uid) => ({
            user_id: uid,
            name: names.get(uid) || 'Unnamed',
            classes: (classesByTeacher.get(uid) || []).sort((a, b) => a.name.localeCompare(b.name)),
          })).sort((a, b) => a.name.localeCompare(b.name)),
        }
      }
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      kind: 'node',
      node: withExtras(nodeRow),
      ancestors,
      siblings,
      children: childRows.map(withExtras),
      practiceHours: Math.round(practiceHours * 10) / 10,
      leaders,
      // Non-null only when this node IS a funded org with a live enrolment
      // policy. The client renders the funder-numbers panel off its presence,
      // so a node that reports to nobody carries no extra chrome and pays for
      // no extra request.
      funderReporting: (funderPolicy as any)?.data?.is_active
        ? { orgName: (funderPolicy as any).data.org_display_name as string }
        : null,
      classPractice,
      ...(treePayload || {}),
      ...(lensPayload || {}),
    })
  } catch (error) {
    console.error('[Groups/Home] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
