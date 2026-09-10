# The verbs half — what the intelligence surface can DO

*Design, written 2026-09-10 before any of it was built, as the first step of the first build slice.
Companion to `docs/delivery-side-intelligence-surface.md`, which designs the ten questions. That
document is the answering half; this is the acting half. Same objects, seen from the side where we
change them.*

*Every claim about existing machinery below was read from the code on this branch, not from a
document.*

> **CORRECTED 2026-09-10, and the correction reverses this document's own recommendation.** §7 asked
> whether a minted plain learner should be born EXCLUDED from analytics, and recommended that it
> should. **Tom ruled against it.** In his words:
>
> > "why cant they be included? if theyre in the data as proper learners, they can just be minted as
> > GIFTED, so the payment side of things doesnt expect them."
>
> He is right and the reason is worth stating plainly, because the mistake was a category error
> rather than a wrong dial setting. **Did they pay** and **are they a real person learning** are two
> different facts, and the first draft carried them on one flag. A comped teacher, a gifted friend
> and a pilot school are all real humans genuinely learning: their sessions, their weak points and
> their drop-off are true signal, and excluding them makes every number LESS accurate, not safer.
> The only things that should ever be excluded are the things that are not people — demo fixtures,
> test accounts, staff accounts.
>
> So the model is **three kinds, not two: paying, gifted, and not-a-person.** Gifted is an
> ENTITLEMENT fact that belongs on the money side, telling the billing machinery not to expect a
> payment, and it has **no effect whatsoever on analytics inclusion**. Not-a-person is the only
> analytics exclusion there is. §4 and §7 below have been rewritten to say so, and the code landed
> in the same change.

---

## Why this exists, and the failure it is written to prevent

Tom, in the same turn as the go:

> "we also need to be able to mint new learners ourselves as well as direct them to their own way of
> doing things if they're an org for example"
>
> "I know this is quite obvious but being able to easily give premium access to whoever we like, to
> be able to make DEMO stuff up for people"

The obvious reading is "add some buttons". That reading is how the admin surface got five ways to do
one thing in the first place. So the discipline here is the same one the ten questions impose on the
answering half: **a small closed set, each verb existing exactly once, each one leaving a record, and
each one born with its own exclusion flags already set.**

The machinery is mostly already written. Twenty-two endpoints under `api/admin/`, `api/invite/`,
`api/entitlement/` and `api/code/` already do nearly everything in the list below. What does not
exist is a *set*: one place that names them, one shape they all share, and one rule about what they
record. This document is that set.

---

## 1. The closed set — nine verbs

Nine, and the argument for stopping at nine is under the table. Each row names the endpoint that
already implements it, because reuse rather than reinvention is the whole point.

| # | Verb | Plain words on screen | Scope it hangs off | Already exists as |
|---|---|---|---|---|
| 1 | **Mint a learner** | "Add a person" | Everyone, or a course | `api/admin/mint-learner.ts` — built 2026-09-10; mints a real, included person, optionally gifted |
| 2 | **Give premium access** | "Give full access" | A person | `api/admin/grant-entitlement.ts`, or the tester role via `api/invite/create.ts` |
| 3 | **Take premium access away** | "Take full access back" | A person | `api/admin/revoke-entitlement.ts` |
| 4 | **Make a way in** | "Make a joining link" | An organisation, a school, a class, or Everyone | `api/invite/create.ts` |
| 5 | **Make demo material** | "Make a demo organisation" | Everyone, or an organisation | `api/admin/demo-schools.ts`, `api/admin/demo-leaf.ts`, `api/groups/[id]/demo-mint.ts`, and `api/admin/mint-demo-learner.ts` for a single not-a-person |
| 6 | **Point an organisation at its own way in** | "Send them their own link" | An organisation | `api/invite/create.ts` scoped to the node, plus the org's own `/org/:id` home |
| 7 | **Rescue a sign-in** | "Make a one-off sign-in link" | A person | `api/admin/create-signin-link.ts` |
| 8 | **Change what someone is** | "Change their role" | A person | `api/admin/update-user-role.ts` |
| 9 | **Set or extend a trial** | "Change their trial" | A person, or an organisation | `api/admin/set-trial.ts` |

### Why the set stops here

Three tests, and a verb has to pass all three.

**It changes state that a human decides.** Refreshing a number is not a verb, it is the page working.
Freezing a snapshot is not a verb, it is a share. Anything that only reads is out by construction.

**It is not somebody else's job.** Sending an email to a learner is Resend's job and the answering
half only produces the list. Editing a course is Popty's job. Repairing a learner's position is
nobody's job — Tom's ruling of 2026-08-31 stands and no verb touches a cursor.

