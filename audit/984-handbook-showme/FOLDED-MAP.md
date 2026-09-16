# Handbook "Show me" / "Take me there" — audit map, all roles

Read-only audit on **staging.saysomethingin.app**, 2026-09-16. No app code changed, nothing fixed.
Commissioned by Tom: "some of the Handbook Show me clips don't quite point to the right place and some are not complete. That MIGHT be because I'm looking at view-as."

**The short answer: view-as is a real cause, but it is the smaller one.** Most of what is broken is broken for a genuinely signed-in user with no impersonation anywhere near it.

---

## 1. Summary

| | entries measured | clean | broken in both modes | broken only under view-as | not measured |
|---|---|---|---|---|---|
| **School leader** (`school_admin`) | 80 genuine · 45 view-as, desktop | 24 of 45 unchanged-and-clean | 30 Take-me-there + 12 Show-me | **11** | phone width; 35 entries in view-as |
| **Leader** (`govt_admin`) | 46 genuine, desktop, one node | ~33 by the leaf's own count, corrected below | 8 confirmed | not measured | view-as 0%; phone 0%; second node kind 0% |
| **Teacher** | 41 of 49 genuine, desktop | — | ~22 | not measured | view-as 0%; phone 0%; 8 entries |
| **SSi admin** | 44 | 3 render at all | 31 render nothing + 3 defective | n/a | 41 not individually traced; 11 of 13 intel walks |
| **Learner** | 6 | 5 | 1 (never offered) | n/a | — |

Per-role detail: school leader table below; leaf docs linked in §5.

## 2. The five causes, in order of how much they cost

### (a) "Take me there" lands where the entry's own anchor does not exist — 39 of 80 school-leader entries
The biggest single class, and nothing to do with view-as. `Take me there` resolves through `PLACE_LINKS`
to a *route*, and the route's page frequently does not contain the element the entry describes:
`settings-delete-school`, `setup-course-picker`, `student-view-link`, `insights-measure`,
`upgrade-update-seats`, `class-copy-play-preview` and ~33 more. The button is honest about the page
and wrong about the thing.

### (b) "Take me there" and "Show me" disagree, by construction — ~20 of 48 teacher entries
`HandbookView.vue` gives Show-me a special case that routes a `class-detail` walk to
`/schools/classes/<firstClassId>` (line 143). `Take me there` calls `placeLink` with **no such case**
(line 110), and `PLACE_LINKS` maps `class-detail` to the bare list `/schools/classes`. So the two
buttons on the same row go to different places, and the one a reader reaches for lands on a list.
*Verified in source by the orchestrator, not only by probe.*

### (c) The destination redirects, so nothing claims the deferred walk — 6 school-leader + 3 leader entries
A walk tapped in the Handbook is *deferred*; the destination's own Show-me surface claims it via
`claimDeferredWalk(persona, place, kind)`. If the landing page is not the walk's place, nothing claims
it and **nothing plays**. Two confirmed redirects do exactly this:
- `DashboardView.vue` L52-61 redirects a genuine group leader from `/schools` to `/org/<group_id>`.
  Six school-leader entries whose link is `/schools` land on `/org/<node>`; all six also fail to start.
- `/schools/all` redirects a leader to `/org/<node>?lens=schools`, where `HowThisWorks` claims
  `node-home`, not `schools-list` — three leader entries.
Twelve school-leader entries show a Show-me button that starts nothing at all; the six above plus six
class-page ones are the whole set.

### (d) The reader has no node to point at — 31 of 44 SSi-admin entries
The genuine ssi_admin account carries no `group_id` or `school_id`, and `placeLink` builds
`/org/<node>` from exactly that. With no node it returns null, so **neither** the Show-me button
**nor** the Take-me-there link renders. Plain signed-in mode, no impersonation.

### (e) View-as strips the element the clip points at — 35 walk steps across 18 walks
`SchoolsContainer.vue` L87 provides `isAdminView = isViewingAs`. Every write control gated on
`v-if="!isAdminView"` — directly, or through `canManageStaff` / `canEditSchool`, both of which are
`role && !isAdminView` — is **removed from the DOM** under view-as. `WalkOverlay` falls back to an
unanchored card with a Next button when an anchor never appears: that is Tom's "floats in the middle
of the page". Tom's own specimen is exactly this: `add-teacher-by-name` step 1 anchors
`teacher-named-seat`, gated `v-if="canManageStaff"`.

