# Area 6 — anywhere the server trusts data the client can write

Baseline: this worktree, reset to `origin/dev` (`f666d4a7`). Read-only: no code changed, no test run, no request made against any deployment, no live database queried. Every quote below is from source in this tree.

The area is a shape, not a directory: **a server route reading a value a browser can set, and then making an authorisation, money or identity decision on it.** The obvious spelling — a body field naming the thing you want — is well covered in this repo; I found no unguarded `school_id`/`class_id`/`learner_id`-from-the-body in the write paths (see *What I checked and cleared*). The findings below are all the same shape one layer down: the value the client writes is not in the request at all. It is **a row the browser is allowed to INSERT into the database directly**, or **a payload the browser posts to a public endpoint**, or **an email address the browser typed** — and a server resolver then reads it back as if it were server-derived fact.

Not re-reported, already filed: the `api/admin/update-school.ts` DELETE gate (area 5), the fixed `user_metadata` arrival attestation, the fixed `getAppOrigin` Host poisoning. FE6-01 (c) touches area 5's endpoint but from a different root and with a much larger blast radius; it is called out as such.

---

## FE6-01 — `user_tags` is browser-writable, and four server resolvers read it as authority

**Confidence: certain on the grant and the policy as committed; likely on live state** (schema.sql is a dump, not live state — see *What would settle it*).

### What the client can write

`supabase/schema.sql:22124` — the table grant:

```text
22124: GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.user_tags TO authenticated;
```

Table-level, so **every column**: `user_id`, `tag_type`, `tag_value`, `role_in_context`, `added_at`, `added_by`, `removed_at`.

`supabase/schema.sql:20296` — the only content rule:

```text
20296: CREATE POLICY user_tags_insert ON public.user_tags FOR INSERT TO authenticated
         WITH CHECK ((public.is_god_user()
           OR ((user_id = (( SELECT auth.uid() AS uid))::text)
               AND (role_in_context IS DISTINCT FROM 'teacher'::text)
               AND (role_in_context IS DISTINCT FROM 'admin'::text))));
```

And the UPDATE twin, `supabase/schema.sql:20310`, whose `USING` clause admits **any** row of my own — including my own `teacher` row — while its `WITH CHECK` only requires the *resulting* row not to say `teacher`/`admin`:

```text
20310: CREATE POLICY user_tags_update ON public.user_tags FOR UPDATE TO authenticated
         USING (((user_id = (( SELECT auth.uid() AS uid))::text) OR public.is_god_user() OR ...))
         WITH CHECK ((public.is_god_user()
           OR ((user_id = (( SELECT auth.uid() AS uid))::text)
               AND (role_in_context IS DISTINCT FROM 'teacher'::text)
               AND (role_in_context IS DISTINCT FROM 'admin'::text)) OR ...));
```

There is **no trigger on `user_tags`** policing content the way `enforce_verified_emails_provenance` polices `learners.verified_emails` (`supabase/migrations/20260811_lock_learner_identity_columns.sql`). Nothing checks that the class or school named in `tag_value` has anything to do with the caller.

So an authenticated browser, using the anon key the SPA already ships, may insert for itself:

```
{ user_id: <my auth uid>, tag_type: 'class',  tag_value: 'CLASS:<any class uuid>',  role_in_context: 'student', added_at: <any timestamp I choose> }
{ user_id: <my auth uid>, tag_type: 'school', tag_value: 'SCHOOL:<any school uuid>', role_in_context: 'student', added_at: <any timestamp I choose> }
```

and may clear `removed_at` on any of its own existing rows.

The repo has reasoned about this policy twice and both times concluded it was safe — `supabase/migrations/20260807c_school_admin_tag_is_school_admin.sql:40–47`:

```text
40: -- WHY THIS IS SAFE — an 'admin' tag cannot be self-minted. Verified live
41: -- against user_tags_insert / user_tags_update WITH CHECK: an `authenticated`
42: -- caller may only write tags for themselves AND only where role_in_context IS
43: -- DISTINCT FROM 'teacher' AND IS DISTINCT FROM 'admin'. Both privileged roles
44: -- are service-role/god-only, so honouring the admin tag grants exactly what a
45: -- server-side grant already decided.
```

