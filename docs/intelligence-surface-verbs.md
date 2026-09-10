# The verbs half — what the intelligence surface can DO

*Design, written 2026-09-10 before any of it was built, as the first step of the first build slice.
Companion to `docs/delivery-side-intelligence-surface.md`, which designs the ten questions. That
document is the answering half; this is the acting half. Same objects, seen from the side where we
change them.*

*Every claim about existing machinery below was read from the code on this branch, not from a
document.*

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
| 1 | **Mint a learner** | "Add a person" | Everyone, or a course | `api/admin/create-staff.ts` for staff rows; **no endpoint mints a plain learner today** |
| 2 | **Give premium access** | "Give full access" | A person | `api/admin/grant-entitlement.ts`, or the tester role via `api/invite/create.ts` |
| 3 | **Take premium access away** | "Take full access back" | A person | `api/admin/revoke-entitlement.ts` |
| 4 | **Make a way in** | "Make a joining link" | An organisation, a school, a class, or Everyone | `api/invite/create.ts` |
| 5 | **Make demo material** | "Make a demo organisation" | Everyone, or an organisation | `api/admin/demo-schools.ts`, `api/admin/demo-leaf.ts` |
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

## 4. Born excluded — the load-bearing rule

This is the one that matters, because it is the one that silently corrupts every number on the
answering half if it is got wrong.

### The gap as it stands today

The canonical analytics exclusion in the database is `test_learner_ids()`, defined in
`supabase/migrations/20260715_test_learner_exclusion.sql`. It feeds board metrics through
`api/_utils/boardMetrics.ts` and the `daily_contributions` write-time trigger. It excludes a learner
who is `is_demo`, or `is_internal`, or carries a `thomas.cassidy+` address, or is tied to an
`is_test` school.

**It does not know the `tester` role exists.** And nothing in the code ever sets
`is_internal = true` — that flag was set once by a backfill inside that same migration, and by hand
since. Every tester and admin row happens to carry it today. The mechanism that keeps it that way
does not exist. The next person to redeem a tester code gets full content access, stays
`is_internal = false`, and is counted as a real learner in every board number and every daily
contribution from that moment on.

### The rule

**Anything the surface mints is born excluded — set by the endpoint at creation, never by a backfill
somebody remembers to run.**

Applied verb by verb:

| Verb | What it sets at creation |
|---|---|
| 1 Mint a learner | `is_internal = true` unless the admin explicitly says this is a real person, which is a deliberate second click and says so in the confirm |
| 2 Give premium access | Nothing, if it is an entitlement on a real person — a comped real learner IS a real learner and must keep counting. If it is granted by making somebody a tester, `is_internal = true` rides with the role |
| 4 Make a way in | Nothing on the code itself; the exclusion lands when the code is redeemed, in `redeem.ts` |
| 5 Make demo material | `is_demo = true` on every learner, `is_test = true` on every school — already true today, and it is the model the others copy |
| 8 Change what someone is | `is_internal = true` when the new `platform_role` is `ssi_admin` or `tester` |

The distinction in verb 2 is the subtle one and it is worth stating plainly: **comping a real person
does not make them fake.** A learner who pays nothing but practises every day is real, belongs in
the pulse, and must not be hidden. Exclusion follows *staff and test*, never *free*.

### The fix landed in this slice

`api/code/redeem.ts` now sets `is_internal = true` in the same update that assigns a
`platform_role`, which covers both the `tester` and the `ssi_admin` code types. One line, code only,
revertable, no migration and no canary. It closes the gap at the mechanism.

**What is deliberately NOT done here:** teaching `test_learner_ids()` itself about the `tester` role.
That is a database function change on a function two write paths depend on, so it needs the canary
method, and the code-only fix above makes it unnecessary for every learner created from now on. It
stays a named next step, worth doing when the next database pass runs, as belt and braces rather than
as the mechanism.

---

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

**Designed only.** All nine verbs above. Their endpoints exist already, with the single exception of
**Mint a learner**, which has no plain-learner endpoint today and is the one genuinely new piece of
server code the verbs half needs. When it is written it follows `create-staff.ts` — service-role
insert, compensating delete on partial failure, `verifyAdmin` gate — and it sets `is_internal = true`
at birth unless told otherwise.

---

## 7. The one open question

**Should a minted plain learner default to born-excluded, or born-real?**

I have designed it born-excluded, because a wrong exclusion costs one missing person in a number and
a wrong inclusion silently inflates every number until somebody notices. But minting a learner for a
real organisation that cannot self-serve is a real use, and that person is real. The design handles
it with a deliberate second click, and if Tom would rather it defaulted the other way that is a
one-word change with the confirm text following it.
