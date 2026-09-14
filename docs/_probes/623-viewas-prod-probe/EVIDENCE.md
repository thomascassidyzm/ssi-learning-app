# View-as cursor-leak: production probe on build 3eaaf1f (job #623)

**Verdict: PASS. No write reached course_enrollments or player_events for either the admin's learner or the persona's learner, during view-as, at Exit, or in the 15 seconds after Exit. The live DB confirms zero rows touched in the probe window.**

## Served build at probe time

```
GET https://saysomethingin.app/version.json
{"buildNumber":"3eaaf1f","buildTime":"2026-09-14T00:25:17.039Z","buildBranch":"main"}
```

## Probe window (UTC)

| | |
|---|---|
| START | 2026-09-14T01:44:19.222Z |
| Exit clicked | ~01:45:44.4Z (navigation to /admin/structure logged 01:45:44.499) |
| Browser closed | ~01:45:59Z (15 s after Exit, three flush intervals) |
| END | 2026-09-14T01:46:04.122Z |
| DB SELECT run at | 2026-09-14T01:46:44.687Z (DB clock) |

Persona: ssi_admin `thomas.cassidy+ssi@gmail.com` (learner `81987d60-0c00-4553-8a36-79f83cdf1774`) viewing as Chepstow school admin `angharadjones` (auth uid `96105179-6598-4f2b-9281-a1d28270581b`, learner `b5fbf097-50e2-4907-9ce0-6bd446b32dff`). Script: `packages/player-vue/e2e/_607-viewas-prod-probe.mjs` as committed on main, unmodified. Flow: /schools/classes under view-as, click class row, open player at /?course=spa_for_eng, press play, 23 s of playback, click the banner Exit, wait 15 s, close.

## Probe's own summary lines (from run.log)

```
START 2026-09-14T01:44:19.222Z BASE https://saysomethingin.app version {"buildNumber":"3eaaf1f","buildTime":"2026-09-14T00:25:17.039Z","buildBranch":"main"}
A classes page: https://saysomethingin.app/schools/classes | banner: 1
A after click: https://saysomethingin.app/schools/classes/82296000-2c57-4d28-adef-38464a50204e
B player url: https://saysomethingin.app/?course=spa_for_eng | viewingAs in sessionStorage: {"key":"user:96105179-6598-4f2b-9281-a1d28270581b","userId":
B clicked play at 640,852
B playing? body has time: 0:03
B player-events requests while viewing-as: 0
B exit button count: 1
B after exit url: https://saysomethingin.app/admin/structure | viewingAs: null
B player-events requests after exit: 0
DB player_events since START for admin+persona learners: []
course_enrollments rows changed since BEFORE (job #618 success = []): []
course_enrollments PATCH/POST requests seen (job #618 success = 0): 0
```

## Raw request log, filtered to course_enrollments and player_events / player-events

Filter: `grep -nE 'course_enrollments|player.events' net.log` over all 951 captured lines (every non-GET request and every /api/ request, plus every non-GET response).

```
(no matches — zero requests to course_enrollments, zero to /api/player-events, zero to rest/v1/player_events)
```

Every non-GET request that DID leave the page during the whole run, for completeness:

```
01:44:20.657 POST /api/access/claim :: 
01:44:20.658 POST /api/auth/claim-account :: 
01:44:20.908 POST <sb>/rest/v1/rpc/get_my_verified_emails :: {}
01:44:20.979 POST <sb>/rest/v1/rpc/get_my_verified_emails :: {}
01:44:56.316 POST /api/access/claim :: 
01:44:56.316 POST /api/auth/claim-account :: 
01:44:56.621 POST <sb>/rest/v1/rpc/get_my_verified_emails :: {}
01:44:56.683 POST <sb>/rest/v1/rpc/get_my_verified_emails :: {}
01:45:05.101 POST <sb>/rest/v1/rpc/get_community_contribution :: {"p_target_lang":"spa"}
01:45:44.680 POST <sb>/rest/v1/rpc/get_my_verified_emails :: {}
```

## Console: the guard doing its work during view-as

These are the app's own read-only guard refusing the cursor writes the player queued while viewing as the persona. They were blocked in the page before any request was made; net.log has no matching request. Nothing is logged after Exit at 01:45:44.

```
01:45:04.585 warning: [view-as] write blocked (read-only while viewing as): POST https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/course_enrollments?on_conflict=learner_id%2Ccourse_id
01:45:04.585 warning: [view-as] write blocked (read-only while viewing as): PATCH https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/course_enrollments?learner_id=eq.81987d60-0c00-4553-8a36-79f83cdf1774&course_id=eq.spa_for_
01:45:04.590 warning: [view-as] write blocked (read-only while viewing as): PATCH https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/course_enrollments?learner_id=eq.81987d60-0c00-4553-8a36-79f83cdf1774&course_id=eq.spa_for_
01:45:04.591 warning: [view-as] write blocked (read-only while viewing as): PATCH https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/course_enrollments?learner_id=eq.81987d60-0c00-4553-8a36-79f83cdf1774&course_id=eq.spa_for_
01:45:20.804 warning: [view-as] write blocked (read-only while viewing as): PATCH https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/course_enrollments?learner_id=eq.81987d60-0c00-4553-8a36-79f83cdf1774&course_id=eq.spa_for_
01:45:32.417 warning: [view-as] write blocked (read-only while viewing as): POST https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/course_enrollments?on_conflict=learner_id%2Ccourse_id
01:45:32.417 warning: [view-as] write blocked (read-only while viewing as): PATCH https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/course_enrollments?learner_id=eq.81987d60-0c00-4553-8a36-79f83cdf1774&course_id=eq.spa_for_
01:45:35.924 warning: [view-as] write blocked (read-only while viewing as): PATCH https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/course_enrollments?learner_id=eq.81987d60-0c00-4553-8a36-79f83cdf1774&course_id=eq.spa_for_
01:45:44.499 NAV https://saysomethingin.app/admin/structure
```

