## 2026-09-12 — Listening exercises are fetched FIRST, on both paths: every pod slot's list, metadata and audio before the course (job #379, Tom's ruling)

**Tom's ruling.** "Listening exercises (pods/dialogues, list + sentences + audio) are downloaded FIRST, with priority over the main course clips, so a learner who is unexpectedly offline can always play every listening exercise." And on shape: "there is meant to be no offline MODE as such. The app is always cache-first; download-ahead is simply fetch more of the course ahead. Do not add mode-gated logic; make the fetch-ahead ordering itself put listening exercises first, so whatever amount was fetched, the pods are in it."

**What the order was.** Automatic fetch-ahead (`fillBuffer`): head rounds, then only the pod lap due in the span, then the Layer-1 lap in the span, then the span's cycles; the whole pod corpus was removed from this path on 2026-09-01 by ruling. Deliberate download (`buildOfflineDownloadQueue`): head, then the course with one pod clip woven in every eighth slot, by the same day's "not first, but prioritised" ruling. Neither wrote the pod list and metadata except the deliberate download. So Pod 1 was NOT in Tom's cache after 250 MB and 16,000 clips: the automatic path fetches only the lap due next, and for his account main's scheduler composed none (the #350 defect, still on production), so no pod clip was ever ahead-fetched and no list existed.

**Decision.** One order on both paths, through one pure module (`playback/offlineDownloadOrder.ts`): head rounds, then EVERY pod slot's clips (served pod, method pod, any future slot, with split sentences, explainers, Take-G slices, fine-known glosses and bookends), then Layer-1, then the course. The automatic path reads the pod corpus from the listening snapshot and writes the snapshot first when the device has none, so the Dialogues list exists offline before the first pod clip lands. A snapshot written before the extra slots existed is refreshed once, so it lists every slot. Better: whatever the connection allowed, the pods are in it, list included, for every slot and every course. Simpler: the weave and the "due in span" pod collector are gone; both paths call one builder; no mode gate anywhere. Cheaper: a course's pod corpus is about 100 MB on the largest course and it is fetched once per device; the head rounds stay in front so a cold start still lands on cache. This supersedes the 2026-09-01 rulings on both counts and the boundary test now pins the new order instead of forbidding it.

**Proof.** `offlineDownloadOrder.test.ts` pins head → every pod → course on the deliberate queue (16,000 clips carry the whole measured pod corpus) and head → pods → Layer-1 → span on the automatic order. `progressivePrefetch.boundary.test.ts` asserts `fillBuffer` orders through the shared builder with the tiers in that order and still never reaches the bulk downloader or a course-wide cycle collector. `listeningMetaCache.test.ts` shows a pre-slot snapshot is refreshed once and then left alone. Live proof against the deployed build is in the job report.

## 2026-09-12 — Chinese for English speakers listed no Dialogues in airplane mode: the online boot now writes the listening snapshot when none exists (job #379)

**Tom's report.** Production `5ea385e`, iPhone, airplane mode, clips downloaded: Listening Mode listed no dialogues for Chinese. Online, Pod 1 listed as always. Offline-only.

**What was true, read-only.** Content and code both serve the pod online: `zho_for_eng:pod-1` is live and served, 231 sentences, every clip present, and headless production as Tom's own account lists 22 scenes. Offline, the list reads one seat only, the `ssi-listening-meta` IndexedDB snapshot, and that snapshot had exactly one writer: the deliberate Offline Mode download. The automatic download-ahead warms the pod lap's audio and the course bundle carries pod sentences, but neither writes the snapshot, and the bundle's pod rows carry no scene numbers or speakers, so they cannot build the scene list. Reproduced headless on production: automatic path only, then offline → "Dialogues aren't downloaded yet", 0 scenes; the same device after an Offline Mode download at 2% → 22 scenes offline. Nothing in the 2026-09-11 promotion touched this path; it has read this way since the snapshot existed.

**Decision.** The per-boot stamp lane in `useScriptCache` (the one that already refreshes a stale snapshot) also writes the snapshot when the device has none, through the existing full fetch, in the background. Better: any learner who has booted online carries the Dialogues list and the main-flow pod rows into airplane mode, which is what "play what you have" means. Simpler: one export, one call, no new shape, no reader changes; the Offline Mode download still fetches the audio and is unchanged. Cheaper: metadata only, once per device per course, the same reads the schedulers make on every online boot; the 2026-09-01 ruling against loading a corpus up front is about audio and is untouched. Core offline still says nothing is listenable until its audio is downloaded, which is the existing state for that tab.

**Proof.** `useScriptCache.contentStamp.test.ts` asserts the boot lane calls the new export: red with the call removed, green with it. `listeningMetaCache.test.ts` writes the snapshot through the new export and mounts `useListeningPods` against a failing network: one scene listed, error null, and a second call leaves the entry untouched. Live proof against the deployed build is in the job report.

## 2026-09-12 — zho_for_eng lost every pod dialogue in main flow: the Drill lift was completing cohorts; completion now counts main-flow laps only (job #350)

**Tom's report.** "Chinese in main has no PODS (the dialogues at all now)." Staging. Regression, not a held course.

**What the DB said, read-only.** `zho_for_eng:pod-1` is live, core, on a serving slug, `required_role` null, 231 base sentences, nothing touched since 2026-08-24; the anon-key resolver query returns it exactly as it does for a GREEN course such as fra_for_eng. None of today's Popty commits wrote to `listening_pods` or `listening_pod_sentences`. The bundle route is `previewOnly` for an unauthenticated caller and returns `pods: []` for fra too, so it was not the signal. The detector does not list zho because its only recent learner is internal.

**The cause.** Commit `1fc9676c8` (2026-09-06, "the top of the ladder COMPLETES") made a cohort leave the sequence once `alive` passes the ladder length, and `alive` in the lap composer is `max(derivedAlive, storedLift)`, where `storedLift` is the Listening-mode Drill's shared `learner_pod_state` counter. Tom's learner `81987d60` has 367 zho pod-state rows, all written in one moment on 2026-09-06 13:28, with exposures 96 to 461 on every sentence, against a main-flow ratchet of 45. Under the live pods config the ladder is 37 rounds, so every cohort, including ones the main flow had never debuted, read as completed the moment it was taken in, and `nextLap()` composed nothing. `allCohortsCompleted()` already judged on derived age only, so the fire gate kept claiming boundaries the composer could not fill. Four other learners have rows past 37 on fra, swe, ron and cym_n; they were losing individual cohorts the same way.

**Decision.** Completion is judged on the derived age alone, the laps the main flow has actually served that cohort. The Drill lift still raises the rung a cohort is served at, as far as the top one, and still writes back; it cannot take a cohort out of the sequence. Better: a lap the learner never heard cannot count towards leaving the ladder, which is what "top of the ladder it THEN goes" means. Simpler: one identifier changes, and the composer now agrees with the gate above it. Cheaper: no data write, no migration, nobody's pod state is repaired, per the standing rule never to repair a learner position.

**Proof.** One test in `usePodLapScheduler.test.ts` with exposures 459 to 461 on three sentences and a ratchet of 3: red on the pre-fix source with `nextLap()` returning null, green after with all three sentences served at the top rung. The other 62 scheduler tests stay green. Projected onto Tom's live rows: cohort 1 is genuinely past the ladder at derived age 45 and stays gone; cohorts 9 to 45 return to the sequence.

**Not shared with the Listening-mode auto-advance regression.** `ListeningOverlay.vue` never reads completion; its only link to this code is the exposures counter it writes.

## 2026-09-12 — usePlayerLog: #317's "closed" was "narrowed"; the bound is now stated as a trade-off and lifted wherever the page is safe; a refused beacon no longer drops its batch (job #320)

**What Astra proved about #317 (#319, cold verification on staging build 1ed0496).** Two findings. First, the 800 ms bound was a narrowing, not a close: a bearer that resolves after 800 ms still saw its batch beaconed unattributed, while the commit and the #317 entry below said "the gap is closed, not narrowed". Second, a plain miss independent of any race: `navigator.sendBeacon` returns false when the browser declines to queue the payload, and the code treated that as sent, so the batch was silently dropped with no fetch fallback.

**The floor, named.** A hidden page can be evicted at any moment without firing anything. A batch still held in JS at that moment is gone; a beacon already handed to the browser survives. Waiting longer for the bearer buys attribution and risks the batch; sending sooner secures the batch and loses attribution. No client-only design closes both. The full close is an idempotent re-send the server can dedupe, a client event id with a unique index and an insert-or-attribute path, which is a schema change on a production table for a residual population nobody has yet measured, so it is not built. Better×Simpler×Cheaper today is to spend the wait only where the eviction risk is real.

**Decision: the wait is shaped by eviction risk, not by one number.** `flush(true)` now carries its cause. A player unmount inside a live tab is a route change, not an unload, so it waits for the bearer up to 10 s, a hung-client guard only. A tab that was hidden and has come back to the foreground while the flush was waiting is likewise safe and keeps waiting on the same budget. Only a tab that is hidden and STAYS hidden secures its batch as an unattributed beacon at 800 ms, and a bearer that resolves after that is NOT applied to that batch: that row lands unattributed, by this decision, and the next flush carries the token. 800 ms stays because the only ways Supabase's getSession takes longer are a network refresh of an expired access token or a navigator-lock held by another tab, and an expired token would have been stored unattributed by the server anyway. `SYNC_TOKEN_WAIT_MS` is renamed `HIDDEN_TOKEN_WAIT_MS` so the constant says what it governs.

**Beacon refusal falls through.** A `sendBeacon` that returns false now takes the same keepalive fetch the bearer-carrying path already uses, so the batch is not lost; a beacon that throws already did.

**Proof.** Five tests added to `usePlayerLog.test.ts`, run against the pre-fix source and the fixed one: unmount with a 1200 ms bearer sends attributed (red before, green after); hidden-then-visible with a 1200 ms bearer sends attributed (red, green); unmount with a hung getter sends unattributed after the safe budget rather than never (red, green); refused beacon falls through to fetch with the batch intact (red, green); hidden-and-stays-hidden with a 1200 ms bearer beacons at 800 ms and is not sent twice, green on both because it pins the trade-off rather than a change. #307's and #317's five tests stay green. Typecheck's one red is a pre-existing `HandbookView.showMe.test.ts` tuple error on dev, untouched here.

**Correction to the #317 entry below.** Its sentence "Better: the gap is closed, not narrowed" overstated. Read it as: the gap is narrowed to a hidden-and-stays-hidden tab whose bearer takes longer than 800 ms to resolve, and that residue is a deliberate bounded trade-off, per this entry.

## 2026-09-12 — Option A built: three rows then Show all, Ways In by role, year-group tiles, "phrases practised" (job #306)

Tom's commission, 2026-09-12, answering the #303 review: "phrases practised is better / and build
Option A". Built as reviewed, on the leader home (`/org/:id`, NodeHomeView) and the classes page
(TeacherDashboard). Every section is a template change on data the pages already fetch; no
endpoint, column, store or composable was added.

- **"Phrases practised this week" replaces "phrases spoken this week"** on every leader and
  teacher surface: the stats row, the class practice card, the tree rows, the Insights sentences
  and chart, and the Handbook sentences behind them. Reason, from the #298 verification: the
  `audio_play` event fires as a phrase's turn begins, not on finished audio and not on detected
  speech, so "spoken" overclaimed. Locale keys kept and only the English changed; a key rename
  would have rippled into the pending-translation ledger and 21 locales for no learner-facing
  gain. **Kept:** the learner's own player tile "Phrases spoken", which counts cycles where the
  VAD heard the learner speak and is genuinely speech.
- **Three rows then Show all, one idiom everywhere** (`components/shared/topThree.ts` +
  `ShowAll.vue`): the phrase table, a class's students, the taught-by and led-by names, the
  Below this tree's groups, classes and people, the classes-page table, and the Ways In ledger.
  Under three rows no control renders; nothing is hidden without a way to show it. Per section,
  never sticky; a node switch folds everything again.
- **Ways In folds to one row per role** — "12 class links, none used yet · 1 teacher link, used 2
  times · 1 school leader link, none used yet" — with Copy on a single-link row and Show all
  opening the ledger exactly as it was, chips, Re-mint and Revoke included. The ways-in walk
  gained a click-advance step on Show all so its verb steps still find their anchors.
- **Year-group tiles** under the headline numbers on both pages, from one pure module
  (`views/schools/yearGroup.ts`) and one shared component. Year group is read off the class
  name — a leading 6 to 13, optionally after Year/Yr/Y — and never stored. Unparsed names fall
  into one Other tile; fewer than half parsing falls back to per-class tiles, busiest first,
  three then Show all. Each tile carries phrases practised this week and classes practising out
  of classes in the group, practising by the headline's own rule (last practised inside the
  window). No minutes per year group, as the review left out.

**Taste defaults taken, each overturnable in a word:**
1. **Below this at three**, not the review's eight-then-"N more": the commission said every list,
   and one idiom on the page beats two. Say "eight" and the cap goes back.
2. **The phrase table stays a table** at three rows, not a sentence. Say "sentence".
3. **Year group only**; by-teacher tiles held for a later ruling, as the review offered and Tom
   did not take.
4. **Ways In group labels** read "class links" when every learner link is class-scoped, else
   "learner links"; teacher, school leader and group leader links use the ledger's own role words.
5. **A class page's phrase list folds too**, since it is the same table; its Handbook sentence
   says so.

**Not done, logged:** the classes-page subtitle still sums the rows' own minutes rather than
the endpoint's school rollup, because switching it means the fetch composable returning a
field it drops today, and the commission fenced the fetch after job #301. The review's fourth
health tile "Not this week" and default sort by time in app were not in the commission's steps
and were left alone. Wiring the top-three probe into a nightly timer is recorded in the job
report.