**It cannot be composed out of two others.** This is what kills the long tail. "Give a school a
trial extension and a joining link" is verbs 9 and 4, not a tenth verb. "Make a demo school with
demo learners in it" is verb 5, which already provisions the leaf. "Comp a whole class" is verb 2
run over the class's people, and if that is tedious the fix is a multi-select on the rows, not a new
verb.

Two things deliberately NOT on the list that a reader will look for:

- **Delete a person, a school or an organisation.** Deletion already exists behind
  `api/_utils/auditAdminDelete.ts` and the Structure page, and it belongs to the org tree, which the
  design document keeps exactly as it is. The intelligence surface does not learn to destroy things.
- **Ban or suspend an account.** No such need has been voiced, and `demo-schools.ts` already bans
  demo staff accounts as part of teardown. Until somebody asks out loud, out.

---

## 2. Who may do them

Read from the live role model rather than invented.

`learners.platform_role` is constrained by the database to exactly three values — `ssi_admin`,
`popty_user`, `tester` — plus NULL. `learners.educational_role` carries `student`, `teacher`,
`school_admin`, `govt_admin`, `tutor`. Organisation leadership additionally lives in the
`govt_admins` table, and org scope is resolved server-side by `api/_utils/schoolScope.ts`.

**The rule for all nine verbs: `ssi_admin` only, enforced by `verifyAdmin()` in the endpoint.**

That is deliberately blunt and it is the right blunt. The intelligence surface is internal — Tom,
Kai and Aran. Every one of these verbs already gates on `verifyAdmin` today except the invite
creation path, which has its own richer permission model because leaders legitimately mint their own
joining links from the org dashboard. That richer model stays where it is; the intelligence surface
calls the same endpoint as an admin and gets admin scope.

Two consequences worth stating so nobody re-derives them later:

- **No clever RLS.** The standing architecture on this repo is that RLS answers only "is this my
  row?" and every hierarchy question is answered by a server endpoint with a test. None of these
  nine verbs adds a policy.
- **`tester` is a privilege, not a permission.** The `tester` role gives full *content* access — the
  server content gate `checkCourseAccess` honours it, and `api/entitlement/offline-lease.ts` treats
  it as privileged. It gives no power to act. Nobody with `platform_role = 'tester'` can run any of
  these nine.

---

## 3. What each one records

There is already a pattern and it is good: `api/_utils/auditRole.ts` exposes `recordRoleChange`,
which writes a `role_change_audit` row naming the actor, the target, the field, the new value, the
source and the code used. `api/code/redeem.ts` calls it on every privilege change. Separately,
`api/admin/create-signin-link.ts` writes its mint to `player_events` as
`admin_signin_link_minted`.

**The rule: every verb writes one row saying who did what to whom and when, before it returns.**

Concretely, and following the pattern that exists rather than inventing a second one:

- Verbs that change a role or a privilege field on a learner — 2, 3, 8, and the tester grant inside
  4 — write `role_change_audit` through `recordRoleChange`, with `source` naming the verb.
- Verbs that create something — 1, 4, 5 — write the created object's own provenance row where the
  object has one, and otherwise an admin event on `player_events` in the shape
  `create-signin-link` already uses.
- Verbs 7 and 9 already log; they keep logging exactly as they do.

Two rules about the record, both learned the hard way on this estate:

**The audit row is written by the endpoint, not by the page.** A page that forgets is a page that
lies. A test per endpoint asserts the row.

**The audit names the human, never the surface.** `actorUserId` is the admin's own auth uid. "The
intelligence surface did it" is not an answer to who did it.

---

## 4. Three kinds — the load-bearing rule

This is the one that matters, because it is the one that silently corrupts every number on the
answering half if it is got wrong. It was got wrong in this document's first draft, and Tom's
correction of 2026-09-10 is what it now says.

### The three kinds

| Kind | Is it a person? | Does billing expect money? | Counted in analytics? |
|---|---|---|---|
| **paying** | yes | yes | **yes** |
| **gifted** | yes | no, because they hold an entitlement | **yes** |
| **not-a-person** | no — a demo fixture, a test account, a staff account | irrelevant | **no** |

**Gifted is not a status and nothing in the code invents one.** It is a `user_entitlements` row,
written by the machinery that already grants entitlements, and read back as a cohort. That is
exactly what Tom meant by "minted as GIFTED, so the payment side of things doesn't expect them":
the row is the message to the payment side, and the payment side is the only thing that reads it.

**Free is not fake.** A learner who pays nothing and practises every day is real, belongs in the
pulse, and must not be hidden. Exclusion follows *staff and test*, never *free*.

