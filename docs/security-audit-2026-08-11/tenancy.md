# Security audit 2026-08-11 — Area 2: Multi-tenant authz / IDOR

**Slug:** `tenancy` · **Branch:** `sec/audit-2026-08-11` · **Method:** static read of every handler in scope, end to end, plus one read-only live query (see [Method notes](#method-notes)). No production behaviour was changed; nothing was patched.

**Scope:** `api/school/**`, `api/org/**`, `api/groups/**`, `api/govt/**`, `api/teacher/**`, `api/family/**`, `api/board/**`, and the authz helpers `schoolScope.ts`, `groupTreeAuth.ts`, `classTeacherAuth.ts`, `groupSubtree.ts`, `orgLeader.ts`, `familyAccess.ts`, `familyMembership.ts`, `schoolStaff.ts`, `courseBoundary.ts`. 44 handlers, ~10,700 lines. **Every one of the 44 builds a `SUPABASE_SERVICE_ROLE_KEY` client**, so RLS is bypassed by design and the handler's own code is the entire tenancy boundary — exactly as CLAUDE.md's RLS doctrine intends.

---

## Headline

The hand-written scope checks are, on the whole, **good**: the recurring `resolveVisibleScope(...).classIds.includes(id)` gate, the session-derived school resolution, and the `parent_id`-walk subtree rule are applied consistently and correctly across the great majority of the surface. 34 of 44 handlers are clean.

The failures cluster into **three distinct root causes**, not forty:

1. **Slug-path subtree resolution survived the 2026-08-06 migration to `parent_id` in four places.** `groupSubtree.ts`'s own header declares the path-string rule unusable for tenancy ("every `path LIKE '<root>%'` resolver silently merged two unrelated tenants"), and `schoolScope.ts` was rewritten accordingly — but four call sites were not. Two of them make *authorization grants*. Because root-org creation is self-serve and the duplicate-name check is a warning that `confirm_duplicate: true` bypasses, **an attacker can manufacture the colliding path on demand by choosing an organisation name**. That turns a latent data-hygiene bug into an exploitable cross-tenant read and write.
2. **The Paddle webhook validates the *tier* rigorously and the *target tenant* not at all.** `customData.school_id` / `customData.group_id` come from browser JS and are used as the sole address for a privileged write to another tenant's billing row.
3. **Two established, deliberately-built controls are not applied uniformly** — the code-enumeration throttle (`api/code/validate.ts`) and the bounded-privileged-code guard (`codeGuard.ts`).

Findings 08–10 are consistency/hygiene rather than breach.

---

## Findings, most severe first

| ID | Sev | Location | One line |
|---|---|---|---|
| TENANCY-01 | **critical** | `api/groups/[id]/invites.ts:132` | Name-collision gives an attacker another tenant's invite codes — including personal sign-in URLs — plus revoke/rotate on them |
| TENANCY-02 | **high** | `api/groups/[id]/rate-compare.ts:319` | Authorization granted on slug-path equality; same collision reaches another tenant's node data |
| TENANCY-03 | **high** | `api/teacher/paddle-webhook.ts:467,526` | Client-supplied `school_id`/`group_id` addresses a privileged write to any tenant's billing row |
| TENANCY-04 | medium | `api/school/rate-compare.ts:119,230,281` | Unbounded `path LIKE` folds another tenant's learners into a leader's own displayed rate |
| TENANCY-05 | medium | `api/_utils/orgPlatform.ts:142` | Same unbounded prefix drives the org billing seat count |
| TENANCY-06 | medium | `api/teacher/by-code.ts:52` | Unauthenticated, unthrottled join-code oracle over a 13.8M keyspace the repo throttles elsewhere |
| TENANCY-07 | medium | `api/groups/[id]/invites.ts:547` | `govt_admin` invite codes mint unbounded: no expiry, unlimited uses |
| TENANCY-08 | low | 3 sites | School-admin recognised under one spelling only — re-opens the 2026-08-08 staging bug; fails closed |
| TENANCY-09 | info | `api/groups/index.ts:58` | `govt_admin` is self-assignable, so it is not a trust boundary — this is what makes 01/02 reachable |
| TENANCY-10 | info | `api/org/subscription.ts:42` | `Access-Control-Allow-Origin: *` on an authenticated endpoint |

---

### TENANCY-01 — Cross-tenant read **and write** of invite codes via a self-inflicted slug collision
**Severity: critical** · **Confidence: CONFIRMED (code path); the collision is attacker-creatable, see caveat**
**`api/groups/[id]/invites.ts:121-152`, reached from `:174-182` (PATCH) and `:283-390` (GET `?scope=subtree`)**

`resolveSubtree()` decides which groups, schools and classes belong to the node being viewed. It resolves membership by **slug path string**, not by `parent_id`:

```ts
// api/groups/[id]/invites.ts:121-134
async function resolveSubtree() {
  const { data: nodeRow } = await supabase
    .from('groups').select('id, path').eq('id', groupId).maybeSingle()
  if (!nodeRow) return null
  const path = (nodeRow as any).path as string
  const { data: groupRows } = await supabase
    .from('groups').select('id, name')
    .or(`path.eq.${path},path.like.${path}/%`)
```

The `/`-boundary on the `like` half is correct and closes the `ime-demo` → `ime-demo-two` case. **The `path.eq.${path}` half does not**: two unrelated root organisations whose names slug identically have *equal* paths, and this returns both. `groupSubtree.ts:5-15` says exactly this, in the codebase's own words:

```
 * SUBTREE MEMBERSHIP IS BY `parent_id`, NOT BY SLUG PATH (changed 2026-08-06).
 * `compute_group_path()` slugifies the name, and NOTHING makes a slug unique —
 * two orgs both called "Deborah Testing" both got `path = 'deborah-testing'`
 * live, so every `path LIKE '<root>%'` resolver silently merged two unrelated
 * tenants: each org's dashboard counted the other's people. The '/'-boundary
 * guard ... cannot help here — the paths are EQUAL.
```

**The collision is attacker-creatable.** Root-org creation is self-serve for any signed-in user, and the duplicate-name check is explicitly a warning, not a constraint:

```ts
// api/groups/index.ts:58-67 — resolveAdminOrLeaderForParent
if (!parentId) {
  // Root org creation (founder ruling 2026-08-02): open to any signed-in
  // user — the creator becomes the org's group leader. ...
  return { userId: authResult.userId, isAdmin: false, becomesLeader: true }
}
```
```ts
// api/groups/index.ts:160-174
if (!confirm_duplicate) {
  const duplicates = await findSiblingSlugCollisions(supabase, name, parent_id)
  if (duplicates.length > 0) { res.status(409).json(duplicateNameBody(...)); return }
}
```
`groupSlug.ts:10-13`: *"The rule this file enforces is a WARNING, never a constraint ... the same request re-sent with `confirm_duplicate: true` proceeds exactly as it does today."* `createRootOrgAndLeader` then mints the attacker's own `govt_admins` row (`rootOrgProvision.ts:56-58`), and the DB trigger stamps `path` from the name.

**What the attacker does**
1. Signs up as an ordinary learner. Reads a target org's display name off any public/shared surface.
2. `POST /api/groups` `{ name: "<victim org name>", confirm_duplicate: true }` → owns a root org whose `path` is byte-identical to the victim's, and is its `govt_admin`.
3. `GET /api/groups/<their own group id>/invites?scope=subtree` — **fully authorized on their own node**; the door check at `:111` (`callerCanSeeGroup`, correctly `parent_id`-based) passes legitimately. `resolveSubtree()` then folds in the victim's entire subtree.

**What they get** — the response is not a count. `:371-381`:

```ts
const isPersonal = !!row.metadata?.personal_auth_user_id
return {
  species: isPersonal ? 'personal' : 'shareable',
  personalName: row.metadata?.personal_name ?? null,
  personalEmail: row.metadata?.personal_email ?? null,
  code: row.code,
  url: `${origin}/${redeemPathForRole(role)}/${row.code}`,
```

That is the victim tenant's staff **names, email addresses, and redeemable sign-in URLs**. The file's own comment calls a personal link "a specific person's login" (`:49-51`). Redeeming one is account takeover of a school leader or teacher.

**And write.** PATCH ownership is decided by the same contaminated set (`:174-178`):
```ts
const inSubtree = !!row && (
  (row.grants_group_id && subtree.groupIds.includes(row.grants_group_id as string)) || ...
```
so `PATCH { code: "<victim code>", action: "revoke" | "rotate" | "resend" }` succeeds — revoking a victim tenant's onboarding links (denial of service), or `resend`ing a personal login link to the address on file.

**Caveat, honestly stated.** I ran a read-only query against the live `groups` table (51 rows): **zero duplicate paths and zero non-boundary prefix pairs exist right now.** The historical Deborah Testing pair has been cleaned up. So this is not currently *live*-exploitable against an existing collision — the attacker has to create one, which step 2 above lets them do in a single request. Treat it as reachable, not as already-breached.

**Recommended fix (not applied).** Replace `resolveSubtree()`'s group query with the `parent_id` walk that already exists and is already imported elsewhere: `fetchSubtree(supabase, groupId)` / `descendantIds()` from `_utils/groupSubtree.ts`. The schools/classes bridges below it key off `groupIds` and need no change. Longer term, a partial unique index on `groups(path)` would make the whole class impossible, but the parent_id switch is the correct minimal fix and matches the 2026-08-06 ruling.

---

### TENANCY-02 — Authorization granted on slug-path equality
**Severity: high** · **Confidence: CONFIRMED**
**`api/groups/[id]/rate-compare.ts:313-321`**

The non-admin authz branch decides "is this node inside my governed subtree?" by comparing path strings, using `isStrictDescendantGroup` (the correct `parent_id` walk, already imported in this very file) only as a fallback when a path is missing:

```ts
// api/groups/[id]/rate-compare.ts:313-321
} else {
  // Strict-descendant check from the forest already in hand; the
  // helper query only when a path is missing.
  const ownPath = groupPathById.get(scope.groupId)
  const nodePath = groupPathById.get(nodeId)
  authorized = ownPath && nodePath
    ? nodePath === ownPath || nodePath.startsWith(ownPath + '/')
    : await isStrictDescendantGroup(svc, scope.groupId, nodeId)
}
```

`nodePath === ownPath` is a **grant**. With the collision from TENANCY-01, `GET /api/groups/<victim node id>/rate-compare` returns 200 instead of 403 — the victim node's label plus its rate-of-progress and weekly-trend aggregates. Worse, `startsWith(ownPath + '/')` propagates the grant to the victim's *entire* subtree: every school node and class beneath the colliding root is authorised too.

Note the asymmetry that makes this a genuine defect rather than a style point: the *correct* predicate is one line away in the same expression. The fast path was added for latency and silently weakened the rule.

**Recommended fix.** Delete the path comparison; always call `isStrictDescendantGroup` (or `isWithinLeaderSubtree`, which wraps it and is what every other write path uses). The forest is already in hand as `allGroups`, so `descendantIds(allGroups, scope.groupId).includes(nodeId)` costs nothing and needs no extra query — the latency motivation is satisfied without the string comparison.

---

### TENANCY-03 — Paddle webhook trusts client-supplied `school_id` / `group_id` for tenant addressing
**Severity: high** · **Confidence: CONFIRMED (code); attacker cost is one real subscription**
**`api/teacher/paddle-webhook.ts:462-493` (schools) and `:521-530` (orgs)**

The webhook is otherwise carefully built. Signature verification is correct and fails closed (`:257-277`), and the *money* claim is validated server-side against the price actually billed:

```ts
// api/teacher/paddle-webhook.ts:414-429
} else if (kind === 'school_platform' || kind === 'tutor_platform' || kind === 'org_platform') {
  // customData.kind comes from CLIENT JS, but the entitlement it claims
  // (the paid dashboard) must be backed by the PLATFORM price actually billed.
  const billedPriceId = planIdOf(data)
  const meta = billedPriceId ? PRICE_CATALOG[billedPriceId] : undefined
  if (meta?.tier !== 'premium') { ...; return }
```

The **tier** cannot be faked. The **target tenant** is never checked:

```ts
// api/teacher/paddle-webhook.ts:466-493
const schoolId = customData.school_id as string | undefined
if (!schoolId) { ...; return }
...
const { error } = await supabase
  .from('schools')
  .update({
    platform_status: status,
    platform_expires_at: periodEnd,
    teacher_seats: seats,
    provider_subscription_id: data.id,
    provider_customer_id: data.customerId,
  })
  .eq('id', schoolId)
```

`customData` is constructed entirely in the browser — `packages/player-vue/src/composables/useSchoolCheckout.ts:86-87` (`kind: 'school_platform'`, `school_id`) and `useOrgCheckout.ts:80` (`group_id`). Paddle's signature attests that the event came from Paddle, not that the `customData` Paddle was handed at checkout time was honest.

**What the attacker does.** Opens a genuine school-platform checkout on the legitimate £15/seat price (so the tier gate passes) with `custom_data.school_id` set to a **victim school's uuid**, and pays. On the resulting `subscription.created`/`updated` webhook the victim school's row is overwritten.

**What they get**
- **Billing hijack.** `api/school/portal.ts:43-65` builds a Paddle customer-portal session from `school.provider_customer_id` — now the attacker's customer. The victim's own admin is handed a portal for the attacker's account. Symmetrically, `api/school/update-seats.ts:135-167` reads `school.provider_subscription_id` and issues `paddle.subscriptions.update(subId, ...)` — the victim admin's seat changes now mutate the attacker's subscription.
- **Coverage denial of service.** The attacker cancels; the next signed webhook carrying the same `customData` sets the victim's `platform_status = 'cancelled'`. Every coverage-gated surface then 403s `coverage_expired` for the whole school — `api/school/class-practice-7d.ts:62-66`, `api/school/daily-activity.ts:56-60`, `api/school/rate-compare.ts:348-351`.
- `teacher_seats` is overwritten with the attacker's quantity.

The same shape applies to `handleOrgPlatformSubscription` (`:521-530`) writing the `groups` row.

**Recommended fix.** Bind the checkout to the tenant server-side rather than trusting the payload: mint the checkout (or a signed one-time token carrying `school_id`) from an authenticated endpoint that has already proved the caller administers that school, and have the webhook resolve the target from that token. A cheaper interim: in the handler, refuse the write when the school/group row already carries a *different* `provider_subscription_id` (never let one tenant's subscription id displace another's), and record `customData.supabase_user_id` alongside so the pairing is auditable.

---

### TENANCY-04 — Unbounded `path LIKE` contaminates a group leader's own numbers
**Severity: medium** · **Confidence: CONFIRMED**
**`api/school/rate-compare.ts:118-128` (also `:230`, `:281`)**

```ts
// api/school/rate-compare.ts:118-119
async function subtreeClassIdsForGroupPath(svc, path, courseCode) {
  const { data: subtreeGroups } = await svc.from('groups').select('id').like('path', `${path}%`)
```

No `/` boundary and no collision protection — this is the *pre*-2026-08-06 rule, weaker even than TENANCY-01's, and `schoolScope.ts:119-126` documents both failure modes for the identical query while calling it "a cross-tenant read".

This resolves **the entity's own class set** at `entity_level=group` (`:180`), not merely the comparison cohort:
```ts
// api/school/rate-compare.ts:178-184
const { data: group } = await svc.from('groups').select('id, name, path, parent_id').eq('id', entityId)...
const classIds = await subtreeClassIdsForGroupPath(svc, (group as any).path, courseCode)
```
and that set feeds `entityWindow`/`entityTrend` (`:378-379`), which are returned as `entity.value` — the number the leader reads as *their own* rate of progress. So a leader of `acme` sees a figure computed partly over `acme-two`'s learners' sessions.

Impact is bounded: aggregates only, no names or row identities cross, and the cohort side is additionally protected by `K_FLOOR`. But it is still another tenant's session data being read and displayed.

**Recommended fix.** Same as TENANCY-01 — `descendantIds` over the forest. `:281`'s ancestor/descendant overlap exclusion (`entityPath.startsWith(g.path) || g.path.startsWith(entityPath)`) should move to the same primitive.

---

### TENANCY-05 — Org billing seat count spans colliding tenants
**Severity: medium** · **Confidence: CONFIRMED**
**`api/_utils/orgPlatform.ts:131-145`, consumed by `api/org/subscription.ts:112`**

```ts
// api/_utils/orgPlatform.ts:141-144
if (path) {
  const { data: subtree } = await svc.from('groups').select('id').like('path', `${path}%`)
```

Its own docstring (`:119-121`) claims it uses "the same subtree rule `schoolsForGroupSubtree` uses for schools, applied to people" — **that has not been true since 2026-08-06**, when `schoolsForGroupSubtree` moved to `descendantIds`. The comment is now the opposite of the code, which is how this one survived the migration.

`countSubtreeMembers` returns `member_count` on the org billing surface, so a leader can be shown a headcount inflated by a colliding or prefix-sibling tenant's staff and buy seats against it. No identities are disclosed — a count only.

**Recommended fix.** Switch to `descendantIds` and correct the docstring in the same edit.

---

### TENANCY-06 — Unauthenticated, unthrottled class join-code oracle
**Severity: medium** · **Confidence: CONFIRMED**
**`api/teacher/by-code.ts:31-56`**

The handler takes a code from the query string and looks it up with **no authentication and no throttle**:

```ts
// api/teacher/by-code.ts:40-56
const codeRaw = req.query.code
const code = typeof codeRaw === 'string' ? codeRaw.trim().toUpperCase() : ''
...
const { data: classRow } = await supabase
  .from('classes')
  .select('id, class_name, course_code, teacher_user_id, is_active, student_join_code, school_id, group_id')
  .eq('student_join_code', code)
  .maybeSingle()
```

The keyspace is `generateCode()`'s `ABC-123`: 24³ × 10³ = **13,824,000**. The repo already treats this exact keyspace as brute-forceable and built the countermeasure — `api/code/validate.ts:79-117` enforces 10 attempts per IP per 15 minutes with sha256-hashed IPs and writes every attempt to `possession_mint_attempts` "so abuse is observable", and its comment insists the sibling endpoint `api/auth/possession-redeem.ts` must share the window. `api/teacher/by-code.ts` looks up codes in the same space and does neither.

**What the attacker gets.** Enumeration yields (a) class name, course, teacher display name and school name for every class in the estate — a tenant-structure map — and (b) **working student join codes**, which is the material harm: a valid code lets an outsider enrol into a real school's class, appearing on that school's roster and inside its pupil-facing surfaces.

**Recommended fix.** Reuse the existing limiter: same window/limit, same `hashIp`, same `possession_mint_attempts` logging, so the three endpoints throttle a single IP jointly. Widening the code alphabet is a separate, larger change and is not required to close this.

---

### TENANCY-07 — `govt_admin` invite codes mint as unbounded bearer tokens
**Severity: medium** · **Confidence: CONFIRMED**
**`api/groups/[id]/invites.ts:507-537` (limits at `:536-537`), mapping at `:69-74`**

```ts
// api/groups/[id]/invites.ts:69-74
const CODE_TYPE_BY_ROLE: Record<Role, string> = {
  leader: 'govt_admin',
  school_leader: 'school_admin_join',
  teacher: 'teacher',
  student: 'student',
}
```
```ts
// api/groups/[id]/invites.ts:536-537
if (limits?.expires_at !== undefined) insertData.expires_at = limits.expires_at
if (limits?.max_uses !== undefined) insertData.max_uses = limits.max_uses
```

Both columns are nullable with **no database default** (`supabase/schema.sql:7325-7326`), so omitting `limits` mints a code that never expires and has unlimited uses. `role: 'leader'` produces a `govt_admin` code — group-leader authority on redemption.

`_utils/codeGuard.ts` exists precisely to stop this ("a privileged code can never again be unlimited-use + never-expiring — the SSI-GOD-2026 class of hole"), but its only caller restricts it to three types:

```ts
// api/invite/create.ts:274-278
const isPrivileged = code_type === 'ssi_admin' || code_type === 'god' || code_type === 'tester'
if (isPrivileged) {
  const bounded = boundPrivilegedCodeLimits(expires_at, max_uses)
```

So `govt_admin` and `school_admin_join` — both of which grant tenant-level administrative authority — are outside the guard on **both** minting paths. This is a policy gap, not a regression introduced by the newer endpoint; I flag it here because the newer surface makes it the default way leader codes get made. Combined with TENANCY-06's un-throttled sibling lookups, an unbounded code in a 13.8M space is a standing risk rather than a one-shot one.

**Recommended fix.** Extend `isPrivileged` to include `govt_admin` and `school_admin_join`, and apply `boundPrivilegedCodeLimits` in `api/groups/[id]/invites.ts` too, so both minting paths bound the same set.

---

### TENANCY-08 — School admin recognised under one spelling only, in three places
**Severity: low (fails CLOSED — availability, not breach)** · **Confidence: CONFIRMED**
**`api/school/roster.ts:297-304`, `api/teacher/create-class-join-code.ts:125-132`, `api/teacher/create-class-learner.ts:114-121`**

All three hand-roll the school-admin branch against the founding pointer alone:

```ts
// api/teacher/create-class-join-code.ts:125-132
if (!authorized && cls.school_id) {
  const { data: school } = await supabase
    .from('schools').select('admin_user_id').eq('id', cls.school_id).maybeSingle()
  if (school?.admin_user_id === callerUserId) authorized = true
}
```

`_utils/schoolStaff.ts:105-133` is the designated single owner of that question and accepts **both** spellings — the pointer *and* an active `SCHOOL:` tag with `role_in_context='admin'`. Its docstring records the live consequence of getting this wrong (Tom, staging, 2026-08-08: "Harbour Leader" refused on all three of her own school's classes) and states the intent plainly: *"Deliberately ONE predicate, exported, so the two spellings can never again be recognised in one place and missed in another."* `classTeacherAuth.canTeachClass` is the ready-made composite.

These three sites are the missed ones. A tag-admin — which is every admin after the founder — is denied minting a join code or creating a learner entity for classes in her own school, and cannot enumerate co-teacher candidates. It is a denial, so there is no data exposure; I report it because CLAUDE.md names duplicated authz rules as the drift mechanism, and this is that mechanism caught in the act on three surfaces.

**Recommended fix.** Replace all three hand-rolled ladders with `canTeachClass(supabase, callerUserId, classRow)` (which already composes lead-pointer → active class tag → platform admin → `isSchoolAdminOf`), deleting the local copies.

---

### TENANCY-09 — `govt_admin` is self-assignable, so it is not a trust boundary
**Severity: info** · **Confidence: CONFIRMED**
**`api/groups/index.ts:58-67` + `api/_utils/rootOrgProvision.ts:56-58`**

Any signed-in user can create a root organisation and is minted its `govt_admins` row. This is deliberate (founder ruling 2026-08-02, quoted in the code) and correct for self-serve onboarding — a leader of their own empty org has authority over nothing else. I record it because several handlers read as though "has a `govt_admins` row" were an earned privilege, and it is not: it is one POST away. It is precisely what makes TENANCY-01 and TENANCY-02 reachable by an outsider rather than only by an existing leader. Any future check that treats `govt_admin` as elevated should be read in this light.

---

### TENANCY-10 — Wildcard CORS on an authenticated endpoint
**Severity: info** · **Confidence: CONFIRMED**
**`api/org/subscription.ts:42-44`**

```ts
res.setHeader('Access-Control-Allow-Origin', '*')
```

The only endpoint in scope that does this. Not exploitable as written — auth is a bearer token, not a cookie, so a hostile origin has nothing to replay and `Allow-Credentials` is absent — but it is inconsistent with the other 43 handlers and would become a real problem if this endpoint ever moved to cookie auth.

---

## Endpoint × method table

`resolveVisibleScope` is abbreviated **RVS**; `verifyAuthToken` **VAT**; `verifyAdmin` **VA**.

| Endpoint | Method | Id params accepted | Auth | Scope check | Verdict |
|---|---|---|---|---|---|
| `school/delete-class.ts:48` | GET, POST | `class_id` (query/body) | VAT | `scope.classIds.includes(classId)` :61 | SAFE |
| `school/rename-class.ts:44` | POST | `class_id` (body) | VAT | `scope.classIds.includes(classId)` :59 | SAFE |
| `school/update-profile.ts:66` | POST | none — school from session | VAT | `admin_user_id` OR `SCHOOL:` tag `role_in_context='admin'` :68-85 | SAFE |
| `school/update-seats.ts:72` | POST | none — school from session | VAT | same admin-only resolution :74-92 | SAFE |
| `school/remove-staff.ts:52` | POST | `target_user_id` (body) | VAT | caller school admin-only :62-86, target must hold teacher tag on *that* school :89-102 | SAFE |
| `school/roster.ts:74` | GET | — | VAT | role gate + own school; teacher pupil rows filtered to `scope.classIds` :214-216 | SAFE |
| `school/roster.ts:251` | GET `?class_id` | `class_id` | VAT | class membership ladder :271-304 | WEAK (TENANCY-08) |
| `school/class-progress.ts:359` | POST | `classId`, `method`, `args` | VAT | role∈{teacher,school_admin} :395 **and** `scope.classIds.includes` :399; learner+course from class row, never body :404-414; `assertSessionOwnedByClass` :318, lego-row ownership :178-186 | SAFE |
| `school/class-practice-7d.ts:51` | GET | `class_ids` (csv) | VAT | intersected with `scope.classIds` :55-56 + coverage gate | SAFE |
| `school/daily-activity.ts` | GET | `days` only | VAT | RVS learner set + coverage gate :56 | SAFE |
| `school/group-summary.ts:58` | GET | `groupId` | VAT | own group wins; `groupId` honoured only after VA :70-77 | SAFE |
| `school/rate-compare.ts:310` | GET | `entity_id`, `entity_level` | VAT | membership in `classIds`/`schoolIds`/`groupId` :329-336 | WEAK (TENANCY-04 — gate holds, resolved set contaminated) |
| `school/subscription.ts` | GET | none — school from session | VAT | `admin_user_id` else school tag :102-120 | SAFE |
| `school/portal.ts` | GET | none | VAT | `.eq('admin_user_id', userId)` :43-47 | SAFE |
| `org/subscription.ts` | GET | `group_id` | VAT | `leaderGroupId` from session; `group_id` only when caller leads nothing **and** is `ssi_admin` :74-87 | WEAK (TENANCY-05, TENANCY-10) |
| `org/update-seats.ts` | POST | none — org from session | VAT | `leaderGroupId(auth.userId)` :64 | SAFE |
| `groups/index.ts` | GET | — | VA | admin-only :92-96 | SAFE |
| `groups/index.ts` | POST | `parent_id` | VA→VAT | `isWithinLeaderSubtree(own, parentId)` :69; root creation open by design | SAFE (see TENANCY-09) |
| `groups/[id].ts` | PATCH | `id`, `parent_id` | VA→VAT | name-only for leaders + `isWithinLeaderSubtree` :148; type/parent admin-only :138; re-parent cycle check :160-168 | SAFE |
| `groups/[id].ts` | GET `?impact`, DELETE | `id` | VA→VAT | `isStrictDescendantGroup` :77 — strict descendant only | SAFE |
| `groups/tree.ts` | GET | `root`, `depth` | `resolveGroupTreeCaller` | `callerCanSeeGroup` :88; `fetchSubtree` = `parent_id` | SAFE |
| `groups/table.ts` | GET | filters only | `resolveGroupTreeCaller` | `fetchSubtree(caller.ownGroupId)` :43 | SAFE |
| `groups/[id]/home.ts` | GET | `id` (group\|school\|class) | `resolveGroupTreeCaller` | `callerCanSeeGroup` :145; rail trimmed to `ownGroupId` :273-289 | SAFE |
| `groups/[id]/invites.ts` | GET | `id` | `resolveGroupTreeCaller` | `callerCanSeeGroup` :111 (correct) | SAFE |
| `groups/[id]/invites.ts` | GET `?scope=subtree` | `id` | as above | `resolveSubtree()` — **slug path** :132 | **VULNERABLE (TENANCY-01)** |
| `groups/[id]/invites.ts` | PATCH | `id`, `code` | as above | `inSubtree` from same contaminated set :174-178 | **VULNERABLE (TENANCY-01)** |
| `groups/[id]/invites.ts` | POST | `id`, `personal.class_id` | as above | class must belong to node's school :493-506; limits unbounded :536 | WEAK (TENANCY-07) |
| `groups/[id]/rate-compare.ts` | GET | `id` | VA→VAT | class in `scope.classIds`, school in `scope.schoolIds`, else **path compare** :319 | **VULNERABLE (TENANCY-02)** |
| `groups/[id]/demo-mint.ts` | POST | `id` | VA→VAT | `isStrictDescendantGroup` :94 | SAFE |
| `groups/[id]/demo-refresh.ts` | POST | `id` | VA only :38 | admin-gated; demo guards server-side | SAFE |
| `govt/create-school.ts` | POST | none — group from session | VAT | `govt_admins.group_id` :82-91; `admin_user_id` deliberately NULL | SAFE |
| `govt/school-links.ts` | GET | `groupId` | VAT | own group wins; `groupId` only after VA :58-67 | SAFE |
| `teacher/class-teachers.ts` | POST | `class_id`, `target_user_id` | VAT | `isActiveClassTeacher` for self-remove, else `canManageClassTeachers` :110-111 | SAFE |
| `teacher/create-class-join-code.ts` | POST | `class_id` | VAT | lead → class tag → platform admin → `admin_user_id` :96-137 | WEAK (TENANCY-08) |
| `teacher/create-class-learner.ts` | POST | `class_id` | VAT | same ladder :96-126 | WEAK (TENANCY-08) |
| `teacher/classes.ts` | GET, POST | none | VAT | teacher row from session; POST hardcodes `school_id: null` :241 | SAFE |
| `teacher/me.ts` | GET, PATCH | none | VAT | `.eq('user_id', authResult.userId)` :90 | SAFE |
| `teacher/commissions.ts` | GET | none | VAT | learner→teacher from session :51-66 | SAFE |
| `teacher/payout-recipient.ts` | GET, POST | none | VAT | same :65-80 | SAFE |
| `teacher/portal.ts` | GET | none | VAT | same :38-53 | SAFE |
| `teacher/by-code.ts` | GET | `code` | **none** | none — public join page | WEAK (TENANCY-06) |
| `teacher/paddle-webhook.ts` | POST | `customData.*` | Paddle signature :257-277 | tier validated :421-429; **tenant id not** :467,526 | **VULNERABLE (TENANCY-03)** |
| `teacher/wise-webhook.ts` | POST | `data.resource.id` | RSA-SHA256, fails closed :97-101 | matched on `wise_transfer_id` set by our own cron | SAFE |
| `family/index.ts` | GET | none | VAT | `resolveLearnerId` from session :40 | SAFE |
| `family/invite.ts` | POST | `email` | VAT | owner = session learner :56 | SAFE |
| `family/create-child.ts` | POST | `display_name` | VAT | owner = session learner :52 | SAFE |
| `family/remove.ts` | POST | `member_id` | VAT | `.eq('owner_learner_id', ownerLearnerId)` is the filter :55 | SAFE |
| `family/leave.ts` | POST | none | VAT | `.eq('member_learner_id', learnerId)` :48 | SAFE |
| `family/signin-link.ts` | POST | `member_id` | VAT | owner match + `is_child_account` :56-63 | SAFE |
| `board/snapshot/[code].ts` | GET | `code` | **none** — capability URL | 128-bit CSPRNG code (`codeGen.ts:35-40`); 404 on missing *or* revoked | SAFE |

---

## Controls that hold — verified, and now regression-locked by tests

These are as much the finding as the vulnerabilities are; the pattern is sound and worth protecting.

- **`isStrictDescendantGroup` / `isWithinLeaderSubtree` walk `parent_id`, never the path** (`schoolScope.ts:146-160`, `orgLeader.ts:17-25`) — and therefore correctly **deny** a leader over an unrelated same-path group. This is the exact predicate TENANCY-01/02 bypass, and it is right.
- **The `scope.classIds.includes(classId)` gate is applied identically on reads and writes** — `delete-class.ts:61`, `rename-class.ts:59`, `class-progress.ts:399`. No read/write asymmetry found anywhere in `api/school/**`.
- **Session-derived school resolution refuses a body `school_id`** across `update-profile`, `update-seats`, `subscription`, `portal`, `remove-staff`, and gates on `role_in_context='admin'` rather than bare school membership.
- **`class-progress.ts` re-derives `learnerId` and `courseId` from the class row** (`:404-414`) so `args` can never address another learner, and both mutable-by-id paths carry ownership assertions (`assertSessionOwnedByClass` :318, `updateLegoProgress` :178-186).
- **Admin-passthrough ordering is right** in `group-summary.ts:65-81` and `govt/school-links.ts:54-71`: a real leader's own scope always wins, and a client `groupId` is honoured only after `verifyAdmin`.
- **`remove-staff.ts` cascades class-level tags and hands over the lead pointer** (`:117-237`), closing the "removed staff keep pupil visibility" hole, and never swallows a cascade error.
- **Both webhooks fail closed on signature verification** (`paddle-webhook.ts:274-277`, `wise-webhook.ts:97-101`, `wise.ts:100-117` returns false when the key is unset).
- **`verifyAdmin` distinguishes "not an admin" from "lookup failed"** (`auth.ts:110-112`), returning 500 rather than silently denying a real admin — and uses the caller's own token, so RLS still applies to the role read.

---

## Method notes

- Static reading of all 44 handlers and 9 helpers, line by line, including every HTTP-method branch. All quotes are copied from the files at the commit under audit.
- One **read-only** live query was run (`SELECT id, name, path, parent_id FROM groups`, 51 rows) to test whether TENANCY-01/02's precondition exists today. It does not. Nothing was written; no endpoint was called; no exploit traffic was generated.
- No fixes were applied to any file under `api/` or `packages/`.

## Gaps — what I could not check

1. **No live exploit verification.** Every attack chain here is derived from code plus schema; none was executed. TENANCY-01/02 in particular assume the DB trigger stamps `path` from the name as `groupSlug.ts:17-19` documents — I read that documentation and the absence of any unique index, but did not observe a trigger-produced collision.
2. **`compute_group_path()`'s body was not read.** It is not in `supabase/migrations/` (only referenced), so the slug rule is taken from `groupSlug.ts`'s mirror and its comment. If the live function differs, TENANCY-01/02's *trigger* changes; the code defects at those lines do not.
3. **TENANCY-03's Paddle side is unverified.** I did not confirm against Paddle that `custom_data` is echoed verbatim into `subscription.*` webhooks, nor test a tampered checkout — that would be live payment traffic, which is out of bounds. The client-side origin of `customData` is confirmed in `useSchoolCheckout.ts` / `useOrgCheckout.ts`; the webhook's own comments (`:397`, `:415`) independently assert that `customData` is client-supplied.
4. **Rate-limit efficacy at the edge.** I checked application-level throttling only. Any Vercel/WAF layer in front of `api/teacher/by-code.ts` would reduce TENANCY-06's practicality and I could not observe it.
5. **`api/teacher/paddle-webhook.ts` was audited for signature handling and tenant addressing, not as a whole billing state machine.** Its 1,699 lines contain commission and precedence logic I read only in outline; a dedicated billing-integrity pass would be a separate piece of work.
6. **Cross-area interactions not pursued.** Redemption (`api/code/redeem.ts`, `api/auth/possession-redeem.ts`) is another area's scope, so TENANCY-01's "redeem the stolen personal link" and TENANCY-06's "enrol with the guessed code" endpoints were read for impact only, not audited.
7. **No fan-out.** The dispatch ceiling refused workers at this depth, so this area was audited single-threaded. Coverage is complete; a second independent reader would have been a useful adversarial check on the three top findings and did not happen.
