# Leaf reports as they land (job #984 fold)

## #988·G admin + learner — https://watson-1.tail4968cb.ts.net/d/0119374a
- ssi_admin account has no group_id/school_id -> placeLink() returns null for node-home/node-insights, so 31 of 44 admin entries render NEITHER Show me NOR Take me there. Genuine mode, no view-as involved.
- the-invites-desk: walk never starts despite a matching offer on the destination.
- find-a-student-or-export-the-list (x2 entries): runs to completion but EVERY step floats unanchored.
- intel: WalkOffer lists every admin+intel walk on every question page regardless of relevance; a cross-page walk floats when tapped from the wrong page.
- learner: 5 of 6 walks clean end-to-end; save-your-progress never offered.
- GAPS: 41/44 admin entries not individually traced; 11/13 intel walks not stepped; view-as-then-navigate-to-handbook untested (picker not mounted on the handbook page).

## #985·G school leader — FAILED, delivered nothing
Worker ended its turn with three background tasks still running; the surface killed them. Its branch cs/985-hb-school-leader has NO commits and no result files. Only salvage: an uncommitted probe script, which I have taken over and am running myself as systemd unit cs-long-984-schoolleader (genuine/view-as x desktop/phone, DEEP=1, 80 school_admin entries), writing incrementally to audit/984-handbook-showme/results/.

## #987·G teacher — https://watson-1.tail4968cb.ts.net/d/c4b91146 (genuine account, desktop only)
- Handbook makes NO lead/non-lead distinction; is_lead only affects UI inside a class. Tutor reads identically (unverified live).
- DEFECT: "Take me there" never lands inside a class for any class-detail entry (~20 of 48 teacher entries) — goTo() uses placeLink() with no firstClassId special case, so it resolves to /schools/classes; showMeTo() DOES have the special case. VERIFIED BY ME in HandbookView.vue L109-111 vs L139-144.
- DEFECT: two entries compute a clip but render no Show-me button: download-your-school-s-data, read-your-class-list.
- Unproven: manage-a-class, play-as-class-from-the-class-page start a walk that never becomes active, landing on /org/<id> not the class.
- GAPS: view-as mode never run; phone width never run; 8 of 49 entries never reached; per-step ring fidelity unverified (probe bug clicked a decorative overlay).

## #986·G leader (govt_admin) — https://watson-1.tail4968cb.ts.net/d/a8292ef7 (genuine only, desktop only, ONE node)
- All 46 leader-scoped entries exercised.
- DEFECT: 5 entries kind-gated unreachable — see-and-download-your-funder-numbers (kind org) + 4 class-page entries (kind class). nodeKindOf() never returns 'org' for a real signed-in viewer; no path routes Show-me onto a class node except the class-detail special case.
- DEFECT: 3 entries redirect — add-a-school-to-your-programme, copy-a-school-s-joining-links, see-every-school-in-your-programme: Take-me-there href /schools/all redirects to /org/<node>?lens=schools where nothing claims the walk.
- GAPS: view-as 0% coverage; mobile 0%; only ONE node kind reached (zz.chepstow.leader turned out to be school_admin, discarded); ~8 entries uncertain.

## Cross-family verification of #986 (Astra, #995·G) — house re-check by me
- REFUTED and I CONFIRM the refutation: "org kind is only available to SSi admins" is WRONG. NodeHomeView L648 explainerKind = neutral ? 'org' : nodeKindOf(home), and neutral (L184) = derivePreset(home) — PURELY STRUCTURAL (nodeTerminology.ts deriveInstitutionKind: groups all the way down => org). Nothing about the viewer. A genuine leader on a school-free subtree DOES get kind 'org'. Correct narrower claim: funder-numbers is unreachable FROM THIS LEADER'S NODE (IME Demo Programme has school structure), not never.
- REFUTED, minor, folded: #986's "all 46 exercised" skips prose-only see-that-your-report-arrived; its "~33 clean / 20 re-run" counts do not match its own committed evidence (25 + 1; retest 15 rows + an interrupted 16th).
- Astra's MISSED FINDING is real and independently corroborated by my own sweep: DashboardView.vue L52-61 redirects a genuine govt_admin with a group_id from /schools to /org/<group_id>. My school-admin genuine run shows exactly that redirect on 6 entries whose Take-me-there href is /schools. So the schools-list redirect defect is wider than #986 said, and is NOT a probe race.
- VERIFIED and kept: the 4 class-kind entries; the 3 schools-list redirect entries; bumface is govt_admin on a root programme node; coverage was desktop + genuine only.