**Proof:** each mechanism has a test seen red on the pre-change code and green after —
`topThree.test.ts`, `yearGroup.test.ts` (the real St Alban's and Chepstow name shapes),
`NodeHomeView.test.ts` (phrase fold, student fold, tree fold flipped from eight to three,
year tiles), `WaysInLedger.grouped.test.ts`, `TeacherDashboard.topThreeYearGroups.test.ts`; the
existing files beside them unchanged and green; walkthrough `--check`, i18n parity, typecheck
and lint green.
## 2026-09-12 — usePlayerLog: the sync flush waits for the bearer instead of racing it; #307's causal sentence corrected (job #317)

**What Astra proved about #307 (#316·G).** The old code did not fill the bearer cache "only on a timed flush": every async flush refreshed it, whether timed, triggered by a ten-event batch or called explicitly. The failing case was any SYNC flush, a tab hide or an unmount, that ran before the first of those had RESOLVED. #307 primed the cache at mount, which started the refresh earlier but left the same window open between prime-start and prime-resolve: a hide inside those milliseconds still beaconed with no bearer. Reproduced red on dev in `usePlayerLog.test.ts` with a token getter that resolves only after the visibilitychange has fired, then green after the fix.

**Decision: hold the sync flush client-side, bounded.** When `flush(true)` finds the cache empty and a getter is configured, it awaits the in-flight `refreshToken()`, deduplicated so one refresh serves both the prime and the flush, under a race against an 800 ms timer, then sends by keepalive fetch with the bearer. A keepalive fetch issued after an awaited promise inside a visibilitychange handler is inside the page's lifetime on the same terms as sendBeacon. A getter that resolves null, a genuine guest, still beacons unattributed. A getter that never settles beacons after the bound, because losing attribution on one batch beats losing the batch. 800 ms was chosen because Supabase's getSession answers from local storage in single-digit milliseconds, so the bound only bites when the auth client hangs, and it stays well inside the time a hidden tab keeps running its handlers. Better: the gap is narrowed to a hidden-and-stays-hidden tab whose bearer takes longer than 800 ms (corrected by job #320 above; "closed" was an overstatement), and a class's first seconds land on its learner row. Simpler: the server is untouched, SEC25 INPUT-04 is not re-opened, no session-corroboration logic moves into the write path. Cheaper: one composable, one constant, three tests, no new endpoint. The server-side alternative, attributing a bearerless batch from `payload.learnerId` only when the same session already holds an attributed row for that learner, stays a documented fallback for the day a browser is found to drop the post-await fetch; none was found.

**#307's Chepstow total corrected.** The "2,294 Chepstow production rows" in #307's entry, report and evidence page was the class accounts of every school in the fleet over the trailing fortnight, mis-scoped, not Chepstow's: Chepstow's class accounts are 1,818 rows, 1,831 counting the boot rows that name a class account only in the payload, and the figure is the same under a fixed 29 August to 12 September window. The env finding stands, the number changes. Script with explicit bounds and rules: `scripts/player-events-chepstow-totals-2026-09-12.cjs`; the 568 dangling `learner_id` rows are characterised read-only in `docs/player-events/dangling-learner-id-census-2026-09-12.md`, recommendation leave them.

## 2026-09-12 — player_events write side: the orphan rows were the first sync flush of a session, the env tag was right, and the schools helpers do NOT filter env (job #307)

**The Astra finding (#305·G).** Nine class-8H rows carried the learner in `payload.learnerId` but a null top-level `learner_id`; all 199 attributed 8H events read `env='production'` while the dashboard helpers filter no environment.

**Orphan rows: suspect (ii), fixed at the client seam.** All nine are boot events, `cold_start` / `bundle_boot_path` / `bundle_tier_heal` / `learning_mode_selection`, and every one is at the head of its session; two of the three sessions never got a single attributed row. `usePlayerLog` filled its bearer cache only on a timed flush, so a tab hidden or a player unmounted inside the first five seconds sent its boot events by `sendBeacon`, which cannot carry a header, and the server attributed nothing, exactly as SEC25 INPUT-04 says it must. The fix primes the cache at mount and re-kicks a refresh after any sync flush that found it empty. The server is not loosened: the unsigned payload is still never an identity. Course-wide the same shape was 904 rows in 30 days, 157 of them with an attributed sibling in the same session.

**Backfill: session corroboration only, 157 rows.** A row was repaired only when `payload.learnerId` exists in `learners.id` AND the same `session_id` already carries an attributed row for that learner. Both dual-write columns were set, in one transaction, with the before-state re-asserted in the UPDATE. That repaired 3 of the nine 8H rows; the other 6 sit in two sessions that never earned an attributed sibling, so they stay unattributed. They are almost certainly the class's, the same teacher's auth uid is stamped on them five seconds either side of an attributed 8H session on the same build, but "almost certainly" is not the rule, and a guest session carrying a stale learner id would look identical. Decision candidate, not done: widen corroboration to same actor plus adjacent attributed session, which would take those 6 and about 100 more of the remaining 747. Script and both logs: `scripts/backfill-player-events-orphan-learner-2026-09-12*`.

**Env tag: the finding was a misread, and the derivation now reads the deployment first.** Staging tagging was already working, 10,965 staging rows in the last fortnight against 94,513 production. The 8H rows read production because 8H practises on production: every Chepstow class-account row in 14 days is production or dev, none staging, and the driving teacher's 208 rows are all production. Even so, `getEnv` now takes `VERCEL_ENV` and `VERCEL_GIT_COMMIT_REF` before the host header, same three values, host as the fallback when the build carries no `VERCEL_ENV`; a build knows which deployment it is and a header does not. No historic env values were touched.

**Helper filter: NO env filter on `inAppTime.ts`, `diarySessionRows.ts`, `classPractice.ts`.** Better: the trial schools practise on production and their leaders, and Tom, read their dashboards on staging, so a per-request env filter would blank every class on the staging dashboard tonight, and a hardcoded `production` would hide a staging-only school when one appears. Simpler: no new parameter through three helpers and their callers. Cheaper: nothing to maintain, and the intel lenses' `production` pin stays where it is because they answer a fleet question, not a school's. Revisit only if staging and production ever stop sharing one database.

## 2026-09-12 — the classes list never shows dots for a failed practice fetch; it says so, with the status, and retries once (job #301)

**Symptom (Tom, 03:14 BST, staging, View-as angharadjones · School leader · Chepstow).** Every one of 34 class rows read Belt White, Journey "…", Time "…", Activity "—", Health "Inactive", and the header "0 min in the app this week", while the school page for the same school read 437 phrases, 20/34 practising, 352 minutes.

**Trace.** The #265 fix IS deployed and DOES fire: with the ssi_admin token, `GET /api/school/class-practice-7d?class_ids=<34>&school_id=<chepstow>` on staging answers 200 in ~0.9 s with all 34 `classAccountByClass` rows and `rollup.inAppMinutes7d = 352`; the served `schools-*.js` chunk carries the `school_id` passthrough; and two headless replays under View-as (a reload with the persona restored, and Tom's exact in-app sequence from the audit log: angharad → leejames → Exit → angharad → Classes) both paint Yellow, 14 / 679, real minutes, 8 Good / 14 Needs eyes. Chepstow's trial runs to 2027-07-16, so the coverage gate is not it. What the dots prove is only this: in Tom's Safari session that one response did not land, and `TeacherDashboard.loadPractice7d` turned it into "…" with no word of why — `fetchClassPractice7d` returned `null` on `!res.ok` / no token, the page `return`ed, and `practiceLoaded` stayed false. The transient cause in his tab (a refreshing token, a cold function, a dropped response) is not reproducible from here and is not knowable after the fact: the page kept no evidence.

**Decision.** A failed practice fetch is loud. `fetchClassPractice7d` never resolves null: it throws `ClassPracticeFetchError` carrying the HTTP status and the server's own message, after ONE retry for the transient kinds (network error, 408, 429, 5xx). The classes page catches it into a banner — "Couldn't load this week's practice for these classes — belts, journeys and minutes are not shown. <message> (HTTP <status>)" — with a Retry button that runs the page's one refresh protocol. Rows stay honestly unloaded ("…") under the banner; "Not started" is still only ever said when the payload said so. The class page (`ClassDetail.vue`) already caught the null path and keeps its behaviour under the throw.

**Not changed, and why.** The list still reads ONLY `classAccountByClass` (Tom's ruling, #265, not re-opened). The coverage gate is untouched: it already admits an active trial. The header total on the classes page sums the rows' own minutes (class account + its pupils), which is a different rule from the school page's `rollup.inAppMinutes7d` (adds staff and pupils' own accounts): 174 vs 352 for Chepstow this week. Both are true numbers with different scopes; whether the classes header should read the rollup is a taste call flagged in the job #301 report, not decided here.

**Proof.** `TeacherDashboard.adminViewPractice.test.ts` gained a test that mounts the page with the practice endpoint answering 403 `coverage_expired` and asserts the banner, its status and message, and the Retry button — red on the pre-fix code (no banner), green after. `classPractice7d.test.ts` covers the throw, the single retry on 5xx, the persisting network error, and the no-session 401.
## 2026-09-12 — leader dashboard design review: top three then show all, sub-tiles by year group, the unfed classes page (job #303·F)

A design review, not a build: no code changed. Tom's brief was that the lists on the school-leader
home page are noise, that each section should show its top three rows with an expand, and that the
headline number tiles want a breakdown into smaller tiles beneath them. The review, with mocks at
phone width in the Mist palette and this week's real numbers for St Alban's and Chepstow, is
published at https://watson-1.tail4968cb.ts.net/d/81ce6c56.

- **Recommended:** Option A, Tom's top-three-then-show-all as drawn, with two grafts: Ways In
  collapses to three GROUPED rows (12 class links none used, 1 teacher link used twice, 1 leader
  link) rather than the first three of fourteen identical rows, and the same year-group sub-tiles
  go on the classes page. Below this keeps its existing eight-class cap and "N more" as the one
  expand idiom on the page. Roughly two builder days, every section a template change on data the
  page already fetches; the one expensive item, minutes per year group, is left out.
- **Sub-tiles:** year group first, derived on screen from the class name (a leading 6 to 13),
  never stored; 12 of 12 St Alban's names and 30 of 34 Chepstow names parse, the rest fall into
  one Other tile, and a school where fewer than half parse falls back to per-class tiles. Teacher
  is the second variable (3 tiles at St Alban's, 39 at Chepstow); course is one tile at both.
- **Finding for a separate job:** the classes page under View-as shows "…" and every health tile
  at 0 while the home page says 20 of 34 practising and 352 minutes. The pages read the same
  records by different doors: the home endpoint resolves the school from the URL, the per-class
  endpoint resolves scope from the caller and needs the persona's school id passed along. The
  admin read-view of the same page at 02:24 today returned 200 with 174 minutes and 8 Good / 14
  Needs eyes, so the data and the rule are fine and the View-as route is what fails. A second
  mismatch rides with it: the classes subtitle's minutes exclude staff and pupil accounts that the
  home headline includes, and the endpoint already returns the home page's figure in a rollup
  field the page ignores.
- **Held, not rejected:** Option C, "what changed since last week" — both schools started on 8
  September, so every row would read "new" this week; revisit from the third week of term.
- **Two taste calls put to Tom:** does the phrase table stay on the home page at three rows or
  become a sentence; year group only for now, or teacher too.
## 2026-09-12 — the Handbook offers the clip where one exists, and support is reachable but unnamed (job #302·F)

**What Tom saw.** "I can't see it anywhere", of in-app support, as a school leader on staging; and "the
How This Works clips don't surface in the handbook". Both audited under View-as as the Chepstow
school admin at phone width, every leader page shot: https://watson-1.tail4968cb.ts.net/d/00e06fd0.
The Handbook coverage table, walk attachment and the gap list by section:
https://watson-1.tail4968cb.ts.net/d/de026b1d.

**Finding: support exists and is two taps from every page, avatar then Support, under Handbook in
the user menu, as job #214 built it.** Tom could not see it because three things stack under
View-as on a phone: the orange View-as banner sits on the top bar and covers the avatar, so the only
door is untappable; the Support page 403s because every request carries the admin's own token and
the support API authorises by the caller's own scope, which is the act-as guard doing its job; and
the word Support appears on no page as landed. The org lens carries Does this look wrong beside the
stats, which is the channel under another name. No door was built here: the verdict list in the
document is for Tom and the dashboard design worker, who owns layout. Two things a cold reader would
take for support are not: the blue bug button is Send Feedback for testers and ssi_admins, and the
banner's Pages list names Support only because it lists every route the account can reach.

**Corrected by Tom the same night: the support channel is the DB-backed message thread, not the
explainer doors.** Signed in for real as Tom's test-scenario admin, Angharad ZZ Test, and posted two
labelled test messages: entry point, compose, posted message and the stats-door sheet are shot at
https://watson-1.tail4968cb.ts.net/d/ff20f840. Both rows sit unanswered because the watcher on
command-surface main, `tools/support/watcher.cjs` from jobs #214 and #220, is not armed: no unit
installed, no env file, no log. Against Tom's three-rule spec, once armed: rule 1, point to the clip,
is unbuilt, nothing in tools/support reads a walk; rule 2, point and show the Handbook entry, is
the design, quoting the entry's sentences with a link; rule 3, answer and build a clip, answers in
draft-only and only counts gaps toward a clip threshold of three askers, building nothing by
design. View-as can never verify support: the banner covers the avatar menu and the API refuses
the admin's own token. Reported, not built.

**Decision: an entry that names a walk offers it, with the How this works wording.** `HandbookView.vue`
now renders a Show me button beside Take me there wherever the pack names a walk for the reader's own
persona, the same persona rule the How this works panel applies, because a walk steps real anchors.
Read from the code and confirmed on staging: before this, zero of the eleven walk-bearing entries
surfaced their clip on the Handbook, though every one was offered on the page it lives on.

**Decision: the Handbook defers the walk; the page it lives on starts it.** A walk cannot run on the
Handbook page, its anchors are elsewhere, and the overlay ends a walk on any route change, so
starting after navigation is a race. `useWalkthrough` gains `deferWalk` and `claimDeferredWalk`: the
tap records the walk and goes to the walk's place, and the first `HowThisWorks` or `WalkOffer` mount
whose persona × place × kind offers it claims and starts it on real anchors. A mount that does not
offer it leaves it waiting, so the class list on the way to a class page does not lose it; a tap older
than ten minutes starts nothing. Never-auto-play holds: only a tap ever puts a walk in that queue.
Proven by `HandbookView.showMe.test.ts`, red on the pre-fix sources and green after, and
`deferredWalk.test.ts`; `compile.mjs --check` green, 18 walks, 103 entries.

**Not done, deliberately.** No walk JSON for the 92 entries without a clip: the gap list is the
deliverable, ranked by section for Tom to pick from. No HANDBOOK comment rewritten, so no reconfirm
was needed. One attachment gap is Tom's word, not a worker's: invite-first-teacher, the school-admin
walk at a school node, is attached to no entry because Bring your first person in names
invite-first-person. And two View-as facts worth one line each if Tom wants View-as to show what a
leader sees: the #286 door on /schools/classes/:id is gated on isAdminView, which View-as sets, and
the banner covers the avatar menu on a phone.

**Landed (job #308·F, 2026-09-12):** merged to dev and promoted to staging on Tom's word, "yes to both";
the Show me button verified live on staging.saysomethingin.app/schools/handbook. The support watcher
was armed the same night, draft-only, ceiling sonnet, as a systemd user service on watson-1
(command-surface docs/DECISIONS.md, same date).

## 2026-09-12 — support_messages is column-granted, and the govt_admin subtree is parent_id in SQL too (job #300)

Two live security gaps, found by job #297's audit and confirmed against the real database by job
#299, closed by canary-applied migrations. Neither leaked anything: the support table held zero
messages, and no govt_admin sat on one of the three duplicate root paths (`my-school` x8,
`rogiet-primary-school` x2, `ysgol-gyfun-tredegar` x2).

- **support_messages (20260912a).** `authenticated` had a table-level SELECT, so PostgREST would have
  served envelope, draft_reply, escalation_evidence, move_reason, model_ladder and the asker's auth
  uid to any school admin whose row test passed — the handlers' `MESSAGE_VIEW_COLUMNS` projection
  is TypeScript and narrows nothing in Postgres. Now a COLUMN grant of exactly that projection plus
  `thread_id` (the filter key). Chosen over a view because no browser code reads this table at all
  today — both handlers and the doorbell cron use the service key — so a view is a second object to
  keep in step for a reader that does not exist, and a column grant leaves every future column
  unreadable by default. Consequence: `select=*` as `authenticated` is now "permission denied"; a
  caller names its columns. A test pins the grant list to the constant so the two cannot drift.
- **is_govt_admin_over_group() (20260912b).** The predicate behind four live SELECT policies
  (schools, classes, support_threads, support_messages) compared `groups.path` strings, and `path`
  is the slugged NAME with nothing making it unique. TENANCY-02/04/05 fixed this in TypeScript on
  2026-08-25 and stopped at the language boundary. The SQL now walks `parent_id` UP from the target
  (a single chain, depth-capped at 32; the live forest is 3 deep) and asks whether any ancestor is
  a group the caller governs. Same signature, definer, search_path and ACL.
- **Canary proof, one transaction, live:** both defects reproduced on the old definitions (a school
  admin read `draft_reply`; an admin of root org A was "over" same-slug root org B and saw its
  school), both closed after, the six sensitive columns each answer permission denied, the app's
  columns still read the row, a stranger still sees no rows, and every one of the 42 real
  govt_admins plus the real school admin sees an identical set of groups / schools / classes /
  threads / messages before and after. 32/32, then COMMIT and `NOTIFY pgrst`.
- **Not done, deliberately:** duplicate root-org slugs are still permitted (`confirm_duplicate` in
  `groupSlug.ts`). With no row policy reading `path` any more, a duplicate is cosmetic at the DB
  boundary, so a unique constraint would only block legitimate same-name orgs for nothing. The
  one remaining `path LIKE` reader is the CLIENT's govt-admin class lookup in
  `useClassesData.ts` (line ~250), which lists subtree group ids by path prefix before querying
  classes; the classes read itself is now gated by the fixed predicate, so it can over-ask but not
  over-read. Repointing it at a server endpoint is a separate follow-up.
- **schema.sql** re-snapshotted from live with pg_dump 18; the diff also catches up several earlier
  applied changes (org_enrolments RPCs, narrowed classes grants) the previous snapshot had missed.

## 2026-09-11 — a class row is the class account's own progress; per-pupil framing leaves the class list and the class page (job #265, Tom's ruling)

Tom, on the Chepstow classes list under View-as: every one of 34 cards read Students 0, Belt White,
Avg seeds 0, a flat line, Inactive — while the 8H class page read 53 phrases and 24 minutes this
week. His ruling: "each class row shows the class's progress read from the play-as-class learner
account, obviously"; a per-pupil student count on a class is meaningless because a class IS one
learner account; where the account has never played, say "not started" in words, never zeros;
minutes per week, never hours.

- **One source.** `/api/school/class-practice-7d` now carries `classAccountByClass` — started,
  journey in LEGOs (the same chain the class node home uses: enrollment ceiling → last completed →
  `classes.last_lego_id`, as an ordinal via the shared `legoOrdinal`), the seed the class has reached
  for its belt, the cursor stamp, phrases this week and the class account's own in-app minutes per
  UTC day for the sparkline. The list reads only that; `class_sessions` (dead since 2026-08-19) and
  `class_student_progress` averages no longer drive any cell.
- **Gone from the list:** the Students column, the Students sort, "Avg seeds". **In:** "Journey,
  LEGOs" as done / total, sortable. Header line: "34 classes across School · 352 min in the app
  this week". A never-played account reads **Not started** in the belt, journey, time and health
  cells and shows no sparkline.
- **Gone from the class page:** the Students stat tile (now "LEGOs travelled together"), the
  "Students average N LEGOs on their own" sentence, the Belt distribution card and the Practice
  min/student/week card, with their Handbook entries. The student roster section stays — it is the
  invite target, and "No students in this class yet" is words, not a zero.
- **Verified live for Chepstow (query in the job report):** 34 class accounts, 30 with diary
  events, 4 never played (11E, 11H, 8S, "Rachel Tiller Cleaves Personal"); no account carries a
  `highest_completed_lego_id`, so the journey comes off `last_completed_lego_id` / `last_lego_id`.
  35 of 39 staff accounts have played as themselves — reported, not moved.

## 2026-09-11 — practice is MINUTES on every school surface, and the school headline is this week's in-app minutes, the number the admin reads (job #265)

Tom on staging: "why the fucking hell are they all showing 0h progress. Why the fuck is hours a thing
anyway? How many TIMES do I have to tell you guys to get the damn data displaying properly." Two
faults, both closed:

- **Hours are not a unit.** One formatter, `composables/schools/practiceMinutes.ts` — "352 min",
  nothing else, no "h m", no "1.2h". The DB views still carry hours; `useSchoolData` converts at its
  boundary, `roster.ts` returns minutes, `groups/[id]/home.ts` sends `practiceMinutes` beside the
  hour fields it keeps for older readers. Eleven locale keys named for hours were deleted from all
  25 locale files and fourteen minutes keys minted in English, enrolled in `pending-translation.json`.
- **The school dashboard headline changed SOURCE, not just unit.** It read all-time hours off
  `school_summary`, while the admin's node home read minutes in the app this week off the
  class-practice spine — two different measures of one school, never able to agree, and the school
  one rounding to "0h". The dashboard now reads `/api/school/class-practice-7d`'s new `rollup`,
  computed by the same helpers and rule as the admin page: minutes in the app this week and "X of Y
  classes practising this week". Not loaded → a dash and a sentence, never a zero.
- **Role-only View-as for a school role no longer exists.** It sent no userId, so no scope loaded and
  every count painted 0 as if real — a silent lie. The role buttons now pick the most recently active
  real person of that role (`/api/admin/users?role=`), whose real school then loads; a learner stays
  role-only because a learner has no school scope to fake. Chosen over an explicit "no school
  selected" state on every stat because it deletes a whole state instead of adding one to every page.
- **The admin's empty scope is passed around, not widened.** Under View-as every fetch runs as the
  ssi_admin, whose `resolveVisibleScope` is empty. `class-practice-7d` takes `?school_id=` for that
  caller only, behind `verifyAdmin`; a staff caller's own scope is never widened by the parameter.
  Same shape as `group-summary.ts`'s `?groupId=` passthrough.

Proof: `DashboardView.minutesHeadline.test.ts` mounts the real SFC and is red on the pre-#265 code
(no minutes headline, "6m" from a 0.1h row) and green after; `class-practice-7d.test.ts` pins the
rollup composition and the passthrough's refusal of a non-admin.

## 2026-09-11 — The in-app support channel for school and org admins is built, reconciled to Tom's two rulings (job #214, branch cs/214-build-the-in-app-support-channel)

Spec `/d/8e1fce9d` §14, built as written except where Tom's two later rulings changed it: **admins
only** ("not individual teachers — a bridge too far at the moment", 2026-09-10 21:55Z) and **DB
writes as turn-taking and as surfacing data points for the handbook page**. The transport is the
database: her question is a row through `POST /api/support/messages`, the answer is a row the
watcher on watson-1 writes back, and there is no reply-in endpoint. Decisions taken where the spec
was silent or ambiguous, each overturnable in a word:

- **Support sits directly under Handbook in the user menu.** The commission doubted the Handbook
  entry existed in `SchoolsTopBar.vue`; it does, at the top of the menu, so the spec's placement
  stands. Shown only to `isSchoolAdmin || isGovtAdmin`; the routes refuse a teacher with 403.
- **The Handbook data points are a third signal key, not a page.** Every answer row records
  `handbook_anchors` and `handbook_hit`; a how-to the pack could not answer mints
  `handbook-gap:<anchor-or-topic>` on `support_signals`, so the count of what people have to ask
  about accumulates by itself and is readable from the table. The admin-facing half is the quiet
  question mark beside the stats row and the class-practice card, reading the compiled sentence by
  anchor. No authoring tool, no editor, no second corpus (§15).
- **The endpoint does not call the agent inline.** §14 item 6 says "calls the agent, writes the
  agent's reply, returns both"; the reconciled architecture has the agent on watson-1, so the route
  writes her row and the watcher takes the turn seconds later. Simpler: one agent, one place, and
  the app never holds a model key. The thread view polls every 15s while visible, and on focus.
- **A thread is keyed by school OR by group.** `support_threads.school_id` / `group_id`, exactly one
  set, so an org leader has a thread of their own without pretending to be a school.
- **Three columns the sketch did not have:** `draft_reply` on the question (the card's draft, so
  `yes` is one INSERT with no retyping), `last_read_at` on the thread (the unread dot and the
  doorbell key on it), `escalation_resolved_at` (what turns "Waiting on Tom since …" off).
- **Population counts OTHER schools**, the caller's own excluded, so the integer reads as the
  sentence the agent says.
- **The doorbell is a Vercel cron, not the watcher.** `api/cron/support-doorbell.ts`, hourly at
  :20 — the Resend key already lives in Vercel and nowhere on watson-1. Rings once per reply,
  after three hours unopened, to the admin who asked, in the thread's language.
- **Tom's one word maps to one flag on one script.** `tools/support/reply.cjs --message <id>`
  with `--yes` (the draft, in his name), `--body "…"` (verbatim, in his name) or `--no` (SSi says
  a person is looking). Author stamps are author-stamp.js's vocabulary: human · Tom · login-header.
- **The estate side lives on a command-surface branch made in a git worktree**, never on the live
  checkout that the running surface reads from. `cs/214-support-channel-watcher`, not merged.
- **The watcher is written and not armed.** `ops/ssi-support-watcher.service` is not installed;
  the file says what arming takes. `SUPPORT_PACK_PATH` must point at a `dev` checkout with the
  handbook compiled — the shared checkout's pack had no handbook section on 2026-09-11, and the
  loader now says so out loud rather than answering every how-to with "I don't know" quietly.
- **The migration is unapplied.** `supabase/migrations/20260911_support_channel.sql`; the three
  tables are declared by hand in `schema.sql` so the snapshot gate stays honest until it is.

## 2026-09-10 — The layer-1 voice order is settled: v2 third, not last (job #74, branch cs/74-glossary-voice-order-ruling)

Tom ruled on the one open question the vocabulary glossary was carrying. Asked whether the code was
right or whether target voice 2 should come last, he answered: *"this order is fine: The voice
ordering inside drill — code plays target v1, known, target v2, target v1. You'd said v2 last."* His
earlier stated order, with v2 last, is withdrawn by him. The code was already correct and does not
change.

- **The ruling settles the pattern everywhere, not just in drill.** The question was put about
  drill; the constant is `DEFAULT_LISTENING_PATTERN` at `listeningExposureRamp.ts:84`, which is one
  pattern, mode-agnostic and layer-agnostic — layer 1 maps it onto a seed's two recorded voices,
  layer 2 onto a pod sentence's target and translation clips. So the entry it closes is
  `LAYER-1 SEEDS PLAY t k t t ALWAYS` in `tools/vocabulary-pointers.json`, now `clean`, carrying his
  words rather than a summary of them.
- **The dead `seedPlaylist` DB row was aligned rather than left holding the rejected order.**
  `algorithm_config['listening'].seedPlaylist` held `['t1','known','t1','t2']` — the withdrawn
  order. It is dead on the learner path: `LearningPlayer.vue:4421` always supplies a
  `listeningPolicy`, so neither ternary at `useLayer1Scheduler.ts:819` or `:881` takes the
  `c.seedPlaylist` arm for a real learner. Dead is not unreachable, though: the field stays
  admin-editable on the Listening config page, so a value Tom has just rejected sitting there is a
  landmine for the next admin. It was written to `['t1','known','t2','t1']` and read back. Zero
  effect on what any learner hears, by definition of the arm never being taken.
- **Two pointers added, no prose about behaviour.** The second live ternary at `:881` and the
  config read at `LearningPlayer.vue:4392` were unpointed; they are pointers now. 63 pointers across
  17 terms, all resolving.

## 2026-09-08 — The 30-day grace: a family member's cover outlives the plan name (job #402)

Tom's ruling, superseding #376·F **D8** ("no grace discount, the end-of-period window is the
grace"). His family identity model of 01:50 that morning says the opposite and it wins: *full
access continues to the end of the paid period, plus 30 days, applied to every member
individually*. #397·F had found the build honouring the older rule — the moment the renewal webhook
wrote `plan_name = 'SSi Premium'`, `familyAccess.ts` stopped returning the owner's row for every
member, with no tail at all.

- **The cutoff is derived from one date already on the row, not stored a second time.**
  `scheduled_plan_at` is the end of the paid Family period, written by `change-plan` when the owner
  confirms. The webhook now clears only `scheduled_plan_NAME` when it applies the change and
  **keeps the date**, so after the flip that column reads as "when Family cover ended".
  `api/_utils/familyGrace.ts` adds the 30 days — once, in one function. The alternative, a second
  `family_ended_at` column, would have been a second date to keep in step with the first for no new
  information; the alternative of inferring the date from the new billing period would have been
  wrong for an annual plan and for any missed webhook.
- **`scheduled_plan_name` alone now says whether a change is pending.** Every existing test of
  "is something scheduled?" already read the name, so nothing had to change — but it is now the
  rule rather than a coincidence, and the column comments say so.
- **The resolver stopped filtering on the plan name and started reading it.** The `.eq('plan_name',
  'SSi Family')` predicate WAS the cliff. The owner's row is fetched on `status = 'active'`, and
  the plan name decides which branch runs: live family, or the grace tail.
- **One computed date, everywhere.** `resolveEffectiveSubscription` returns `coverEndsAt` and
  everything downstream states that: `/api/subscription`'s `familyEndsAt` for a member,
  `familyCoverEndsAt` for the owner before and after they confirm, `/api/family`'s two dates
  (`planChangesAt` and `familyEndsAt`), the confirm dialog, the family page and the member email.
  Nothing but `familyGrace.ts` adds days to anything.
- **A cancellation gets no grace, deliberately.** A downgrade leaves the owner paying and displaces
  other people; a cancellation ends everything for everybody at the paid period, and there is
  nobody left paying to hang a tail on. The family page says so in its own sentence rather than
  borrowing the downgrade's.

## 2026-09-08 — Family to Premium: built as designed, and the calls the build had to make (job #383·F)

Built from the #376·F record (D1–D9) on fable, as Tom asked: "Fable needs to execute it as well - it's
a payment related issue". Part One, the removed-child sign-in-link fix, landed on `dev` on its own
first (`f6d82c41`, merged at `61e0cefb`). Part Two is the downgrade: two columns, `change-plan`
accepting `premium`, the webhook filing plan changes off the billed price in both directions, the
confirm screen, the member email and `familyEndsAt`. D1–D9 were not reopened. These are the calls
the design left to the build, each decided by the tie-break (works first time for the displaced
member or the child; then better × simpler × cheaper; membership is access, progress is theirs).

- **A displaced member's checkout route.** The checkout front door (`routeForPlan`) sent anyone
  who counts as subscribed to the already-subscribed notice — and a family member counts as
  subscribed through the owner's row. That dead-ended the one person D6/D8 exist for. A member
  whose `familyEndsAt` is set now routes to `buy`; their own row, once bought, resolves first.
  Members whose cover is not ending are still blocked, as before.
- **`familyEndsAt` covers a cancellation too.** The field the member banner reads is the owner's
  scheduled change when there is one, else the owner's cancellation date. One field, one banner;
  the member is told either way and the cost is nil.
- **`plan_id` is held with `plan_name` during the window.** Nothing reads `plan_id` for
  entitlement, and a row saying Family by name but Premium by price id is a trap for the next
  reader. Both flip together at the renewal.
- **The price-first webhook path is scoped to the two tiers a Family subscription moves between.**
  A premium-tier price is also the tutor and school platform unit; those rows are never Family and
  keep their handlers and side effects. A Premium-priced event on a row that is not Family and holds
  no schedule falls through to the ordinary path.
- **Schedule first, Paddle second, and undo on refusal.** The columns are written before Paddle's
  price moves, so the `subscription.updated` that follows within seconds finds the schedule and
  holds. If Paddle refuses, the columns are cleared and the request fails; nothing has changed.
  "Keep Family" runs the other way round, Paddle first, so a refusal leaves row and price agreeing.
- **The member email's address.** The address the member joined on (`invited_email`, which the
  claim path leaves on the row), else the first of the learner's verified emails. No address, no
  mail, logged. Best-effort, never fails the change.
- **Premium price ids on the server** come from `VITE_PADDLE_TEACHER_PRICE_*` with the in-repo
  ids as fallback — the same two sources `PRICE_CATALOG` and `lib/paddle.ts` already agree on.
- **Copy.** No parentheses anywhere; "Lewis · child" is a tag, not a bracket. The child line says
  "their", not "his".

**Shakedown, live, 2026-09-08 09:41 UTC, on `sub_01m1z3z0k2b6htg77tctxwa5ty` only, `do_not_bill`
only.** Swapped to the Premium price and back through the Paddle API. Both updates applied at once;
`next_billed_at` and `current_billing_period` did not move; no transaction was created (the only
one on the subscription is still the original £25). `subscription.updated` fired within seconds
with `custom_data.kind` still `family_plan` and the billing period unchanged — the exact shape the
hold path reads. The deployed webhook, still on the old code, REJECTED the Premium-priced event and
left the row untouched, as #376·F predicted; the revert event converged it. Gap closed: the payload
after a price swap. Still open: whether Paddle sends the customer an email on a `do_not_bill` swap
(Tom's `+family_002` inbox knows), and whether a prorated downgrade credits the balance (never run,
by rule).

**The one thing that must be true before 7 October.** Paddle notifies exactly one active
destination, and it is `staging.saysomethingin.app/api/teacher/paddle-webhook` (read from the live
notification settings, 2026-09-08). A downgrade scheduled from any deployment moves Paddle's price
at once; the flip at renewal is done by whichever webhook receives the renewal. Until the webhook
change is promoted `dev → staging`, a scheduled downgrade would renew at £15 and leave the row
frozen at Family with a stale period end — the very failure this job removes. "Keep Family"
reverts cleanly at any point.
## 2026-09-08 — a shared tenant is DERIVED from who lives on the domain, never listed (#385)

Tom's commission, off the #375 write-up: close the hole where the first school to sign up on a
national email tenant — hwbcymru.net, every school in Wales — claims it, and its teacher link then
vouches for any Hwb address in the country with no code and no mail. His constraint: **a hardcoded
list of shared tenants is refused**; derive it from the live data the way the backfill did, once, so
the creation path and the backfill agree by construction. Ordering: a legitimate Welsh school must
still get set up without emailing support; correctness is the second function of the same design.

**The rule.** A domain is a SHARED TENANT for school S when another school, outside S's group, has
its FOUNDING ADMIN living at that domain or beneath it. One async derivation in
`api/_utils/schoolDomain.ts` — learner_emails (kept in step with auth by triggers) joined to
`schools.admin_user_id` — and both sides call it: the creation path at claim time and at every
arrival, and `tools/backfill-school-identity-claims.mjs`, whose own admin-loop test is deleted.

**Three moments, one derivation.** CLAIM refuses `shared_tenant` when another household already
lives there. ARRIVAL suppresses a domain row whose domain has since become shared — re-derived every
time, never deleted, so accounts already born verified under it are untouched; suppression IS the
un-claim and no delete path exists. DOOR names only an effective holder: the second head on a tenant
is told who signed up first and carries on in one tap; the third sees nothing, because by then the
domain belongs to nobody.

**Better × simpler × cheaper.** Better: the hole closes the instant a second school proves an
address on a tenant, and no legitimate school is ever stopped — a refused claim degrades to today's
off-domain path. Simpler: no table, no column, no list, no migration; one function replaces the
backfill's N-lookup loop. Cheaper: three indexed PostgREST reads per claim or arrival, and nothing to
maintain when the next national tenant appears.

**The floor, stated rather than papered over.** The FIRST school on a fresh tenant is
indistinguishable from a school on its own domain — no evidence exists yet — so it claims, and its
link vouches for that domain until a second school proves an address there. Without a list or an
outside oracle the live data cannot know sooner. The window is bounded by the contest rule in
`unclaimedMint.ts`, which stays armed, and it shrinks to zero the moment the second Welsh school
signs up. Teachers who joined OTHER schools off-domain are deliberately not counted as evidence: an
off-domain arrival is the unproved shape, and counting it would let a leaked link switch a real
school's one-tap off.

**Proven on the live data, read-only.** Residents of hwbcymru.net are the four Welsh schools; of
chepstowschool.net, Chepstow alone; of schoolsedu.org.uk, two schools beneath it, so the parent can
never be claimed either. The door names nobody for an Hwb address and names Chepstow for a Chepstow
one. The repointed backfill's dry run reproduces the #375 distribution exactly — 42 schools, 6
already claimed, 24 public mail, 10 shared tenant, 2 with no admin — with zero writes and the claims
table unchanged at 6 rows.

## 2026-09-06 — a stale characterization is the test's bug, not the code's (#912)

The 2026-09-05 security audit (cs/551 and its 552-555 family) was merged into dev by the #900 sweep,
went red on eight tests, and was reverted whole (20dcce04) rather than guessed at. Reconciled here.

**The rule this settles.** A characterization test pins TODAY's behaviour so it goes red when the
behaviour changes — going red is the design, not a defect, and the correct response is to read WHY.
Where dev had since FIXED the very finding the characterization documented, the test is what moves:
it is rewritten as a secure-assertion of the shipped fix, so it now guards the fix instead of the
bug. Reverting a shipped security fix to make an older test green would be the exact inversion.

**What the eight reds actually were.** Six were characterizations of two findings dev had already
closed: A-02 account pre-hijacking (fixed by #557's `shellClaim` invite-binding) and A-01
staff-signin-link containment (fixed by #565's `schoolReachOf` union). Two were machinery going
stale as the file set changed — the pinned `*.security.test.ts` roster, and a literal-string
assertion on `vitest.api.config.ts`'s `include` that dev had widened. None of the eight was a
finding dev is still missing.

**The one residual.** A-03: `staff_access_codes` exists in production and is now recorded in
`supabase/schema.sql` with RLS on and a `service_role`-only grant (regenerated in `a7384811`), but
NO migration file creates it. The repo cannot build the table from scratch. That half of the finding
is still open and is left pinned by its test rather than papered over.

**Also landed:** cs/595's school-authority agreement tests, hand-merged against the schoolReachOf
suite they collided with, carrying a genuinely new finding — `ensureSchoolAdminTag` treated `23505`
as proof of a grant, when the live constraint has no `WHERE removed_at IS NULL`, so a revoked tag
holds the key and re-granting admin to a removed person silently did nothing. It now fails loudly,
which turns `code/redeem`'s school_admin_join branch from a silent 200 into a 500 in that case.

## 2026-09-05 — pod delivery is a work DEBT, not a position schedule (#646 → #649)

Tom ruled yes to both of #646's questions: switch the cadence, and keep Welsh North/South and the
no-pod courses HELD with the detector's RED standing loud rather than muted.

**The rule.** One monotonic per-enrollment counter, `course_enrollments.rounds_since_pod`,
incremented on EVERY completed round — replays, easy-mode rounds, revival-tail rounds. At any clean
round boundary where the debt has reached `pods.roundInterval` (5) and a lap can compose, the pod
fires; lap COMPLETION resets it to 0. Skip, failure, offline-incomplete and composed-nothing all
leave the debt standing.

**Why the axis changed.** The shipped rule was `(mainRound − activation) % 5 === 0` — five rounds of
POSITION. Beuno did 33 round-completions in a month while his position crawled from round 10 to 14
(replays after breaks, easy mode, short sessions), crossed no boundary, and received no pod at all.
Position is a proxy for work; work is the thing. The constant 5 is unchanged. Measured on his real
shape in a unit test: 0 fires under modulus, 6 under debt.

**What was deleted, not left inert.** `usePodActivation.ts` (the returning-learner pin) and its call
site, the 2026-05-20 `POD_ACTIVATION_CAP` hotfix and `DEFAULT_POD_ACTIVATION`, the
`podActivationRound` ref and every read/write of `pod_activation_round` in the runtime path, and the
INF-PLAY revival-ordinal special case in `podCadenceFiresAtRound` (revival rounds are work like any
other now, so one rule covers both). Two interacting cadence mechanisms, one silently winning, was
the named failure mode. The DB column stays — dropping a production column is not additive — but
nothing reads or writes it.

**Preview, the one genuine wrinkle.** `sectorMerge` and the span audio pre-warm take
`shouldFireLapAt` as a pure `(totalRound) => boolean`, and a debt is not a pure function of round
number. Settled as: the live fire decision uses a new `isLapDue()`, and `shouldFireLapAt` survives as
a PREVIEW-ONLY forward projection of the current debt from its anchor. `sectorMerge`'s ratified
rules are untouched.

**Migration.** 1,464 enrollments with real completed rounds seeded to 5 (owed a lap at their next
clean boundary); 300 brand-new left at 0. Seeded to the threshold, not to a computed backlog: the
counter resets on completion and only ever needs to reach 5, so a bigger seed buys nothing and risks
exactly the avalanche the 2026-05-20 cap was fighting.

**The detector stands.** `scripts/pod-delivery-detector.mjs` runs nightly at 06:20 Europe/London
(`ops/systemd/ssi-pod-delivery.{service,timer}`), `--days 7 --notice`, from its own worktree pinned
to origin/dev. After the change it reports the same 9 RED / 2 AMBER / 13 GREEN as before —
`cym_n_for_eng` RED no-servable-pod, `por_br`/`ukr`/`tur`/`isl` RED zero-delivery — which is the
point: the content did not change, so a GREEN there would have meant a broken detector, not fixed
courses. Held pods stay held and stay loud.

Revert: one commit — `git revert fbc66978` (the rule) plus, if wanted,
`ALTER TABLE public.course_enrollments DROP COLUMN rounds_since_pod;`. Nothing else depends on it.


## 2026-09-05 — promoted dev to production (ssi-learning-app)

Tom ruled GO in 環 RBF ("yes to dev / yes to promotion"). Shipped `2e3f43e4` → `71b5dbc0`
(66 commits, 235 files, +9,936/−1,132), then `df39befb` correcting the release notes.

**Census taken at the merged union, not on dev.** `git merge --no-ff origin/dev` onto
`origin/main` produced a tree byte-identical to dev (`git diff origin/dev HEAD` empty), so the
union carried no merge-only interaction. Green at that union: `@ssi/core` build, `vue-tsc`,
player-vue vitest (3114 pass / 0 fail), eslint (0 errors, 166 pre-existing warnings), API
typecheck, API vitest (1758 pass), i18n parity (127 pass), the bare-English passthrough gate
(exit 0; 25 non-fatal Latin-script warnings, nearly all loanwords), release-train (30) and
worktree-deps (7).

**Payers proved against real state, not asserted.** Before and after, live Supabase read-only:
entitlement_grants 2/2 active/2 paid, user_entitlements 95, subscriptions 16/4 active, and the
same five entitlement rows and four active subscriptions identical either side.

**Verified live in a real browser at 390×844**, not by assertion: the Settings build stamp read
`df39bef · 5 Sept 2026, 16:02` off the page (branch correctly suppressed on main), the play probe
returned `healthy` with the session clock advancing 0:00→0:35, 172 audio fetches, zero JS errors
and 7× 200 telemetry POSTs, and belt taps landed rather than going silent.

**One defect found and fixed in flight.** The notes finaliser is line-based, so hand-edited
wrapped bullets were truncated mid-sentence, and the What's New panel has no markdown renderer,
so `**bold**` showed as literal asterisks to learners. Corrected in `df39befb` and back-merged to
staging and dev. The generator itself still has both limitations — a future ship must write
one-line, markup-free bullets.

Revert: `git revert -m 1 71b5dbc0 && git push origin main`

## 2026-09-05 — release notes: constrain the generator, don't teach the panel markdown

The Settings "What's new" panel and the release-train finaliser each held their own copy of the
same bullet regex, so a wrapped bullet was truncated mid-sentence twice over and `**bold**` reached
learners as literal asterisks. The fork was: render the markup, or constrain what may be emitted.

**Constrain.** Rendering means a `v-html` sink on a learner-facing production page fed by a
hand-authored Supabase row — a sanitisation surface bought for the sake of bold text. Constraining
deletes a problem instead of adding one, and a constraint that FAILS the promotion is stronger than
a renderer that silently does its best.

Both sides now import `tools/release-train/notes-bullets.mjs` — one definition of "a bullet"
(joining wrapped lines) and one predicate naming markup the panel cannot render. `--finalize`
throws on a violation; `AdminReleaseNotes` refuses to save one.

**The word that reverts it:** render. If bold in the notes ever earns its keep, the change is to
give the panel a markdown renderer plus a sanitiser, drop `assertRenderable` from the finalise
path, and keep the shared extractor — the joining half of the module survives either way.

## 2026-09-06 — the base checkout goes back on `dev`, and the outstanding work goes to staging

`/home/tomcassidy/ssi-learning-app` — the checkout the deploy sentinel runs out of AND the base
every SSi worker worktree is cloned from — had been on no branch at all since 2026-08-20, because
the sentinel's sync step ran `git checkout -qf --detach FETCH_HEAD` every three minutes. Asked
whether that was deliberate, Tom ruled: *"not deliberate, I have no idea, but we should have merged
everything to staging anyway."*

**The detachment.** It was reasoned, not accidental: detaching guarantees no branch pointer moves,
so the clone's own branches and its ~22 worktrees are safe. That guarantee is kept without the
detachment by advancing `dev` **fast-forward-only** — only `dev` moves, only forwards, and only when
git can do it. Attach failure and ff failure both log and carry on, so the invariant that an update
failure never silences the watchman is unchanged. Nothing existed only in that checkout: it was
bit-identical to `origin/dev` with a clean tree; its two local-only commits were a scratch
main∪dev probe (left alone) and an unpushed README/CLAUDE.md docs fix (merged here).

**The sweep.** Twenty-three unlanded branches — pod carry/ratchet restores, the Layer-1 census, the
Android field-test build and its WebView shim, the cold-start fixes, the iOS scaffold, and the
India/environment/identity design docs — were merged to `dev` and promoted to `staging`. Four were
left where they are, each for a reason that is a finding rather than a chore: `cs/595` (two
independent suites collide in one authz test file), `cs/680` (predates the #672 cup fallback it
would clobber), `perf/journey-baseline` (its i18n key work is superseded — dev's locales carry 702
keys to that branch's 365), and `cs/551` plus its four area branches (characterization tests that
pin code dev has since fixed).

**What the sweep caught that no single branch could.** #701 added a second inline script to
`index.html` while the CSP hash guard asserted there was exactly one. Each branch was green alone.
Together they exposed a real gap: the shim's hash was missing from the policy, so promoting CSP from
Report-Only to enforced would have blocked the very shim that lets Android WebView 80-91 boot.

**The word that reverts it:** detach. If keeping the sentinel's checkout on a branch ever costs more
than it is worth, the change is three lines in `tools/deploy-sentinel/run.sh` and one field in
`command-surface/ops/serving-refs.json`.

## 2026-09-08 — school identity on the domain (job #371)

Tom's commission, verbatim: *"A school top level admin can invite teachers with one link and other
admins with a separate link. So they are multiple use links. But they can only be verified by a
domain level similarity maybe? Also the very first admin person to sign up a school therefore claims
the domain for the school and mints the school and is top level admin. Working first time is most
important. Being secure is secondary in chronology but no less important."*

**What already existed, read from the code.** Every school carries `teacher_join_code` and
`admin_join_code`, minted by a CSPRNG trigger at insert and registered into `invite_codes` with
`max_uses` NULL and no expiry — the two multi-use links Tom described are the shape the code has
had since July. Nothing recorded which email domain a school lives on. The first admin already mints
the school on two paths: self-serve `/schools1` (mailbox proved by OTP before provisioning) and a
leader-minted `school_admin` invite (vouched by the leader, address unproven).

**The domain claim.** One table, `school_identity_claims`: rows of `kind='domain'` and
`kind='address'` owned by a school. The founding admin's own domain is claimed at school creation on
both minting paths, and never for a public mail domain (`api/_utils/schoolDomain.ts` carries the one
declared list, beside the existing disposable-domain list). A claim is per school, not global: a
second head at an already-claimed domain is told which school holds it and pointed at that school's
links (that is "joins rather than mints"), with an explicit confirm to mint a second school on a
shared domain — the multi-academy-trust case, same 409-then-confirm shape the org door uses for
duplicate names. A school may claim several domains, and an arrival matches if its domain is claimed
by the link's school **or by any sibling school in the same group** — a trust sharing one domain
needs no second claim.

**"Domain level similarity" means exact-or-subdomain.** `staff.example.sch.uk` is under
`example.sch.uk`; `example-sch.uk` is not. Fuzzy similarity would be a way to be wrong quietly.

**An arrival on the link at a matching domain is the ordinary path and is one tap.** No code, no
mail, no waiting — exactly today's possession mint. The match is recorded as an attestation on the
account: `learners.needs_verification` is false from birth and the address goes into
`verified_emails`, so the teacher is never nudged to verify. The mailbox-reach card of job #358 is
left alone: it asks whether our mail *arrives*, which the domain says nothing about.

**An off-domain arrival is the contested case.** It still gets in first time — Tom's ordering —
but it stays `needs_verification=true`, so the existing Settings "Verify now" code path is its
route to becoming proven, and the admin sees an "unverified" mark on the Teachers row. Supply staff
and personal addresses are put on the school's address allowlist by the admin beforehand, and then
behave as on-domain. No route here is "email support".

**Contested versus uncontested, made computable.** Job #354 proved the server cannot tell "the
teacher's own second device signing in by code" from "the real owner arriving at a squatted
account" — the two event sequences are identical. So the one party who knows is asked, once: when a
session that proved the mailbox by code arrives at a schools-minted account from a different session,
the app shows one card — was the earlier sign-in you? *That was me* records the address proved and
retires the marker for good; *Not me* revokes every credential and session on the account and hands
the owner a fresh one. The purchase-path sweep stays automatic, because there the password was
planted by a stranger by construction. `mayClaim` keeps its home and its fail-closed default; the
schools mints are `CONTESTABLE`, never `AUTO`.

**The token layer.** Measured live 2026-09-08: after a global sign-out GoTrue reports the session
dead, and the same access token still reads rows through PostgREST until its `exp` — 3600 seconds
on this project. PostgREST checks signature and expiry locally and never asks GoTrue. The close is a
PostgREST pre-request guard (`supabase/secfix-toolkit/session_guard.sql`) that refuses a token whose
`session_id` no longer exists in `auth.sessions`, failing open on any other error. It is a change
to every API request on the one shared database, so it is staged and canaried, not applied — Tom's
call, one command, reversible in one statement. The probe asserts at the PostgREST layer and is red
until it is applied; that red is the truth.

**The word that reverts it:** claims. Drop the `school_identity_claims` table and the arrival check
in `api/auth/possession-redeem.ts` becomes a no-op; the contest card keys off `unclaimedMint.ts`
alone and survives either way.

## 2026-09-10 — the school board counts phrases spoken, not hours it never measured (job #159)

**The finding.** Every clip a class plays is in `player_events`, with its audio id, for every kind
of account. The playback ledger — the one definition of a minute since 2026-08-19 — cannot be
written by a class account: `bump_speaking_opportunities` checks `learners.user_id = auth.uid()`,
and a class's user_id is `class-learner:<id>`, so the write is refused and the player only logs it.
The class account's `sessions` rows are inverted: none for Chepstow's nineteen real lessons this
week, eight for app opens with no play. So the board's "Class practice 0h" was reading a ledger
that cannot see lessons, while throwing away the school_summary hours it had already computed, and
the Lens still reads `class_sessions`, dead since 19 August.

**The decision.** Whole-class play is shown as PHRASES SPOKEN — Tom's term for cycles played, one
per `target2` clip, the same count the ledger banks as `opportunities` for own accounts — plus the
phrase-by-count list, off the diary joined to the phrase tables. Practice minutes on the board are
own accounts only, off the ledger, as their own field. Whole-class practice TIME is not shown as any
number: no ledger measures it and no proxy stands in for it; one sentence under the row says so.
The hours tile, the class sessions count and the "Xh practised together" line are deleted, not
relabelled. Learners leaves the school-shaped stats row; it stays in the tree.

**Better × Simpler × Cheaper.** Better: every tile is backed by a live record, and the page shows
what was practised. Simpler: two dead tiles and three dead sentences gone; the phrase list is the
existing insight Table widget. Cheaper: one paged, JSON-path-filtered read of class-account diary
rows over seven days — a few thousand rows estate-wide, 596 ms live for Chepstow — no migration, no
player deploy.

**Not done, named.** Timing whole-class play needs the class account's ledger bump routed through
`/api/school/class-progress` (service role, teacher-authorised) and the class session opened at play
start: a player deploy, not a Friday hotfix. The Lens needs re-pointing off `class_sessions`.


## 2026-09-11 — the human test-sheet gate on staging→main is removed, not disabled (job #211)

**The three rulings, in order.**

- **2026-09-10, Tom: "10 — gate it."** A human test pass on the fixed `colombo-pass-v1` sheet
  became a required gate on `staging → main`. It lived in `tools/release-train/human-pass.mjs`,
  was recorded by `record-pass.mjs` from the tester's own words into `passes/<sha7>.json`, and
  `promote.sh` refused without it. Every step had to read `pass` on both the web run and the
  Android run, an unanswered step blocked exactly as a failed one did, and there was deliberately
  no bypass flag.
- **2026-09-10, later the same evening.** Tom's own words, as the ledger noted them at 21:55Z:
  the third thrust is a "live agent as real learner on the web, testing suite run by Astra".
  Watson recorded the ruling as "release testing is automatic and run by Astra; nobody hands Tom a
  test sheet." The ledger line is the nearest original wording found; Watson's is the paraphrase
  the commission carried. Both are given here so the reader can see the distance between them.
- **2026-09-11, Tom: "ok, remove that gate, we're not slaves to the system we created."** The
  ruling that removed it in code, when Watson offered three ways round the gate — someone runs the
  sheet, Tom waives it once, or hold the release — and Tom rejected the frame.

**What was removed.** The `HUMAN-PASS-GATE` limb in `promote.sh`, the `--accept-drift` argument
that existed only to feed it, and the header paragraph describing it. `human-pass.mjs`,
`record-pass.mjs`, `human-pass.test.mjs` and `passes/` are deleted, `package.json` loses
`test:human-pass`, and Thursday's candidate report no longer prints "the promote will REFUSE".
No pass was ever recorded; the gate blocked exactly one release, today's, for the eleven hours it
existed on the branch that ships. Removed rather than defanged because a bypass flag on the
ordinary path becomes the ordinary path inside a month — the script's own header said so.

**What replaced it.** The semi-automatic release-test loop landed on `dev` by job #208 earlier
today: a nightly user timer at 00:45Z that works the same checklist against staging as a real
learner would, records what it saw, and reports. It deliberately gates nothing yet. The sheet
`TESTER-SHEET.md` stays as the named source of the loop's controls, with a line at the top saying
it is no longer a gate. Nobody hands Tom a test sheet.

**What is still enforced in `promote.sh`, untouched.** Nothing runs without `--go`. The script
refuses when `origin/main` is not an ancestor of `origin/staging`, which is how an un-back-merged
hotfix announces itself. It regenerates the release notes from the range actually promoted and
commits them onto the merge, and if the notes fail to finalise it exits non-zero and says THE
PROMOTE LANDED. THE RELEASE NOTES DID NOT. It is never cronned. The removal is pinned by a case in
`promote-notes-commit.test.mjs` that asserts the gate's absence and those refusals' presence,
seen red on the old script and green on the new one. This was a supersession, not an erosion.

**The word that reverts it:** gate. The deleted files are one `git revert` away on `dev`.

## 2026-09-11 — a class has started when it has practised, not when it was assigned a course (job #215)

**Better × Simpler × Cheaper.** Better: the two sentences a school leader reads on one screen,
"13 have never started" and "30 of 34 have started", now describe the same fact and add up to the
school. Simpler: one rule, written once in `api/org/intel.ts`, decides what "started" means for
both QUIET and JOURNEY and for each class row's position; no widget hidden, no second read.
Cheaper: a reading-side change to one function and one proving test; no write path touched, no
migration, no shared database change.

**What was wrong.** Opening the class player writes a live position to the enrollment WITHOUT a
practice stamp, by design since 2026-06-11 so that a boot does not read as practice. JOURNEY read
that cursor as "started"; QUIET read the missing practice stamp as "never started". Nine of
Chepstow's thirty-four classes carried a cursor at sentence 1 and no practice, and were counted
both ways.

**The principle, Tom's.** "They know that SSi works, and all it needs is regular use." Assignment
is an intention; practice is what the school is being asked about. So started means practised.

**What changed.** `computeOrgIntel` gives a class a position only when it has practice evidence,
the same evidence QUIET already uses. Pinned by a test that was seen red on the old code and green
on the new: a class with a cursor and no practice is counted never-started by both questions.

**Follow-up, not done here.** The boot-time save still leaves a cursor on a class that never
played. The node home reads that cursor for its journey bar too. Whether a bare boot should write a
cursor at all is a write-path question for its own job.
---

## 2026-09-11 — the support channel's three tables are live; the watcher is not

**Decision.** Job #214 left three questions open. Two of them were answered yes and are done here:
the two branches are merged and the migration is applied. The third — arming the watcher — is
Tom's alone and was not touched.

**The migration.** `20260911_support_channel.sql` was applied to the live shared project by
`supabase/secfix-toolkit/canary_support_channel.cjs`, canary style: one transaction, the DDL, then
fixtures on real schools and a real council group, then thirty-seven assertions, then a rollback of
the fixtures and a COMMIT of the DDL alone. Leak-closed: anon reads nothing; a school admin sees
their own thread and their own turns and nothing of the school next door, cannot see an org thread,
cannot read `support_signals` at all, and cannot insert, update or delete anything anywhere — every
write is the server's or the service key's. Legit paths alive: `ensureThread`'s select, the
messages POST, the thread GET's `last_read_at` stamp, the doorbell's `doorbell_sent_at` stamp, the
population count as an integer, the signals upsert, and the watcher's unanswered-questions query.
The shape holds too — a thread owns exactly one of a school or a group, and there is one thread per
school forever. Live posture after commit: RLS on all three, one SELECT policy each on threads and
messages, zero policies and zero grants on `support_signals`, and SELECT the only privilege
`authenticated` holds anywhere in the set.

**One red the merge found.** `SEC0901-A-03` keeps the cron inventory as an explicit list so that
adding a cron is a deliberate edit to the security file. The doorbell was added to `vercel.json` on
the branch without that edit, so `test:api` went red the moment the branch met `dev`. The
deliberate edit is made; the handler already carried `checkCronAuth`, which the gate's derived
second assertion proves independently. The gate worked exactly as designed.

**The doorbell cannot ring yet, and that is structural, not a promise.** It selects `out` rows
older than three hours. Nothing writes an `out` row but the watcher and Tom's reply tool, and the
watcher is unarmed — so no school admin can receive an email from this until somebody arms it.

**The watcher stays unarmed.** `ops/ssi-support-watcher.service` in command-surface is committed
and installed nowhere: not in `~/.config/systemd/user`, no `~/.config/ssi-support/env`, never
enabled, never started. Arming it means an AI begins drafting replies to real school admins.
That is an intention-level call and it is being asked of Tom separately.
## 2026-09-11 — a class with no pupil accounts is not "inactive" by fiat (job #217·G)

**The case.** Ysgol Cas-gwent runs 34 classes as whole-class play from the front, with no pupil
accounts at all. On the morning of 11 September its head of department sent screenshots of her
class list reading "Inactive" on every row, next to "0h this week". By 12:03Z the in-app-time
release (`5ea385e88`) had made the hours column true, and the node home true, but the health mark
stayed "Inactive" for every class — the rule in `TeacherDashboard.vue` said "no pupil accounts
means inactive" before it looked at whether the class had practised at all.

**The ruling applied.** The Handbook sentence for that column already says what the rule is:
"Health is worked out from how many of the last seven days the class practised on." The code now
does that. `/api/school/class-practice-7d` carries `activeDaysByClass` — distinct days with any
play in the window, the class account and its pupils together — from the same diary read that
already produces the in-app seconds. `deriveClassHealth` (`views/schools/classHealth.ts`) takes
the higher of the report's active days and the diary's, tiers as before (5+ excellent, 2+ good,
1 needs attention), and only then falls back to the old pupil-count rule for a class with no play
on either record. Classes with pupils keep the answer they had. No Handbook sentence changed,
because the sentence was right and the code was wrong; `--check` stays green.

**What this does not do.** It does not touch the node home, the Insights rate engine (which still
reads `analytics_class_sessions_scoped` over the dead `class_sessions` table and reports "no
practice recorded" for this school — logged for job #215·G), or any copy. It sends no notice to
anyone. Pinned by `classHealth.test.ts`, seen red on the old rule and green on the new one.

## 2026-09-11 — copying a teacher's mistaken own-account play onto the class account (job #266)

**The case.** Chepstow's teachers have been running lessons signed in as themselves. Read live on
11 September: thirty-odd classes on cym_s_for_eng whose teacher's own learner row carries the
sessions and the diary, while the class's own account carries nothing. Under job #265's rule that
a class row reads the class account, those classes say "not started" forever. Tom's ask, verbatim:
"IF the teachers have by mistake played as themselves, Angharad needs to be able to copy all
progress data and telemetry and everything to the play as class account."

**Copy and keep, not move.** Tom said "copy", so the teacher's rows stay where they are and
re-keyed copies land on the class learner. The price of that is a second run doubling everything,
which is paid by the audit record: every apply writes one `class_progress_copy_audit` row naming
every source id it copied, and the next preview skips all of them. Natural-key tables are
insert-if-absent on the class side. Practice minutes on the enrollment are added once, on the
first run for a pair. Seen in the test: a second apply changes no table and still writes its record.

**Scoped to the class's course.** Only rows whose course is `classes.course_code` move. A teacher
who learns Welsh for themselves on a Spanish class keeps that Welsh. If Tom means "everything"
more widely than that, it is one parameter, not a redesign.

**The cursor is the further of the two.** The class enrollment is never duplicated. Position is the
last LEGO actually played, which on the live rows is `last_completed_lego_id` and its round index,
not the seed number and not `highest_completed_lego_id`, which is null on every Chepstow row read.
When the teacher is further, the class takes the teacher's cursor and helix state whole.

**Thirteen tables copy, thirteen are named as skipped.** The inventory came from
`information_schema` live, not from a doc: every `learner_id` column plus `player_events.user_id`,
which holds the learner PK. Identity, roles, billing, leases, entitlements and audit tables are
never copied and every record says so with the reason. `learner_practice_history` is skipped
because it carries no course and its session ids never match `sessions` rows, so no row can be
attributed to the class's course.

**Who may run it.** The server accepts `canTeachClass`: the school admin under either spelling,
ssi_admin, or an active teacher of the class, because a teacher fixing their own mistake is the
commonest case and costs nothing extra. The card is shown to school leaders only. Under View-as
the preview works and the apply is refused with the standard 403; Tom checking on staging as
Angharad will see exactly that, and it is not a bug.

**The audit table is live.** `20260911b_class_progress_copy_audit.sql` was applied to the shared
project by `canary_class_progress_copy_audit.cjs`: nine assertions, anon and authenticated denied
on read and write, service_role writes and reads back by pair, then COMMIT of the DDL alone.

## 2026-09-11 — nightly red on staging: the copy-play card voiced a failed teacher read as an empty class; the explainer pack was stale (job #284·F)

**Two reds, both from the 11 September promotions, neither a flaky test.**

**The copy-play card said "No teachers are linked to this class yet" whenever its list was empty**,
including when the class page's own `class_teachers` read had FAILED. The panel beside it already
keeps pending, failed and observed-empty apart through `teacherPanelState`, and
`ClassDetail.teacherAffordance.test.ts` asserts that a failed read never reads as an empty class
anywhere on the page. The card, added by job #266, did not know the read's state, so the page
said "Couldn't load" and "No teachers" at once. The fix hands the card the same `PanelState` the
panel uses: it says loading while pending, "couldn't load" on failure, and "no teachers" only on a
clean empty read. Absent the prop it still speaks from the list alone, so the card's own tests
did not change. Two new card tests fail on the pre-fix card and pass on the fixed one.

**The explainer pack was a commit behind its sources.** Job #265 renamed two class-page measures,
"Students" to "LEGOs travelled together" and "Practice hours" to "Minutes practised", without
running `tools/explainer/compile.mjs`, so the checked-in `pack.json` carried version 525131d5baef
while the sources compiled to f33f092123b9. The compile gate exists precisely to catch that. The
repair is the compiler's own output, committed; nothing was hand-edited.

## 2026-09-11 — schools pages open the explainer clips, not the prose Handbook (job #286·F)

**Where Tom actually was.** View-as as the Chepstow leader lands on the ORG LENS, `/org/<school>`,
and class 8H is `/org/<class-id>`, rendered by `NodeHomeView.vue`, not `/schools/classes/:id`. That
page already mounted `HowThisWorks.vue` with both doors. The Handbook was the bordered chip and the
explainer toggle a faint underlined link, so the first tap went to the prose map "Everything this
dashboard can do". The persona there is `leader`, and no walk in the pack targets node-home at a
class, so even the right door opened prose with no clips beneath it.

**Decision: the explainer toggle is the louder door, everywhere the component mounts.** Tom's
words set it: the clips are what "How this works" means. The Handbook stays as the quiet second
door, unchanged in destination, because the 2026-09-07 ruling keeps it as the map of everything
and the panel as the just-in-time answer. This is one component, so the org lens and the schools
class page cannot disagree about which door is first.

**Decision: the /schools class page mounts the same door with the viewer's own persona.** Persona
comes from `viewerPersona`, the resolver the Handbook page already uses, so the door and the map
agree about who you are and View-as opens what the impersonated leader or teacher would see. The
teacher-only "Show me" row it replaces had been showing school leaders the teacher clips anyway;
those five walks now name school_admin, which their capabilities' HANDBOOK comments already do.

**Decision: no mount on the /schools dashboard.** The school_admin school ruling was authored for
the org lens and bolds "Class practice" and names a teacher link and a learner link the /schools
dashboard does not carry. A panel that points at numbers that are not on the page is the failure
mode the brief named, so that page keeps its top-bar Handbook only. If in doubt, cut it out.

**Not done, deliberately.** The explainer drift gate still validates admin and leader only.
Wiring school_admin and teacher fails on twelve org-lens verbs those rulings never name, because
they were written for the legacy /schools surface. Re-authoring rulings is Tom's prose, not a
worker's. The full persona × place × clip inventory, including the class-node clips gap on the org
lens, is the published gaps list for this job.

## 2026-09-12 — class 8H's "6 of 679 LEGOs" and "53 phrases" are right; no code change (job #298·F)

**What Tom saw.** The org-lens class page for 8H at Chepstow said the class had travelled 6 of
679 LEGOs and spoken 53 phrases this week, above a table of 22 different phrases. Six LEGOs
looked too few to make that many phrases.

**What the live DB says.** The class account's diary carries five `round_complete` rows, LEGOs
S0001L01 to S0002L02, all on 8 Sept, and the sixth round, S0003L01, started on 8 Sept and again
on 11 Sept without finishing. The enrollment cursor reads S0003L01, ordinal 6 of 679, which is
the second link in the journey chain because the class-progress endpoint never writes
`highest_completed_lego_id`. The 53 phrases are the 53 target2 clips in the window, 22 distinct
audio ids, and every one of the 22 phrases is built from exactly the six chunks "dw i'n moyn",
"siarad", "Cymraeg", "dysgu", "dw i'n trio" and "dw i'n mynd i". The teacher has no enrollment
of their own, so no class play landed elsewhere; every Chepstow class that played on 8 Sept
did so in the same 07:50 to 08:03 slot, so nothing is missing from the diary.

**Decision: the figures stand.** Six is the number of rounds the class has entered, five
completed and one in progress, which is Tom's definition of LEGOs travelled. Twenty-two
different phrases from six LEGOs is the method working: the sixth round alone recombines the
earlier five into eight new sentences. No computation changed, no label changed.

**Not shipped, offered.** A leader reading 6 LEGOs above 22 phrases hits the same doubt. One
sentence under the journey bar, "Every phrase the class spoke this week is built from those 6
LEGOs", would resolve it from data the diary already carries. That is class-page copy, so it
waits for Tom. A separate different-phrases tile is not recommended; the phrase table already
lists every distinct phrase with its count. Findings, queries and the full phrase-to-LEGO
table: https://watson-1.tail4968cb.ts.net/d/1dad23b0

## 2026-09-12 — "Report a bug" for learners is a postbox, not a thread (job #327·F)

**What Tom ruled.** "We should probably use the in-app support channel for all learners if
there's a bug or an issue. But not have agents reply to them because that would soon escalate.
So we want something like 'report a bug' in contradistinction to the in-app general support
channel we've built for org admins." And, to the proposed shape: "Reports go to one channel yes
and that can be one of the things we direct you agents to have a look at."

**Decision: a one-way postbox.** A new table `bug_reports` with no reply path at all: no
direction, no in_reply_to, no answered_at, no status, no priority. The support channel's tables
were not reused because their whole shape is turn-taking, which is the thing being cut off;
`tester_feedback` was not reused because it is tester-gated and carries a workflow. The only
reply a learner ever sees is the client-side "Got it, thank you."

**Decision: one inbox, the ssi-learning-app project channel.** A poller on watson-1
(`command-surface/tools/bug-reports/poster.cjs`, unit `ssi-bug-report-poster`) posts each row once
into that room and stamps `posted_at`. Not Tom's Watson, not needs-you, not email. Agents are
directed at the channel; nothing is spawned from repeats.

**Decision: the shape key is display, not a classifier.** `course_code | app_shell | belt |
last event_type before the report`. The post opens with "Nth report of this shape in 7 days" so
repeats are visible to whoever reads the room. That is the whole grouping.

**What a real tap did (job #361, 2026-09-12).** Astra refuted #347's "whole pipeline proven":
that probe submitted with `el.click()`, which skips hit-testing. A headless phone at 390x844 with
a touch context, opening the sheet from Settings and tapping Send at its own coordinates, closed
the sheet and Settings and posted nothing: the point under the thumb was the bottom nav's Play
button, because the scrim sat at z-index 1200 under the nav's 3000. So delivery worked and normal
phone submission was broken, exactly as Astra said. Raising the scrim to 3300 alone did nothing on
staging: Settings mounts the sheet inside `.settings-overlay`, a fixed z-index 2000 stacking
context, so the sheet could never outrank the nav from there. Fix: the sheet teleports to body
and stacks at 3300; a test asserts the scrim is a direct child of body, red on the old component,
green on the fix. Verified live on staging build f731f19: the same probe's tap on Send returned 200,
showed the thank-you and wrote a `bug_reports` row stamped `390x844`, then deleted. Probe kept as
`packages/player-vue/e2e/_361-postbox-tap-probe.mjs`.

**Decision: guests may report.** A guest has no bearer, so the route accepts an unauthenticated
report with learner_id and auth_user_id null and only the client's unflushed buffer for events.
Throttled per attested peer in memory and by a fleet-wide cap of guest rows per quarter hour
counted from the table. Not a hardened limiter; flagged for Tom's eye.

**Position is the lego.** The report carries the cursor as the lego's own known and target text
plus the belt name; the channel post renders it that way and never as a seed number.
## 2026-09-12 — mode and belt on every play row, Listening Mode per-clip events, the JP/FI rule corrected (job #325·F)

**Tom's ruling.** "Yes. Telemetry fixes. Certainly." at 11:16Z, answering the #318 census gaps:
mode on no per-play row, belt derived from seedId, Listening Mode with no per-clip event, and
59 real learners erased whole by the machine-country rule.

**Differential, before.** Production, fixed window 2026-09-05T00:00Z to 2026-09-12T00:00Z:

```sql
SELECT event_type, count(*) AS rows,
  count(*) FILTER (WHERE payload ? 'mode') AS has_mode,
  count(*) FILTER (WHERE payload ? 'belt') AS has_belt,
  count(*) FILTER (WHERE payload ? 'seedId') AS has_seedId,
  count(*) FILTER (WHERE payload ? 'roundIndex') AS has_roundIndex,
  count(*) FILTER (WHERE payload->>'cycleType' = 'listening_mode') AS listening_mode_rows
FROM player_events
WHERE env='production' AND occurred_at >= '2026-09-05T00:00:00Z' AND occurred_at < '2026-09-12T00:00:00Z'
  AND event_type IN ('audio_play','round_complete','listening_tick','tap_play','tap_pause','tap_skip','phase_skip','learning_mode_toggle','learning_mode_selection')
GROUP BY 1 ORDER BY 2 DESC;
```

| event_type | rows | has_mode | has_belt | has_seedId | has_roundIndex | listening_mode_rows |
|---|---|---|---|---|---|---|
| audio_play | 44,919 | 0 | 0 | 44,919 | 0 | 0 |
| phase_skip | 1,217 | 0 | 0 | 0 | 0 | 0 |
| tap_pause | 791 | 0 | 0 | 0 | 791 | 0 |
| round_complete | 698 | 0 | 0 | 698 | 698 | 0 |
| tap_play | 581 | 0 | 0 | 0 | 581 | 0 |
| tap_skip | 285 | 0 | 0 | 0 | 285 | 0 |
| learning_mode_selection | 256 | 256 | 0 | 0 | 0 | 0 |
| learning_mode_toggle | 47 | 47 | 0 | 0 | 0 | 0 |
| listening_tick | 1 | 0 | 0 | 0 | 0 | 0 |

A play row: `{url, role, cycleId, cycleType, legoId, seedId, playbackSpeed, cacheHit, learnerId}`. A
round row: `{roundIndex, legoId, seedId, learnerId}`. A Listening Mode session: `listening_tick
{view}` every 30 s and nothing else.

**Differential, after.** Every row the player logs additionally carries `mode` ('easy' | 'fast'),
`belt` (name), `seedId` and `roundIndex`, filled at the instant of logging. A Listening Mode
session carries one `audio_play` per clip with `cycleType: 'listening_mode'`, `mode: 'listening'`,
the pod-play keys, plus `view`, `listenMode`, `scene`; the tick stays. The same query, run over
rows from a build carrying this change, shows has_mode = has_belt = rows for every player event
type. Old rows are unchanged and every query that ran before still runs: these are payload keys,
no column, no migration, no rename.

**Decision: stamp at the pipeline, once.** `usePlayerLog` takes a `context` provider called at
log time and fills only the keys a call site left absent. "Every row carries mode" is then true
by construction rather than by auditing forty call sites, which is the Better × Simpler ×
Cheaper reading. An explicit key from the caller, even null, wins: a pod play's `seedId: null`
means "no seed" and stays that way.

**Decision: belt is the belt PLAYED.** `playingBelt.name`, which in `useBeltProgress` is the
same `playingBeltIndex` that `currentBelt` reads, so the badge and the row agree. Not the belt
achieved. Stored so a future move of the thresholds cannot rewrite history.

**Decision: Listening Mode rows say `mode: 'listening'`.** There is no Easy/Fast in the overlay;
a null would read as "unknown" when the truth is "a different surface". Its `belt` is the focal
row's own belt in the Core and All views and null in a pod scene, which carries none.

**Decision: the country rule applies only to unattributed rows.** `isMachineEvent(row, realIds)`
replaces `isMachineCountry` at every consumer in `api/intel/*`. Read live on 2026-09-12, the 59
"real learners" the old rule erased were: 49 dangling learner ids with no `learners` row, every
one on a probe day (5 Aug, 2 Sep, 7 Sep, all FI, 1 to 22 events each); 7 accounts that are
probes by their own names (`claude-signup-proof-*@saysomethingin.com` ×3, `zz-probe-*@ssi-probe.test`,
`cs-probe-*@example.com`, one invite-link student, and Tom's own gmail); and 3 people in Finland
on iPhones, one with 15,706 production events across twelve courses since June. The narrowest
rule that keeps the humans is "a signed-in real learner is never dropped by country". The seven
probe accounts are not a country problem: they belong in `test_learner_ids()` (is_internal), and
that is left as a data-hygiene candidate rather than done here, because it changes board metrics
and the contributions trigger and is a one-look decision. The k-floor test that pinned the old
behaviour was flipped deliberately. The census SQL on branch `cs/318-…` still inlines the old
rule; it is a read-only artefact of that job and was not edited.

**Not done, deliberately.** No column, no index, no backfill, no engine. The nightly
insight-discovery digest applies no country rule at all, so it needed no change; its population
still differs from the resolver's, as the census already said.
## 2026-09-12 — cym_s_for_eng learners past Yellow were reset to White belt: a preview-sized script cache was trusted (job #326·F)

**What the learner saw.** Forum complaint via #cyhoeddi: the Southern Welsh course "saves your
progress, but sends you back to the start of white belt if you ended your session past yellow".

**What production shows.** Since 2026-09-03 cym_s_for_eng boots off a course bundle, and it is the
only Welsh course that does. A guest, an unentitled learner, or a session that fetched the bundle
before its token restored gets the free preview: 33 rounds through S0019L01, the end of Yellow.
The player wrote that script into the IndexedDB script cache, keyed by course alone. The bundle
heals when entitlement arrives; the cache never did. The cache fast-path then hydrated 33 rounds,
failed to find a cursor past Yellow in them, warned to the console and started at round 1. The
cursor row was untouched, which is the "saves your progress" half. One live row shows the whole
path today: ieuan422, subscribed at 04:17Z, cursor S0215L01, every cold start landing on S0001L01.
Reproduced headlessly on build 5ea385e with a fresh test account.

**Decision: a cached script that cannot place the learner is not their course view.** The fast-path
now skips such a cache (`cachedScriptCoversLearner`) and the bootstrap resolves against the live
bundle's round map, after which the full-script handoff rewrites the cache. Separately,
`resolveResumeStart` no longer reads a cursor beyond the round map's last seed as "fresh learner":
it lands on the map's last round, which for an unentitled learner is the paywall wall. Both carry a
test that fails on the pre-fix code and passes after. No new telemetry, no belt-threshold change, no
cursor repairs: no real learner's cursor moved backwards.

**Second trap, found on staging.** Once a device has been reset to round 1 and played there, or a
guest played there before signing in, its local position snapshot reads S0001L01 with a fresher
stamp than the server row, and position authority kept choosing it: both test profiles still
landed on White with the cache fix live. A cache that sits BEHIND the server cursor is stale
whatever its clock says, so `resolveAuthoritativePosition` now lets a fresher local snapshot win
only when it is at or past the cursor. Offline progress ahead of the cursor is untouched. This
narrows the 2026-07-09 position-authority rule by one clause and is flagged as a default for Tom
to overturn.

**Left for Tom.** Whether Welsh should be `pricing_tier = premium` at all; three unentitled
learners sit past the wall (fransetter S0217, lea.weber94 and reillyfeatherstone in infinite play)
and will meet the paywall on return rather than round 1. Census, queries and reproduction:
https://watson-1.tail4968cb.ts.net/d/00ee37b1

## 2026-09-12 — #325 watched live on staging: main-flow rows proven, Listening Mode found broken and fixed (job #339)

**What was watched.** Staging build 3004383 (promote of #325) served at 11:46Z. A headless
play-through as a guest from watson-1 (session `3a1b62ee-22c7-4c19-9c37-1aa34e671762`, env
`staging`, ip_country FI) wrote 17 rows to `player_events`. All 16 main-flow rows carry `mode:
'easy'`, `belt: 'white'` and `roundIndex`; `round_complete`, `tap_*` and `adaptation_plan` carry
`seedId`. The one Listening Mode row is a `listening_tick` with `mode: 'listening'`, `belt`, `view`
and no `roundIndex`, as pods have no round. (Corrected by job #361 on 2026-09-12: this entry first
read "every one carries … roundIndex", which Astra refuted and the house re-query confirmed.)

**Found 1 — Listening Mode per-clip rows never landed, and playback stopped after one clip.**
`effectiveRate` was declared inside a `try` in `playCurrentPhrase` and read by the new
`logEvent('audio_play', …)` after it: `ReferenceError: effectiveRate is not defined` on the first
clip, the async loop rejected, and the overlay never advanced. ListeningOverlay is plain
`<script setup>`, so vue-tsc and eslint were both blind. Fix: the const is hoisted above the try.
Guard: `ListeningOverlay.scope.test.ts` compiles the SFC with the inline template and lints the
result for `no-undef` and `no-const-assign`; it fails on the staging content and passes on the fix.

**Found 2 — pre-existing since 2026-05-15.** The belt-jump strip's `:ref` callback assigned to the
`activeBeltPipEl` const binding itself, throwing "Assignment to constant variable" on every strip
render. Fix: a setup function writes `.value`. The same test catches it.

**Found 3 — `seedId` on main-flow `audio_play` rows was null on every row, before and after.**
The call site passed `seedId: cycle.seedId ?? null`, an explicit null that wins over the log
context by #325's own design, and no main-flow cycle carries a seedId: 47,336 of 47,336
production `audio_play` rows in the week to 2026-09-12 were null. Fix: the key is left absent
when the cycle has none, so the context stamps the seed the cursor is on, as on every other row.
Pod plays still pass an explicit null, meaning "no seed".

**JP/FI rule, live.** `isMachineEvent` run from this branch against production rows for
2026-09-05..12 through the real `resolveRealLearners`: 1,121 unattributed JP/FI rows dropped;
518 attributed FI rows from six real learners kept; 104 attributed FI rows dropped because their
learner key has no `learners` row (12 keys) or is internal (1 key). Exactly the rule as written.
Not exercised through staging's `/api/intel/*` over HTTP, which needs an admin session.

## 2026-09-12 — #339's Listening Mode fix landed on dev and staging, watched live before and after (job #343)

**Scope check.** `cs/339-verify-325-telemetry-live-on-sta` at 774f51918 carried exactly the three
fixes and the scope test described, a DECISIONS entry, and a `.at(-1)` → index swap in
`usePlayerLog.test.ts`. Nothing else. Merged to dev as 476f0c7a3, promoted to staging as 9b3a78c44
on top of #326's two promotes.

**Gates on the merged dev.** Typecheck was red on dev before this job from job #302's
`HandbookView.showMe.test.ts` (an untyped `vi.fn()` calls tuple); one-line fix, b4608a231. Lint
0 errors. player-vue suite: 3803 passed, 2 failed, both in `localiseWalk.test.ts` — the ways-in
walk's locale mirror has drifted from the walk copy. Pre-existing on dev, walkthrough prose,
not touched here. The three walkthrough `compileGate` failures seen mid-job were the
report-bug anchors, already fixed on dev by 91e99577f.

**Before, on staging build 890c379 (pre-fix), headless guest play-through from watson-1, session
`404156df-dc2e-49c1-94f3-10d43340afd0`.** Page error `ReferenceError: effectiveRate is not
defined`; two console `TypeError: Assignment to constant variable` from `ListeningOverlay`'s
`ref`; the belt strip drew 8 pips regardless. Listening Mode produced one `listening_tick` and
ZERO `audio_play` rows. Every main-flow `audio_play` row had `seedId=null` while the
`round_complete` / `tap_*` rows beside them carried `S0001`.
**After, on staging build 9b3a78c (the #339 fix), session `4eb21a1b-89d7-4985-abed-82bb76d3320a`.**
No page error. Listening Mode wrote 15 `audio_play` rows with `mode: 'listening'`, one per clip,
`seedId` S0001 → S0015, `belt` white then yellow as the queue crossed the belt boundary, and the
`listening_tick` beside them. Every main-flow `audio_play` row now carries `seedId: 'S0001'`. So
the regression from #325 is closed and the seedId fix is proven on the row.

**Found on that same build, fixed in this job.** Three console errors per strip render: `TypeError:
Cannot create property 'value' on number '0'` from #339's pip setter. Cause: the file has no
`lang="ts"`, so `ref<HTMLElement | null>(null)` is JavaScript — `(ref < HTMLElement) | (null >
null)` — and evaluates to 0. Both belt-strip "refs" had been 0 since 2026-05-15; the strip's
auto-scroll read `.value` of 0 and did nothing, silently. Fix: `ref(null)` for both; the scope test
now fails on any `ref/computed/inject/reactive<…>(` in the file. It was the only plain-JS SFC in
`src/components` and `src/views` with a type argument. Promoted as 19c43ecf9.

**After, on staging build 19c43ec, session `6aef0380-828f-4c10-9f62-125dfedd75ab`.** Zero page
errors, zero console errors, belt-jump strip rendered 8 pips, 14 per-clip listening `audio_play`
rows S0001 → S0014, main-flow rows stamped S0001. Probe kept as
`packages/player-vue/e2e/_343-listening-probe.mjs`; rows read back by `session_id` with the
service key.

**Not done.** Production still serves the #325 regression until the next staging → main promotion,
which is Tom's. The `localiseWalk` pair stays red on dev; walkthrough copy, someone else's.

## 2026-09-12 — the Italian method pod is a THIRD Listening Mode slot beside Pod 1 (job #354·F)

**Tom's ruling (12:36Z).** "Yes." to Watson's proposal: serve the method pod as a third slot so it
sits alongside Pod 1 for everyone rather than replacing it. The "swap it into the Pod 1 slot" and
"gate it to a role" alternatives are closed.

**What widened, and what did not.** `servedPod.ts` gains rule 6 and a second closed allow-list,
`LISTENING_EXTRA_POD_SLUGS = ['method-pod']`, read only by the new `resolveListeningPods`, which
answers the served pod first and then the named extras the course actually has. `SERVING_POD_SLUGS`
and `resolveServedPod` are byte-for-byte the main-flow answer they were, so the pod-lap scheduler,
stage 0 and the script generator still get exactly one pod. The Dialogues list builds scenes per pod
and tells them apart by a pod-qualified `sceneKey`; scene numbers stay local to their pod and a group
heading, the pod's own title from the data, appears only when a course lists more than one pod. The
offline snapshot carries the extras in a separate `extraPods` field so the served-pod offline lane is
untouched and older snapshots load as before. The bundle route's slug list becomes the union, behind
the same three gates. Popty's `serving-slug.cjs` widened in the same hour so a write onto
`method-pod` is refused as a serving write.

**Why visibility is not a client filter.** A held row is absent to the anon key under RLS, so the
player has nothing to filter and pretending otherwise would name the client as the enforcement. The
service-role bundle route keeps its explicit `visibility='live'`. The proof is the order of events:
staging with the pod still held shows only Pod 1 and the bundle carries only pod-1; then the one
UPDATE flips `ita_for_eng:method-pod` live and both surfaces show it. Production main never serves
the `method-pod` slug, so the flip changes nothing there until the next promotion.

**Taste defaults, flagged.** The group heading uses the DB title as-is, "Italian Method Pod — Tom
and Aran Talk Bollocks", even though it contains the word "Pod" (Pod 1's title already does). The
auto-advance playlist is flat, so Pod 1's last scene flows into the method pod's first and the whole
list wraps to Pod 1 scene 1. An extra slot's sentences carry `podOrdinal` 0, so the drill's derived
main-flow maturity never credits the ratchet against a pod main flow has not played. No learner
progress migration: `learner_pod_state` is keyed by sentence id and the method pod's ids are its own.

## 2026-09-12 — SSi admin top bar: Intelligence | Admin, two modes, one switch (job #340·F)

**What was wrong.** The bar over `/intel/*` and `/admin/*` carried three small-caps question groups
(Learners, Content, Business), a divider and an unlabelled schools-admin group on one row. So
"Organisations" appeared twice meaning two things, the row wrapped to two lines at 1280 and 1440
wide, and the ScopeRail beside it already tracked scope in different words.

**Decision.** Tom, 2026-09-12 11:57Z: "Yes to admin nav", answering Watson's card proposing the
split. The route decides the mode, never local state, so a deep link lands right. `/intel/*` is
Intelligence: the ten questions on one row, grouped by scope in the ScopeRail's own vocabulary,
Everyone / One person / One organisation, parted by quiet rules rather than labels. `/admin/*` is
Admin: Structure, People, Tools. The switch sits where the wordmark meets the tabs; Intelligence
lands on `/intel/pulse`, Admin on `/admin/structure`. View-as and Refresh are controls, not
destinations, and keep their right-anchored slot in both modes; Refresh itself renders only on a
page that registers a refresh handler, which today means the Admin pages, since no Intelligence
view registers one. (Corrected by job #361 on 2026-09-12: this entry first said both controls
"stay right-anchored in both modes", read as Refresh being visible in both, which Astra refuted
and a grep confirmed. Registering handlers in the Intelligence views would be page content, which
#340 did not touch.) "Organisations" now means one thing: question
10's sentence. Its tab reads "One organisation"; its path is unchanged. No route was renamed and no
page content was touched.

**Width.** The Intelligence row needs about 1365px, so 1280 cannot hold it. The breakpoint moved
before the font: Intelligence collapses into the one menu below 1380px, Admin below 1180px as
before. On phones the switch stays visible and the section trigger truncates its label rather than
squeezing View-as.
https://watson-1.tail4968cb.ts.net/d/d715f061

## 2026-09-12 — the 60-day belt rewind never lands below the learner's own belt start (job #326·F)

**Tom's ruling (11:27Z).** The rewind stays, but it must never send a learner back further than
the start of the belt they are currently at: past Yellow rewinds to the start of Yellow, or
whichever belt they hold, never to White.

**What the code did.** The rewind stored the round BEFORE the belt's first round so that the legacy
"+1" resume would land on the first round. Playback was right; the stored cursor, and the belt
badge read from it, sat one belt down, and the instant-playback path, which resumes ON the cursor,
resumed one belt down too.

**Decision.** `beltRewindTarget` names the belt's first round and nothing earlier; the rewind
writes that round as the cursor and the legacy path jumps onto it rather than after it. A learner
already at or before their belt's first round is left alone. Test red on the old decision, green
after.

**Census.** No `resume_ttl_belt_regression` cursor move has fired since telemetry began on
31 August, and no real learner on any course sits on the round before a belt start with practice
or a ceiling beyond it, so no cursor needs repairing under the old rule. The 8 September report's
24 real learners idle 60+ days above White will NOT be rewound on return, because the live boot
paths never reach the rewind, as the next paragraph records. (This sentence first said they "will
be rewound to their own belt start on return"; corrected by job #361 on 2026-09-12 after Astra
refuted it and the house confirmed the reading below.)

**Found verifying live, staging build 19c43ec.** A 70-day-idle test learner with the cursor at
S0025L01 on cym_s_for_eng, fresh device, signed in, `?bundle=0`: the instant-playback boot resumed
straight onto S0025 and stamped `last_practiced_at`; no rewind fired and no cursor move was
written. The rewind lives only in the legacy eagerLoad resume, which neither the cache fast-path
nor the bootstrap reaches: in `LearningPlayer.vue` the cache fast-path returns at line 14916 and
the instant-playback bootstrap returns at line 15470, both before the `beltRegressionDays` check
at line 15783, which only the legacy fall-through reaches (job #361 read the same three lines on
dev). So on the live boot paths the 60-day rewind is effectively unreachable. The cap is proven by
its test and is in place where the rewind lives; making the rewind reachable again is a design
call for Tom, not part of this job.

## 2026-09-12 — house re-check of four Astra refutations: all four confirmed, one real bug fixed (job #361)

**Why.** Four HOLD cards said Astra had refuted a claim in a house report and asked for a house
model to re-check before Watson acted. Each was reproduced with evidence, not argument.

**Item 1, #339's roundIndex sentence: CONFIRMED.** Re-ran the session query on the live DB: 16
main-flow rows carry `roundIndex`, the one `listening_tick` does not, by design, since pods have
no round. Sentence corrected in the #339 entry; no code change.

**Item 2, #347's "whole pipeline proven": CONFIRMED, and a real bug.** A 390x844 touch-context
tap on Send at its own coordinates hit the bottom nav's Play button beneath the sheet (scrim
z-index 1200, nav 3000, and the sheet trapped inside `.settings-overlay`'s z-index 2000 stacking
context). Fix: the sheet teleports to body at z-index 3300; test asserts the scrim is a child of
body, red on the old component, green on the fix; recorded in the #327·F entry; probe
`packages/player-vue/e2e/_361-postbox-tap-probe.mjs`.

**Item 3, #340's "Refresh in both modes": CONFIRMED.** `RefreshButton` renders only with a
registered handler and no `views/intel/*` file calls `registerRefresh`. Sentence corrected in the
#340·F entry and the AdminTopBar header comment. Handlers were not added to Intelligence views:
that is page content, outside #340's nav-only scope.

**Item 4, #326's "24 learners will rewind": CONFIRMED, already conceded by #326's own later
paragraph.** The census sentence is corrected in place and the four #343 paragraphs that a merge
had spliced into the #326·F entry are back under the #343 heading. The rewind stays unreachable;
wiring it into the live boot paths is Tom's design call.

## 2026-09-12 — "cancelled Family plan has zero access" was the app offline, not the cancellation (job #378·G)

**Tom's report.** He paid £25 for SSi Family on `thomas.cassidy+family_002@gmail.com`, cancelled it on
8 September, and on 12 September the account showed zero access on production build 5ea385e.

**What the live rows say.** `subscriptions` row `b119e295-2faf-4d44-b018-cee49cb3d797`: status
`active`, plan `SSi Family`, `cancel_at_period_end = true`, `current_period_end = 2026-10-07T23:41Z`,
Paddle `sub_01m1z3z0k2b6htg77tctxwa5ty`. Two active child members (Lewis, Bovis) and one open invite.
Signed in as that account against production, `/api/subscription` answers `isSubscribed: true`,
`/api/family` answers `hasFamilyPlan: true`, and both course bundles come back whole. No row on
production has `status = cancelled` with a paid period still running. The cancellation path is
correct and nothing was repaired.

**What actually happened.** His screenshots carry the airplane icon and Settings reads "we will
check it again as soon as you are online". The localStorage mirror of the last `/api/subscription`
answer carried a five-minute TTL; a boot more than five minutes after the last online one threw it
away, the fetch failed instantly with no network, `initialize()` declared hydration done with
`subscription === null`, and every premium course fell to the free preview. Any paying subscriber
who reopens the app offline hit the same wall.

**Decision.** The mirror has no TTL. An online answer overwrites it when one lands, sign-out and a
401 clear it, and `isSubscribed` still checks the paid period's end date against the clock, so a
period that has genuinely ended fails closed however old the copy is. A device that has never held
an answer still fails closed. Test red on the old code at the offline-reopen case, green after.

**Gaps.** The Paddle API key lives only as an encrypted Vercel secret, so Paddle's own event log for
the subscription was not read; the row and the live endpoints were the evidence. Vercel runtime
logs reach back only a few hours, so the 8 September webhook delivery itself was not observed.
## 2026-09-12 — the service worker's navigation fallback is the precached shell, never a runtime copy (job #377)

**Why.** Tom's staging PWA, with ~250 MB of clips downloaded, showed Safari's own "not connected"
page in airplane mode: no service worker answered the navigation at all. Production, same code
for the worker, loaded fine. The worker config, registration, index.html and boot watchdog are
byte-identical between `main` and `staging`; the delta was six staging deploys in an hour.

**The chain, reproduced end to end** (`packages/player-vue/e2e/sw-stale-shell-redeploy-probe.mjs`,
two real builds, 1a99888 then f731f19). The navigation route kept its own copy of index.html in
`navigation-cache`. A new worker installs, the app closes, the worker activates and the precache
drops the old build's chunks — but the runtime copy still names them. One navigation where
index.html takes longer than the route's 3s NetworkFirst timeout serves that stale shell; its
chunks come back as index.html through Vercel's catch-all rewrite; the inline boot watchdog sees a
same-origin module failure on a live network, concludes the deploy is broken, and heals:
unregisters the worker and wipes every cache. The app reloads fresh and works online, so nothing
looks wrong, but the worker is now reinstalling 545 files, and the next airplane-mode launch
before that finishes is the browser's own error page. The probe's control run shows exactly this:
heal attempts 1, two document loads, worker `installing` with a one-entry precache at boot, and
`net::ERR_INTERNET_DISCONNECTED` on relaunch. IndexedDB, where the clips live, survives the heal
untouched (a marker proves it), so no learner re-downloads anything.

**Decision.** The route never stores a runtime shell and every cache read answers with the
precached index.html (`src/sw/precachedShellPlugin.js`, stringified into sw.js by workbox-build;
the route itself is `src/sw/navigationRoute.js`, pinned by its test). The precached shell and its
chunks are installed and retired together, so it cannot go stale that way. Fresh deploys still
propagate: a network that answers inside 3s wins as before. The probe's fixed run: one document
load, from the precache, no heal, the worker still active, offline relaunch boots.

**Not changed, on purpose.** The heal ladder still unregisters and wipes on a same-origin script
failure with a live network; with the stale-shell trigger gone its remaining triggers are real
breakage. Whether a heal should keep the precache when a precached shell exists is a separate
design question, noted, not taken here. Not verified: iOS itself — no device or simulator on this
box; the reproduction is headless Chromium against the same worker code.
## 2026-09-12 — Immersion keeps pace inside the sentence by BREATH GROUP, from the clip's own timings (job #408)

**Why.** Tom, RBF room: "for longer sentences it really doesn't show the word by word, or even the
chunk by chunk breakdown… Pods are never cut below the sentence. So that means we'd have to use
the timings within the sentence… Immersion only, where the only tracker is the target sentence…
think about how to switch off the translations in immersion as well." The reference is Spotify's
podcast transcript: the line being spoken lit, lines said white, lines to come dim, nothing else.

**Decision.** `playback/breathGroups.ts` turns a clip's word timings into breath groups: a run of
words with no pause between them, a pause being a gap from one word's end to the next word's start
of 250 ms or more. The threshold is read off the data, not chosen: across 6,036 pod target clips
with Azure word boundaries (55,368 gaps) the gaps inside a phrase sit at 0–100 ms and the real
pauses at 400 ms and up, with an empty band between; 250 ms is its floor. Nothing tokenises below
the ear. Two raw shapes normalise to one: the #407 contract (`{source, words, starts, ends}`,
seconds) and the Azure `course_audio.word_boundaries` already on 1.5M rows (ms, punctuation as
tokens, folded into the word before). Group text is a slice of the pod row's own sentence text,
aligned word by word, so a render-text drift ("cansado" in the clip, "cansada" on the row, "…"
pause markers) never reaches the screen. The tracked card is a stack — said in secondary, lit in
primary, ahead in muted — and the lit group's text is painted up to `--fill` with the clip's media
clock, read off the shared Audio element per animation frame; media time, so speed costs nothing.

**One condition.** A sentence with one breath group, a clip with no timings, the 19 degenerate
all-zero rows, Drill, Core, All: `trackerGroupsFor` is null and the existing card renders exactly as
before. `ListeningOverlay.breathTracker.test.ts` pins the Drill fusion-strip block byte-for-byte.

**Translations in Immersion.** OFF by default, on their own persisted eye state
(`ssi-listening-gloss-immersion`) so the shared eye never leaks a habit in. Two single taps and no
other affordance: the eye shows every gloss for the sitting; a tap on the card that is sounding
reveals that one line until the next line sounds, and no longer restarts the line. Tom redlines
both by feel on staging.

**Data path.** The pod clip read (`POD_CLIP_COLUMNS`, shared by the online loader and the offline
snapshot) now also fetches whole-turn target clips for their timings; timings ride in the same
IndexedDB snapshot as `clipTimings`, no cache of their own, and a snapshot written before this
simply has none until its next refresh. When #407's `word_timings` column lands it joins that
column list and `readClipTimings` already prefers it over `word_boundaries`.

## 2026-09-12 — Breath-group tracker tidy: four findings from the #423 cold-verify (job #425)

**Why.** Astra's cold-verify of job #408 raised four findings against the live DB and the code. Each
was verified before it was touched, and one of them turned out to be wrong as stated.

**Array-shaped `word_boundaries` — finding withdrawn, pinned instead.** The ~375k array-shaped rows
are not a second word-timing payload: they are Azure viseme frames, `[[offset_ms, viseme_id], …]`,
several per word and carrying no text, so no normaliser can turn them into words. And they are not
the tracker's population: of the 29,496 pod sentence clips, 4,798 carry the object shape, 24,602
carry nothing, and 5 carry the viseme shape, all reused course-phrase clips. The normaliser already
returned null for them; it now says why, and a real row is a fixture that pins null.

**Threshold in whole milliseconds.** `0.35 - 0.1` is `0.24999…` in binary, so a gap of exactly 250 ms
failed to split. Gaps are now compared as `Math.round(sec * 1000)`.

**The pause band was never empty — 250 ms is a chosen floor.** The #408 entry above said the
250–399 ms band was empty. Re-measured on the 4,798 pod clips with word boundaries: 33,423 gaps, of
which 29,538 at 0–99 ms, 815 at 100–249, 22 at 250–399 and 3,048 at 400+. Twenty-two real gaps sit
in the band. The threshold stays at 250 ms, as a choice: it catches every real pause and the 22 are
ear-audible hesitations that split correctly.

**A tap on a silent card plays it.** The #408 reveal-on-tap read `displayIndex === currentIndex`,
which after playback stopped made the tap reveal the gloss and play nothing. The reveal now applies
only while that card is sounding; otherwise the tap is the pre-#408 handler, stop then play from
that row.

**Wrapped lines fill in reading order.** The fill gradient sat on the block, so every wrapped line
advanced together. It now sits on an inline span: an inline box's background is laid out as if the
run were unbroken and sliced per line (`box-decoration-break: slice`, the default), which is reading
order for free. No layout engine, no per-word painting.

**Also.** The #408 pin test never loaded: under vitest's jsdom default `import.meta.url` is an http
URL, and `fileURLToPath` threw at import, so none of its pins had run since #408 landed. It runs in
the node environment now, as its sibling scope test does. The dead `audioMap` ref predates #408 and
went with the same broom.
