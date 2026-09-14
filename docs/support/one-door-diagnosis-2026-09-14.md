# In-app support doors, diagnosed from code and the live DB (2026-09-14, job #677)

Read-only pass before any change. Every claim below comes from the code in this tree and one read-only query against the production database, not from earlier docs.

## The doors, one per line

| Door | UI | Who sees it | Writes | Identity on the row | Read by |
|---|---|---|---|---|---|
| Learner sheet | ReportBugSheet.vue, from Account | any learner, guests too | bug_reports, source learner, via /api/report/bug | learner_id and auth uid only. No email, no role, no account code | ssi-bug-report-poster.service, active, posts to the ssi-learning-app room |
| Dashboard modal | ReportBugModal.vue, account menu | teacher, school admin, govt admin | bug_reports, source schools_dashboard | as above, plus context.role and school from the client | same poster |
| Tester widget | TesterFeedback.vue | tester and ssi_admin roles | bug_reports, source tester_widget, since job #652 today. Before today: tester_feedback | as above | same poster. tester_feedback was read by nothing |
| Content flag | ReportIssueButton.vue, in the player | QA mode only, so admins and testers in practice | content_feedback plus a sample_flags upsert, straight from the browser | user_id is the learner id, or a random anon id from localStorage | sample_flags is read by Popty's QA tooling. content_feedback is read by Popty's production API feedback list, which nothing polls. No watcher |
| Admin support thread | SupportChannel, from the dashboard | school admins and govt admins only, ruled 2026-09-10 | support_messages direction in, via /api/support/messages | author_user_id, author_name, and the two-halves envelope. No email on the row | ssi-support-watcher.service, active, draft-only, cards Tom |

Both units are active in cs-workers.slice and read one env file. That is two pollers where Tom asked for one.

## What the tables hold today

| Table | Rows | Last 14 days | Unread |
|---|---|---|---|
| bug_reports | 2 | 2 | 0, both posted, both test probes |
| tester_feedback | 13 | 2 | all 13 carry status new and nobody polls it. The two this week are Aran's scrolling reports. The May row from nba4191 is the Lithuanian belt jump |
| content_feedback | 2111 | 1 | 2110 are Popty's own presentation-author flags, one is a January learner flag. The learner door is effectively unused |
| support_messages inbound | 2 | 2 | both answered in draft-only, both test rows from job #302 |

No real message from a learner or school is sitting unread in the one watched table. The unread real reports are Aran's two in tester_feedback, which the tester widget stopped writing to only this morning, and nba4191's four from April and May.

## What every existing row lacks

No row in any of the five tables carries the signed-in email, the platform or educational role, or the account code. The account code is derived from learners.id by supportIdForLearnerId in packages/core, the same function Settings renders, so it can be stamped server-side at report time with no new lookup. The email is on the verified bearer already, since verifyAuthToken calls getUser, but the route discards everything but the id.

## What the job builds, given the above

1. ReportIssueButton posts through the postbox with source content_flag, keeping the sample_flags upsert Popty reads. Its posts go to the Popty room because a flag is about the course.
2. The postbox stamps account code, email, roles, and school role and id on every row at report time. Guests carry nulls.
3. A service-role view, support_inbox, unions bug_reports with inbound support_messages and, for history, tester_feedback and content_feedback, so "are there any messages" is one query.
4. One watcher on watson-1 replaces the two units. Post lane for every bug_reports source, support lane unchanged for admins. Test senders are stamped but not posted.
