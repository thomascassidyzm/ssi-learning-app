# Area F — the unaudited school / teacher / group read and write surfaces

Tenth security audit, 2026-09-12. Branch `cs/446-sec-f-school`, cut from `origin/dev` at `e558b43ee`.
Test file: `api/_security/sec0912t-f-school-teacher.security.test.ts` (43 assertions, green, pure).

**Rules this area ran under:** findings and tests only. No production behaviour changed, no fix applied,
no migration written, no live database read, no external service called, nothing sent, nothing deleted,
nothing promoted. Every claim below is derived from repo source. The honest gap is at the end.

## Scope

Handlers: `api/school/{class-practice-7d,daily-activity,group-summary,identity-claims,named-seat,practice-by-course}.ts`,
`api/school/copy-teacher-play/{_shared,preview}.ts`, `api/teacher/{class-students,commissions,me,payout-recipient}.ts`,
`api/groups/[id].ts`, `api/groups/[id]/{home,invites,rate-compare,demo-mint,demo-refresh}.ts`,
`api/govt/school-links.ts`, `api/access/list-grants.ts`.
Supporting: `api/_utils/{schoolScope,classTeacherAuth,groupAffiliation,classPractice,directMemberPractice,classProgressCopy}.ts`,
and the helpers those lean on (`groupTreeAuth`, `orgLeader`, `schoolStaff`, `schoolDomain`, `demoLeaf`, `demoNodeRefresh`, `groupSubtree`).

## Q1 — cross-tenant read: how each handler gets its school / class / group id

| Handler | Id source | Verdict |
|---|---|---|
| `school/class-practice-7d.ts` | `resolveVisibleScope(caller)`; `class_ids` intersected with scope; `?school_id=` only when caller scope is empty AND `verifyAdmin` passes | clean |
| `school/daily-activity.ts` | `resolveVisibleScope(caller)` only; no request id at all | clean |
| `school/group-summary.ts` | govt_admin → own `scope.groupId`, client `groupId` ignored; `?groupId=` only under `verifyAdmin` | clean |
| `school/practice-by-course.ts` | body `learner_ids` must all be inside `resolveVisibleScope` + self; out-of-scope → loud 403 unless `verifyAdmin` | clean |
| `school/identity-claims.ts` | caller's own admin memberships (`schoolMembershipsOf`, both spellings); a `school_id` can only narrow | clean (see F-04) |
| `school/named-seat.ts` | caller's own admin school; body carries a name only | clean |
| `school/copy-teacher-play/*` | body `class_id` → `fetchClassAuthRow` → `canTeachClass(caller)`; `teacher_user_id` must teach that class | clean |
| `teacher/class-students.ts` | body/query `class_id` → `canTeachClass` OR `isLeaderAboveClass`; the write target must be in the class's own school pool | clean |
| `teacher/{commissions,me,payout-recipient}.ts` | caller's own `learners` → own `teachers` row; no request id | clean (see F-01/F-02) |
| `groups/[id].ts` | PATCH: `isWithinLeaderSubtree(leaderGroupIdFor(caller), id)`; GET/DELETE: `isStrictDescendantGroup` or admin | clean |
| `groups/[id]/home.ts`, `invites.ts` | `resolveGroupTreeCaller` + `callerCanSeeGroup` (parent_id walk) | clean |
| `groups/[id]/rate-compare.ts` | admin, or `resolveVisibleScope` + `descendantIds` by parent_id | clean |
| `groups/[id]/demo-mint.ts` | admin, or leader whose own group is `id` or a strict ancestor | see F-03 |
| `groups/[id]/demo-refresh.ts` | `verifyAdmin` only | clean |
| `govt/school-links.ts` | leader → own `govt_admins.group_id`; `?groupId=` only under `verifyAdmin` | clean |
| `access/list-grants.ts` | `verifyAdmin` only | clean |

No handler in scope trusts a request-supplied school, class or group id as authority. A teacher cannot
read another school's roster or practice through any of these.

## Findings

### SEC0912T-F-01 (HIGH) — column-blind own-row UPDATE grant on `teachers`

**Where.** `supabase/schema.sql:24011` (`GRANT ALL ON TABLE public.teachers TO authenticated`),
`:20857` (`teachers_update_own_or_admin`, own-row, no column list), `:20839` (`teachers_insert_own`).
No migration under `supabase/migrations/` revokes or column-scopes it.

