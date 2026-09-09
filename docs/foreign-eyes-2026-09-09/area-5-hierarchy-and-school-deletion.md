# Area 5 (part 1) — the school-deletion claim: VERIFIED

Baseline: this checkout, cut from `origin/dev` (`f666d4a7`). Read-only. No live database was queried; every statement below is from source in this tree, quoted with `file:line`.

## The claim under test

A previous run died having asserted, without evidence:

> "admin/update-school.ts uses the same resolver for school deletion without checking the callers role. A teachers school tag passes that gate."

**Verdict: CONFIRMED.** The claim is true as stated, and the reachable damage is larger than the sentence suggests. Below is the resolver, the missing check, the proof that a teacher really does hold the tag the resolver reads, the proof that nothing upstream stops it, and the attack sequence.

Confidence: **high** on the code path (every link read in source, and the repo itself documents the hazard in a sibling file). **Medium** on live exploitability, for one reason stated plainly in *Limits* below: I did not query the live database, so I have not confirmed that a live teacher account with a `SCHOOL:` tag exists today. Three separate code paths write exactly that row.

---

## FE5-01 — a teacher can delete their whole school

**Severity: high. Destructive and irreversible; no role check anywhere on the path.**

### The resolver

`api/_utils/schoolScope.ts:75–94`

```text
75: export async function schoolIdForAdmin(svc: SupabaseClient, authUid: string): Promise<string | null> {
76:   const { data: tag } = await svc
77:     .from('user_tags')
78:     .select('tag_value')
79:     .eq('user_id', authUid)
80:     .eq('tag_type', 'school')
81:     .is('removed_at', null)
82:     .order('added_at', { ascending: true })
83:     .limit(1)
84:     .maybeSingle()
85:   if (tag?.tag_value) return (tag.tag_value as string).replace('SCHOOL:', '')
86:
87:   const { data: school } = await svc
88:     .from('schools')
89:     .select('id')
90:     .eq('admin_user_id', authUid)
91:     .limit(1)
92:     .maybeSingle()
93:   return (school as any)?.id ?? null
94: }
```

Two facts about it, both decisive:

1. The `user_tags` query filters on `tag_type` and `removed_at` only. It **never reads `role_in_context`** — the column that says whether this person is a `school_admin` or a `teacher` here. The genuine ownership test, `schools.admin_user_id = authUid` at line 90, is the *second* branch and is only reached when the first returns nothing. A membership tag therefore **shadows** the ownership check.
2. Its own docstring says so, in as many words — `api/_utils/schoolScope.ts:65–74`:

```text
65: /**
66:  * The school a staff member (school_admin OR teacher) belongs to:
67:  * first-joined SCHOOL: tag, else admin_user_id. Exported so endpoints that
68:  * need a TEACHER's own school (resolveVisibleScope deliberately leaves a
69:  * teacher's schoolIds empty — see filterActiveScope's docstring, a teacher
70:  * can span schools) can resolve the same "home school" the client's
71:  * useSchoolContext.resolveUser() shows them, without re-deriving it from
72:  * classIds (which can't distinguish "no school" from "multiple schools").
73:  */
```

This is a **membership** resolver, correctly named for nothing. It is documented as answering "which school does this staff member — *admin or teacher* — belong to?". Its name, `schoolIdForAdmin`, says the opposite, and that is how it came to be used as an ownership gate.

### The gate that trusts it

`api/admin/update-school.ts:87–105`, on the shared `GET`/`DELETE` branch:

```text
87:     // ssi_admin/god first; fall back to the school's OWN admin — a
88:     // server-derived ownership check, never a client claim of "my school".
89:     const adminResult = await verifyAdmin(req)
90:     let callerUserId: string
91:     if (!('error' in adminResult)) {
92:       callerUserId = adminResult.userId
93:     } else {
94:       const authResult = await verifyAuthToken(req)
95:       if (!authResult.valid || !authResult.userId) {
96:         res.status(401).json({ error: authResult.error || 'Unauthorized' })
97:         return
98:       }
99:       const ownSchoolId = await schoolIdForAdmin(supabase, authResult.userId)
100:      if (!ownSchoolId || ownSchoolId !== schoolId) {
101:        res.status(403).json({ error: 'Not your school' })
102:        return
103:      }
104:      callerUserId = authResult.userId
105:    }
```

What is wrongly trusted: **`schoolIdForAdmin` is read as "the school this caller owns", when it means "a school this caller is tagged into, in any staff role."** The comment at line 88 — "a server-derived ownership check, never a client claim" — is true about *provenance* and false about *meaning*. Deriving the wrong predicate on the server is still the wrong predicate.

