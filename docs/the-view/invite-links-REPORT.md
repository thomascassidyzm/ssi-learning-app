# Invite links — fix report (role-shaped links, identity capture)

**Date:** 2026-07-20 · **Branch:** dev · **Brief:** fix the redeem shambles + produce the IME pack.
Reconciled design per founder ruling: role-scoped links, the link stays the credential (no OTP),
named roles get ONE identity-capture screen, landing matches role, zero link-UUID ghosts.

---

## The shambles, decomposed (root causes found)

1. **"Every link is the same generic link"** — two causes:
   - `api/code/validate.ts` resolved NO display context for node-scoped teacher/student codes
     (`grants_group_id` only) — so the redeem screen said just "Teacher Invite"/"Student Invite"
     with no place name, for every node in the org.
   - The node panel's most prominent action, **Get join link**, mints/reuses a *learner* (student-
     role) link at every node — so the links the founder was clicking were all learner links:
     identical anonymous screens, all landing in the player. (The links were in fact node-scoped
     in the token — `grants_group_id` differs per node — but nothing on screen showed it.)
2. **Ghost accounts** — `possession-redeem.ts` linkAuth mode minted
   `link-<uuid>@invite.saysomethingin.app` accounts with no name for ALL possession-eligible
   roles. That was the 2026-07-19 "straight-in, zero interstitials" design doing exactly what it
   said — the founder has now refined that ruling (capture screen = the account being born).
3. **"Redirects to the player regardless of role"** — for learner links, the player IS the right
   landing; the named-role landings (`/schools` scope-resolved per role) were already correct
   server-side but unreachable in practice because the prominent path was the learner link, and
   any named-role redeem arrived as a nameless ghost anyway.

## The fix (commit `90887d85`, docs `41bc2c07`)

| Pin | Enforcement |
|---|---|
| Role-scoped token content | already true (`grants_group_id`/`grants_school_id`/`grants_class_id` per link); now VISIBLE: `validate.ts` returns group/school names for node-scoped codes |
| Real named account, captured email, zero ghosts for named roles | `RedeemCode.vue` capture step (name+email, role+place in the heading) → `possessionRedeem`; server refuses `linkAuth` for named roles (`identity_required`, `possession_mint_attempts`-logged) |
| Pupil path | name-only capture ("What's your name?") → linkAuth mint carries `display_name`; placeholder email survives for `student` codes only |
| Landing per role | leader → `/schools` (their node home, scope-resolved), school leader → `/schools`, teacher → `/schools`, student → player on class course, learner → player. Deployed-build walk: below (IME pack) |
| Re-click of a redeemed link | `validate.ts` (with bearer) returns `alreadyRedeemed`+`redirectTo` → straight to surface, no confirm, no second code spend |
| Generic-link path | **kept, learner-only, node-scoped** (my read, journalled in DECISIONS.md): "Get join link" = the group's learner join link; not generic — every node's differs |
| School-leader links | `ways-in` now lists AND mints them at school nodes (`school_leader` → `school_admin_join` keyed by `grants_school_id`; previously filtered out of the list entirely) |
| Revocability/expiry/FK behaviour | untouched — same `invite_codes` machinery |

**Tests:** api 644/644 · player-vue 958/958 · both typechecks clean. Pins revised:
`RedeemCode.test.ts` (capture-then-in for teacher incl. heading copy; pupil name-only; re-click
straight-to-surface; already-registered → sign-in-instead; tester stays OTP-only),
`possession-redeem.test.ts` (named-role linkAuth refusal ×4, pupil mode carries name),
`invites.test.ts` (school_leader mint at school node; 400 at plain group node).

## Bonus defect found + fixed while building the pack

Demo generators wrote `classes.student_join_code` without registering the `invite_codes` row —
**37 class join links across the whole demo estate were dead** ("Invalid code" on click; very
plausibly part of the founder's staging experience). Repaired live
(`scripts/demo-data/repair-class-join-codes.mjs` — 37/37, 3 already ok) and both generators
fixed at source (`79dcb22c`).

## Status

- [x] Deliverable 1 — fix + tests, pushed to dev (`90887d85`, docs `41bc2c07`, APML `7419ed96`)
- [x] Deliverable 2 — IME pack on deployed dev: **6/6 roles ALL PASS**, fresh-context redeems,
      3 screenshots per role + DB truth → [`ime-invite-pack.md`](./ime-invite-pack.md)
- [x] Demo estate class-link repair (37 dead links → live) (`79dcb22c`)
- [x] Promoted dev → staging (all suites green, deployed-dev walk green)


---

## 2026-07-20 (late) — TWO SPECIES ruling + personal links shipped

Founder clarification (screenshot evidence): the capture screen is for **OPEN shareable links
only**. **PERSONAL links** — what gets emailed to known partners — are pre-provisioned accounts
whose link IS the login: zero screens, role landing, repeatable, revocable. Built + shipped:

- `provisionPersona` (api/_utils) + `personal:{name,email?,class_id?}` on the node mint;
  binding = `invite_codes.metadata.personal_auth_user_id`, server-derived only.
- `possession-redeem.ts` personal branch: session minted for the BOUND account; the
  already-registered rail deliberately N/A here (journalled).
- Client zero-screen path incl. class-course switch for personal pupil links.
- Node verbs: **Invite a person** vs **Get a shareable link**.
- Rate-limiter fixes found by the acceptance walk itself: successful personal sign-ins and the
  limiter's own refusals no longer count toward the per-IP window (a block could self-perpetuate).
- Pins: personal zero-screens / bound-account mint / provision-first / rate-fix; THE-MODEL
  §1.13+I12 rewritten (two species); APML `PersonalLinksAreTheLogin`.

**IME pack v2 (`ime-invite-pack.md`): six personal links, ALL PASS on deployed dev AND verified
per-link on the staging host** (zero dialog watcher, role landings, names in shell, repeat-click,
revoked-fails-friendly, student on the class course). Suites: api 660 + player-vue 959 green.

**Prod note:** at time of writing `saysomethingin.app` still served the pre-species-1 build — the
six production URLs go live on the next staging→main promote (staging is green and soaked with
exactly this build).
