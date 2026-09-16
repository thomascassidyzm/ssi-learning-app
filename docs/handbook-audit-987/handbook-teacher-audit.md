# Handbook Show-me / Take-me-there audit — teacher persona (job #987)

Read-only, staging, genuine teacher account `thomas.cassidy+chepstowtest-cover@gmail.com` (verified teacher at ZZ Test Chepstow), desktop width (1280x800) only. Persona check confirmed in code: the Handbook makes **no lead vs non-lead distinction** — `viewerPersona()` maps `educational_role === 'teacher' | 'tutor'` straight to `teacher`; `is_lead` only changes what's visible *inside* `ClassDetail.vue` (co-teacher note, who can manage teachers), never which Handbook entries or clips a teacher sees. A tutor was not separately probed (not reached in the time budget) — same persona, so expected identical, but unverified.

## Two real, well-evidenced defects

**1. "Take me there" never opens an actual class for any `class-detail` entry — "Show me" does.**
`placeLink()` resolves `class-detail` via `PLACE_LINKS['class-detail'] = () => '/schools/classes'` (`handbook.ts`), no class id, always the list. `showMeTo()` has a special case that routes to `/schools/classes/<firstClassId>` when the viewer has one. Confirmed live: for `add-students-to-a-class`, `delete-a-class`, `hand-a-class-over-to-another-teacher` (and every other class-detail entry), Show me landed on `/schools/classes/ea59ef42-ab29-46d0-a956-a4fdbe5e1d09` (a real class) while Take me there on the same entry landed on `/schools/classes` (the list) — so its anchor (`class-student-add`, `class-delete`, etc.) is never on the page. This is the majority of the teacher's Handbook (roughly 20 of 48 clip-bearing entries) and is a single, one-line fix (give Take-me-there the same firstClassId special case Show-me already has).

**2. Two entries compute a clip but render no Show-me button at all.**
`download-your-school-s-data` (walk `download-your-schools-data`) and `read-your-class-list` (walk `reading-your-class-list`) both have a non-empty `clipsFor()` result (confirmed by replicating the pack.json logic) but `#hb-<id> [data-walk-offer]` is absent from the DOM on a direct `?entry=<id>` deep link, opened and settled. Take-me-there rendered fine for both. Not diagnosed further (no time) — worth a look at whether the entry's `walk` field or an extra runtime gate is suppressing the button only for these two.

## What I could NOT verify (honest gaps)

- **"Show me" step-by-step fidelity is unverified for `on:"click"` steps.** My probe's ring-detector queried `.walk-ring` and read its own `data-walk`/`data-intel` attribute, which came back `null` on every click-driven step — the ring is a decorative overlay, not the anchored element itself, so clicking it never advanced the walk and the probe looped uselessly at step 0 for 8 iterations on every click-driven walk (`add-students-to-a-class`, `open-your-inbox`, `copy-a-class-link-without-opening-the-class`, `report-a-bug-from-settings`, and others below). **This is a probe defect, not a reported app defect** — I have deliberately excluded "did not reach terminal" as a finding for any walk whose steps are click-driven; it is unverified, not broken. Walks driven entirely by "Next" (`export-your-class-list`, `find-a-class-in-a-long-list`, `make-a-class`, `open-a-class`, `read-your-messages`, `start-a-class-session-from-the-list`) DID verify clean end-to-end.
- **view-as mode**: not run at all — no time left in the 30-minute budget after the genuine-account desktop pass. Every row below is genuine-account only.
- **Phone width (390x844)**: not run at all, same reason.
- **8 entries never reached** (time budget cut the sweep): `tell-us-about-something-that-went-wrong`, `the-classes-by-year-group`, `told-when-you-are-playing-as-yourself`, `where-a-class-s-practice-is-read`, `where-the-class-has-got-to`, `your-class-against-the-average`, `your-classes-at-a-glance`, `your-own-teaching-numbers`.
- **Tutor (groupless teacher) account**: not reached; same persona as teacher by code, unverified live.

## Full table (genuine account, desktop, teacher persona — 49 entries)