**Why it is a defect.** The anon key ships in the bundle. A tutor with their own JWT can
`PATCH /rest/v1/teachers?id=eq.<own>` and set any column on their row: `platform_status='active'`,
`platform_expires_at`, `verified=true`, `payout_recipient_id`. Three consumers give those columns weight:
- `api/school/subscription.ts:181` treats `platform_status in (active, past_due)` on the teacher's own row
  as PAID for the tutor platform, and `useSchoolContext.ts:314` reads the same three columns from the
  browser as the client gate. The paid tutor dashboard is therefore self-grantable without a Paddle event.
- `api/cron/teacher-payouts.ts:249` pays commission to `Number(row.payout_recipient_id)` with no
  verified flag, so the one endpoint that is supposed to set it (F-02) is optional.
- `teachers_insert_own` lets any learner mint their own row already carrying those values.

**Blast radius.** Every tutor account; the tutor-platform subscription revenue; the payout path.
The same column-blind shape has been a real finding twice before (support_messages, SEC0912-B-01).

**Fix shape (not applied).** Replace the table grant with `GRANT SELECT ON public.teachers` plus
`GRANT UPDATE (display_name, photo_url, bio, country, teaching_languages) ON public.teachers TO authenticated`
and the matching INSERT column list; keep `platform_*`, `verified`, `payout_recipient_id`,
`own_subscription_id` service-role-only; `NOTIFY pgrst, 'reload schema'`; canary per the RLS runbook.
The server routes already project narrowly, so nothing client-side needs to change.

**Gap.** `schema.sql` is a dump. The live grant was not re-verified from this job (no live DB access by rule).

### SEC0912T-F-02 (HIGH) — payout destination changes on a bare session

**Where.** `api/teacher/payout-recipient.ts:95-151`.

**Why it is a defect.** The POST takes `currency / account_holder_name / type / details` from the body,
creates a Wise recipient under SSi's business profile, and repoints `teachers.payout_recipient_id`.
There is no step-up (no fresh OTP, no recent-auth check), no audit row, no notice to the account owner,
no cooling-off, no `rejectIfViewAs`, and the previous recipient is not retained. The account-holder name
is not checked against the teacher. The next run of `api/cron/teacher-payouts.ts` pays the whole released
balance (≥ £100 threshold) to the new account.

**Concrete attacker.** Anyone holding a live session as the tutor: a stolen refresh token; or a school
admin who mints a live session for a colleague via `api/school/staff-signin-link.ts`. That endpoint's
containment refuses `govt_admin`, `ssi_admin`, `god` and any second-school reach, but does not consider a
tutor `teachers` row — a school teacher who also tutors freelance is a supported state, so the admin lands
in that person's tutor dashboard with the bank-details form open.

**Blast radius.** Every tutor with accrued commission.

**Fix shape (not applied).** Step-up on change (fresh OTP to the verified address, or `amr` recency);
write a `pending_payout_recipient_id` + notify the owner + apply after a cooling period, or at minimum an
audit event and an email on change; `rejectIfViewAs` on the POST; add "holds a `teachers` row" to
staff-signin-link's containment; and F-01's column grant so the row cannot be written around the endpoint.
Precedent: `api/teacher/paddle-*.security.test.ts`.

### SEC0912T-F-03 (MEDIUM) — demo-mint is unbounded and accepts a live parent

**Where.** `api/groups/[id]/demo-mint.ts:59-86` (door), `:117-126` (parent read), `:205-239` (invite),
`api/groups/index.ts:57` (self-serve root org), `api/_utils/demoLeaf.ts:84-135`.

**Why it is a defect.** The door admits any group leader whose own group is the parent or an ancestor.
Root-org creation is open to any signed-in user, so any learner becomes such a leader in one call. The
parent is read for existence only (`select('id')`), never for `is_demo`; there is no rate limit and no
per-parent ceiling. Each call writes a group, a `govt_admin`-type invite code with `max_uses: null` and a
30-day expiry, and a `demo_orgs` row; `shape=school` adds a hidden school (`platform_status='trial'`, one
year), a class, a registered student join code and a class learner account. A learner can therefore mint
thousands of groups, schools, classes and open invite links under a real org tree, and every one of them
is picked up by the expiry cron.

**Blast radius.** Row flooding in `groups`, `schools`, `classes`, `invite_codes`, `demo_orgs`,
`learners`; noise in every admin tree/table lens and in the expiry cron. Not a data read.

**Fix shape (not applied).** Require the parent to be a demo node (or the caller to be `verifyAdmin`)
for non-admin callers; a per-caller rate limit on the `named-seat.ts` pattern (fails closed); a bounded
`max_uses` on the minted leader invite.