Worst-hit walks: `share-a-class`, `invite-a-supply-teacher`, `hand-over-the-lead`,
`move-a-teacher-between-classes`, `manage-a-class-from-its-page`, `run-class-session`,
`add-students-to-a-class`, `manage-your-school-settings`, `school-identity-list`,
`add-teacher-by-name`, `remove-a-teacher`, `invite-a-teacher-to-your-school`,
`school-language-and-time-zone`, `find-a-student-or-export-the-list`, `start-or-make-a-class`,
`what-the-class-tools-page-counts`, `add-a-school-to-your-programme`, `structure-a-group`.

**Measured, genuine vs view-as, same 45 school-leader entries:** 11 entries are strictly worse under
view-as (an anchor that is present genuinely is absent impersonated), and 3 walks that start
genuinely fail to start. Everything else that is broken is broken in both.

### Not a cause: JSON drift
All 243 walk steps across the 83 walk files resolve to an anchor that exists in the source and is
reachable from its own place once the shell is counted. There is no stale walk id, no dead anchor.

## 3. School leader — full table

Genuine account `+chepstowtest-leader`; view-as from `+ssi` onto the same school admin. Desktop 1280x800.
View-as covers the first 45 entries alphabetically; the rest is a stated gap.

| entry | Show me (genuine) | Take me there (genuine) | Show me (view-as) | Take me there (view-as) | view-as only? |
|---|---|---|---|---|---|
| add-a-class-to-a-group | started; 1/4 steps floated | clean | started; 1/4 steps floated | clean | no |
| add-a-student-to-a-class | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `verb-invite-student` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `verb-invite-student` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| add-a-teacher-by-name | started; 1/3 steps floated | clean | started; 1/1 steps floated | **anchor `teacher-named-seat` absent** on /schools/teachers | **yes** |
| bring-your-first-person-in | started; 1/5 steps floated | clean | started; 1/5 steps floated | clean | no |
| change-how-many-seats-you-pay-for | started; 2/4 steps floated | **anchor `upgrade-update-seats` absent** on /schools/upgrade | started, all steps anchored | **anchor `upgrade-update-seats` absent** on /schools/upgrade | no — broken in both |
| change-your-school-s-name-and-details | started; 3/7 steps floated | clean | started; 3/7 steps floated | **anchor `settings-save-profile` absent** on /schools/settings | **yes** |
| choose-what-a-class-learns | started; 2/2 steps floated | **anchor `create-class-course` absent** on /schools/classes | started; 2/2 steps floated | **anchor `create-class-course` absent** on /schools/classes | no — broken in both |
| choose-what-role-someone-arrives-as | started; 1/5 steps floated | **anchor `invite-form-role` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | started; 1/5 steps floated | **anchor `invite-form-role` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| choose-which-courses-your-school-uses | started; 2/2 steps floated | **anchor `setup-course-picker` absent** on /schools/setup | started; 2/2 steps floated | **anchor `setup-course-picker` absent** on /schools/setup | no — broken in both |
| claim-another-email-domain-for-your-school | started; 2/4 steps floated | clean | started; 4/4 steps floated | **anchor `settings-identity-add-domain` absent** on /schools/settings | **yes** |
| copy-a-class-link-without-opening-the-class | started; 1/2 steps floated | clean | started; 1/2 steps floated | clean | no |
| copy-a-teacher-s-own-play-onto-the-class | started; 3/5 steps floated | **anchor `class-copy-play-preview` absent** on /schools/classes | **started nothing** → /schools/classes/d52efceb-da67-413b-a660-9fbe6c48a494 | **anchor `class-copy-play-preview` absent** on /schools/classes | yes |
| copy-every-teacher-s-own-play-onto-their-class | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | clean | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | clean | no — broken in both |
| create-your-first-classes | started; 3/3 steps floated | **anchor `setup-add-class-row` absent** on /schools/setup | started; 3/3 steps floated | **anchor `setup-add-class-row` absent** on /schools/setup | no — broken in both |
| delete-your-school | started; 3/7 steps floated | **anchor `settings-delete-school` absent** on /schools/settings | started; 3/7 steps floated | **anchor `settings-delete-school` absent** on /schools/settings | no — broken in both |
| download-your-school-s-data | started; 2/2 steps floated | **anchor `settings-export-data` absent** on /schools/settings | started; 2/2 steps floated | **anchor `settings-export-data` absent** on /schools/settings | no — broken in both |
| email-someone-their-invite-again | started; 2/2 steps floated | **anchor `ways-in-resend` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | started; 2/2 steps floated | **anchor `ways-in-resend` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| export-your-class-list | started; 1/4 steps floated | clean | started; 2/4 steps floated | clean | no |
| find-a-class-in-a-long-list | started; 1/5 steps floated | clean | started; 1/5 steps floated | clean | no |
| find-out-which-email-you-are-signed-in-with | started; 1/3 steps floated | **anchor `account-identity` absent** on /schools/settings | **started nothing** → /?screen=settings | **anchor `account-identity` absent** on /schools/settings | yes |
| finding-your-way-around-the-organisation | started; 1/6 steps floated | clean | started; 1/6 steps floated | clean | no |
| give-a-class-its-course | started; 2/2 steps floated | **anchor `setup-class-course` absent** on /schools/setup | started; 2/2 steps floated | **anchor `setup-class-course` absent** on /schools/setup | no — broken in both |
| give-a-teacher-their-classes | started; 1/5 steps floated | clean | started; 1/1 steps floated | **anchor `teacher-assign-classes` absent** on /schools/teachers | **yes** |
| hand-a-teacher-their-access-code | started; 1/3 steps floated | clean | started; 3/3 steps floated | **anchor `teacher-signin-link` absent** on /schools/teachers | **yes** |
| hand-out-a-sign-up-link-for-one-course | started; 1/1 steps floated | **anchor `ways-in-copy-course` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | started; 1/1 steps floated | **anchor `ways-in-copy-course` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| hand-out-your-staff-links | started; 2/2 steps floated | **anchor `setup-staff-links` absent** on /schools/setup | started; 2/2 steps floated | **anchor `setup-staff-links` absent** on /schools/setup | no — broken in both |
| how-far-a-class-has-travelled | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `class-journey` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `class-journey` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| how-fresh-these-numbers-are | started; 1/6 steps floated | clean | started; 1/6 steps floated | clean | no |
| invite-a-teacher-to-your-school | started; 1/2 steps floated | clean | started; 2/2 steps floated | **anchor `teachers-invite-link` absent** on /schools/teachers | **yes** |
| let-a-named-address-in-through-your-links | started; 2/4 steps floated | clean | started; 4/4 steps floated | **anchor `settings-identity-add-address` absent** on /schools/settings | **yes** |
| look-up-one-student | started; 3/3 steps floated | **anchor `student-view-link` absent** on /schools/students | **started nothing** → /schools/students | **anchor `student-view-link` absent** on /schools/students | yes |
| make-a-class | started; 1/4 steps floated | clean | started; 2/4 steps floated | **anchor `verb-new-class` absent** on /schools/classes | **yes** |
| make-a-link-anyone-can-use | started; 2/7 steps floated | clean | started; 2/7 steps floated | clean | no |
| manage-a-class | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `class-page-manage` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `class-page-manage` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| minutes-in-the-app-this-week | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| name-your-school | started; 1/4 steps floated | clean | started; 1/4 steps floated | clean | no |
| open-a-class | started; 1/5 steps floated | clean | started; 1/5 steps floated | clean | no |
| open-the-folded-ledger | started; 2/7 steps floated | **anchor `ways-in-show-all` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | started; 2/7 steps floated | clean | yes |
| open-your-inbox | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| play-as-class-from-the-class-page | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `class-page-play` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `class-page-play` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| prove-your-mailbox-reaches-you | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| put-the-app-on-your-device | started; 1/4 steps floated | clean | started; 1/4 steps floated | clean | no |
| read-your-class-list | started; 1/5 steps floated | clean | started; 1/5 steps floated | clean | no |
| read-your-messages | started; 1/3 steps floated | clean | started; 1/3 steps floated | clean | no |
| reading-one-student-s-progress | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `class-students` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **anchor `class-students` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | no — broken in both |
| reading-your-insights | started; 1/10 steps floated | **anchor `insights-measure` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5/insights | started; 1/10 steps floated | **anchor `insights-measure` absent** on /org/648185c9-78cf-48bd-98bd-8a5dd73670d5/insights | no — broken in both |
| remove-a-teacher-from-your-school | started; 1/2 steps floated | clean | not measured | not measured | — |
| report-a-bug-from-settings | started; 1/5 steps floated | **anchor `report-bug` absent** on /schools/settings | not measured | not measured | — |
| report-a-bug-from-the-dashboard | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | not measured | not measured | — |
| say-what-happened | started; 1/5 steps floated | **anchor `report-bug-text` absent** on /schools/settings | not measured | not measured | — |
| say-what-happened-on-the-dashboard | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | not measured | not measured | — |
| see-that-your-report-arrived | prose only | **anchor `report-bug-thanks` absent** on /schools/settings | not measured | not measured | — |
| see-what-your-school-pays | started; 3/7 steps floated | **anchor `settings-billing-plan` absent** on /schools/settings | not measured | not measured | — |
| send-a-dashboard-bug-report | **started nothing** → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | **redirected** /schools → /org/648185c9-78cf-48bd-98bd-8a5dd73670d5 | not measured | not measured | — |
| send-the-report | started; 1/5 steps floated | **anchor `report-bug-send` absent** on /schools/settings | not measured | not measured | — |
| set-or-change-your-password | started; 1/4 steps floated | clean | not measured | not measured | — |
| set-your-language-and-time-zone | started; 2/3 steps floated | **anchor `settings-localisation-save` absent** on /schools/settings | not measured | not measured | — |
| start-a-class-session-from-the-list | started; 1/4 steps floated | clean | not measured | not measured | — |
| students-on-their-own-accounts | started; 1/3 steps floated | **anchor `class-roster` absent** on /schools/classes | not measured | not measured | — |
| subscribe-your-school | started; 2/4 steps floated | clean | not measured | not measured | — |
| take-a-domain-or-address-off-your-school-s-list | started; 2/4 steps floated | **anchor `settings-identity-remove` absent** on /schools/settings | not measured | not measured | — |
| take-a-teacher-off-a-class-or-move-them | started; 1/5 steps floated | **anchor `assign-classes-modal` absent** on /schools/teachers | not measured | not measured | — |
| take-your-lists-away-as-a-spreadsheet | started; 3/3 steps floated | **anchor `students-export` absent** on /schools/students | not measured | not measured | — |
| tell-us-about-something-that-went-wrong | started; 1/5 steps floated | **anchor `report-bug-sheet` absent** on /schools/settings | not measured | not measured | — |
| the-classes-by-year-group | started; 1/5 steps floated | **anchor `classes-year-groups` absent** on /schools/classes | not measured | not measured | — |
| the-numbers-by-year-group | started; 1/6 steps floated | clean | not measured | not measured | — |
| the-numbers-on-any-level | started; 1/6 steps floated | **no link** | not measured | not measured | — |
| told-when-you-are-playing-as-yourself | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| voice-and-pause | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| walking-down-to-a-school-a-class-or-a-person | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| ways-in-who-can-get-in-and-how-to-change-it | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| what-your-classes-actually-practised | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| when-more-people-join-than-you-have-seats | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| where-a-class-s-practice-is-read | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| where-classes-are-in-the-course-and-where-they-stop | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| whether-a-class-is-practising-together | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| which-classes-have-gone-quiet | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| which-classes-practised-this-week | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| why-the-insights-show-a-rate-not-a-total | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |
| work-through-setup-at-your-own-pace | **no Show-me button** (clip exists) | **no link** | not measured | not measured | — |

