/**
 * GET /api/groups/:id/home — the NODE HOME payload (docs/THE-VIEW.md).
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
 *   - CHILDREN     → children (direct child nodes, each with rollups), or the
 *                    subtree-wide lens payload when ?lens= is set
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
    // Subtree class ids — node-attached (group_id) ∪ legacy school-attached.
    // Shared by the class-practice rollup and the direct-member practice term.
    const classIdsPromise = schoolsPromise.then(async () => {
      const classIds = new Set<string>()
      await Promise.all([
        ...chunk(subtreeIds).map(async (batch) => {
          const { data } = await svc.from('classes').select('id').in('group_id', batch).eq('is_active', true)
          for (const c of data ?? []) classIds.add((c as any).id)
        }),
        ...chunk(schoolRows.map((s) => s.id)).map(async (batch) => {
          const { data } = await svc.from('classes').select('id').in('school_id', batch).eq('is_active', true)
          for (const c of data ?? []) classIds.add((c as any).id)
        }),
      ])
      return classIds
    })
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
    // CLASS PRACTICE rollup — classes practising together across the subtree
    // (class_sessions), the primary school metric.
    const classPracticePromise = classIdsPromise.then(async (classIds) => {
      let seconds = 0
      let sessions7d = 0
      const active7d = new Set<string>()
      const weekAgo = Date.now() - 7 * 86400000
      await Promise.all(chunk([...classIds]).map(async (batch) => {
        const { data } = await svc.from('class_sessions').select('class_id, started_at, duration_seconds').in('class_id', batch)
        for (const r of data ?? []) {
          seconds += Number((r as any).duration_seconds) || 0
          if (new Date((r as any).started_at).getTime() >= weekAgo) {
            sessions7d += 1
            active7d.add((r as any).class_id as string)
          }
        }
      }))
      return {
        hours: Math.round((seconds / 3600) * 10) / 10,
        sessions7d,
        activeClasses7d: active7d.size,
        classCount: classIds.size,
      }
    })
    // WHO LEADS THIS NODE. The org page could name the leader of a group
    // nowhere at all: leadership lived only in govt_admins, which is authz and
    // is read by no lens. A creator therefore governed a group that listed no
    // manager (founder ruling 2026-08-06 — the creator IS the first manager).
    // Unioned across govt_admins + the leader membership tag so orgs created
    // before the ruling still name theirs.
    const leadersPromise = leadersForNodes(svc, [nodeId])
    const [, extras, practiceHours, classPractice, leadersByNode] = await Promise.all([
      schoolsPromise,
      computeNodeExtras(svc, [nodeId, ...childRows.map((c) => c.id)], allGroups),
      practiceHoursPromise,
      classPracticePromise,
      leadersPromise,
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
    // 2026-07-19, reasoning in docs/gamification-done-right.md.
    if (classRow) {
      const [{ data: ct }, { data: csp }, { count: legoTotal }, { data: classStats }, { data: classSessions }, { data: classEnrollment }] = await Promise.all([
        svc.from('class_teachers').select('teacher_user_id, is_lead').eq('class_id', classRow.id),
        svc.from('class_student_progress').select('learner_id, student_name, seeds_completed, legos_mastered, total_practice_seconds, last_active_at, joined_class_at').eq('class_id', classRow.id),
        svc.from('course_legos').select('id', { count: 'exact', head: true }).eq('course_code', classRow.course_code),
        svc.from('class_activity_stats').select('total_practice_seconds, active_students, school_id, region_code, course_code').eq('class_id', classRow.id).maybeSingle(),
        // PLAY-AS-CLASS IS THE PRIMARY METRIC (founder ruling): the class's
        // own teacher-led sessions lead this page. Newest first; 500 covers
        // years of twice-weekly classroom practice.
        svc.from('class_sessions').select('started_at, ended_at, duration_seconds, cycles_completed, end_lego_id').eq('class_id', classRow.id).order('started_at', { ascending: false }).limit(500),
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
      // is the only metric that matters in a school; students are the bonus). ───
      const cs = (classSessions ?? []) as { started_at: string; ended_at: string | null; duration_seconds: number | null; cycles_completed: number | null; end_lego_id: string | null }[]
      const weekAgo = Date.now() - 7 * 86400000
      const monthAgo = Date.now() - 28 * 86400000
      const classPractice = {
        weekSessions: cs.filter((s) => new Date(s.started_at).getTime() >= weekAgo).length,
        sessions28d: cs.filter((s) => new Date(s.started_at).getTime() >= monthAgo).length,
        totalSessions: cs.length,
        lastSessionAt: cs[0]?.started_at ?? null,
        hours: Math.round((cs.reduce((sum, s) => sum + (Number(s.duration_seconds) || 0), 0) / 3600) * 10) / 10,
      }

      // Journey: how far the CLASS has travelled together — the class-entity's
      // play-as-class position (enrollment cursor, falling back to the newest
      // class session's end LEGO, then classes.last_lego_id), expressed as a
      // LEGO ordinal so it shares units with the course total. Only when no
      // class play exists at all do we fall back to the legacy current_seed
      // estimate (a seed count — kept so pre-play classes still show a bar).
      const journeyTotal = Number(legoTotal) || 0
      const journeyLegoId = (classEnrollment as any)?.highest_completed_lego_id
        || cs.find((s) => s.end_lego_id)?.end_lego_id
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
      const classes: { id: string; class_name: string; school_id: string | null; group_id: string | null; teacher_user_id: string | null }[] = []
      const seenClassIds = new Set<string>()
      const addClasses = (rows: any[] | null) => {
        for (const c of rows ?? []) if (!seenClassIds.has(c.id)) { seenClassIds.add(c.id); classes.push(c) }
      }
      const taggedTeacherUids = new Set<string>()
      await Promise.all([
        ...chunk(subtreeIds).map(async (batch) => {
          const { data } = await svc.from('classes').select('id, class_name, school_id, group_id, teacher_user_id').in('group_id', batch).eq('is_active', true)
          addClasses(data)
        }),
        ...chunk(subtreeSchoolIds).map(async (batch) => {
          const { data } = await svc.from('classes').select('id, class_name, school_id, group_id, teacher_user_id').in('school_id', batch).eq('is_active', true)
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
      const classHoursByClass = new Map<string, number>()
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
        ...(lens === 'classes'
          ? chunk(classIds).map(async (batch) => {
              const { data } = await svc.from('class_sessions').select('class_id, started_at, duration_seconds').in('class_id', batch)
              for (const r of data ?? []) {
                const cid = (r as any).class_id as string
                classHoursByClass.set(cid, (classHoursByClass.get(cid) || 0) + (Number((r as any).duration_seconds) || 0) / 3600)
                const at = String((r as any).started_at)
                if ((lastClassSessionByClass.get(cid) || '') < at) lastClassSessionByClass.set(cid, at)
              }
            })
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
            classPracticeHours: Math.round((classHoursByClass.get(c.id) || 0) * 10) / 10,
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
      classPractice,
      ...(lensPayload || {}),
    })
  } catch (error) {
    console.error('[Groups/Home] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
