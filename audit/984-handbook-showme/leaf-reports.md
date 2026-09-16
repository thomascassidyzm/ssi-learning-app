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
