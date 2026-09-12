/**
 * SEC0912T-F — the school / teacher / group read and write surfaces that no
 * earlier security test named (tenth audit, 2026-09-12, area F).
 *
 * Full write-up: docs/security-audit-2026-09-12-tenth/area-f-school-teacher.md
 *
 * Findings and tests only: nothing here changes behaviour, and NO LIVE
 * DATABASE WAS READ. Every assertion is over repo source — handlers,
 * api/_utils/**, supabase/schema.sql, supabase/migrations/**, and the two
 * player-vue files that read the teachers table from the browser. Where a
 * finding depends on live grant state it says so: schema.sql is a dump, and
 * the honest gap is that the live GRANT was not re-verified from here.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEC0912T-F-01 (HIGH) — COLUMN-BLIND OWN-ROW UPDATE ON `teachers`.
 *   schema.sql carries `GRANT ALL ON TABLE public.teachers TO authenticated`
 *   and an own-row UPDATE policy (`teachers_update_own_or_admin`) with no
 *   column list, and no migration narrows either. The anon key ships in the
 *   bundle, so a tutor with their own JWT can PATCH their own row through
 *   PostgREST and set `platform_status='active'`, `platform_expires_at`,
 *   `verified=true` and `payout_recipient_id` directly. Two consumers make
 *   that matter: api/school/subscription.ts treats
 *   `teachers.platform_status in (active, past_due)` as PAID for the tutor
 *   platform, and useSchoolContext.ts reads the same columns from the
 *   browser as the client gate — so the paid tutor dashboard is
 *   self-grantable; and api/cron/teacher-payouts.ts pays commission to
 *   whatever `payout_recipient_id` says, so the one endpoint that writes it
 *   (F-02) is optional. `teachers_insert_own` lets the row be created with
 *   those values already set.
 *   CHARACTERIZATION: goes red when a migration revokes UPDATE on
 *   public.teachers from authenticated or replaces it with a column-scoped
 *   GRANT, or when the tutor gate stops reading the row's own status.
 *
 * SEC0912T-F-02 (HIGH) — PAYOUT DESTINATION CHANGES ON A BARE SESSION.
 *   POST api/teacher/payout-recipient.ts creates a Wise recipient from a
 *   caller-supplied body and repoints `teachers.payout_recipient_id` with no
 *   step-up (no fresh OTP, no password, no recent-auth check), no audit row,
 *   no notice to the account owner, no cooling-off, no view-as refusal, and
 *   nothing retains the previous recipient. The next monthly run of
 *   api/cron/teacher-payouts.ts pays the accrued balance to the new account.
 *   Reachable by anyone holding a live session as the tutor — a stolen
 *   refresh token, or a school admin minting a session for a colleague via
 *   api/school/staff-signin-link.ts, whose containment refuses govt_admin,
 *   ssi_admin, god and multi-school reach but does not consider a tutor
 *   `teachers` row (a school teacher who also tutors is a supported state).
 *   CHARACTERIZATION: goes red when the handler gains a step-up, an audit
 *   write, a view-as refusal, or a pending/notify/apply shape.
 *
 * SEC0912T-F-03 (MEDIUM) — DEMO MINT IS UNBOUNDED AND ACCEPTS A LIVE PARENT.
 *   POST api/groups/[id]/demo-mint.ts is open to any group leader whose own
 *   group is the parent or an ancestor of it. Root-org creation is
 *   self-serve for any signed-in user (api/groups/index.ts), so any learner
 *   becomes such a leader in one call. The parent is read for existence
 *   only (never `is_demo`), there is no rate limit and no per-parent
 *   ceiling, and each call writes a group, a govt_admin-type invite code
 *   with `max_uses: null`, a demo_orgs row, and for shape=school a hidden
 *   school + class + student join code + class learner account. The
 *   admin-only sibling demo-refresh.ts is correctly gated and is not part
 *   of this finding.
 *   CHARACTERIZATION: goes red when the parent must be a demo node, or a
 *   rate limit / ceiling lands, or the leader door closes.
 *
 * SEC0912T-F-04 (LOW) — IDENTITY CLAIMS: STALE CONTRACT, SKIPPED TENANT RULE.
 *   api/school/identity-claims.ts is correctly caller-scoped (admin of the
 *   caller's own school under both spellings; a body school_id can only
 *   narrow). It cannot attach anyone to a foreign school. But its header and
 *   schoolDomain.ts still say a claim lets an arrival "straight in", while
 *   api/auth/possession-redeem.ts and api/code/redeem.ts removed that weight
 *   on 2026-09-09 (claims are now a roster sort hint only). And the POST
 *   path applies whyDomainNotClaimable but not the shared-tenant refusal
 *   that claimDomainForSchool applies — arrival-time suppression covers the
 *   read side, so this is an inconsistency, not a hole.
 *   CHARACTERIZATION: goes red when the header is corrected or the POST
 *   path adopts the shared-tenant check.
 *
 * SEC0912T-F-05 (LOW, recurrence) — RAW ERROR TEXT in 500 bodies, the class
 *   already pinned by api/groups/groupsErrorLeakage.security.test.ts and
 *   SEC0912-B-02, recurring in commissions.ts, me.ts, payout-recipient.ts
 *   (Wise response body, up to 500 chars), groups/[id].ts GET/DELETE,
 *   class-students.ts (`detail`), demo-mint.ts. One line, not a headline.
 *
 * Also here, as SECURE ASSERTIONS on what this audit checked and cleared:
 * every read rollup resolves scope server-side and only widens under
 * verifyAdmin; every group handler in scope walks parent_id (descendantIds
 * / isStrictDescendantGroup / callerCanSeeGroup) and none compares slug
 * paths; demo-refresh and list-grants are admin-only; named-seat and
 * class-students resolve the school from the caller, never the body.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

const SCHEMA = 'supabase/schema.sql'
const MIGRATIONS_DIR = join(repoRoot, 'supabase/migrations')
const allMigrationSql = (): string =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'))
    .join('\n')

// ───────────────────────────────────────────────────────────────────────────
describe('SEC0912T-F-01 (HIGH) — teachers: column-blind own-row UPDATE grant', () => {
  it('schema.sql grants ALL on public.teachers to authenticated (table-level, column-blind)', () => {
    expect(read(SCHEMA)).toMatch(/GRANT ALL ON TABLE public\.teachers TO authenticated;/)
  })

  it('the own-row UPDATE policy carries no column restriction', () => {
    const schema = read(SCHEMA)
    expect(schema).toMatch(/CREATE POLICY teachers_update_own_or_admin ON public\.teachers FOR UPDATE USING/)
    // and an own-row INSERT policy, so the row can be born with any values
    expect(schema).toMatch(/CREATE POLICY teachers_insert_own ON public\.teachers FOR INSERT WITH CHECK/)
  })

  it('the sensitive columns live on that same table', () => {
    const table = read(SCHEMA).match(/CREATE TABLE public\.teachers \(([\s\S]*?)\);/)?.[1] ?? ''
    for (const col of ['payout_recipient_id text', 'verified boolean', 'platform_status text', 'platform_expires_at timestamp']) {
      expect(table, `${col} on public.teachers`).toContain(col)
    }
  })

  it('CHARACTERIZATION: no migration revokes or column-scopes UPDATE on teachers for authenticated', () => {
    const sql = allMigrationSql()
    expect(sql).not.toMatch(/REVOKE\s+(ALL|UPDATE)[^;]*ON\s+(TABLE\s+)?(public\.)?teachers\s+FROM\s+authenticated/i)
    expect(sql).not.toMatch(/GRANT\s+UPDATE\s*\([^)]*\)\s*ON\s+(TABLE\s+)?(public\.)?teachers\s+TO\s+authenticated/i)
  })

  it('consumer 1: api/school/subscription.ts treats the row\'s own platform_status as PAID', () => {
    const src = read('api/school/subscription.ts')
    expect(src).toMatch(/\['active', 'past_due'\]\.includes\(\(teacherOut\.platform_status as string\) \|\| ''\)/)
    expect(src).toMatch(/\.from\('teachers'\)[\s\S]*?\.select\('platform_status, platform_expires_at, created_at'\)/)
  })

  it('consumer 2: the browser reads the same columns straight off the table as its gate', () => {
    const src = read('packages/player-vue/src/composables/schools/useSchoolContext.ts')
    expect(src).toMatch(/\.from\('teachers'\)\s*\.select\('platform_status, platform_expires_at, created_at'\)/)
  })

  it('consumer 3: the payout cron pays to whatever payout_recipient_id says, unverified', () => {
    const src = read('api/cron/teacher-payouts.ts')
    expect(src).toMatch(/targetAccount: Number\(row\.payout_recipient_id\)/)
    expect(src).not.toMatch(/recipient_verified|payout_recipient_verified|recipient_confirmed/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('SEC0912T-F-02 (HIGH) — payout-recipient.ts repoints the payout destination on a bare session', () => {
  const src = read('api/teacher/payout-recipient.ts')

  it('the POST writes payout_recipient_id from a Wise recipient built from the request body', () => {
    expect(src).toMatch(/wiseApi<WiseRecipientResponse>\('\/v1\/accounts'/)
    expect(src).toMatch(/\.update\(\{\s*payout_recipient_id: recipientId,/)
  })

  it('CHARACTERIZATION: no step-up, no audit row, no notice, no cooling-off, no view-as refusal', () => {
    // auth is a bare bearer verification only
    expect(src).toMatch(/import \{ verifyAuthToken \} from '\.\.\/_utils\/auth'/)
    expect(src).not.toMatch(/verifyOtp|stepUp|requireRecentAuth|recent_auth|amr|reauth/i)
    // no audit event of the change
    expect(src).not.toMatch(/player_events|audit/i)
    // no notice to the owner and no pending/apply shape
    expect(src).not.toMatch(/sendEmail|resend|notify|pending_payout_recipient|cooling|cooldown/i)
    // no view-as refusal (the read-only browsing guard every other write in this area carries)
    expect(src).not.toMatch(/rejectIfViewAs/)
    // the previous recipient is not retained anywhere
    expect(src).not.toMatch(/previous_payout_recipient_id|payout_recipient_history/)
  })

  it('the staff-signin-link containment does not consider a tutor `teachers` row as reach', () => {
    const link = read('api/school/staff-signin-link.ts')
    expect(link).toMatch(/OUT_OF_SCOPE_EDU_ROLES = new Set\(\['govt_admin'\]\)/)
    expect(link).toMatch(/OUT_OF_SCOPE_PLATFORM_ROLES = new Set\(\['ssi_admin', 'god'\]\)/)
    expect(link).not.toMatch(/from\('teachers'\)/)
  })

  it('commissions.ts is READ-ONLY and scoped to the caller\'s own teacher row (cleared)', () => {
    const c = read('api/teacher/commissions.ts')
    expect(c).toMatch(/if \(req\.method !== 'GET'\)/)
    expect(c).toMatch(/\.from\('teacher_commissions'\)[\s\S]*?\.eq\('teacher_id', teacher\.id\)/)
    expect(c).toMatch(/\.from\('tutor_rebate_ledger'\)[\s\S]*?\.eq\('teacher_id', teacher\.id\)/)
    expect(c).not.toMatch(/req\.(query|body)\.(teacher_id|learner_id)/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('SEC0912T-F-03 (MEDIUM) — demo-mint.ts: unbounded, leader-reachable, live parent accepted', () => {
  const mint = read('api/groups/[id]/demo-mint.ts')

  it('the leader door: own group === parent, or a strict ancestor of it', () => {
    expect(mint).toMatch(/ownGroupId === groupId \|\| \(await isStrictDescendantGroup\(supabase, ownGroupId, groupId\)\)/)
  })

  it('root-org creation is self-serve for any signed-in user, so any learner can become that leader', () => {
    const index = read('api/groups/index.ts')
    expect(index).toMatch(/Root org creation \(founder ruling 2026-08-02\): open to any signed-in/)
    expect(index).toMatch(/becomesLeader: true/)
  })

  it('CHARACTERIZATION: the parent is read for existence only — never is_demo', () => {
    expect(mint).toMatch(/\.from\('groups'\)\s*\.select\('id'\)\s*\.eq\('id', parentGroupId\)/)
    expect(mint).not.toMatch(/parent[\s\S]{0,200}is_demo !== true|is_demo[\s\S]{0,80}parent/)
  })

  it('CHARACTERIZATION: no rate limit, no ceiling, and the minted leader invite has no use cap', () => {
    expect(mint).not.toMatch(/429|rate[-_ ]?limit|RATE_WINDOW|PER_CALLER_LIMIT|max_mints|ceiling/i)
    expect(mint).toMatch(/limits: \{ max_uses: null, expires_at: expiresAt \}/)
    // the invite_codes insert carries no max_uses at all
    const inviteInsert = mint.match(/\.from\('invite_codes'\)\s*\.insert\(\{([\s\S]*?)\}\)/)?.[1] ?? ''
    expect(inviteInsert).not.toContain('max_uses')
  })

  it('shape=school provisions a school + class + join code + class learner per call', () => {
    const leaf = read('api/_utils/demoLeaf.ts')
    expect(leaf).toMatch(/\.from\('schools'\)\s*\.insert\(/)
    expect(leaf).toMatch(/\.from\('classes'\)\s*\.insert\(/)
    expect(leaf).toMatch(/\.from\('invite_codes'\)\.insert\(/)
    expect(leaf).toMatch(/ensureClassLearnerEntity\(supabase, classId\)/)
  })

  it('contrast (cleared): demo-refresh.ts is verifyAdmin-gated and its helper refuses non-demo nodes', () => {
    const refresh = read('api/groups/[id]/demo-refresh.ts')
    expect(refresh).toMatch(/const admin = await verifyAdmin\(req\)/)
    expect(refresh).not.toMatch(/verifyAuthToken|govt_admins/)
    const helper = read('api/_utils/demoNodeRefresh.ts')
    expect(helper).toMatch(/Refresh refused: this is not a demo node/)
    expect(helper).toMatch(/Refresh refused: subtree contains non-demo school/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('SEC0912T-F-04 (LOW) — identity-claims.ts: caller-scoped, stale contract, skipped tenant rule', () => {
  const claims = read('api/school/identity-claims.ts')

  it('cleared: the school is the caller\'s own admin membership; a body/query school_id can only narrow', () => {
    expect(claims).toMatch(/const adminOf = memberships\.filter\(\(m\) => m\.role === 'admin'\)\.map\(\(m\) => m\.schoolId\)/)
    expect(claims).toMatch(/adminOf\.includes\(requested\) \? requested : null/)
    expect(claims).toMatch(/\.delete\(\)\s*\.eq\('id', id\)\s*\.eq\('school_id', schoolId\)/)
    expect(claims).toMatch(/\.insert\(\{ school_id: schoolId, kind, value, source: 'admin_added', added_by: auth\.userId \}\)/)
  })

  it('CHARACTERIZATION: the handler still promises arrivals get "straight in" while the door no longer reads claims', () => {
    expect(claims).toMatch(/let an arrival straight in/)
    expect(read('api/auth/possession-redeem.ts')).toMatch(/NOTHING IS STAMPED AT THE DOOR/)
    expect(read('api/auth/possession-redeem.ts')).not.toMatch(/resolveArrival|claimsVouchingFor|matchArrival/)
    expect(read('api/code/redeem.ts')).not.toMatch(/resolveArrival|claimsVouchingFor|matchArrival/)
    // the only remaining reader is the roster's sort hint
    expect(read('api/school/roster.ts')).toMatch(/matchArrival\(email, claims\)\.onDomain/)
  })

  it('CHARACTERIZATION: the POST applies whyDomainNotClaimable but not the shared-tenant refusal', () => {
    expect(claims).toMatch(/whyDomainNotClaimable\(value\)/)
    expect(claims).not.toMatch(/isSharedTenantOnLiveData|claimDomainForSchool/)
    // the canonical claim path does apply it
    expect(read('api/_utils/schoolDomain.ts')).toMatch(/if \(shared\) return \{ status: 'not_claimable', domain, reason: 'shared_tenant' \}/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('SEC0912T-F-05 (LOW, recurrence) — raw error text in 500 bodies', () => {
  it('CHARACTERIZATION: the known class recurs across the area', () => {
    expect(read('api/teacher/commissions.ts')).toMatch(/res\.status\(500\)\.json\(\{ error: withHold\.error\.message \}\)/)
    expect(read('api/teacher/me.ts')).toMatch(/res\.status\(500\)\.json\(\{ error: classesError\.message \}\)/)
    expect(read('api/teacher/payout-recipient.ts')).toMatch(/res\.status\(500\)\.json\(\{ error: err\?\.message \|\| 'Internal server error' \}\)/)
    expect(read('api/groups/[id].ts')).toMatch(/err\?\.message \|\| 'Failed to delete group'/)
    expect(read('api/teacher/class-students.ts')).toMatch(/detail: enrolFailure/)
    expect(read('api/groups/[id]/demo-mint.ts')).toMatch(/`groups insert failed: \$\{groupErr\?\.message\}`/)
  })

  it('the Wise client puts up to 500 chars of the upstream body into the thrown message that F-05 echoes', () => {
    expect(read('api/_utils/wise.ts')).toMatch(/failed \$\{res\.status\}: \$\{text\.slice\(0, 500\)\}/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('CHECKED AND CLEARED — cross-tenant read: scope is resolved from the caller, never the request', () => {
  const ROLLUPS = [
    'api/school/class-practice-7d.ts',
    'api/school/daily-activity.ts',
    'api/school/group-summary.ts',
    'api/school/practice-by-course.ts',
    'api/groups/[id]/rate-compare.ts',
  ]
  for (const rel of ROLLUPS) {
    it(`${rel} resolves scope via resolveVisibleScope(svc, auth uid)`, () => {
      const src = read(rel)
      expect(src).toMatch(/resolveVisibleScope\(svc, auth(Uid!|\.userId)\)/)
    })
  }

  it('every admin passthrough in the area is behind verifyAdmin', () => {
    for (const rel of ['api/school/class-practice-7d.ts', 'api/school/group-summary.ts', 'api/school/practice-by-course.ts', 'api/govt/school-links.ts']) {
      const src = read(rel)
      const passthroughs = src.match(/requestedSchoolId|requestedGroupId|requested === null|outOfScope\.length > 0/g) ?? []
      expect(passthroughs.length, `${rel} has a passthrough`).toBeGreaterThan(0)
      expect(src, `${rel} gates it`).toMatch(/const adminResult = await verifyAdmin\(req\)/)
    }
  })

  it('class-practice-7d intersects requested class_ids with the resolved scope', () => {
    expect(read('api/school/class-practice-7d.ts')).toMatch(/requested\.filter\(id => inScope\.has\(id\)\)/)
  })

  it('practice-by-course refuses out-of-scope ids loudly for non-admins', () => {
    const src = read('api/school/practice-by-course.ts')
    expect(src).toMatch(/const outOfScope = requested\.filter\(id => !visible\.has\(id\)\)/)
    expect(src).toMatch(/error: 'out_of_scope'/)
  })

  it('govt/school-links: a real leader always reads their OWN group; the query id only works under verifyAdmin', () => {
    const src = read('api/govt/school-links.ts')
    expect(src).toMatch(/if \(govtAdmin && \(govtAdmin as any\)\.group_id\) \{\s*\/\/ A real group leader always sees their OWN group/)
  })

  it('access/list-grants is admin-only and read-only', () => {
    const src = read('api/access/list-grants.ts')
    expect(src).toMatch(/const adminResult = await verifyAdmin\(req\)/)
    expect(src).not.toMatch(/verifyAuthToken/)
    expect(src).toMatch(/if \(req\.method !== 'GET'\)/)
  })

  it('named-seat and class-students take the school from the caller / the class row, never the body', () => {
    const seat = read('api/school/named-seat.ts')
    expect(seat).toMatch(/memberships\.find\(\(m: SchoolMembership\) => m\.role === 'admin'\)\?\.schoolId/)
    expect(seat).not.toMatch(/req\.body\?\.school_id|req\.body\.school_id/)
    const cs = read('api/teacher/class-students.ts')
    expect(cs).toMatch(/canTeachClass\(svc, auth\.userId, cls\)/)
    expect(cs).toMatch(/const pool = await schoolStudents\(svc, cls\.id, cls\.school_id\)/)
    expect(cs).toMatch(/rejectIfViewAs\(req\)/)
  })

  it('copy-teacher-play resolves authz through canTeachClass and refuses view-as on apply', () => {
    const shared = read('api/school/copy-teacher-play/_shared.ts')
    expect(shared).toMatch(/canTeachClass\(svc, auth\.userId, classRow\)/)
    expect(shared).toMatch(/if \(!opts\.allowViewAs\) \{\s*const viewAs = rejectIfViewAs\(req\)/)
    expect(read('api/school/copy-teacher-play/preview.ts')).toMatch(/allowViewAs: true/)
  })

  it('teacher/me.ts PATCH is allowlisted to profile fields (no status/payout columns)', () => {
    const src = read('api/teacher/me.ts')
    const list = src.match(/const EDITABLE_FIELDS = \[([\s\S]*?)\] as const/)?.[1] ?? ''
    expect(list).toContain("'display_name'")
    for (const col of ['platform_status', 'platform_expires_at', 'verified', 'payout_recipient_id', 'own_subscription_id']) {
      expect(list, `${col} must not be PATCHable via me.ts`).not.toContain(col)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('CHECKED AND CLEARED — TENANCY-02 siblings walk parent_id, never the slug path', () => {
  const GROUP_HANDLERS = [
    'api/groups/[id].ts',
    'api/groups/[id]/home.ts',
    'api/groups/[id]/invites.ts',
    'api/groups/[id]/rate-compare.ts',
    'api/groups/[id]/demo-mint.ts',
    'api/groups/[id]/demo-refresh.ts',
  ]
  for (const rel of GROUP_HANDLERS) {
    it(`${rel} has no path-prefix or path-equality subtree match`, () => {
      const src = read(rel)
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // ignore comments, which explain the old bug
        .join('\n')
      expect(src).not.toMatch(/\.path\)?\.startsWith\(/)
      expect(src).not.toMatch(/\.like\('path'|\.ilike\('path'|path LIKE|path\.like\./)
      expect(src).not.toMatch(/\.eq\('path'/)
    })
  }

  it('the subtree relation in every group handler is descendantIds / isStrictDescendantGroup / callerCanSeeGroup', () => {
    expect(read('api/groups/[id]/home.ts')).toMatch(/descendantIds\(allGroups, nodeId\)/)
    expect(read('api/groups/[id]/rate-compare.ts')).toMatch(/descendantIds\(allGroups, scope\.groupId\)\.includes\(nodeId\)/)
    expect(read('api/groups/[id]/invites.ts')).toMatch(/callerCanSeeGroup\(supabase, caller, groupId\)/)
    expect(read('api/groups/[id].ts')).toMatch(/isStrictDescendantGroup\(supabase, ownGroupId, groupId\)/)
    expect(read('api/_utils/schoolScope.ts')).toMatch(/descendantIds\(\(forest \?\? \[\]\) as ParentLinked\[\], groupId\)/)
  })

  it('the one remaining .path use in home.ts is display depth only', () => {
    const src = read('api/groups/[id]/home.ts').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    const uses = src.match(/\.path\b/g) ?? []
    expect(uses.length).toBeLessThanOrEqual(4)
    expect(src).toMatch(/depth: nodeRow\.path && g\.path \? g\.path\.split\('\/'\)\.length - nodeRow\.path\.split\('\/'\)\.length : 1/)
  })
})