## 4. Honest gaps

- **Phone width: 0% everywhere.** The school-leader phone runs are queued behind the desktop ones in
  systemd unit `cs-long-984-schoolleader` and were not finished inside the budget; results will appear
  at `audit/984-handbook-showme/results/school-admin-{genuine,viewas}-phone.json` on this branch.
- **View-as: only measured for school leader**, and only its first 45 entries. Leader, teacher, SSi
  admin and learner were never exercised under view-as at all.
- **Leader: one node only.** The second account tried turned out to be a school_admin; no `org`-kind
  or second-kind node was reached.
- **Teacher: 8 of 49 entries never reached.**
- **SSi admin: 41 of 44 entries not individually traced** (the root cause was established instead);
  11 of 13 intel walks not stepped.
- **Per-step completion is NOT trustworthy in this data.** Two independent probes drove walk steps
  badly, and nearly every walk reads "did not reach terminal". Treat "started / did not start",
  "anchor present / absent" and the genuine-vs-view-as diff as measured; treat step-by-step
  completion as unverified.
- **The school-leader slice was originally a worker job (#985·G) that failed**, ending its turn with
  its browser runs in background tasks that were killed. It delivered nothing; the orchestrator took
  over its probe and re-ran it as a detached service.

## 5. Sources

- School leader — this document, raw JSON in `audit/984-handbook-showme/results/`.
- Leader (govt_admin) — https://watson-1.tail4968cb.ts.net/d/a8292ef7 · cold-verified by GPT-6 Astra; its
  claim that `org` kind is unreachable for a genuine leader is **refuted** (kind is structural, not
  viewer-dependent: `NodeHomeView.vue` L648 + `nodeTerminology.ts` `deriveInstitutionKind`). The correct
  claim is narrower: unreachable *from that leader's node*.
- Teacher — https://watson-1.tail4968cb.ts.net/d/c4b91146
- SSi admin + learner — https://watson-1.tail4968cb.ts.net/d/0119374a
- Static view-as gate scan — `audit/984-handbook-showme/viewas2.txt`, `viewas-gated.json`.
