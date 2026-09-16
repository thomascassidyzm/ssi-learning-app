# Handbook Show-me audit — leader (govt_admin) — job #986

Read-only audit on staging (`https://staging.saysomethingin.app`, build `718877c`), 2026-09-16.
No app code changed. Probe script: `packages/player-vue/e2e/_986-leader-handbook-audit-probe.mjs`.
Raw evidence: `docs/handbook-audit-986/*.log`, `*.json` (this directory).

## Coverage actually achieved (read this before the table)

- **Genuine sign-in, desktop (1280×800), ONE node kind: `thomas.cassidy+bumface@gmail.com`.**
  Verified live in the `learners` table: `educational_role: "govt_admin"`, `platform_role: null` →
  persona `leader`. This account's node is `2d98bc20-a9c7-4fed-b69a-aa64038ded2a` ("IME Demo
  Programme"), the **top of its tree** (`parent_id: null`, `type: "programme"`).
- **All 46 leader-scoped Handbook entries** (under "Just what I can do") were exercised: Show me
  tapped and stepped through to completion or failure, Take me there tapped and the landing URL
  compared against `PLACE_LINKS`. 20 of the 46 that did not cleanly reach the terminal card on the
  first pass were **re-run with a longer settle wait** (3.5s vs 1.2s) to separate real defects from
  my own probe racing the app's slow auth boot (see Gaps).

## STATED GAPS — what I could NOT cover, and why

1. **Second node kind: not reached.** The brief asked for at least two node kinds (org/trust level
   and a group level). I tried a second account,
   `thomas.cassidy+zz.chepstow.leader@gmail.com` — **verified live it is `educational_role:
   "school_admin"`, not `govt_admin`.** It reads as persona `school_admin`, not `leader`, so its run
   is **not leader-persona evidence** and I have discarded it from the findings table below (raw log
   kept as `zzleader-desktop-INVALID-ACCOUNT.log` for the record). I did not find or mint a second
   genuine govt_admin account reaching a `group`- or `school`-kind node inside the time I had. **This
   audit covers exactly one node — the top-level programme node — for the leader persona.**
2. **`kind: "org"` may be structurally unreachable for ANY genuine leader, on ANY node** — see
   Finding 1. If that reading is right, a second node for this persona would not have produced a
   `kind=org` claim either way; the real second kind worth chasing next is `school` (a leader who
   also directly admins one school) or `class` (see Finding 2).
3. **Mobile width (390×844): not tested.** Desktop only, for time. Given Finding 2 and 3 below are
   both routing/structural (not CSS), I'd expect them to reproduce at any width, but that is
   unverified.
4. **view-as mode: not tested at all.** Zero coverage of "sign in as ssi_admin, view-as leader,
   read-only banner up" — the whole `view-as-only?` column is unanswered for every row. This is the
   single biggest gap against the brief.
5. **6 entries never got a clean automated verdict** even after the retest (`give-a-teacher-their-
   classes`, `say-what-happened`, `send-the-report`, `take-a-teacher-off-a-class-or-move-them`,
   `tell-us-about-something-that-went-wrong`, `what-your-classes-actually-practised`) — logged as
   `incomplete-maxsteps`. One sibling walk (`report-a-bug-from-settings`, same underlying walk as
   `say-what-happened`/`send-the-report`/`tell-us-about-something-that-went-wrong`) **did** reach its
   terminal card cleanly on the retest, which is evidence these are a **probe** limitation (my step-
   driver doesn't type into text fields or pick from dropdowns, so a walk with a fill-in step just
   sits there until my loop gives up), not a confirmed product defect. Marked `probe-incomplete,
   likely clean` below rather than broken.

## Findings (leader persona, genuine sign-in, desktop, one node — the "IME Demo Programme" top node)