## Live SQL, both learners, after the probe

Run directly against the production Postgres (postgres role) at 01:46:44Z.

```
-- Q1 course_enrollments touched in probe window (start 2026-09-14T01:44:19.222Z) | rows: 0
SQL: SELECT learner_id, course_id, last_completed_lego_id, highest_completed_lego_id, last_practiced_at, updated_at FROM course_enrollments WHERE learner_id = ANY($1) AND (updated_at >= $2 OR last_practiced_at >= $2) ORDER BY updated_at DESC
PARAMS: [["81987d60-0c00-4553-8a36-79f83cdf1774","b5fbf097-50e2-4907-9ce0-6bd446b32dff"],"2026-09-14T01:44:19.222Z"]
RESULT: []
-- Q2 player_events in probe window | rows: 0
SQL: SELECT id, user_id, event_type, occurred_at FROM player_events WHERE user_id = ANY($1::uuid[]) AND occurred_at >= $2 ORDER BY occurred_at
PARAMS: [["81987d60-0c00-4553-8a36-79f83cdf1774","b5fbf097-50e2-4907-9ce0-6bd446b32dff"],"2026-09-14T01:44:19.222Z"]
RESULT: []
-- Q3 most recent course_enrollments touch, any time | rows: 4
SQL: SELECT learner_id, course_id, last_practiced_at, updated_at FROM course_enrollments WHERE learner_id = ANY($1) AND updated_at IS NOT NULL ORDER BY updated_at DESC LIMIT 4
PARAMS: [["81987d60-0c00-4553-8a36-79f83cdf1774","b5fbf097-50e2-4907-9ce0-6bd446b32dff"]]
RESULT: [
 {
  "learner_id": "81987d60-0c00-4553-8a36-79f83cdf1774",
  "course_id": "spa_for_eng",
  "last_practiced_at": "2026-09-13T22:54:18.507Z",
  "updated_at": "2026-09-13T22:54:18.728Z"
 },
 {
  "learner_id": "81987d60-0c00-4553-8a36-79f83cdf1774",
  "course_id": "cym_n_for_eng",
  "last_practiced_at": "2026-09-13T20:50:58.583Z",
  "updated_at": "2026-09-13T20:50:58.724Z"
 },
 {
  "learner_id": "81987d60-0c00-4553-8a36-79f83cdf1774",
  "course_id": "ita_for_eng",
  "last_practiced_at": "2026-09-13T16:18:35.911Z",
  "updated_at": "2026-09-13T16:18:36.066Z"
 },
 {
  "learner_id": "81987d60-0c00-4553-8a36-79f83cdf1774",
  "course_id": "zho_for_eng",
  "last_practiced_at": "2026-09-12T21:39:34.357Z",
  "updated_at": "2026-09-12T21:39:34.435Z"
 }
]
-- Q4 most recent player_events, any time | rows: 3
SQL: SELECT id, user_id, event_type, occurred_at FROM player_events WHERE user_id = ANY($1::uuid[]) ORDER BY occurred_at DESC LIMIT 3
PARAMS: [["81987d60-0c00-4553-8a36-79f83cdf1774","b5fbf097-50e2-4907-9ce0-6bd446b32dff"]]
RESULT: [
 {
  "id": "884705",
  "user_id": "81987d60-0c00-4553-8a36-79f83cdf1774",
  "event_type": "intel_question_opened",
  "occurred_at": "2026-09-14T01:26:07.125Z"
 },
 {
  "id": "884702",
  "user_id": "81987d60-0c00-4553-8a36-79f83cdf1774",
  "event_type": "intel_question_opened",
  "occurred_at": "2026-09-14T01:25:53.879Z"
 },
 {
  "id": "884698",
  "user_id": "81987d60-0c00-4553-8a36-79f83cdf1774",
  "event_type": "intel_question_opened",
  "occurred_at": "2026-09-14T01:25:37.274Z"
 }
]
-- Q5 db clock at query time | rows: 1
SQL: SELECT now() AS db_now
PARAMS: []
RESULT: [
 {
  "db_now": "2026-09-14T01:46:44.687Z"
 }
]
```

Reading Q3: the admin's most recent course_enrollments touch is still `spa_for_eng` at 2026-09-13T22:54:18Z, which is the pre-fix leak stamp #615 found. It was not moved by this run. Reading Q4: the admin's newest player_events are `intel_question_opened` at 01:25 to 01:26Z, eighteen minutes before the probe started, from Tom's own use of the Intelligence page. The persona's learner has no row in either table in the window.

## Verdict

On the served production build 3eaaf1f, the view-as flow that leaked a mid-round cursor onto the admin's own enrolment row on 2026-09-13 no longer writes anything. The player under view-as queued cursor writes and the read-only guard refused them in the page. Exit from view-as then produced no PATCH or POST to course_enrollments and no player_events batch, and a direct SELECT on both tables for both learners over the exact probe window returned zero rows. The pre-fix stamp of 22:54:18Z remains the admin row's last touch, untouched. The leak is closed on production.

Raw artefacts alongside this file: run.log, net.log, console.log, db.json, sql-after.log, five screenshots.
