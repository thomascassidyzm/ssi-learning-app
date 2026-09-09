# Foreign-eyes sweep — 9 September 2026

Read and report only. No application changes, no tests. Candidate defects require independent verification before action.

Areas 2–4 were read on baseline `4555418a` by a foreign model. Areas 5–7 were read on `f666d4a7` (origin/dev tip) by a Claude run, which also verified one dying claim left behind by an earlier run.

- Area 2 complete: [entitlement and offline lease](area-2-entitlement-and-offline-lease.md). FE2-01 likely; FE2-02 explicitly policy-dependent/uncertain.
- Area 3 complete: [org enrolment and family](area-3-org-enrolment-and-family.md). FE3-01–05; two explicitly labelled incomplete enrolment-repair fixes.
- Area 4 complete: [identity resolution](area-4-identity-resolution.md). No new defect; installed-library behaviour and every NULL caller recorded.
- Area 5, part 1: [the school-deletion claim](area-5-hierarchy-and-school-deletion.md). **FE5-01 CONFIRMED** — a teacher's school tag passes the delete gate on `api/admin/update-school.ts`; the resolver is `schoolIdForAdmin` and it never reads `role_in_context`.
- Area 5, part 2: [admin and teacher hierarchy, view-as, schoolScope](area-5-admin-teacher-hierarchy.md). FE5-02 (global role × oldest school tag → class deletion at the wrong school), FE5-03 (a mint that runs before its own gate). View-as advisory and the class-progress input handling recorded as already known.
- Areas 6 and 7: in flight in their own worker sessions; their files land beside these.

No live database or deployment verification anywhere in this sweep. Each file records its own limits and evidence.