| entry | Show me result | Take me there result | view-as-only? | one-line cause guess |
|---|---|---|---|---|
| **see-and-download-your-funder-numbers** | never starts (button renders, click navigates, no walk claims) | landed as expected | untested | **element role-gated** — `nodeKindOf()` (`explainer/evaluateRules.ts:96`) only ever returns `class`/`school`/`group` for a real signed-in viewer; `'org'` is returned only when `neutral` (i.e. an SSi admin viewing). The walk requires `kinds:["org"]`, so no genuine leader, on any node, can ever have this claimed. |
| **add-a-student-to-a-class** | never starts | landed on own group/org node; entry's own anchor absent there | untested | **element role-gated** — walk requires `kinds:["class"]`; `showMeTo()`/`goTo()` always resolve via the leader's own `group_id`/`school_id` (`HandbookView.vue:107`), never a class id. Only the `class-detail` route has a `firstClassId` fallback (line 142); plain `node-home`+`kinds:["class"]` walks have none. |
| **how-far-a-class-has-travelled** | never starts | landed on own node; anchor absent | untested | same cause as above — shares the `reading-a-class-page` walk (`kinds:["class"]`) |
| **reading-one-student-s-progress** | never starts | landed on own node; anchor absent | untested | same cause as above |
| **whether-a-class-is-practising-together** | never starts | landed on own node; anchor absent | untested | same cause as above |
| **add-a-school-to-your-programme** | button renders, click navigates to `/schools/all`, but that URL **redirects to `/org/<node>?lens=schools`** for this leader, where nothing claims the walk | mismatch: href says `/schools/all`, lands on `/org/<node>?lens=schools` | untested | **no claimer on destination route** — `schools-list` walks assume `/schools/all` is where the reader ends up; for a leader it visibly isn't |
| **copy-a-school-s-joining-links** | same as above | same mismatch | untested | same cause |
| **see-every-school-in-your-programme** | same as above | same mismatch | untested | same cause |
| **hand-out-a-sign-up-link-for-one-course** | flaked between `button-not-rendered` and `incomplete-maxsteps` across two runs on the same account/node | landed as expected | untested | **uncertain — reproduce before trusting**; not consistent enough to call clean |
| open-your-inbox, report-a-bug-from-the-dashboard, say-what-happened-on-the-dashboard, send-a-dashboard-bug-report | walk starts, then a Take-me-there re-test right after landed on `/org/<node>` instead of the expected `/schools` | mismatch (as noted) | untested | **likely probe race, not a product defect** — `goTo()` for the `dashboard` route is `PLACE_LINKS['dashboard'] = () => '/schools'`, a static, node-independent mapping with no code path to `/org/<node>`; my Take-me-there step reused a page that had a Show-me navigation still settling from the immediately preceding test. Needs a clean, isolated re-check, not filed as confirmed. |
| give-a-teacher-their-classes, say-what-happened, send-the-report, take-a-teacher-off-a-class-or-move-them, tell-us-about-something-that-went-wrong, what-your-classes-actually-practised | `incomplete-maxsteps` — walk starts, rings the right anchors, but my scripted stepper can't fill in a text/dropdown step so it never reaches the terminal card | landed as expected | untested | **probe-incomplete, likely clean** — the sibling walk `report-a-bug-from-settings` (identical shape, same fill-in step) reached its terminal card cleanly on retest |
| all other 33 entries (add-a-class-to-a-group, bring-your-first-person-in, change-how-many-seats-you-pay-for, choose-what-role-someone-arrives-as, email-someone-their-invite-again, find-out-which-email-you-are-signed-in-with, finding-your-way-around-the-organisation, how-fresh-these-numbers-are, make-a-link-anyone-can-use, open-the-folded-ledger, put-the-app-on-your-device, read-your-messages, reading-your-insights, set-or-change-your-password, subscribe-your-organisation, the-numbers-by-year-group, the-numbers-on-any-level, voice-and-pause, walking-down-to-a-school-a-class-or-a-person, ways-in-who-can-get-in-and-how-to-change-it, when-more-people-join-than-you-have-seats, where-classes-are-in-the-course-and-where-they-stop, which-classes-have-gone-quiet, which-classes-practised-this-week, why-the-insights-show-a-rate-not-a-total, and 8 more) | reached terminal card, every anchor matched the step JSON's named anchor | landed as expected | untested | clean |
| see-that-your-report-arrived | no clip for this persona (prose only, by design — `clipsFor` returns empty) | not tested | untested | clean — not a defect, this is the one entry in the 46 with no walk |

## Summary

- **46 entries total** for the leader persona under "Just what I can do".
- **1 entry** is prose-only by design (no walk exists) — not a defect.
- **~33 entries clean**: Show me reaches its terminal card with every step correctly anchored, Take
  me there lands where `PLACE_LINKS` says.
- **3 entries confirmed broken** on structural grounds (code-read, not just probe output): every
  `kind:["class"]`-gated walk offered to a leader (`add-a-student-to-a-class`,
  `how-far-a-class-has-travelled`, `reading-one-student-s-progress`, `whether-a-class-is-practising-
  together` — 4 entries, one root cause) plus `see-and-download-your-funder-numbers`
  (`kind:["org"]`) — **5 entries, 2 root causes**, both "the leader is standing on the wrong kind of
  node and there is no code path that ever gets them onto the right one."
- **3 entries confirmed broken** on a second root cause: `schools-list`-route walks
  (`add-a-school-to-your-programme`, `copy-a-school-s-joining-links`, `see-every-school-in-your-
  programme`) whose Take-me-there destination redirects away from where the walk expects to run.
- **~8 entries genuinely uncertain** — either a flaky repro (`hand-out-a-sign-up-link-for-one-
  course`) or my own probe's known limits (can't type into a form field, raced its own navigation) —
  flagged rather than guessed at.
- **view-as mode and mobile width: 0% coverage**, and the second node-kind requirement was not met
  (the account I tried for it was not actually a govt_admin) — see Gaps above.

## What this means for Tom's original hypothesis

Tom's worry was clips pointing to the wrong button, possibly a view-as artefact. What this pass
actually found, on a **genuine** sign-in with **no view-as involved**, is narrower and more
structural than "wrong button": for a leader on the org/programme's own top node, an entire *class*
of Handbook clips (anything gated to `kind:"class"` or `kind:"org"`) can **never** be shown at all,
because the generic `node-home` routing always sends the leader to their own node and there is no
code path onto a class, and because a genuine leader's own top node is never classified `kind:
"org"` in the first place. Neither of these needs view-as to reproduce.