That reasoning is correct **for readers that require `role_in_context IN ('teacher','admin')`**. The DB-side readers do (`is_school_admin_of`, `is_class_teacher`, `my_readable_tag_values`, `my_manageable_tag_values` — I read all four in `supabase/schema.sql` and they are clean). The problem is the readers that **do not ask for a role at all**, or that ask for `'student'` — and those are on the API side, where that migration never looked.

### (a) Free premium course content, via the entitlement cascade

`supabase/schema.sql:3800–3820` — the cascade resolver, keyed on exactly the self-mintable row:

```text
3800: CREATE FUNCTION public.get_cascade_courses(p_user_id text) RETURNS text[]
3801:     LANGUAGE plpgsql STABLE SECURITY DEFINER
...
3811:   FOR rec IN
3812:     SELECT c.id AS class_id, c.school_id, s.group_id
3813:     FROM user_tags ut
3814:     JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
3815:     JOIN schools s ON c.school_id = s.id
3816:     WHERE ut.user_id = p_user_id
3817:       AND ut.tag_type = 'class'
3818:       AND ut.role_in_context = 'student'
3819:       AND ut.removed_at IS NULL
3820:   LOOP
```

`api/_utils/courseAccess.ts:111–117` — the content gate believes it:

```text
111:     try {
112:       const { data: cascadeCourses } = await supabase.rpc('get_cascade_courses', {
113:         p_user_id: authResult.userId,
114:       })
115:       if (cascadeCourses && cascadeCourses.length > 0) {
116:         entitlements.push({ accessType: 'courses', grantedCourses: cascadeCourses, expiresAt: null })
117:       }
```

`resolveServerCourseAccess` is the one authority for whether `/api/courses/[code]/bundle`, `/cycles`, `/infplay-cycles` and `/api/audio/batch-urls` ship the whole course or the Yellow-Belt preview slice (`api/courses/[code]/bundle.ts:667–678`). The RPC itself is `service_role`-only (`supabase/schema.sql:21016–21017`), so a browser cannot call it — but it does not need to. It only needs to write the row the server-side call will read.

**Attack sequence.**
1. Sign in as any ordinary learner (a free account is enough).
2. Learn one `classes.id` belonging to a school that holds an active `entitlement_grants` row. A class uuid is not published, but it is not a secret either: it is in the URL of every class page a member of staff visits, it is the `grants_class_id` on a shared join link, and `classes_select` RLS returns rows to a range of callers.
3. From the browser console, on the app's own origin, with the session already loaded:
   `supabase.from('user_tags').insert({ user_id: <my uid>, tag_type: 'class', tag_value: 'CLASS:<that uuid>', role_in_context: 'student' })`.
   The `user_tags_insert` WITH CHECK passes: the row is mine and the role is neither `teacher` nor `admin`.
4. Reload. `GET /api/courses/spa_for_eng/bundle` now resolves `canAccess: true` through the cascade and returns the entire course rather than the preview.

**What is gained:** the paid product, free, for as long as the school's grant is live — with the attacker also appearing on that class's roster (`api/_utils/schoolScope.ts:200–222` builds `studentsByClass` from the same self-mintable rows), which is how it would eventually be noticed.

**Confidence: likely.** The three links are each read in source and each is unconditional. The uncertainty is step 2 — whether an outsider can obtain a class uuid for a school that actually holds a grant — and whether live `user_tags_insert` still matches the dump.

**What would settle it:** as `authenticated` with a real learner JWT, in a rolled-back transaction, run
`INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context) VALUES (auth.uid()::text,'class','CLASS:<a real class id>','student');`
then `SELECT public.get_cascade_courses(auth.uid()::text);`. A non-empty array is the whole finding. The canary harness for exactly this shape already exists in `supabase/secfix-toolkit/`.

### (b) A student seat that survives being removed

`api/school/remove-staff.ts` and the class-removal paths revoke membership by setting `removed_at` (`api/school/remove-staff.ts:112–115`). `user_tags_update`'s self-branch lets the subject of that removal write their own row back:

**Sequence.** 1. A school removes a pupil from a class; the row is soft-removed. 2. The pupil runs `supabase.from('user_tags').update({ removed_at: null }).eq('user_id', <my uid>).eq('tag_value','CLASS:<id>')`. 3. Every predicate in (a) is satisfied again, plus the roster seat and the class's own analytics.

**What is lost:** removal is not removal. A school cannot durably eject anybody who is willing to open a console.

