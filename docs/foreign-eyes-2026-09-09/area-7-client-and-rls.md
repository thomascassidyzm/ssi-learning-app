# Area 7 — the client and RLS posture

Baseline: this checkout, cut from `origin/dev` (`f666d4a7`). Read-only. No live database was queried
— every statement below is from source in this tree, quoted with `file:line`. Matched against the
Area 5 claim standard (`origin/cs/719-verify-the-school-deletion-claim:docs/foreign-eyes-2026-09-09/area-5-hierarchy-and-school-deletion.md`).

Scope: `packages/player-vue/src/composables/schools/` (the direct-from-browser Supabase composables),
`rlsGuard.ts`, `supabase/migrations/`, `supabase/schema.sql`.

Calibration (Tom's own): no schools are paying yet, so real-world blast radius is smaller than it
sounds. The finding below is not softened for that — it is a real, provable read-scope defect — but
today's actual damage is against demo/pilot tenancies, not paying customers.

---

## FE7-01 — `entitlement_grants` and `groups` carry RLS ON with a single decorative SELECT policy: any authenticated user reads every tenant's row

**Confidence: certain**, on the policy and the exposed columns. **Uncertain** on live-day blast
radius (I did not query the live DB for row counts / how populated `groups.provider_subscription_id`
etc are today).

### The policies

`supabase/schema.sql:19278–19284`:

```text
19278: ALTER TABLE public.entitlement_grants ENABLE ROW LEVEL SECURITY;
...
19284: CREATE POLICY entitlement_grants_authenticated_read ON public.entitlement_grants FOR SELECT TO authenticated USING (true);
```

`supabase/schema.sql:19329–19335`:

```text
19329: ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
...
19335: CREATE POLICY groups_authenticated_read ON public.groups FOR SELECT TO authenticated USING (true);
```

I grepped every `ON public.entitlement_grants` and `ON public.groups` occurrence in `schema.sql`
(indexes, triggers, policies) — each table carries **exactly one** SELECT policy, no others, and
neither carries an INSERT/UPDATE/DELETE policy for `anon`/`authenticated` (writes are service-role
only, confirmed absent from the grep). `USING (true)` with no predicate means: RLS is technically
"on" — satisfying a check like `pg_class.relrowsecurity = true` — but for SELECT it is equivalent to
RLS being off. This is precisely the "policy so broad it is decorative" question the commission
asked about, and it sits on two of the six org tables CLAUDE.md names as the ones "verified RLS-ON
with real policies on 2026-08-06."

### What the columns hold

`supabase/schema.sql:9947–9961` (`entitlement_grants`):

```text
9947: CREATE TABLE public.entitlement_grants (
9948:     id uuid DEFAULT gen_random_uuid() NOT NULL,
9949:     group_id uuid,
9950:     school_id uuid,
9951:     class_id uuid,
9952:     granted_courses text[] NOT NULL,
9953:     granted_by text NOT NULL,
9954:     created_at timestamp with time zone DEFAULT now() NOT NULL,
9955:     updated_at timestamp with time zone DEFAULT now() NOT NULL,
9956:     expires_at timestamp with time zone,
9957:     is_active boolean DEFAULT true NOT NULL,
9958:     state text,
9959:     CONSTRAINT entitlement_grants_state_check CHECK ((state = ANY (ARRAY['trial'::text, 'paid'::text]))),
9960:     CONSTRAINT one_target_level CHECK ((((((group_id IS NOT NULL))::integer + ((school_id IS NOT NULL))::integer) + ((class_id IS NOT NULL))::integer) = 1))
9961: );
```

`supabase/schema.sql:10091–10109` (`groups`):

```text
10091: CREATE TABLE public.groups (
10092:     id uuid DEFAULT gen_random_uuid() NOT NULL,
10093:     name text NOT NULL,
10094:     type text DEFAULT 'region'::text NOT NULL,
10095:     parent_id uuid,
10096:     created_at timestamp with time zone DEFAULT now() NOT NULL,
10097:     updated_at timestamp with time zone DEFAULT now() NOT NULL,
10098:     path text,
10099:     is_demo boolean DEFAULT false NOT NULL,
10100:     name_confirmed boolean DEFAULT false NOT NULL,
10101:     is_test boolean DEFAULT false NOT NULL,
10102:     platform_status text,
10103:     platform_expires_at timestamp with time zone,
10104:     seats integer,
10105:     provider_subscription_id text,
10106:     provider_customer_id text,
10107:     ...
10109: );
```

`groups.provider_subscription_id` / `provider_customer_id` are the Paddle payment-provider
identifiers for a group/region's subscription. `entitlement_grants.state`/`expires_at`/
`granted_courses`/`granted_by` are exactly the paid/trial status, expiry, course list, and grantor of
every school's and every group's course access.

### That these tables are read directly from the browser, not just via a server endpoint

`packages/player-vue/src/composables/schools/useCourseAccess.ts:44–48`:

```text
44:       const { data: schoolGrants, error: schoolErr } = await client
45:         .from('entitlement_grants')
46:         .select('granted_courses')
47:         .eq('school_id', schoolId)
48:         .eq('is_active', true)
```

and `useCourseAccess.ts:112–117` (walking group ancestry):

```text
112:       client.from('groups').select('id, name, parent_id').eq('id', groupId).single(),
113:       client
114:         .from('entitlement_grants')
115:         .select('granted_courses')
116:         .eq('group_id', groupId)
117:         .eq('is_active', true),
```

`client` here is `getSchoolsClient()` (`client.ts:15–20`) — a real `SupabaseClient` instance holding
the signed-in user's own JWT, run straight from the browser (`useCourseAccess.ts:9,25`). The `.eq()`
calls are an **app-level** filter. They are not a security boundary: the same client, called with a
different id or with the `.eq()` dropped entirely, is a normal authenticated PostgREST request and is
adjudicated **only** by the table's RLS policy — which, per FE7-01, admits everything.

`useStudentsData.ts:94` and `useSchoolContext.ts:193,387` also call `.from('groups')` directly from
the browser client (confirmed by grep; not reproduced in full here for space — each is a plain
`.select(...).eq('id', ...)` read of the same kind).

### (a) The attack sequence

Actor: any signed-in learner — a student, a teacher at an unrelated school, anyone with a valid
Supabase session. No special role, no elevated token.

1. Sign in normally to the app (any account, any role). The Supabase project URL and anon key are
   public in the shipped JS bundle (standard Supabase pattern — RLS, not key secrecy, is meant to be
   the boundary here), and the caller already holds their own valid access token from step 1.
2. Send an ordinary authenticated PostgREST request:
   `GET {SUPABASE_URL}/rest/v1/entitlement_grants?select=*` with `Authorization: Bearer <own token>`
   and the project's `apikey` header. `entitlement_grants_authenticated_read` is satisfied by any
   `authenticated`-role JWT — `USING (true)` — so this returns **every** grant row in the system:
   every school's and group's `granted_courses`, `state` (trial/paid), `expires_at`, `granted_by`,
   and which `school_id`/`group_id`/`class_id` it belongs to.
3. Do the same against `/rest/v1/groups?select=*`: every group/region row, including
   `provider_subscription_id`, `provider_customer_id`, `platform_status`, `platform_expires_at`,
   `seats` — for every school-group and region in the system, not just the caller's own.
4. No write is needed and none is possible — only SELECT policies exist on these two tables for
   `authenticated` — so this is a pure read/reconnaissance path, not a destructive one.

### What is gained / lost

A rival school or an ordinary curious learner can see which schools/regions are paying customers,
what they pay for, when their entitlement expires, who granted it, and (for `groups`) the actual
Paddle subscription/customer identifiers tied to a school-group's billing. That is commercially
sensitive information (competitor intelligence: who's paying, what tier, when they lapse) and,
for the Paddle IDs, adjacent to payment-provider account identifiers — not card data, but not
nothing either. Nothing is destroyed or altered; this is confidentiality, not integrity/availability.

### What would settle it

A live, unauthenticated-role-appropriate REST call: sign in as an ordinary non-admin learner account,
then `curl` `{SUPABASE_URL}/rest/v1/entitlement_grants?select=*` and `{SUPABASE_URL}/rest/v1/groups?select=*`
with that learner's own bearer token + the project anon key, and confirm the row count returned
exceeds what that learner's own school/group would produce (i.e. rows for schools/groups they have no
tag or admin_user_id relationship to). That single pair of calls, from any real learner session, is
definitive — no code reading is needed to go further than I already have.

---

## FE7-02 — a stale in-repo comment misdescribes the org tables' current RLS posture (documentation drift, not a live exploit)

**Confidence: certain** that the comment is wrong as written; **certain** that it is not currently
exploitable, because the real protection (RLS admin-bypass policies on `schools`/`classes`) is
independently verified live.

`packages/player-vue/src/containers/AdminSchoolsContainer.vue:10–15`:

```text
10:  * Provides `isAdminView = true` so child views can hide write controls.
11:  * Standalone route (sibling of AdminContainer's children, not nested in
12:  * it) — useAdminGate is its OWN reactive access gate; the org tables this
13:  * reads (schools/…) are RLS-off by design, so this gate is the enforcement,
14:  * not a redundant check on top of the router guard (Trinity audit finding
15:  * #1, archive/docs-retired-2026-08-24/trinity/admin.md).
16:  */
```

This claims the client-side `useAdminGate()` check **is** the enforcement for a non-admin trying to
view another school's data through `/admin/schools/:id`, because the underlying tables are "RLS-off
by design." That was true before the 2026-08-06 org-table RLS pass (see CLAUDE.md's own superseded
note in the same section) but is stale now: `schools` carries real RLS —