Cleared alongside: `demo-refresh.ts` is `verifyAdmin`-gated and `demoNodeRefresh.ts` refuses a non-demo
node and any non-demo school in the subtree, and only ever writes `is_demo=true` student learners.

### SEC0912T-F-04 (LOW) — identity-claims: correct scope, stale contract, skipped tenant rule

**Q3 answer.** The claim asserted is "this email domain / this one address belongs to my school". Only an
admin of the caller's own school may assert it (both spellings via `schoolMembershipsOf`); a `school_id`
in the request can only narrow, never widen; DELETE is scoped to the caller's school in the same
statement. It cannot attach a learner to a school that is not the caller's.

**What remains.** The handler header and `schoolDomain.ts` still say a claim lets an arrival "straight
in" with `needs_verification=false`. That weight was removed on 2026-09-09: `possession-redeem.ts`
("NOTHING IS STAMPED AT THE DOOR") and `code/redeem.ts` no longer read claims, and the only consumer left is
the roster's `on_domain` sort hint. The prose overstates the capability, which is the kind of gap that
gets re-armed by a later reader. Separately, the POST applies `whyDomainNotClaimable` but not the
shared-tenant refusal that `claimDomainForSchool` applies; arrival-time suppression in
`claimsVouchingFor` covers the read side, so this is an inconsistency, not a hole.

**Fix shape.** Correct the two headers; call `isSharedTenantOnLiveData` on the POST path.

### SEC0912T-F-05 (LOW, recurrence) — raw error text in 500 bodies

Already-known class (`api/groups/groupsErrorLeakage.security.test.ts`, SEC0912-B-02), recurring in
`commissions.ts`, `me.ts`, `payout-recipient.ts` (the Wise response body, up to 500 chars, reaches the
caller), `groups/[id].ts` GET/DELETE, `class-students.ts` (`detail`), `demo-mint.ts`. One line, pinned.

## Q5 — TENANCY-02 siblings

Every group handler in scope walks `parent_id`: `home.ts` and `rate-compare.ts` use `descendantIds` over
the forest, `invites.ts` uses `callerCanSeeGroup`, `[id].ts` and `demo-mint.ts` use
`isStrictDescendantGroup`, `schoolScope.ts` uses `descendantIds`. No `.startsWith`, `like`, or path
equality on `groups.path` anywhere in scope outside comments; the single remaining `.path` use in
`home.ts:687` computes display depth. Pinned by test.

## Checked and cleared

- `resolveVisibleScope`: keyed on the verified auth uid; teacher → taught classes; school_admin →
  `adminSchoolIdFor` then membership; govt_admin → parent_id subtree; ssi_admin/student → empty. The 20s
  scope cache means a removed teacher keeps scope for at most 20s (noted, not a finding).
- `scopeForSchoolRead` is only reachable after `verifyAdmin`.
- `classTeacherAuth.ts`: `canTeachClass` / `canManageClassTeachers` / `isLeaderAboveClass` all use
  `isSchoolAdminOf` (both spellings) and `isWithinLeaderSubtree`; no client claim of leadership.
- `groupAffiliation.ts`: pure write helper, called only by authorised paths; 23505 reactivation is bounded
  to the same (user, type, value) key.
- `classPractice.ts`, `directMemberPractice.ts`, `classProgressCopy.ts`: take learner/class id sets from
  the caller's resolved scope or the copy context; no request ids reach them.
- `class-students.ts`: the write target must already be a pupil of the class's own school; view-as refused
  on POST; failures raise rather than flatten to an empty list.
- `named-seat.ts`: seat minted at the caller's own school with the teacher role only; per-caller rate limit
  shared with staff-signin-link, fails closed; hash-only code storage.
- `teacher/me.ts`: PATCH allowlist is profile fields only; none of the status/payout columns.
- `teacher/commissions.ts`: GET only, `teacher_id = own`.
- `copy-teacher-play/preview.ts`: reads only; view-as allowed by design; apply refuses view-as.
- CORS via `applyCors` on every handler; methods pinned.

## Honest gap

- No live database was read, so F-01's grant is asserted from `supabase/schema.sql` (a dump) plus the
  absence of any narrowing migration. If the live project has since been narrowed out-of-band, F-01 is
  already closed and the characterization test should go red the moment the migration is committed.
- No external call was made: the Wise recipient endpoint's behaviour on an arbitrary `type/details` body
  was read from the handler, not exercised.
- `api/school/rate-compare.ts` (not in this area's list) still carries `group.path` in its entity shape;
  its subtree resolution uses `descendantIds` (pinned by `sec0901-a-remediation-verification`), so it was
  not re-audited here.