**Confidence: certain on the policy text; likely on the effect** — I have not confirmed that no other constraint (the `unique_active_tag` key discussed in `api/_utils/schoolStaff.ts:52–60`) interferes with the UPDATE. It does not, on its face: the key is `(user_id, tag_type, tag_value)`, unchanged by clearing `removed_at`.

**What would settle it:** same rolled-back canary — `UPDATE user_tags SET removed_at = NULL WHERE user_id = auth.uid()::text` as `authenticated`, and count the affected rows.

### (c) Any signed-in account can become "staff at a school of my choosing"

`api/_utils/schoolScope.ts:75–85` — the resolver that asks for a school tag and **never asks what role it carries**:

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
```

Two properties compose badly with a browser-writable table. It filters on `tag_type` only, so a `role_in_context='student'` tag satisfies it. And it takes the **earliest** row by `added_at` — a column the same INSERT grant lets the client set to any value it likes.

Area 5 filed `api/admin/update-school.ts`'s DELETE gate as "a teacher can delete their own school", on the basis that a teacher legitimately holds a `SCHOOL:` tag. **The tag does not have to be legitimate and the caller does not have to be a teacher.** `update-school.ts`'s fallback branch runs after `verifyAuthToken` alone (quoted in area 5's file at `:94–105`), so the caller class is *every authenticated account*.

**Sequence.** 1. Create an ordinary free account. 2. `supabase.from('user_tags').insert({ user_id: <my uid>, tag_type: 'school', tag_value: 'SCHOOL:<victim school uuid>', role_in_context: 'student', added_at: '2000-01-01T00:00:00Z' })`. 3. `GET /api/admin/update-school?school_id=<victim>` returns the deletion-impact preview including `schoolName`. 4. `DELETE` the same URL with `confirm_name=<that name>`.

**What is lost:** exactly what area 5 documents — the school row, its classes, class sessions, entitlement grants and every staff membership tag, hard-deleted, non-transactionally, with no undo — but reachable from an account that has no relationship with the school at all.

`GET /api/school/roster` is the same shape one notch smaller: `api/school/roster.ts:82–93` gates on `scope.role` being `school_admin` or `teacher` and then, for a teacher, resolves the school through `schoolIdForAdmin` — so a real teacher at school A can plant a back-dated `SCHOOL:B` tag and read school B's full roster.

**Confidence: certain** that `schoolIdForAdmin` does not read `role_in_context` and that `added_at` is client-settable under the quoted grant; **likely** on the end-to-end walk, since I did not execute it.

**What would settle it:** one live query — `SELECT column_name FROM information_schema.column_privileges WHERE table_name='user_tags' AND grantee='authenticated' AND privilege_type='INSERT';`. If `added_at` and `role_in_context` are in that list, (c) stands as written.

### Scale, honestly

No schools are paying yet, so today the loss in (a) is preview content on demo and pilot tenancies, and in (c) demo and pilot schools. Every one of these is on `dev` and rides the ordinary promotion train. The shape is the point: the estate has spent two migrations reasoning about `user_tags` as a trust boundary and both times reasoned only about the `teacher`/`admin` half.

---

## FE6-02 — a public telemetry endpoint feeds two rate limits, so anyone can freeze a school admin's minting

**Confidence: certain on the code path; likely on live effect.**

`api/player-events.ts` takes a batch from **any caller, authenticated or not**, resolves the identity server-side — and then writes the caller's `event_type` and `payload` through untouched:

`api/player-events.ts:216–232`:

```text
216:   const body = req.body as { events?: unknown; app_shell?: unknown } | undefined
217:   const events = Array.isArray(body?.events) ? (body!.events as IncomingEvent[]) : null
...
226:   const supabase = createClient(supabaseUrl!, supabaseServiceKey)
227:
228:   // Trusted identity from a verified session when present; else cookie/null.
229:   const userId = await resolveIdentity(req, supabase)
```

`api/player-events.ts:254–261`:

```text
254:         user_id: userId,
255:         learner_id: userId,
...
259:         session_id: sessionId,
260:         event_type: e.event_type.slice(0, 64),
261:         payload: sanitizePayload(e.payload),
```

`sanitizePayload` (`api/player-events.ts:182–195`) only bounds the serialized size. It does not whitelist keys. The identity of the *writer* is server-derived and correct; the **contents** are the caller's, and the contents are what the readers below key on.

`api/school/named-seat.ts:119–135` — the mint quota:

```text
119:     const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
120:     const { count: recentCount, error: rateErr } = await supabase
121:       .from('player_events')
122:       .select('id', { count: 'exact', head: true })
123:       .in('event_type', MINT_EVENTS)
124:       .gte('occurred_at', cutoff)
125:       .contains('payload', { actor_user_id: auth.userId })
...
132:     if ((recentCount ?? 0) >= PER_CALLER_LIMIT) {
133:       res.status(429).json({ error: 'Too many codes created just now. Please wait a few minutes.' })
```

`api/school/staff-signin-link.ts:134–148` is the identical query for `school_signin_link_minted`, sharing the same limit of 10 per 15 minutes (`api/school/named-seat.ts:74–78`). Note the count filters on `event_type`, `occurred_at` and `payload` — **never on `user_id`**, so a row written under a null (anonymous) identity counts just as well as a real one.

**Attack sequence.**
1. Learn one school admin's auth uid. It is not secret in the schools UI — it is `schools.admin_user_id`, and `api/groups/[id]/home.ts` returns leader identities to anyone inside the subtree; a colleague at the same school has it trivially.
2. `POST /api/player-events` — **no Authorization header needed** — with
   `{"events":[{"event_type":"school_named_seat_minted","payload":{"actor_user_id":"<victim uid>"}}, … ×10]}`.
   One request; `MAX_BATCH` allows a batch.
3. The victim opens the Teachers page and taps *Create a code for a new teacher*. `recentCount` is 10. They get `429 Too many codes created just now.`
4. Repeat every fifteen minutes. Total cost: one unauthenticated HTTP request per quarter hour.

**What is lost:** the school admin cannot mint a named seat or a staff sign-in link — which, per `api/_utils/unclaimedMint.ts:69–75`, is *the* rescue path when a school mail gateway eats an invite code. The denial is silent and looks like the quota working. Secondarily, the audit trail these events also serve becomes unreliable: a forged `school_named_seat_minted` row is indistinguishable from a real one.

The contrast that shows this is an oversight rather than a policy: the *other* limiter in the estate, `api/_utils/mintRateLimit.ts`, counts rows in `possession_mint_attempts`, which has RLS enabled and **no policies** (`supabase/schema.sql:19715`, and no `CREATE POLICY … ON public.possession_mint_attempts` anywhere in the dump) — deny-all for `anon` and `authenticated` despite its table grant. That limiter cannot be poisoned. This one can, because a public write endpoint sits in front of its table.

**What would settle it:** `SELECT count(*) FROM player_events WHERE event_type='school_named_seat_minted' AND payload ? 'actor_user_id';` on the live DB, then check whether any of those rows has `user_id IS NULL` or a `user_id` that is not the admin named in the payload. Either would be evidence the door is already being walked; neither is needed for the code path, which is unambiguous.

---

## FE6-03 — `api/access/claim.ts` calls a typed address "the OTP-verified address"; for possession accounts it is not

**Confidence: likely.**

`api/access/claim.ts:7–13` states the security premise:

```text
 7:  * SECURITY:
 8:  *  - The email is derived from the VERIFIED auth session (the service-role
 9:  *    client's auth.getUser(token).email — the OTP-verified address), NEVER from
10:  *    the request body. A caller cannot claim someone else's grant.
```

`api/access/claim.ts:58–68`:

```text
58:   const { data: userData, error: userError } = await supabase.auth.getUser(token)
59:   const user = userData?.user
60:   const email = user?.email?.toLowerCase().trim()
...
68:     const result = await applyGrantsForEmail(supabase, user.id, email)
```

The premise holds for an OTP signup. It does **not** hold for a possession-redeem account, and the repo says so in the very file that creates one — `api/auth/possession-redeem.ts:433–436`:

```text
433:     const { data: created, error: createError } = await supabase.auth.admin.createUser({
434:       email: normalizedEmail,
435:       email_confirm: false,
```

`normalizedEmail` is the address the caller typed into the redemption form. `api/code/redeem.ts:347–350` describes the resulting account in as many words:

```text
347:     // Possession-onboarded accounts (api/auth/possession-redeem.ts) never
348:     // prove mailbox receipt — that endpoint mints a session without ever
349:     // emailing anyone. needs_verification is the durable record of that,
350:     // cleared only by a completed round-trip through api/email/verify.ts.
```

So `auth.users.email` on that account is a **client-supplied string**, and `api/access/claim.ts` treats it as proof of mailbox ownership.

The same unproved address reaches `learners.verified_emails` through the compensating RPC rather than the front door: `public.sync_my_verified_emails()` (`supabase/migrations/20260811_lock_learner_identity_columns.sql`, part C) appends `auth.users.email` for the calling session, excluding only the `@invite.saysomethingin.app` placeholder, and is `GRANT EXECUTE … TO authenticated`. The provenance trigger added in part B of the same migration also counts `auth.users.email` as *attested*. The school-belonging change of 2026-09-09 removed the client-side seeding of `verified_emails` for possession accounts (`packages/player-vue/src/composables/useAuth.ts:384`) — the RPC and the trigger take the same address through a different door.

`verified_emails` is the key `api/access/grant-emails.ts:165–172` matches recipients on, and a grant may carry `grants_platform_role`, which `api/_utils/entitlementGrant.ts:79–89` writes verbatim into `learners.platform_role` — the column `verifyAdmin` admits on (`api/_utils/auth.ts:114`).

**Attack sequence.**
1. Obtain any live shared invite code. These circulate: a class join link, a school join code, anything posted in a staff channel.
2. Pick a target address that has **not yet signed up** — which is precisely the population an email allowlist grant exists to serve, and which `api/access/grant-emails.ts:163` calls "waiting users".
3. `POST /api/auth/possession-redeem` with that code and the target's address. The already-registered refusal (`api/auth/possession-redeem.ts:452–456`) does not fire, because the target has no account. A session comes back.
4. `POST /api/access/claim` with that session. Any active `email_access_grants` row for the address is applied to the attacker's learner — including `grants_platform_role`, and including the family-invite attachment `attachPendingInvitesForEmail` does on the next lines.
5. Optionally call `sync_my_verified_emails()` so the address is durably on the attacker's learner row.

**What is gained:** whatever the grant was worth — a paid entitlement, a dashboard role, in the worst case `ssi_admin` — plus a family-plan seat addressed to that person.

**What is not fixed by the existing sweep:** `api/_utils/unclaimedMint.ts` stamps this mint and lets the real owner later contest it (`:85–95`), which destroys the squatter's *credentials*. It does not undo an entitlement row, a `platform_role` write, or a family attachment already made. The harvest happens in step 4, minutes after step 3; the contest happens whenever the real owner turns up, if ever.

**Confidence: likely, not certain.** Two links are inference. I have not confirmed that any live `email_access_grants` row is currently active for an address with no account, nor that any carries `grants_platform_role`. And step 1 needs a live invite code. The code path itself — typed address → `auth.users.email` → `access/claim` → grant — is read end to end and is unconditional.

**What would settle it:** one query.
`SELECT g.email, g.grants_platform_role, g.is_active FROM email_access_grants g LEFT JOIN auth.users u ON lower(u.email)=lower(g.email) WHERE g.is_active AND u.id IS NULL;`
Any row is a live target. A row with a non-null `grants_platform_role` is an admin takeover waiting for someone to type the address.

---

## FE6-04 — `learners.needs_verification` is set from a field the account holder writes

**Confidence: certain on the mechanism; low value today, stated as such.**

`api/code/redeem.ts:335` and `:361–368`:

```text
335:     const metadata = authUser?.user?.user_metadata as Record<string, unknown> | undefined
...
361:     const needsEmailVerification = metadata?.onboarded_via === 'possession'
362:     const { error: insertError } = await supabase
363:       .from('learners')
364:       .insert({
365:         user_id: userId,
366:         display_name: displayName,
367:         needs_verification: needsEmailVerification,
368:       })
```

`user_metadata` is writable by the account holder through `supabase.auth.updateUser()` — the repo states this itself, twice, as the reason the *other* markers live in `app_metadata` (`api/_utils/shellClaim.ts:25–28`, `api/_utils/unclaimedMint.ts:39–43`). `onboarded_via` is the one durable marker that stayed in `user_metadata`.

Independently, the browser can write the column directly: `supabase/schema.sql:22101` grants `INSERT(needs_verification)` to `authenticated`, and `packages/player-vue/src/composables/useAuth.ts:393` is a client-side insert that sets it. Unlike `verified_emails`, there is no content trigger.

**Sequence.** 1. Arrive through `possession-redeem`; the account is stamped `onboarded_via:'possession'`. 2. Before redeeming a code, call `supabase.auth.updateUser({ data: { onboarded_via: 'otp' } })`. 3. `api/code/redeem.ts` creates the learner with `needs_verification: false`. (Or skip the metadata entirely and race the insert from the browser with the value you want — the two inserts are documented as racing at `useAuth.ts:368–372`.)

**What is lost:** the flag stops meaning what `supabase/schema.sql:7648` says it means. Its only consumers today are the admin badge at `packages/player-vue/src/views/admin/AdminUsers.vue:252` and the onboarding nag series seeded in `supabase/seeds/20260716_onboarding_messages_seed.sql:26` — so the present cost is an admin looking at a Users list that says "verified" about somebody who is not, and a skipped reminder email. **Nobody gains access through this today.** It is worth recording because the column is explicitly the "durable record" the school-belonging design of 2026-09-09 leans on, and the next reader that gates on it inherits a forged value.

**What would settle it:** confirm the column list of `GRANT INSERT … ON public.learners TO authenticated` live, and grep for any new consumer of `needs_verification` before trusting it in a gate.

---

## FE6-05 — the act-as read-only guard is a header the client chooses to send

**Confidence: certain on the mechanism; by design, and I say so.**

`api/_utils/actAsGuard.ts:20–27` (docstring) and `:25–27` (the check):

```text
20:  * The client sets the `X-Ssi-View-As: 1` header on every request made while
21:  * isActingAs is true (useUserRole.viewAsRequestHeaders()). Its presence is
22:  * sufficient to reject — a plain teacher/school-admin session never sends
23:  * it, so this can never block a real write by a real staff member.
...
25: export function isViewAsRequest(req: VercelRequest): boolean {
26:   return req.headers['x-ssi-view-as'] === '1'
27: }
```

The guard is **fail-open by construction**: absence grants. It protects `api/school/create-class.ts:64`, `api/teacher/class-teachers.ts`, `create-class-join-code.ts` and `create-class-learner.ts`, all of which carry a deliberate ssi_admin support bypass.

**Sequence.** 1. An ssi_admin enters "View as" on a teacher persona. 2. They (or anything running in that tab — an extension, a pasted snippet) issue the same write without the header. 3. The ssi_admin support bypass fires and the write lands, attributed to the persona's class.

**What is lost:** nothing an ssi_admin was not already permitted to do — the header restrains a person who already holds the authority, so this is a UI safety catch, not an authorisation control. It is listed because it is a literal instance of the area's shape and because the docstring's "sufficient to reject" reads as a guarantee it cannot make. If the act-as design ever grows a non-admin persona-browsing role, this becomes a real hole.

**What would settle it:** confirm every route calling `rejectIfViewAs` also has a server-side check that the caller is an ssi_admin before its bypass fires — `api/teacher/class-teachers.ts` is the one to read first.

---

## FE6-06 — two client INSERTs manufacture a class membership, and three entitlement resolvers believe it

**Confidence: certain on every policy and grant as committed; likely on the end-to-end unlock.** This is FE6-01(a) with the hardest precondition removed: you do not need to know a class uuid, because you can create the class.

`classes` is browser-writable and its INSERT policy checks exactly one column — `supabase/schema.sql:22029` and `:18912`:

```text
22029: GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE public.classes TO authenticated;
18912: CREATE POLICY classes_insert ON public.classes FOR INSERT
         WITH CHECK ((teacher_user_id = (auth.uid())::text));
```

`school_id`, `group_id` and `course_code` are unconstrained. `api/school/create-class.ts:8–17` documents this policy as the reason that endpoint exists — "the ONLY way to make a class was to name yourself its teacher on the spot" — and treats naming yourself the teacher as sufficient containment. It is not, because `school_id` is a free column with a plain foreign key (`supabase/schema.sql:17383`, nullable) and nothing anywhere checks that the caller has any relationship to the school named.

`api/_utils/classCoverage.ts:30–36` then reads the self-mintable tag:

```text
30:   const { data: tags } = await svc
31:     .from('user_tags')
32:     .select('tag_value')
33:     .eq('user_id', authUid)
34:     .eq('tag_type', 'class')
35:     .eq('role_in_context', 'student')
36:     .is('removed_at', null)
```

and `api/_utils/classCoverage.ts:63–69` grants that class's own `course_code` on the strength of the *school's* subscription:

```text
63:   for (const c of classRows) {
64:     if (!c.school_id || !c.course_code) continue
65:     const school = schoolStatus.get(c.school_id)
66:     if (!school) continue
67:     if (isPlatformActive(school.platform_status, school.platform_expires_at)) {
68:       courses.add(c.course_code)
69:     }
```

`isPlatformActive` (`api/_utils/platformStatus.ts:24–26`) **fails open on a null status and on a `trial` with no expiry**, by design and with the reasoning written out at `:14–18`.

**Attack sequence.**
1. Sign in as any learner. Obtain one `schools.id` — your own school's if you are a pupil or member of staff anywhere, or read one through `schools_select` (`supabase/schema.sql:19879`), whose predicate is `has_user_tag('school','SCHOOL:'||id)` — itself satisfiable by the self-minted tag of FE6-01(c).
2. `supabase.from('classes').insert({ class_name:'x', course_code:'<any premium course>', school_id:'<that school>', teacher_user_id:'<my uid>' })`. `classes_insert` passes on the last field alone. The `tr_classes_join_code` trigger mints the NOT NULL join code for me.
3. `supabase.from('user_tags').insert({ user_id:'<my uid>', tag_type:'class', tag_value:'CLASS:<the id from step 2>', role_in_context:'student' })`. Passes `user_tags_insert`.
4. `GET /api/entitlement/user` now returns a `class-coverage` entitlement for that course (`api/entitlement/user.ts:100–110`), and `get_cascade_courses` — which joins the same tag through `classes` to `schools` — now walks that school's and its group ancestry's `entitlement_grants` on my behalf, which is the branch `api/_utils/courseAccess.ts:112` uses to unlock real content.

**What is gained:** the course catalogue of any school whose id you can name, in one round trip each, from an account with no relationship to it. Repeat step 2 with a different `course_code` for every paid course.

**Two limits I want stated plainly, because they bound this:**
- The *server content gate* (`resolveServerCourseAccess`) reads `get_cascade_courses`, **not** `resolveClassCourseCoverage`. So step 4's class-coverage entitlement unlocks the client's optimistic state and the `/api/entitlement/user` answer, while the bytes only follow if the named school (or a group above it) actually holds an `entitlement_grants` row. A school on a bare platform trial with no grant gives you a UI that says you are entitled and a server that still serves the preview slice. That split is itself worth knowing about.
- You need one real `schools.id`. It is a uuid and is not published. Anyone who has ever been a pupil, teacher or admin at any school has one; a cold outsider does not.

**What would settle it:** as `authenticated` with an ordinary learner JWT, in a rolled-back transaction, run step 2 and step 3 and then `SELECT public.get_cascade_courses(auth.uid()::text);`. Two questions get answered at once — whether `classes_insert` really admits an arbitrary `school_id`, and whether the cascade then pays out.

---

## What I checked and cleared

Named so a verifier knows where I have already been, and so a later sweep does not redo it. Each of these is the area's shape done **right**, and several are worth reading as the pattern:

- **Body ids used to select.** `api/billing/bind-customer.ts:101–140` takes only a `scope` word from the body and resolves the node from the session — "so the browser never gets to name the node it is paying for" (`:165–167`). `api/school/create-class.ts:76–105` takes `group_id` from the body but runs `callerCanSeeGroup` on it first. `api/school/delete-class.ts`, `rename-class.ts`, `class-progress.ts`, `daily-activity.ts`, `class-practice-7d.ts` all filter body ids against `resolveVisibleScope(...).classIds`. `api/groups/table.ts`, `tree.ts`, `[id]/home.ts`, `[id]/invites.ts`, `api/org/funder-export.ts`, `api/org/enrolment-cancellation.ts` all gate on `resolveGroupTreeCaller` + `callerCanSeeGroup` before touching a body/query group id.
- **Course pricing.** `resolveServerCourseAccess` is never handed client-supplied pricing metadata: `bundle.ts:667–671`, `cycles.ts:474–478`, `infplay-cycles.ts:253`, and `audio/batch-urls.ts:151–168` all read `courses` from the DB first, and batch-urls fails **closed** on a missing course row (`:174–182`).
- **`user_metadata` reads.** Every other read in `api/` is cosmetic (`display_name` for a fallback label) or is deliberately in `app_metadata`: `shellClaim.ts`, `unclaimedMint.ts`, `named-seat.ts:143–146`. FE6-04 is the only one making a decision.
- **Client headers.** `getAppOrigin` is an allowlist (fixed, area 1's ground). `getClientIp` reads `x-vercel-forwarded-for` (edge-overwritten) and never `x-forwarded-for` — `api/_utils/mintRateLimit.ts:88–98` records exactly why. Webhook signature headers on `paddle-webhook.ts:311` and `wise-webhook.ts:84–85` are verified, not trusted.
- **`resolveVisibleScope`** keys the caller's role on `learners.educational_role`, which is **not** in the `authenticated` INSERT allowlist (`20260811_lock_learner_identity_columns.sql`) and has no UPDATE grant. That is why FE6-01 cannot turn into a role escalation directly.
- **`api/admin/codes.ts` and `api/admin/invites.ts`** use `verifyAuthToken` rather than `verifyAdmin`, which looks wrong at a glance; both then read `platform_role` under the service role and gate on it (`codes.ts:53–57`, `invites.ts:461–465`). Correct.
- **`api/board/snapshot/[code].ts`** is unauthenticated by design, on a 128-bit share code, single-row, 404-on-revoked. Fine.
- **`possession_mint_attempts`** — RLS on, no policies, so the mint limiter it backs cannot be poisoned from a browser. The contrast that makes FE6-02 a finding.
- **Money out.** `api/cron/teacher-payouts.ts` is gated by `checkCronAuth` (`api/_utils/cronAuth.ts:47–58`), which is constant-time and fails closed on every deployed environment. The amounts come from `teacher_commissions.accrued_pence`, and that table is RLS-on with `teacher_commissions_insert_admin` / `_update_admin` both `is_ssi_admin()` (`supabase/schema.sql:20119`, `:20136`) — so despite a blanket `GRANT ALL … TO anon, authenticated` at `:23202–23203`, a browser cannot write a payable row. `api/teacher/payout-recipient.ts:96–133` takes bank details from the body but writes them to the caller's OWN `teachers` row, resolved from the session. Clean.
- **One thing in that neighbourhood I am flagging without a walk.** `teachers` also carries `GRANT ALL … TO authenticated` (`supabase/schema.sql:23221`) and `teachers_update_own_or_admin` (`:20210`) has **no `WITH CHECK`** — Postgres reuses the `USING` clause, which pins only `learner_id`. So the row's own `verified boolean`, `platform_status` and `platform_expires_at` are writable by their subject. `isPlatformActive` would then say `active` about a self-declared tutor-platform subscription. I could not find a server decision that reads `teachers.platform_status` for anything but display (`api/school/subscription.ts:178`, `:222` shape a response; `api/_utils/classCoverage.ts` reads the SCHOOL's status, not the teacher's), which is why this is a note and not a finding — but it is one consumer away from being one, and `verified` is the kind of boolean that acquires a consumer. **What would settle it:** `SELECT count(*) FROM pg_policies WHERE tablename='teachers' AND cmd='UPDATE' AND with_check IS NOT NULL;` and a grep for any future reader of `teachers.verified`.

## What I did not reach

- **No live database was queried and no request was made against any deployment.** Every "what would settle it" line above is unrun. `supabase/schema.sql` is a dump; CLAUDE.md warns it is not live state, and FE6-01 rests on it.
- **`api/family/*` (7 routes), `api/try-link/*`, `api/invite/create.ts` and `api/onboarding/provision.ts`** got a grep-level pass for the shape and no closer reading. `provision.ts` is the one I would read next: it is a self-serve path that creates a school, and FE6-06 needs exactly one school id.
- **`packages/player-vue`** was read only where it writes to Supabase directly (`useAuth.ts`). The other client-side inserts named in `20260811_lock_learner_identity_columns.sql` — `views/teach/WithTeacher.vue:211` — were not read.
- **Other browser-writable tables.** I traced `user_tags`, `learners` and `player_events` to their readers. `class_sessions`, `lego_progress`, `seed_progress`, `course_enrollments` and the other own-row learner tables carry client INSERT grants too; I did not check whether any server decision keys on their contents the way `get_cascade_courses` keys on `user_tags`. That is the natural continuation of FE6-01/FE6-06 and I would run it as its own pass. `classes` turned out to be one of them; I did not audit `classes_update` (`supabase/schema.sql:18935`), which lets the self-declared teacher of the class they just invented keep editing it.
- **I could not fan this work out.** The dispatch surface refused at my depth in the fan-out tree, so the whole area is one pair of eyes and one afternoon.