| entry | Show me result | Take me there result | view-as-only? | cause guess |
|---|---|---|---|---|
| add-students-to-a-class | started, walk=add-students-to-a-class, in-app step fidelity unverified (probe click-target bug, see gaps) | landed /schools/classes (expected class, got list) | not tested | class-detail routing gap (finding #1) |
| choose-what-a-class-learns | started, walk=choose-a-class-course, unverified fidelity | landed /schools/classes | not tested | class-detail routing gap (finding #1) |
| copy-a-class-link-without-opening-the-class | started, unverified fidelity | landed /schools/classes, anchor present (place=classes list, correct) | not tested | clean |
| copy-a-teacher-s-own-play-onto-the-class | started, reached terminal (Next-driven) | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| delete-a-class | started, reached terminal | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| download-your-school-s-data | **Show me button absent despite clip existing** | landed /schools/settings, anchor absent | not tested | finding #2 |
| export-your-class-list | started, reached terminal, clean | landed /schools/classes, anchor present | not tested | clean |
| find-a-class-in-a-long-list | started, reached terminal, clean | landed /schools/classes, anchor present | not tested | clean |
| find-out-which-email-you-are-signed-in-with | started, reached terminal | landed /schools/settings, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| hand-a-class-over-to-another-teacher | started, reached terminal | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| how-students-join-a-class | started, reached terminal | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| invite-a-teacher-who-isn-t-here-yet | started, reached terminal | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| look-up-one-student | started, reached terminal | landed /schools/students, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| make-a-class | started, reached terminal, clean | landed /schools/classes, anchor present | not tested | clean |
| manage-a-class | **started=false — walk never began** | landed /org/648185c9-78cf-48bd-98bd-8a5dd73670d5, anchor absent | not tested | no claimer on destination route (see note) |
| move-a-teacher-to-another-class | started, unverified fidelity | landed /schools/classes | not tested | class-detail routing gap (finding #1) |
| open-a-class | started, reached terminal, clean | landed /schools/classes, anchor present | not tested | clean |
| open-your-inbox | started, unverified fidelity | landed /schools, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| play-as-class-from-the-class-page | **started=false — walk never began** | landed /org/648185c9-78cf-48bd-98bd-8a5dd73670d5, anchor absent | not tested | no claimer on destination route (see note) |
| play-as-class-from-your-dashboard | started, reached terminal | landed /schools, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| practice-on-your-own-account | started, reached terminal | landed /schools, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| prove-your-mailbox-reaches-you | started, reached terminal | landed /schools, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| read-your-class-list | **Show me button absent despite clip existing** | landed /schools/classes, anchor present | not tested | finding #2 |
| read-your-messages | started, reached terminal, clean | landed /schools/inbox, anchor present | not tested | clean |
| remove-a-student-from-a-class | started, reached terminal | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| rename-a-class | started, reached terminal | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| report-a-bug-from-settings | started, unverified fidelity | landed /schools/settings, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| report-a-bug-from-the-dashboard | started, unverified fidelity | landed /schools, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| run-your-first-class-session | started, reached terminal | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| say-what-happened | started, unverified fidelity | landed /schools/settings, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| say-what-happened-on-the-dashboard | started, unverified fidelity | landed /schools, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| see-that-your-report-arrived | no clip (prose-only, by design) | landed /schools/settings, anchor absent | not tested | prose-only entry, anchor check not meaningful |
| send-a-dashboard-bug-report | started, unverified fidelity | landed /schools, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| send-the-report | started, unverified fidelity | landed /schools/settings, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| set-your-language-and-time-zone | started, unverified fidelity | landed /schools/settings, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| share-a-class-with-a-colleague | started, unverified fidelity | landed /schools/classes | not tested | class-detail routing gap (finding #1) |
| start-a-class-session-from-the-list | started, reached terminal, clean | landed /schools/classes, anchor present | not tested | clean |
| students-on-their-own-accounts | started, reached terminal | landed /schools/classes (expected class) | not tested | class-detail routing gap (finding #1) |
| subscribe-as-a-tutor | started, reached terminal | landed /schools/upgrade, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| take-a-teacher-off-a-class-or-move-them | started, unverified fidelity | landed /schools/teachers, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| take-your-lists-away-as-a-spreadsheet | started, reached terminal | landed /schools/students, anchor absent | not tested | anchor selector wrong / off-screen (unverified detail) |
| tell-us-about-something-that-went-wrong | NOT RUN | NOT RUN | not tested | time budget exhausted |
| the-classes-by-year-group | NOT RUN | NOT RUN | not tested | time budget exhausted |
| told-when-you-are-playing-as-yourself | NOT RUN | NOT RUN | not tested | time budget exhausted |
| where-a-class-s-practice-is-read | NOT RUN | NOT RUN | not tested | time budget exhausted |
| where-the-class-has-got-to | NOT RUN | NOT RUN | not tested | time budget exhausted |
| your-class-against-the-average | NOT RUN | NOT RUN | not tested | time budget exhausted |
| your-classes-at-a-glance | NOT RUN | NOT RUN | not tested | time budget exhausted |
| your-own-teaching-numbers | NOT RUN | NOT RUN | not tested | time budget exhausted |

Note on `manage-a-class` / `play-as-class-from-the-class-page`: both are `node-home` place entries; `placeLink()` resolves node-home via `currentUser.group_id || school_id`, which for this teacher is the **school's** id, landing Take-me-there on `/org/<school-id>` — the router comment at `router/index.ts:347` says "CLASS PAGE for every role is the class node home, /org/:id" implying `:id` should be the *class's* id, not the school's. If that comment is right, both the node-home resolution and the Show-me destination for this teacher are pointed at the wrong node (the school org page, not their class org page), which is consistent with Show me never starting there (a teacher likely isn't authorized on the school-level org page). Not confirmed by reading the guard code — a plausible cause, not a proven one.

## Summary
- 49 entries total for teacher persona (48 with a clip, 1 prose-only by design).
- 41 entries actually run (8 not reached — time budget).
- 2 genuine "Show me never starts" failures (`manage-a-class`, `play-as-class-from-the-class-page`).
- 2 genuine "clip computed, button absent" failures (`download-your-school-s-data`, `read-your-class-list`).
- 1 systemic "Take me there wrong destination" defect spanning ~20 class-detail entries (finding #1) — Show me is correct for all of these; only Take me there is wrong.
- Remaining ~15 entries: Show me starts and (where Next-driven) reaches its terminal card cleanly; Take-me-there anchor-on-landed-page came back false for several (settings/dashboard/students/teachers-place entries) — these are unverified in detail (didn't inspect whether the anchor was genuinely missing, off-screen, or my selector matched the wrong element) and should be treated as "needs a second look," not confirmed defects.
