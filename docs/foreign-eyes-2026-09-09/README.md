# Foreign-eyes sweep — 9 September 2026

Read and report only. No application changes, no tests, no live database query, no request against any deployment anywhere in this sweep. Every claim is source-proof and carries the one check that would settle it.

Areas 2–4 were read on baseline `4555418a` by a foreign model. Areas 5–7 were read on `f666d4a7` (origin/dev tip): Area 5 and the verification of a dying claim by a Claude run, Areas 6 and 7 by workers `#720·F` and `#721·F`, folded in here.

## The one that matters

**Any signed-in account can delete any school.** `user_tags` is INSERTable from the browser for any role except teacher/admin (`supabase/schema.sql:22124`, `:20296`); `schoolIdForAdmin` reads a `SCHOOL:` tag without ever reading its role (`api/_utils/schoolScope.ts:75`); and `api/admin/update-school.ts:99` uses that resolver as its ownership gate for DELETE. Six steps, no privilege beyond signing up. The cascade takes every class, class session and entitlement grant with the school. Written up at the foot of [area-5-hierarchy-and-school-deletion.md](area-5-hierarchy-and-school-deletion.md).

Neither area found this alone. Area 5 found a gate that trusts a tag; Area 6 found the tag is client-writable. The composition is the finding.

## The areas

- Area 2: [entitlement and offline lease](area-2-entitlement-and-offline-lease.md). FE2-01 likely; FE2-02 explicitly policy-dependent.
- Area 3: [org enrolment and family](area-3-org-enrolment-and-family.md). FE3-01–05; two labelled incomplete enrolment-repair fixes.
- Area 4: [identity resolution](area-4-identity-resolution.md). No new defect; library behaviour and every NULL caller recorded.
- Area 5, part 1: [the school-deletion claim](area-5-hierarchy-and-school-deletion.md). **FE5-01 CONFIRMED**, then escalated as above.
- Area 5, part 2: [admin and teacher hierarchy, view-as, schoolScope](area-5-admin-teacher-hierarchy.md). FE5-02 (global role × oldest tag → class deletion at the wrong school), FE5-03 (a mint that runs before its own gate).
- Area 6: [where the server trusts data the client can write](area-6-server-trusts-client-data.md). FE6-01 (client-writable `user_tags` read as authority by four resolvers), FE6-06 (client-INSERTable `classes` manufacturing membership), FE6-02 (unauthenticated `player-events` payload freezing an admin's seat minting), FE6-03, FE6-04, FE6-05.
- Area 7: [client and RLS posture](area-7-client-and-rls.md). **FE7-01** — `groups` and `entitlement_grants` carry RLS with `USING (true)` and a live `authenticated` SELECT grant, so any signed-in token reads every tenant's commercial state and Paddle identifiers. FE7-03 — the `rlsGuard` tripwire is wired into 1 of ~20 composables and not into the one that reads those tables.

## The shape of it

Five of the seven findings across areas 5–7 are the same defect: **a gate that reads as present and is not**. A resolver named for an authority it never checks; a policy that is `USING (true)`; a read-only mode enforced by a header the client chooses to send; a tripwire wired into one file out of twenty.

The two independent verdicts worth carrying forward: the mixed-identity policy question the estate worries about most (`auth.uid()` vs `learners.id`) came back **clean**, and so did the money-out path (cron auth constant-time and fail-closed, commission writes admin-only).

## Known and re-reported as known, not new

View-as read-only is advisory (`api/_utils/actAsGuard.ts:25`), and the input handling at `api/school/class-progress.ts:224,254`.

## Not reached

No live database verification of anything. Area 6: `api/family/*`, `api/try-link/*`, `api/invite/create.ts`, `api/onboarding/provision.ts` at grep level only; `class_sessions`, `lego_progress`, `seed_progress`, `course_enrollments` carry client INSERT grants that were not traced to their readers. Area 7: ~14 of ~20 schools composables grep-checked rather than read; ~80 of ~100 migrations not read individually.
