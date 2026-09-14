# In-app minutes: every reader, one definition (job #673, 2026-09-14)

Enumerating command, run from the repo root. Re-run it rather than trusting this table:

```
grep -rln "inAppTime\|diarySessionRows\|inAppSecondsByLearner\|inAppTimeByLearner\|sessioniseSeconds\|duration_seconds\|total_practice_minutes\|admin_practice_minutes\|total_practice_hours\|total_practice_seconds\|practice_minutes\|practiceMinutes\|minutesThisWeek\|inAppMinutes7d\|play_seconds\|engagedMinutes" api packages/player-vue/src --include=*.ts --include=*.vue | grep -v '\.test\.' | sort
```

## How in-app minutes are calculated

A minute is everything between the learner pressing play and stopping play, pauses included, because the pause is the gap they speak into. Listening Mode counts too, timed from its own clips and its thirty-second heartbeat, and is kept apart from main-flow time. When no stop ever arrives, because the phone locked or the app was killed, the span closes at the last audio-ended event the player emitted, never at a guess. A class account and a pupil's own account are each one learner id, sessionised once, so the class's play and a pupil's own play can never double-count. The rule lives in one place, `api/_utils/inAppTime.ts`, and every figure below either reads it or is named here as not reading it.

## Readers before this job

Scope words: CLASS = the class's own account (`classes.class_learner_id`). PUPILS = the class's pupils' own accounts. STAFF = staff own accounts under the node. Window words: ROLLING = timestamps within the last N × 24 h from now. UTC-DAYS = the last 7 UTC calendar days from midnight.

| Surface | Endpoint / component | Source | Who is counted | Window | Total or rate | Verdict |
|---|---|---|---|---|---|---|
| Class Insights, measure "Practice minutes per class" | `api/groups/[id]/rate-compare.ts` → `insight/NodeRateEngine.vue` (mounted by `NodeInsightsView`, `TeacherInsightsView`, `NodeHomeView`) | inAppTime spans via `diarySessionRows.loadScopedSessionRows` (+ legacy `class_sessions` RPC rows, dead since 2026-08-19) | CLASS only (school node = mean over its classes) | ROLLING 1 / 7 / 30 / 3650 days | RATE: minutes ÷ weeks from first activity to now; ÷7 again under Today | **The defect.** 7d 18.7 > 30d 11.5 because the divisor grows. Becomes a TOTAL. |
| Class Insights, measure "Practice hours" | same file, `hours_total` | same rows | CLASS, sum | ROLLING | TOTAL in hours | Duplicate of the new measure in other units. Retired. |
| Class Insights trend chart | `insight/components/RateTrend.vue`, `insight/widgets/TimeSeries.vue`, `insight/theme.ts` | the measure's per-bucket series | as above | daily / hourly / monthly buckets | per bucket | Spline-smoothed with area fill. Becomes real bars. |
| Classes list, per-row "Time in app" and the header "… min in the app this week" | `api/school/class-practice-7d.ts` `classPlayByClass` → `views/schools/TeacherDashboard.vue` | inAppTime | CLASS only (since #662) | UTC-DAYS | TOTAL | Window rule differs from every other reader. Becomes ROLLING; header label names the scope. |
| Class page header "{n} min in the app this week" | `class-practice-7d` `classPlayByClass` → `views/schools/ClassDetail.vue` | inAppTime | CLASS only | UTC-DAYS | TOTAL | Same window fix. |
| School home stat "Minutes in the app this week" | `class-practice-7d` `rollup.inAppMinutes7d` → `composables/schools/useSchoolPractice7d.ts` → `DashboardView.vue` | inAppTime via `classPractice.inAppTimeSeconds` | CLASS + PUPILS + STAFF | ROLLING 7d | TOTAL | Correct rule; sub-label now names the scope. |
| Node home (org lens) stat "Minutes in the app this week" | `api/groups/[id]/home.ts` `classPractice.inAppMinutes7d` → `views/admin/NodeHomeView.vue` | inAppTime, same helper | school/group node: CLASS + PUPILS + STAFF; class node: CLASS only | ROLLING 7d | TOTAL | Correct rule. |
| Node home stat "Minutes practised" (all time) and the children list's "practised" per school / class | `home.ts` `practiceMinutes`, lens payload `practiceMinutes` → `NodeHomeView.vue`, `components/admin/NodeChildrenList.vue` | `school_summary.total_practice_hours` and `class_student_progress.total_practice_seconds`, both off the `sessions` ledger the class account cannot write | everyone with a sessions row | all time | TOTAL | A second truth. Removed from the surface. |
| Node home student rows spark "{n}m this wk" | `home.ts` `students[].week_minutes` → `NodeChildrenList.vue` | `learner_speaking_opportunities.play_seconds` (audio-played) | one pupil | 7 UTC days | TOTAL | Audio-played, not in-app. Left, named in the gap. |
| Org intel panel: class rows "{n} min", people rows | `api/org/intel.ts` → `insight/OrgIntelPanel.vue` | `inAppSecondsByLearner` | class rows CLASS only; people rows own accounts | ROLLING 7d, last week = fortnight − week | TOTAL | Correct rule. |
| Teacher home "playing as yourself" strip | `class-practice-7d` `callerOwn` → `DashboardView.vue` | inAppTime | the caller's own account | UTC-DAYS | TOTAL | Same window fix. |
| Schools list (govt view) and school tiles "Practice hours" | `api/school/group-summary.ts`, `api/school/roster.ts` → `useSchoolData.ts` → `SchoolsView.vue`, `DashboardView.vue` govt tiles | `school_summary.total_practice_hours` (sessions ledger) | everyone with a sessions row | all time | TOTAL | Second truth, not moved: named in the gap. |
| Students list, class page pupil rows, teachers list "student minutes / own minutes" | `api/school/roster.ts` → `useStudentsData.ts`, `useTeachersData.ts`, `ClassDetail.vue`, `StudentsView.vue`, `TeachersView.vue` | `class_student_progress.total_practice_seconds`, `sessions.duration_seconds` | per pupil / per teacher | all time | TOTAL | Second truth, not moved: named in the gap. |
| Student progress page per-course minutes | `api/school/practice-by-course.ts` (`admin_practice_minutes_by_course` RPC) → `StudentProgressView.vue` | sessions ledger | one pupil | all time | TOTAL | Second truth, not moved. |
| School analytics daily activity | `api/school/daily-activity.ts` → `useAnalyticsData.ts` | `learner_speaking_opportunities.play_seconds` | pupils | per day, 30 days | TOTAL | Not mounted by any view today. |
| SSi-admin Intelligence minutes | `api/intel/minutes.ts` → `views/intel/PulseView.vue` | inAppTime (`diary_play_rows`) | everyone on a course | ROLLING windows | TOTAL and per-person ratio | Correct rule. |
| SSi-admin Users page | `api/admin/users.ts` (`admin_practice_minutes` RPC, fallback `course_enrollments.total_practice_minutes`) → `AdminUsers.vue` | sessions ledger | one person | all time | TOTAL | Out of the school surfaces; named in the gap. |
| Learner's own insights and engaged time | `api/me/insights.ts` (inAppTime), `api/me/engaged-time.ts` (ledger play_seconds) | mixed | self | rolling / all time | TOTAL | insights correct; engaged-time is audio-played, named in the gap. |
| Methodology population hours | `composables/methodology/usePopulationHours.ts` | `course_enrollments.total_practice_minutes` | everyone | all time | TOTAL | Internal methodology page, out of scope. |