`supabase/schema.sql:19879` (`schools_select`):
```text
19879: CREATE POLICY schools_select ON public.schools FOR SELECT USING (((admin_user_id = (auth.uid())::text) OR public.has_user_tag('school'::text, ('SCHOOL:'::text || (id)::text))));
```

`supabase/schema.sql:19886` (`schools_select_admin_subtree`):
```text
19886: CREATE POLICY schools_select_admin_subtree ON public.schools FOR SELECT TO authenticated USING ((public.is_ssi_admin() OR public.is_govt_admin_over_group(group_id)));
```

`useAdminGate.ts` itself documents the correct current model (`packages/player-vue/src/composables/useAdminGate.ts:5–9`): "THE SERVER IS THE ENFORCEMENT... A de-platformed ssi_admin's requests therefore 403 the instant they're made, regardless of any client state" — for endpoint-mediated reads. For `AdminSchoolsContainer.vue` specifically there is no endpoint in the loop at all (`useSchoolContext.ts`'s `loadFromSchoolId` queries `schools` directly, `useSchoolContext.ts:350–354`), so the real enforcement for *this* surface is the `is_ssi_admin()` RLS bypass on `schools_select_admin_subtree`, not an endpoint and not the client gate the file's own comment credits.

### (a) Sequence showing why this is not live-exploitable today

1. A non-admin, non-owning learner navigates (or is bounced past a hypothetical broken client gate)
   to `/admin/schools/<some-other-school-id>`.
2. `AdminSchoolsContainer.vue:49–54` calls `ctx.loadFromSchoolId(id, ...)`, which runs
   `supabase.from('schools').select(...).eq('id', schoolId).single()` under that learner's own JWT
   (`useSchoolContext.ts:350–354`).
3. `schools_select_admin_subtree` requires `is_ssi_admin()` or `is_govt_admin_over_group`; neither
   holds for an ordinary learner, and `schools_select`'s own-row clause also fails (not their school).
   Postgres RLS evaluates this per-query regardless of any client-side gate state, so the row comes
   back empty/denied — the client gate being broken or absent changes nothing here.

### What is gained / lost

Nothing, today — the comment is wrong but the outcome is safe because a different mechanism than the
one it names is doing the actual work. The risk is purely to future maintenance: this is the exact
file the commission asked me to read for the "does any browser-side composable read a table whose
policy lets it see another tenant's rows" question, and its own header answers that question
incorrectly. A future change made on the strength of this comment (e.g. "the client gate is the
enforcement, so it's safe to relax it" or "let's add another org-table read here, RLS doesn't matter
since the gate covers it") would be reasoning from a false premise — and would be dangerous
specifically on a table like `entitlement_grants`/`groups` (FE7-01), where RLS truly doesn't cover it.

### What would settle it

Nothing further needed for the current-safety question — `schools_select_admin_subtree`'s predicate
is fully legible in `schema.sql`. To settle *only* "is the comment itself the thing that's stale",
check `archive/docs-retired-2026-08-24/trinity/admin.md` finding #1 for the date it was written
against, and confirm it predates the 2026-08-06 RLS pass CLAUDE.md records.

---

## FE7-03 — the client-side RLS tripwire (`rlsGuard.ts`) is wired into one composable out of ~20 direct-query composables, and misses exactly the tables in FE7-01

**Confidence: certain** on the wiring count; **uncertain** whether this "matters" beyond FE7-01,
since `rlsGuard` is explicitly documented as belt-and-suspenders, not the primary defense.

`packages/player-vue/src/composables/schools/rlsGuard.ts:1–8`:

```text
1: /**
2:  * rlsGuard - client-side scope assertion for schools data
3:  *
4:  * Supabase RLS is the primary defense against cross-school data leaks —
5:  * but RLS is a policy that can regress: a dashboard migration, a policy
6:  * rename, a service-role key mistakenly used on the client. This module
7:  * adds a cheap belt-and-suspenders check so we hear about it immediately
8:  * instead of learning from a support ticket.
9:  */
```

Grepping every composable in the directory for `assertScope`/`assertScopeUnion` usage (excluding
`rlsGuard.ts` and its own test) turns up exactly one call site:

`packages/player-vue/src/composables/schools/useClassesData.ts:13,312`:
```text
13:  import { assertScope, assertScopeUnion } from './rlsGuard'
...
312:      const safeData = assertScopeUnion(data || [],
```

No other composable in the directory (`useCourseAccess.ts`, `useSchoolContext.ts`,
`useStudentsData.ts`, `useTeachersData.ts`, `useAnalyticsData.ts`, `useSchoolData.ts`, etc.) imports
it. CLAUDE.md's own TODO section names this as a known, still-open gap ("Use `rlsGuard.assertScope()`
... as the dev-loop net — extend from `useClassesData` to the other schools composables"), so this is
not a new discovery — but it is directly relevant here: the one detection mechanism the team built for
"RLS regressed and a composable is now seeing rows it shouldn't" does not cover `useCourseAccess.ts`,
which is one of the two files reading the tables FE7-01 found actually leaking. Had it been wired in,
`entitlement_grants`/`groups` rows outside the caller's own school/group scope would have logged
`[RLS_VIOLATION]` to the console and (in dev) thrown, which is exactly how this class of regression is
meant to surface.

### What is gained / lost

Nothing exploitable by itself — `rlsGuard` is a detector, not a gate, and even where wired it only
throws in dev/test (`rlsGuard.ts:30–41,106–108`; production just logs and filters). But its absence
here means FE7-01's leak produces no console signal, no Sentry breadcrumb, nothing — it is silent by
construction in exactly the two composables that read the two tables where RLS is actually decorative.

### What would settle it

Wire `assertScope`/`assertScopeUnion` into `useCourseAccess.ts`'s `fetchCourseAccess`/
`collectGroupGrants` reads (scoped to the school/group ids the caller is actually allowed) and
observe whether it logs `[RLS_VIOLATION]` against a live session — it should, given FE7-01.

---

## Noted in passing, not chased further (outside strict Area-7 scope)

- `supabase/migrations/20260901_content_edit_identity.sql` enables RLS and adds two `CREATE POLICY`
  statements on `content_edit_events` (lines 73–89) but has no trailing `NOTIFY pgrst, 'reload
  schema'`, which is a direct miss of the repo's own standing rule (CLAUDE.md, RLS doctrine rule 6:
  "Every policy/grant migration ends with `NOTIFY pgrst, 'reload schema'`"). `content_edit_events` is
  a content-authoring audit table (course-builder edit attribution), not read by any schools
  composable in this directory (confirmed by grep) — so this is a doctrine-compliance note, not a
  schools-client finding. Confidence: certain on the omission, uncertain on operational impact
  (whether the running PostgREST instance has since reloaded its schema cache by other means, e.g. a
  later migration's own `NOTIFY`, is not something I can determine from source alone).

- All other `USING (true)` policies I found (`course_legos`, `course_audio`, `algorithm_config`,
  `gamification_config`, `daily_contributions`, `sample_flags`, etc.) are content/config/aggregate
  tables — per the commission's own ground truth, content tables permissive by design is not a
  finding, and I did not chase them further.

- `is_school_admin_of`, `is_class_teacher`, `has_user_tag`, `current_learner_id`,
  `my_readable_tag_values`, `my_manageable_tag_values`, `is_ssi_admin`, `is_govt_admin_over_group` —
  all `SECURITY DEFINER` functions used across the org-table policies — were read in full
  (`schema.sql:3123–3140, 4459–4712, 5245–5298`). Each compares `auth.uid()::text` against a TEXT
  column that genuinely holds the auth uid (matching the canonical pattern in CLAUDE.md), each pins
  `search_path`, and the two-argument `is_class_teacher(uuid, text)` variant (which takes an arbitrary
  uid) is correctly locked to `service_role` only (`schema.sql:21257–21258`, `REVOKE ALL ... FROM
  PUBLIC`). No mixed-identity defect found in this function set — this is the depth-first pass the
  commission asked for on the "does a policy compare a column to `auth.uid()` when it actually holds
  `learners.id`" question, and it came back clean.

- `player_events` (the table CLAUDE.md specifically flags for its `user_id` = learner-key-not-auth-uid
  quirk) carries `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (`schema.sql:19690`) with **zero**
  `CREATE POLICY` statements — deny-by-default for `anon`/`authenticated`, correct and safe. No
  schools composable queries it directly (only `useAnalyticsData.ts`, and only via an RPC, not a raw
  table read) — confirmed clean.

---

## What I did not reach

- I reviewed `rlsGuard.ts`, `client.ts`, `useCourseAccess.ts`, `useSchoolContext.ts`,
  `classTeacherScope.ts`, `useGovtAdminActions.ts`, `assignTeacherClasses.ts`, `useAdminGate.ts`, and
  the RLS/function/policy surface of `schema.sql` in full. I did **not** do a line-by-line pass of
  `useAnalyticsData.ts` (429 lines), `useClassesData.ts` (1168 lines, beyond the `rlsGuard` wiring and
  `groups`/`class_teachers` reads already covered), `useSchoolData.ts` (451 lines), `useStudentsData.ts`
  (220 lines beyond its `groups` read), `useTeachersData.ts` (385 lines beyond its `class_student_progress`
  read), `usePlayAsClass.ts`/`usePlayAsClassContext.ts`, `useSchoolsRail.ts`, `useSchoolCourseCatalogue.ts`,
  `useTeachingContext.ts`, `inviteLink.ts`, `schoolRoster.ts`, `teacherRosterSections.ts`,
  `usePublishedMailboxCopy.ts`, `useSchoolsNav.ts`, `useSchoolsDensity.ts`, or `belts.ts` — I grepped
  each for direct `.from(...)` reads against org/tenant tables and cross-checked the ones that
  surfaced (`groups`, `entitlement_grants`, `class_student_progress`, `class_activity_stats`,
  `school_summary`), but did not exhaustively re-derive every scoping predicate in every remaining
  file line by line.
- I did not run any live database query — the `entitlement_grants`/`groups` finding is a source-level
  proof (policy text + table columns + composable call sites), not an observed exploit. The "what
  would settle it" checks above are unrun.
- I did not review the other ~90 migrations beyond the specific greps described above (RLS/GRANT/
  NOTIFY presence, `USING (true)` policy inventory, and the `entitlement_grants`/`groups` history).
- I was already at the fan-out depth ceiling as a worker in this sweep, so all of the above was done
  in-turn rather than parallelised across sub-workers; given the time budget, breadth past the files
  named above was traded for depth on the mixed-identity question first, per the commission's own
  instruction.