`verifyAuthToken` (`api/_utils/auth.ts:32–72`) checks only that the bearer token resolves to a Supabase user. It returns `{ valid: true, userId }` for **any** signed-in account and does not look at `learners` at all. `verifyAdmin` (`api/_utils/auth.ts:88–127`) returns `{ error: 'Requires SSi admin access', status: 403 }` for a teacher, which is precisely what sends the request down the fallback branch at line 94. Nothing between line 105 and the `deleteSchoolCascade` call at line 131 consults `learners.educational_role`, `user_tags.role_in_context`, or `schools.admin_user_id`.

### That a teacher really holds the tag

Three independent writers create `user_tags(tag_type='school', role_in_context='teacher')`:

`api/code/redeem.ts:682–689` — redeeming a teacher invite code:

```text
682:      if (inviteRow.grants_school_id) {
683:        teacherTags.push({
684:          user_id: userId,
685:          tag_type: 'school',
686:          tag_value: `SCHOOL:${inviteRow.grants_school_id}`,
687:          role_in_context: 'teacher',
688:          added_by: userId,
689:        })
```

`api/school/named-seat.ts:187–193` — an admin minting a named teacher seat:

```text
187:    const { error: tagErr } = await supabase.from('user_tags').insert({
188:      user_id: seatUserId,
189:      tag_type: 'school',
190:      tag_value: `SCHOOL:${callerSchoolId}`,
191:      role_in_context: 'teacher',
192:      added_by: auth.userId,
193:    })
```

`api/admin/create-staff.ts:115–120` — staff created by an ssi_admin, `role_in_context` following the chosen role.

So the ordinary, intended, only way a teacher joins a school is the very row that opens this door.

### (a) Is there a gate upstream? No — and here is each candidate, ruled out

| Candidate gate | Verdict |
|---|---|
| Vercel middleware / route guard | **Does not exist.** No `middleware.ts` at repo root or under `api/`. `vercel.json:71–86` rewrites `/api/(.*)` straight through; there is no auth rewrite, and `functions` (`vercel.json:7–16`) only sets `maxDuration` on three unrelated routes. |
| RLS on `schools` | **Cannot apply.** The handler builds its client with the service-role key — `api/admin/update-school.ts:49` (`SUPABASE_SERVICE_ROLE_KEY`) and `:75` (`createClient(supabaseUrl, supabaseServiceKey)`). Service role bypasses RLS by definition. Separately, there is in fact **no DELETE policy** for `authenticated` on `schools` at all (`supabase/schema.sql:19872–19893` has `schools_insert`, two `schools_select`, `schools_update` — no delete), which is exactly why the client-side delete was moved to this endpoint in the first place (`api/admin/update-school.ts:4–9`). The RLS layer was doing its job; the endpoint stands in front of it. |
| Method restriction | **No.** `applyCors(req, res, { methods: 'GET, PATCH, DELETE' })` at `:63` and the 405 at `:65–68` admit DELETE. |
| The `confirm_name` guard | **Not an authorisation gate, and it hands over its own key.** See the sequence below. |
| The tests | **Blind to it.** `api/admin/update-school.test.ts:24` mocks `schoolIdForAdmin` wholesale (`vi.fn(async () => ownSchoolId)`), so no test in the file ever exercises the resolver's real predicate. The suite's own delete cases (`:226`, `:249`) assert the self-serve path *works*; nothing asserts a teacher is refused. |

The most telling evidence is inside the repo. The sibling group-deletion path performs exactly the missing check. `api/_utils/groupTreeAuth.ts:50–61`:

```text
50:  // School leader: scope root = their own school's node. Gated on the
51:  // educational_role, NOT on mere school membership — a teacher also carries
52:  // a SCHOOL: tag but stays on the teacher surfaces (no node-surface access).
53:  const { data: learner } = await supabase
54:    .from('learners')
55:    .select('educational_role')
56:    .eq('user_id', authUid)
57:    .maybeSingle()
58:  if ((learner as any)?.educational_role !== 'school_admin') return null
59:
60:  const schoolId = await schoolIdForAdmin(supabase, authUid)
61:  if (!schoolId) return null
```

That comment is a written acknowledgement of this precise hazard — "*a teacher also carries a SCHOOL: tag*" — placed one line above the guard that neutralises it. `DELETE /api/groups/[id]` reaches `schoolIdForAdmin` only through this function (`api/groups/[id].ts:81`, via `leaderGroupIdFor`), and is therefore **safe**. `DELETE /api/admin/update-school` calls the resolver raw. Two sibling destructive endpoints, the same resolver, the guard present in one and absent in the other.

### (b) The attack sequence

Actor: an ordinary teacher account — someone who redeemed a school teacher invite code, or was given a named seat. No admin role, no elevated token, no stolen credential. Everything below uses their own session.

