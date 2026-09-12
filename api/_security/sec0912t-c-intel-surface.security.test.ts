/**
 * SEC0912T-C — the intel / reporting surface: the eight admin `api/intel/*`
 * endpoints, the leader-facing org lens (`api/org/intel.ts`, `api/org/vad.ts`),
 * the funder export (`api/org/funder-export.ts`), the board metrics registry
 * and the public board snapshot (`api/admin/board-metrics.ts`,
 * `api/board/snapshot/[code].ts`), plus the population / cohort / metrics
 * utilities they import.
 *
 * Full write-up: docs/security-audit-2026-09-12-tenth/area-c-intel-surface.md
 *
 * Findings and tests only. Nothing here changes behaviour and NO LIVE
 * DATABASE WAS READ: every assertion is over repo source (handlers,
 * api/_utils/**, supabase/schema.sql) or over the pure arithmetic the funder
 * export exports. Where a claim needed live state it is named as a gap in the
 * write-up rather than asserted here.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEC0912T-C-01 (MEDIUM) — FUNDER EXPORT HAS NO SMALL-CELL FLOOR, AND ITS
 *   16-24 SUB-COHORT RE-IDENTIFIES A PERSON'S AGE BAND. The handler's own
 *   header promises "The age tick is reported only as a cohort size, never
 *   attached to a person", and the existing funder-export.test.ts checks that
 *   no id, name or email is in the file. But the file carries `all` and
 *   `aged16to24` measures for ANY group the caller may see — including a
 *   child group with one enrolled learner — with no K_FLOOR of the kind
 *   weak-points and where-and-what apply. A leader whose subtree holds a
 *   small cohort (or an org that is itself small) reads
 *   `aged16to24.registered = 1` beside `totalMinutes` and now knows WHICH of
 *   the people on their roster ticked the box, and that person's minutes; with
 *   two registered and one aged, `all − aged16to24` is the other person's
 *   minutes. The age band is otherwise visible only to the learner who ticked
 *   it (api/org/enrol.ts reads it from the caller's own enrolment rows), so
 *   this is new information to the leader, and the file is designed to be
 *   handed onward to the funder. Reachable by every govt_admin / school_admin
 *   through callerCanSeeGroup, with `?groupId=` naming any node in their
 *   subtree. CHARACTERIZATION: goes red when a floor lands — when
 *   `aged16to24` (or `all`) is suppressed / nulled below a threshold, or when
 *   the export source names K_FLOOR / kFloor / tooFewToSay.
 *
 * Recurring instances of ALREADY-KNOWN classes, noted rather than headlined:
 *   - api/org/vad.ts returns `e.message` in its 500 body (SEC0912-B-02 class;
 *     api/groups/groupsErrorLeakage.security.test.ts is the pin). CHARACTERIZATION.
 *   - api/org/vad.ts (via resolveVadScope) calls ensureSchoolNode() — an
 *     INSERT into groups + UPDATE of schools under the service role — for a
 *     client-named school id BEFORE isWithinLeaderSubtree answers (the
 *     SEC0912-A-02 write-before-authz class, which named org/intel, home and
 *     rate-compare but not vad). Same 404-vs-403 existence oracle as A-03.
 *     CHARACTERIZATION on source ordering.
 *
 * Also here, as SECURE ASSERTIONS on what this audit checked and cleared: the
 * door each endpoint uses; parent_id subtree resolution with no path-string
 * matching anywhere in scope; no PostgREST `.or()/.filter()/.like()` and no
 * interpolated filter in scope; the funder CSV's cells and filename are
 * derived only from validated values and cannot start a formula; the board
 * share code is 128-bit CSPRNG on a service-role-only table with no HTML sink
 * on the reader; `test_learner_ids()` is SECURITY INVOKER so its default
 * anon/authenticated grant exposes nothing beyond the caller's own RLS view.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  measureWindowFromTotals,
  toCsv,
  monthWindow,
  type CourseTotal,
  type EnrolledLearner,
} from '../_utils/orgFunderExport'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

const INTEL_ADMIN_HANDLERS = [
  'api/intel/courses.ts',
  'api/intel/findings.ts',
  'api/intel/leaving.ts',
  'api/intel/person.ts',
  'api/intel/pulse.ts',
  'api/intel/weak-points.ts',
  'api/intel/where-and-what.ts',
  'api/intel/working.ts',
  'api/admin/board-metrics.ts',
]
const ORG_LEADER_HANDLERS = ['api/org/intel.ts', 'api/org/funder-export.ts']
const VAD_HANDLER = 'api/org/vad.ts'
const SNAPSHOT_HANDLER = 'api/board/snapshot/[code].ts'
const SUPPORTING_UTILS = [
  'api/_utils/realLearnerPopulation.ts',
  'api/_utils/entitlementCohort.ts',
  'api/_utils/boardMetrics.ts',
  'api/_utils/groupTreeAuth.ts',
  'api/_utils/orgLeader.ts',
  'api/_utils/vadVisibility.ts',
  'api/_utils/vadProsody.ts',
  'api/_utils/groupSubtree.ts',
  'api/_utils/inAppTime.ts',
  'api/_utils/orgFunderExport.ts',
  'api/_utils/schoolCoverageGate.ts',
]
const ALL_SCOPE = [...INTEL_ADMIN_HANDLERS, ...ORG_LEADER_HANDLERS, VAD_HANDLER, SNAPSHOT_HANDLER, ...SUPPORTING_UTILS]

/** Strip comments so a word in prose cannot satisfy or defeat a source assertion. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const FAMILY = { cym_s_for_eng: 'welsh', cym_n_for_eng: 'welsh' }
const window = monthWindow('2026-08')

describe('SEC0912T-C-01 — funder export: no small-cell floor; aged16to24 names one person', () => {
  it('a one-person cohort who ticked 16-24 is reported as a cohort of one, with their exact minutes', () => {
    const roster: EnrolledLearner[] = [
      { learner_id: 'L1', enrolled_on: '2026-08-01', reporting_from: '2026-08-01', age_band_16_24: true },
    ]
    const totals: CourseTotal[] = [{ learner_id: 'L1', course_code: 'cym_s_for_eng', seconds: 47 * 60 }]
    const { result } = measureWindowFromTotals(totals, roster, window, FAMILY)
    // The vulnerable shape as it stands: cohort size 1, minutes attached to it.
    expect(result.aged16to24.registered).toBe(1)
    expect(result.aged16to24.totalMinutes).toBe(47)
    expect(result.all.registered).toBe(1)
    // And it goes out on the wire as-is.
    const csv = toCsv([result])
    expect(csv).toContain('2026-08,aged_16_24,1,')
  })

  it('with two registered and one aged, the other person’s minutes are the difference', () => {
    const roster: EnrolledLearner[] = [
      { learner_id: 'L1', enrolled_on: '2026-08-01', reporting_from: '2026-08-01', age_band_16_24: true },
      { learner_id: 'L2', enrolled_on: '2026-08-02', reporting_from: '2026-08-02', age_band_16_24: false },
    ]
    const totals: CourseTotal[] = [
      { learner_id: 'L1', course_code: 'cym_s_for_eng', seconds: 10 * 60 },
      { learner_id: 'L2', course_code: 'cym_n_for_eng', seconds: 33 * 60 },
    ]
    const { result } = measureWindowFromTotals(totals, roster, window, FAMILY)
    expect(result.all.totalMinutes - result.aged16to24.totalMinutes).toBe(33)
    expect(result.all.registered - result.aged16to24.registered).toBe(1)
  })

  it('CHARACTERIZATION: neither the handler nor its arithmetic carries any floor (goes red when one lands)', () => {
    for (const f of ['api/org/funder-export.ts', 'api/_utils/orgFunderExport.ts']) {
      const src = code(read(f))
      expect(src, `${f} has no k-floor today`).not.toMatch(/K_FLOOR|kFloor|tooFewToSay|small[-_ ]?cell/i)
    }
  })

  it('the leader reaches any node in their subtree, and the age band is visible nowhere else to them', () => {
    const src = read('api/org/funder-export.ts')
    expect(src).toContain("await callerCanSeeGroup(supabase, caller, groupId)")
    expect(src).toContain('const subtree = await fetchSubtree(supabase, groupId)')
    // The only other reader of age_band_16_24 is the enrolment endpoint, which
    // reads it from the caller's OWN enrolment rows.
    const enrol = read('api/org/enrol.ts')
    expect(enrol).toMatch(/age_band_16_24[^\n]*\n\s*\.eq\('learner_id', learnerId\)/)
    // The sibling intel lens does not expose it at all.
    expect(read('api/org/intel.ts')).not.toContain('age_band')
  })
})

describe('Recurring already-known classes, pinned where they recur in this scope', () => {
  it('SEC0912-B-02 class: api/org/vad.ts returns the raw error message in a 500 body (CHARACTERIZATION)', () => {
    expect(code(read(VAD_HANDLER))).toContain("e instanceof Error ? e.message : 'Failed to read VAD scope'")
    // The admin-only board metrics route does the same; admin eyes only, so a note.
    expect(code(read('api/admin/board-metrics.ts'))).toContain("error?.message || 'Internal server error'")
  })

  it('SEC0912-A-02 class: org/vad mints another tenant’s school node BEFORE the subtree gate (CHARACTERIZATION)', () => {
    const src = code(read('api/_utils/vadVisibility.ts'))
    const groupBranch = src.slice(src.indexOf('const groupId = target.groupId'))
    const mint = groupBranch.indexOf('await ensureSchoolNode(svc, asSchool.data as never')
    const gate = groupBranch.indexOf('await isWithinLeaderSubtree(svc, caller.ownGroupId, nodeId)')
    expect(mint).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(mint)
    // ensureSchoolNode really writes: an insert and an update under the service role.
    const node = code(read('api/_utils/schoolNode.ts'))
    expect(node).toMatch(/from\('groups'\)\s*\.insert\(/)
    expect(node).toMatch(/from\('schools'\)\s*\.update\(\{ node_group_id/)
    // And the A-03 oracle rides with it: 404 for a missing id, 403 for a real one outside the subtree.
    expect(groupBranch).toContain("if (!nodeId) return { denied: true, status: 404, error: 'Not found' }")
    expect(groupBranch).toContain("status: 403, error: 'You do not have access to this group'")
  })
})

describe('Checked and cleared — AUTHORISATION: which door each endpoint uses', () => {
  it('every api/intel/* handler and board-metrics gates on verifyAdmin before creating a service client', () => {
    for (const f of INTEL_ADMIN_HANDLERS) {
      const src = code(read(f))
      const gate = src.indexOf('await verifyAdmin(req)')
      const client = src.indexOf('createClient(supabaseUrl, supabaseServiceKey)')
      expect(gate, `${f} must call verifyAdmin`).toBeGreaterThan(-1)
      expect(client, `${f} must use the service role`).toBeGreaterThan(gate)
      expect(src).toContain("if ('error' in admin)")
      expect(src).toContain("if (applyCors(req, res, { methods: 'GET' })) return")
    }
  })

  it('org/intel and funder-export use resolveGroupTreeCaller + callerCanSeeGroup, and gate before any cohort read', () => {
    for (const f of ORG_LEADER_HANDLERS) {
      const src = code(read(f))
      expect(src).toContain('resolveGroupTreeCaller(req, res,')
      expect(src).toMatch(/if \(!\(await callerCanSeeGroup\(/)
      expect(src).not.toContain('verifyAdmin(req)') // the leader door subsumes the admin one
    }
    const intel = code(read('api/org/intel.ts'))
    expect(intel.indexOf('callerCanSeeGroup(svc, caller, nodeId)')).toBeLessThan(intel.indexOf("from('classes').select(cols)"))
    expect(intel.indexOf('callerCanSeeGroup(svc, caller, nodeId)')).toBeLessThan(intel.indexOf('computeOrgIntel(svc, node, classes'))
    const funder = code(read('api/org/funder-export.ts'))
    expect(funder.indexOf('callerCanSeeGroup(supabase, caller, groupId)')).toBeLessThan(funder.indexOf("from('org_enrolment_policies')"))
    // resolveGroupTreeCaller itself: ssi_admin/god, else a govt_admins row, else a school_admin's own school node; anyone else 403.
    const auth = code(read('api/_utils/groupTreeAuth.ts'))
    expect(auth).toContain("from('govt_admins')")
    expect(auth).toContain("if ((learner as any)?.educational_role !== 'school_admin') return null")
    expect(auth).toContain("res.status(403).json({ error: 'You do not govern any group' })")
  })

  it('org/vad resolves the caller then the scope, denies before reading, and hands only the authorised set to the reads', () => {
    const src = code(read(VAD_HANDLER))
    const caller = src.indexOf('await resolveVadCaller(req, res, svc)')
    const scope = src.indexOf('await resolveVadScope(svc, caller, { groupId, classId, learnerId })')
    const denied = src.indexOf('if (isDenied(scope))')
    const reads = src.indexOf('metricsForLearnerIds(svc, scope.learnerIds)')
    expect(caller).toBeGreaterThan(-1)
    expect(scope).toBeGreaterThan(caller)
    expect(denied).toBeGreaterThan(scope)
    expect(reads).toBeGreaterThan(denied)
    expect(src).toContain('fetchProsodyAggs(svc, scope.learnerIds)')
    // No client value reaches a read directly.
    expect(src).not.toMatch(/\.in\('learner_id', \[?learnerId/)
    // vadVisibility: the one-learner door is self, or in resolveVisibleScope's set, or admin.
    const vis = code(read('api/_utils/vadVisibility.ts'))
    expect(vis).toContain('if (caller.learnerId && caller.learnerId === learnerId) return true')
    expect(vis).toContain('return caller.scope.learnerIds.includes(learnerId)')
    expect(vis).toContain('caller.scope.classIds.includes(classId)')
    // fetchProsodyAggs treats an empty array as nobody, never as "no filter".
    expect(code(read('api/_utils/vadProsody.ts'))).toContain('if (learnerIds !== null && learnerIds.length === 0)')
  })

  it('board snapshot is public BY DESIGN behind a 128-bit CSPRNG capability on a service-role-only table', () => {
    const src = code(read(SNAPSHOT_HANDLER))
    expect(src).not.toMatch(/verifyAdmin|verifyAuthToken|getAuthUserId/)
    expect(src).toContain(".select('label, report_month, payload, revoked_at')")
    expect(src).toContain(".eq('share_code', code)")
    expect(src).toContain('if (!snapshot || snapshot.revoked_at)')
    // Only the four fields — never created_by, id, or the table beyond one row.
    expect(src).not.toMatch(/created_by|\.select\('\*'\)/)
    const gen = code(read('api/_utils/codeGen.ts'))
    expect(gen).toMatch(/export function generateShareCode\(\): string \{\s*return randomBytes\(16\)/)
    expect(code(read('api/admin/board-snapshot.ts'))).toContain('const candidate = generateShareCode()')
    const schema = read('supabase/schema.sql')
    expect(schema).toContain('ALTER TABLE public.board_snapshots ENABLE ROW LEVEL SECURITY;')
    expect(schema).toContain('GRANT ALL ON TABLE public.board_snapshots TO service_role;')
    expect(schema).not.toMatch(/GRANT [^\n]* ON TABLE public\.board_snapshots TO (anon|authenticated)/)
    expect(schema).not.toMatch(/CREATE POLICY [^\n]* ON public\.board_snapshots /)
    // The reader renders the markdown into typed blocks, never through an HTML sink.
    expect(read('packages/player-vue/src/views/BoardSnapshotView.vue')).not.toContain('v-html')
    expect(read('packages/player-vue/src/utils/renderBoardMarkdown.ts')).not.toMatch(/innerHTML|v-html/)
  })
})

describe('Checked and cleared — TENANCY: subtree by parent_id, never a path string', () => {
  it('no TypeScript in scope matches a subtree by slug path, prefix or LIKE', () => {
    for (const f of ALL_SCOPE) {
      const src = code(read(f))
      expect(src, f).not.toMatch(/\.path\b|startsWith\(|\.like\(|\.ilike\(|path LIKE|rootOfPath/)
    }
  })

  it('the leader predicate is one copy: callerCanSeeGroup → isWithinLeaderSubtree → isStrictDescendantGroup → descendantIds over parent_id', () => {
    expect(code(read('api/_utils/groupTreeAuth.ts'))).toContain('return isWithinLeaderSubtree(supabase, caller.ownGroupId, groupId)')
    expect(code(read('api/_utils/orgLeader.ts'))).toContain('return isStrictDescendantGroup(svc, ownGroupId, targetGroupId)')
    const scope = code(read('api/_utils/schoolScope.ts'))
    expect(scope).toMatch(/export async function isStrictDescendantGroup[\s\S]*?from\('groups'\)\.select\('id, parent_id'\)[\s\S]*?descendantIds\(rows, ancestorGroupId\)\.includes\(targetGroupId\)/)
    const sub = code(read('api/_utils/groupSubtree.ts'))
    expect(sub).toContain('export interface ParentLinked { id: string; parent_id: string | null }')
    expect(sub).toMatch(/childrenOf\.get\(r\.parent_id\)!\.push\(r\.id\)/)
    // The org lens and the VAD lens both widen through the same walk.
    expect(code(read('api/org/intel.ts'))).toContain('const subtreeIds = descendantIds(forest, nodeId)')
    expect(code(read('api/_utils/vadVisibility.ts'))).toContain('const groupIds = descendantIds((forest ?? []) as ParentLinked[], nodeId)')
    expect(code(read('api/org/funder-export.ts'))).toContain('const subtree = await fetchSubtree(supabase, groupId)')
  })

  it('the caller’s own scope root is resolved from the verified auth uid, never echoed from the request', () => {
    const auth = code(read('api/_utils/groupTreeAuth.ts'))
    expect(auth).toContain(".eq('user_id', authUid)")
    expect(auth).not.toMatch(/req\.query|req\.body/)
    const vis = code(read('api/_utils/vadVisibility.ts'))
    expect(vis).not.toMatch(/req\.query|req\.body/)
  })
})

describe('Checked and cleared — UNTRUSTED ARGS: nothing reaches a raw PostgREST filter', () => {
  it('no handler or util in scope builds an .or()/.filter()/.like() expression or interpolates a query param into a filter', () => {
    for (const f of ALL_SCOPE) {
      const src = code(read(f))
      expect(src, f).not.toMatch(/\.or\(|\.like\(|\.ilike\(|\.textSearch\(/)
      // .filter( on a Supabase builder takes a raw operator string; array .filter((x) => …) is fine.
      expect(src, f).not.toMatch(/\.filter\('/)
      // The one `in.(…)` string in scope is a compile-time constant list.
      for (const m of src.matchAll(/\.not\('([^']+)', 'in', `\(\$\{([^}]+)\}\)`\)/g)) {
        expect(m[2]).toBe("FIREHOSE_EVENTS.join(',')")
      }
    }
    const fire = code(read('api/intel/where-and-what.ts'))
    expect(fire).toContain("export const FIREHOSE_EVENTS = ['audio_play', 'audio_failed', 'listening_tick', 'cycle_prosody'] as const")
  })

  it('the query params that do arrive are bounded and bound', () => {
    expect(code(read('api/intel/weak-points.ts'))).toContain(".eq('course_code', course)")
    expect(code(read('api/intel/weak-points.ts'))).toContain("typeof req.query.course === 'string' ? req.query.course.slice(0, 64) : ''")
    expect(code(read('api/intel/weak-points.ts'))).toContain('Math.min(365, Math.max(1, Number(req.query.days) || 90))')
    expect(code(read('api/intel/where-and-what.ts'))).toContain('Math.min(90, Math.max(1, Number(req.query.days) || 30))')
    expect(code(read('api/intel/working.ts'))).toContain('Math.min(30, Math.max(1, Number(req.query.days) || 7))')
    expect(code(read('api/intel/person.ts'))).toContain(".eq('id', id)")
    expect(code(read('api/intel/person.ts'))).toContain("typeof req.query.id === 'string' ? req.query.id.slice(0, 64) : ''")
    // RPC arguments are bound JSON, with the group list server-derived.
    const funder = code(read('api/org/funder-export.ts'))
    expect(funder).toContain(".rpc('org_enrolment_roster', { p_group_ids: groupIds })")
    expect(funder).toContain(".rpc('org_enrolment_window_seconds', { p_group_ids: groupIds, p_from: w.from, p_to: w.to })")
    expect(funder).toContain("if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(baselineFrom))")
    expect(() => monthWindow('2026-13')).toThrow()
    expect(() => monthWindow('2026-08"; DROP')).toThrow()
    // And both RPCs are service_role only, so the server door is the only door.
    const schema = read('supabase/schema.sql')
    for (const sig of ['org_enrolment_roster(p_group_ids uuid[])', 'org_enrolment_window_seconds(p_group_ids uuid[], p_from date, p_to date)']) {
      expect(schema).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC;`)
      expect(schema).toContain(`GRANT ALL ON FUNCTION public.${sig} TO service_role;`)
      expect(schema).not.toMatch(new RegExp(`GRANT ALL ON FUNCTION public\\.${sig.replace(/[()[\],]/g, '\\$&')} TO (anon|authenticated);`))
    }
  })
})

describe('Checked and cleared — FUNDER EXPORT file: filename and cells are not caller-controlled', () => {
  it('the CSV cannot start a formula: every cell is a number or a label from a validated value', () => {
    const roster: EnrolledLearner[] = [
      { learner_id: 'L1', enrolled_on: '2026-08-01', reporting_from: '2026-08-01', age_band_16_24: true },
    ]
    const { result } = measureWindowFromTotals([], roster, window, FAMILY)
    const csv = toCsv([result, { ...result, window: { from: '2026-04-01', to: '2026-08-31', label: 'since_2026-04-01' } }])
    for (const line of csv.trim().split('\n')) {
      for (const cell of line.split(',')) {
        expect(cell, `cell ${JSON.stringify(cell)}`).not.toMatch(/^[=+\-@\t\r]/)
      }
    }
    // The only free-text-looking column is the window label, and every label
    // the handler builds passes a regex first: YYYY-MM, 'all_time', or
    // `since_${YYYY-MM-DD}`.
    const funder = code(read('api/org/funder-export.ts'))
    expect(funder).toContain("baselineWindow(earliestBaseline, month_window.to, 'all_time')")
    expect(funder).toContain('baselineWindow(baselineFrom, month_window.to, `since_${baselineFrom}`)')
    // org_display_name never enters the CSV.
    const util = code(read('api/_utils/orgFunderExport.ts'))
    expect(util).not.toContain('org_display_name')
  })

  it('the download filename is built from the month AFTER monthWindow() validated it', () => {
    const src = code(read('api/org/funder-export.ts'))
    const validated = src.indexOf('month_window = monthWindow(month)')
    const filename = src.indexOf('attachment; filename="funder-export-${month}.csv"')
    expect(validated).toBeGreaterThan(-1)
    expect(filename).toBeGreaterThan(validated)
    expect(src).toContain("res.setHeader('Content-Type', 'text/csv; charset=utf-8')")
  })
})

describe('Checked and cleared — AGGREGATION: where the k-floor exists, and where the surface is per-person by ruling', () => {
  it('weak-points and where-and-what carry K_FLOOR = 5 and empty their rows under it', () => {
    const wp = code(read('api/intel/weak-points.ts'))
    expect(wp).toContain('export const K_FLOOR = 5')
    expect(wp).toContain('if (learnersInCourse.size < K_FLOOR)')
    expect(wp).toContain('stoppedShare: reached >= K_FLOOR ? (stoppedOn.get(legoId) ?? 0) / reached : null')
    const ww = code(read('api/intel/where-and-what.ts'))
    expect(ww).toContain('export const K_FLOOR = 5')
    expect(ww).toContain('tooFewToSay: all.size < K_FLOOR')
  })

  it('the per-person intel surfaces are admin-only, so their names/emails/countries are admin-eyes by design', () => {
    for (const f of ['api/intel/leaving.ts', 'api/intel/person.ts']) {
      const src = code(read(f))
      expect(src).toContain('await verifyAdmin(req)')
    }
    // leaving caps the list it names.
    expect(code(read('api/intel/leaving.ts'))).toContain('rows: rows.slice(0, 200)')
  })
})

describe('Checked and cleared — test_learner_ids(): default-open grant, harmless because SECURITY INVOKER', () => {
  it('is granted to anon/authenticated (contrary to its own comment) but runs as INVOKER under learners RLS', () => {
    const schema = read('supabase/schema.sql')
    const start = schema.indexOf('CREATE FUNCTION public.test_learner_ids()')
    expect(start).toBeGreaterThan(-1)
    const body = schema.slice(start, schema.indexOf('$$;', start))
    expect(body).not.toMatch(/SECURITY DEFINER/i)
    expect(body).toMatch(/FROM learners l/)
    // The grant is the Supabase default, not a decision — the comment says
    // "service_role only" and realLearnerPopulation.ts repeats it. Pinned so
    // that a future DEFINER conversion without a REVOKE goes red here.
    expect(schema).toContain('GRANT ALL ON FUNCTION public.test_learner_ids() TO anon;')
    expect(schema).toContain('GRANT ALL ON FUNCTION public.test_learner_ids() TO authenticated;')
    expect(schema).toMatch(/CREATE POLICY learners_select ON public\.learners FOR SELECT TO authenticated USING \(\(\(user_id = \(\( SELECT auth\.uid\(\) AS uid\)\)::text\) OR public\.can_view_learner_data\(id\)\)\)/)
    expect(read('api/_utils/realLearnerPopulation.ts')).toContain('test_learner_ids() is granted to service_role only')
  })
})