### The gap that made the first draft look reasonable

The canonical analytics exclusion in the database is `test_learner_ids()`, defined in
`supabase/migrations/20260715_test_learner_exclusion.sql`. It feeds board metrics through
`api/_utils/boardMetrics.ts` and the `daily_contributions` write-time trigger. It excludes a learner
who is `is_demo`, or `is_internal`, or carries a `thomas.cassidy+` address, or is tied to an
`is_test` school.

**It does not know the `tester` role exists.** And until this slice nothing in the code ever set
`is_internal = true` — that flag was set once by a backfill inside that same migration, and by hand
since. The next person to redeem a tester code would have taken full content access, stayed
`is_internal = false`, and counted as a real learner in every board number from that moment on.

That gap is real and it is now closed. What the first draft did wrong was to reach for the same
flag to solve a different problem — somebody minted by hand who does not pay — when the two have
nothing to do with each other.

### The rule, verb by verb

| Verb | What it sets at creation |
|---|---|
| 1 Mint a learner | **Nothing. A minted plain learner is a real person and is counted.** The endpoint refuses `is_demo` / `is_internal` outright and names the demo endpoint instead. A `gift` may ride along, which writes a `user_entitlements` row and changes nothing about whether they count |
| 2 Give premium access | Nothing on the learner — a comped real learner IS a real learner. If access is being granted by making somebody a tester or a Popty user, that is privilege rather than a gift, and `is_internal = true` rides with the role |
| 4 Make a way in | Nothing on the code itself; the exclusion, where there is one, lands when the code is redeemed, in `redeem.ts` |
| 5 Make demo material | `is_demo = true` on every learner, `is_test = true` on every school — already true today, and it is the model `mint-demo-learner.ts` copies |
| 8 Change what someone is | `is_internal = true` when the new `platform_role` is `ssi_admin`, `tester` or `popty_user` — the only three the column allows, all of them staff |

### Two doors, deliberately

Minting a real person and minting a fixture are **two endpoints**, not one endpoint with a
checkbox:

- `POST /api/admin/mint-learner` — a real, included person. Takes an optional `gift`. Answers
  `counts_in_analytics: true`. Passing `is_demo` or `is_internal` is a 400 naming the other door.
- `POST /api/admin/mint-demo-learner` — a not-a-person. `kind` is required and has no default:
  `demo` sets `is_demo`, `test` sets `is_internal`. Answers `counts_in_analytics: false`. Takes no
  gift, because a fixture holding an entitlement would appear in a cohort of real people.

A checkbox on one form is precisely how "is this a real person?" ends up answered by whatever the
last person left ticked. Choosing the door is the act.

### What landed in this slice

- `api/_utils/mintLearner.ts` — `birthFlags()`, `mintPerson()`, `mintNotAPerson()`. The ruling is
  four lines of `birthFlags` and it is tested directly.
- `api/admin/mint-learner.ts`, `api/admin/mint-demo-learner.ts` — the two doors, `verifyAdmin`-gated.
- `grantGiftEntitlement()` in `api/_utils/entitlementGrant.ts` — one writer for both the mint path
  and `api/admin/grant-entitlement.ts`, so the row they produce cannot drift. Every gift leaves a
  `role_change_audit` row: field `entitlement`, source naming the door, actor the admin's own uid.
- `api/code/redeem.ts` sets `is_internal = true` in the same update that assigns a `platform_role`
  on the invite path, and `applyDashboardRole()` now does the same on the entitlement-code path,
  which was the half the first fix missed. Both return untouched when there is no role, so **a gift
  never acquires the flag** — asserted by a test at the redeem level.
- `api/_utils/realLearnerPopulation.ts` states in its own header that it has no opinion about money
  and must never acquire one, with a test that a comped learner stays in the population.

**What is deliberately NOT done here:** teaching `test_learner_ids()` itself about the `tester` role.
That is a database function change on a function two write paths depend on, so it needs the canary
method, and the code-only fix makes it unnecessary for every learner created from now on. It stays a
named next step for the next database pass, as belt and braces rather than as the mechanism.

### Seeing the gifted cohort

Tom asked for this specifically: how comped and pilot learners behave is intelligence worth having,
and it is only available if they are in the data at all — which is the practical argument for the
ruling as well as the principled one.

`api/_utils/entitlementCohort.ts` splits any set of learners into **paying / gifted / free**,
derived from `subscriptions` (the money side) and `user_entitlements` (the access side). It needs no
migration and no new column, and because it derives rather than records, it sees every gift ever
made rather than only the ones minted after today.