1. Sign in normally. Obtain the session access token the SPA already holds (`localStorage`, or DevTools; no privilege needed to read your own token).
2. Learn your own `schools.id`. Three ways, all legitimate: the `schools_select` RLS policy explicitly grants read to a tag-holder — `supabase/schema.sql:19879`, `has_user_tag('school', 'SCHOOL:' || id)` — so a plain client query returns the row; or `GET /api/school/roster`, which resolves a teacher's own school through this same resolver (`api/school/roster.ts:93`); or simply read it out of the schools dashboard the teacher already uses.
3. `GET /api/admin/update-school?school_id=<id>` with your bearer token. `verifyAdmin` fails, the fallback fires, `schoolIdForAdmin` returns your school, the ids match, and the endpoint returns the deletion-impact preview (`api/admin/update-school.ts:107–116`) — class count, session count, learner count, teacher count, **and `schoolName`** (`api/_utils/schoolGroupDeletion.ts:116–124`).
4. `DELETE /api/admin/update-school?school_id=<id>` with the same token. If the school has never been used, it is deleted here and the sequence ends at step 6.
5. If the school has real recorded activity, the endpoint replies 409 with `requires_confirm_name: true` **and the whole impact object in the body** (`api/admin/update-school.ts:122–129`). The exact string needed to defeat the guard is in the refusal. Repeat step 4 with `confirm_name=<schoolName>` copied from that response — or from step 3, which never refused anything.
6. `deleteSchoolCascade` runs (`api/_utils/schoolGroupDeletion.ts:201–222`).

The `confirm_name` gate is a **typo guard for an authorised admin**, and reads correctly as one. It is not an authorisation control, and against a caller who has already been let in it costs one extra HTTP request.

### What is destroyed

`api/_utils/schoolGroupDeletion.ts:201–222` in order, plus the database's own cascades:

- every `invite_codes` row granting the school — `.delete().eq('grants_school_id', schoolId)` (`:209`). Every join code the school hands out, gone.
- every `user_tags` row for `SCHOOL:<id>` — `.delete()` (`:212–216`), a **hard delete, not a `removed_at` soft-remove**. Every teacher's and admin's membership of that school, with no tombstone.
- the `schools` row (`:220`), and behind it:
  - `classes` — `ON DELETE CASCADE` (`supabase/schema.sql:17383`),
  - `class_sessions` via classes — `ON DELETE CASCADE` (`:17359`),
  - `entitlement_grants` by school and by class — `ON DELETE CASCADE` (`:17671`, `:17655`). **Paid access dies with the row.**

Nothing here is transactional: the four statements are separate PostgREST calls, so a failure part-way leaves the school with its invite codes and its staff tags already destroyed. And nothing is soft: there is no `deleted_at`, no archive table, no undo. Recovery means a database point-in-time restore.

What the attacker gains: destruction of their employer's entire schools tenancy — roster, classes, recorded practice history, live entitlements — from an ordinary teacher login, and the audit row written afterwards (`api/admin/update-school.ts:134–138`, `admin_school_deleted`) names them, so this is loud vandalism rather than stealth. Note also that a teacher can legitimately be a **contractor across multiple schools**; the tag is not evidence of loyalty.

### The second variant: `.order('added_at', { ascending: true }).limit(1)`

Line 82 takes the **earliest** active school tag, not the caller's current or chosen school. Two consequences follow from the same line, both reachable by the same sequence with a different actor:

- A genuine `school_admin` of school B who was earlier a teacher at school A resolves to **A**. They can delete **A** — a school they never administered — and are refused on **B**, their own. The endpoint's self-serve promise is broken in both directions at once.
- The set of schools a caller can destroy is determined by whichever tag happens to sort first by `added_at`, which is not a property anyone administers or can see.

### Fix shape (recorded, not applied — this sweep is read-only)

The check missing at `api/admin/update-school.ts:99` is the one already written at `api/_utils/groupTreeAuth.ts:53–58`. The name `schoolIdForAdmin` is itself part of the defect and invites the next misuse.

---

## Limits of this verification

- **No live database query.** I have not confirmed that a live teacher account currently holds a `SCHOOL:` tag, nor how many schools have real activity. Three code paths write that row and it is the only way a teacher joins a school, so I regard the premise as sound — but it is inference from source, not observation.
- **No request was made against any deployment.** Nothing was executed; the sequence in (b) is derived from source and is unrun.
- **Calibration.** No schools are paying yet, so today's blast radius is demo and pilot tenancies rather than customers. That bounds the *present* cost, not the defect: the path is on `dev` and rides the ordinary promotion train to production, and the first paying school is the first irreversible loss.

## Scope of this file

This file answers Job 1 only — the specific dying claim. Area 5 proper (admin and view-as), and Areas 6 and 7, follow in their own files.