**Where it is visible now:** question 1, the pulse. The endpoint returns `standing` alongside the
headline and the page prints one line under the evidence — "N paying, N gifted, N on free access" —
splitting the people already counted, never filtering them.

**Next-slice items, named rather than implied:**

- The gifted cohort as a *rail scope*, so any question can be asked of gifted learners alone — that
  is where "how do pilot learners behave" gets a real answer, and it wants the rail work that
  question 6 and the course questions bring.
- Distinguishing *comped individual* from *pilot organisation* within gifted. The `role_change_audit`
  row carries the source and the actor, and org grants carry a group, so the data is there; nothing
  reads it yet.
- The derived entitlement layers — cascade, class coverage, org coverage, school-staff coverage —
  have no `user_entitlements` row, so a learner whose access comes only from their school's cover
  currently reads as `free`. That undercounts gifted; it never overcounts it. Widening the cohort
  file is the fix when the cohort matters more than the per-person queries cost.

## 5. Where the verbs sit

The design document already fixes the placement: the verbs are slot 5 of the five-part page layout,
across the top of the main column, most common first, scoped to what you are looking at. A verb that
writes anything confirms first and names what it will change. A page with no verbs renders the bar
empty rather than omitting it.

What this document adds is which verb sits on which question at which scope.

| Question | Verbs on it |
|---|---|
| 1 The pulse | none at Everyone scope; **Mint a learner** when the rail is on a course |
| 2 Who is leaving | **Give premium access**, **Set or extend a trial** — the two things you do about a person about to go |
| 4 Weak points | none. Reading content evidence changes nothing on the delivery side; the action is Popty's |
| 6 One person | **Give premium access**, **Take it back**, **Rescue a sign-in**, **Change their role**, **Set or extend a trial** — the support console, unchanged in substance from the page that exists |
| 10 Organisations | **Make a way in**, **Point them at their own way in**, **Make demo material**, **Set or extend a trial** |
| 3, 5, 7, 8, 9 | none |

Everything person-scoped that is not obviously somewhere else goes on question 6; everything
organisation-scoped goes on question 10. That is the standing default and it is what the table above
already follows.

**Verbs whose placement I was not certain about**, flagged rather than blocked:

- **Mint a learner** on question 1. It is there because "add a person to this course" is the thing
  you want when you are staring at a course's row and the number is too small. It could equally be a
  Tools door. One line to move it.
- **Make demo material** on question 10 rather than a Tools door. Demo organisations are made for a
  prospect, so they belong beside the real ones. But they are not *about* an existing organisation,
  which the rest of question 10 is.
- **Give premium access** appearing on both 2 and 6. That is the same verb in two places, which the
  one-metric-one-page rule would forbid for a number. Verbs are not numbers and I judge the
  duplication correct — you comp somebody from the leaver list without opening them — but it is the
  one place the grammar bends.

---

## 6. What is built in this slice, and what is designed only

**Built.** The empty verb bar as slot 5 of the shared question-page layout, with the confirm-first
contract and a test that the bar renders even when there are no verbs. Neither of the two question
pages in this slice carries a verb: question 4 has none by design, and question 1 has one only at
course scope, which the rail cannot reach until the course questions are built.

**Built since, on the correction of 2026-09-10.** **Mint a learner** — the one genuinely new piece
of server code the verbs half needed — is now `api/admin/mint-learner.ts`, following
`create-staff.ts` for its shape: service-role insert, compensating delete on partial failure,
`verifyAdmin` gate. It sets no exclusion flag and cannot be asked for one. Its counterpart
`api/admin/mint-demo-learner.ts` is the door for a not-a-person. The gifted cohort is served by
`api/intel/pulse.ts` and printed on question 1.

**Designed only.** The other eight verbs above, whose endpoints all exist already; and the verb bar
itself is still empty on both question pages in this slice — question 4 has no verbs by design, and
question 1 has one only at course scope, which the rail cannot reach until the course questions are
built.

---

## 7. The question that was asked, and how it was answered

**Was:** should a minted plain learner default to born-excluded, or born-real?

**Answered by Tom on 2026-09-10: born-real, and gifted if they need access.** The recommendation in
this document's first draft — born-excluded, on the grounds that a wrong inclusion silently inflates
every number — was wrong, and wrong in an instructive way: it treated "does not pay" as a reason to
doubt that somebody is a person. It is not one. The safety it was reaching for is real, but it
belongs to demo fixtures and test accounts, which have their own door, and nowhere else.

§4 above is the corrected rule and the code that implements it. Nothing in this document now asks
whether a real person should be hidden.
