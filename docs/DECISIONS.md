## 2026-09-15 — The rate-compare privacy floor is by cohort kind, not by role: classes compare from one peer (job #799)

**Tom's ruling (11:35Z).** "The comparison limit to 5 was for INDIVIDUAL users, to not be identified
for GDPR purposes — not to prevent classes being compared." Before this, the school engine
(`api/school/rate-compare.ts`) applied 5 universally, every role; the group engine
(`api/groups/[id]/rate-compare.ts`) carried it per role: 5 for teachers and leaders, 1 for
ssi_admins and demo worlds. (Corrected by job #806 — the original entry said both were role-based.)

**What the code says.** Every cohort either engine seats is an entity — peer classes when the
entity is a class, peer schools when it is a school or group, each averaged from its own account's
diary and whole-class play. No cohort anywhere in `api/school/rate-compare.ts` or
`api/groups/[id]/rate-compare.ts` is a set of individual learners. The one caller whose cohort IS
people, `api/me/insights.ts` (other learners on my course), keeps the 5.

**Fix.** `api/_utils/rateCompare.ts` names the two kinds: `cohortFloor('individuals')` = 5,
`cohortFloor('entities')` = 1; `K_FLOOR` keeps its name and value for the individual callers and
for spec.ts sovereignty parity. Both engines take the entity floor for every caller, teacher
included. The role and demo branches are gone; the reason text still names the floor it applied.

**Verified live, real teacher door.** R Jeffery (Ysgol Cas-gwent, 11P, Welsh South) through
`verifyAdmin` 403 + her own auth uid + the real caller resolver, not View As: 7-day cohort 16
peer classes, 30-day cohort 29, her rate 6.8 against 8.2 and 4.7. Identical before and after —
she was already over 5 on this endpoint, so the ruling changes her `kFloor` label, not her
comparison. Where the floor now bites differently is a one- or two-class school.

**One spot missed, closed by job #806.** `api/intel/minutes.ts` still compared COURSES against
`K_FLOOR` = 5. Its cohort is every other course with anyone on it — entities, not people — so it
now takes `cohortFloor('entities')` through `courseCohortTooSmall()`; one other course compares.
Test in `api/intel/minutes.test.ts` was red on the old import and green after.

**Proof.** New case in `api/groups/[id]/rate-compare.test.ts` — a teacher with one class and one
comparable class elsewhere on the course gets a comparison — red on the pre-fix engine ("expected
true to be false"), green after; three role-floor cases flipped deliberately; rate-compare suites
113/113 green; `test:premerge` green.

## 2026-09-15 — Insights under View As reads the VIEWED teacher's classes, so a class whose only practice is play-as-class draws (job #788)

**Tom's report.** Schools > Insights, View as R Jeffery (teacher, Ysgol Cas-gwent, 11P): "No classes
yet — once you have a class with sessions, it compares here." The dashboard and the class page for
the same class read 18 minutes played as class that week, 55 phrases, 7 of 679 travelled.

**Cause, verified against production, not the scout.** Scout #787's two candidates — the dead
`player_events.session_id` join and the bulk-stamped `course_progress` view — are not on this path.
TeacherInsightsView takes its class list from `GET /api/me/teaching-context`, which scopes to the
CALLER's auth uid, and under View As the caller is the ssi_admin. All 13 ssi_admins teach zero
classes, so production answered `{classes: []}` six times per page load and the view showed its
honest zero-classes state. The rate engine itself already has 11P as its own entity off the class
account's diary (18.4 min over 30 days, live probe) — Tom's ruling that play-as-class IS the class
data was already true one layer down; the picker never got to ask.

**Fix.** One door on teaching-context: a caller carrying the View As header who passes `verifyAdmin`
may send `?as=<auth uid>` and gets that person's context. Any other caller sending `as` is refused
with 403 rather than quietly answered for themselves. The view sends the persona uid while
`viewingAs` is set. No learner progress row is read or written; nothing about a real teacher's own
login changes.

**Proof.** `api/me/teaching-context.test.ts` two new cases red on the pre-fix handler, 15/15 green
after; `TeacherInsightsView.test.ts` one new case red on the pre-fix view, 8/8 green after; live
opt-in case for 11P added to `rate-compare.live.test.ts`; `test:premerge` green; both typechecks
clean against a per-worktree install. Production before/after screenshots via
`e2e/_788-viewas-insights-probe.mjs`.

## 2026-09-15 — Admin user search "broken on mobile": the results were off-screen, not missing (job #789)

**Symptom (Tom, 13:08 local).** In the Schools app, "search for users" is broken on mobile and
fine on desktop, same production build, same account.

**Mechanism, measured live on production at an iPhone 14 viewport, not a narrow desktop window.**
Not an event, not a fetch: with touch and the mobile user agent the Users page filtered on every
keystroke and the View-as person search called `/api/admin/users?search=` and got its rows, exactly
as on desktop. The failure is layout. On a 390×664 screen the Users page filters card alone runs to
y=579, the first matching row starts at y=661, and nothing above it changes as you type — the
"1308 users" hero is the full set by design and the chips do not move — so with the keyboard up the
search visibly does nothing. In the View-as picker the person search sat below the four role rows
at y≈400, under the iOS keyboard, with its results under that. A third, iOS-only hazard sat on top:
both boxes were plain `text`/`search` inputs with autocorrect and autocapitalize on, so a name or an
email typed on a phone can be rewritten before it is searched.

**Fix, the boring pattern.** Users page: a live "N users match" line directly under the box, so the
answer is on screen above the keyboard; Enter, which is the phone keyboard's Search key via
`enterkeyhint=search`, blurs the input and scrolls the list panel into view; autocorrect,
autocapitalize, autocomplete and spellcheck off; on phones the tier and sort chips become one
scrollable row each so the rows start on the first screen. View-as picker: the person search is
its own block, ordered first on phones by CSS only, same input attributes, Enter drops the
keyboard. Students roster search: the same input attributes. Desktop layout is unchanged.

**Proof.** `AdminUsers.phoneSearch.test.ts` and the new case in
`ViewAsPicker.classMinutes.test.ts` are red on the pre-fix sources and green after. Pre-merge gate
(invariants, api `--changed`, player-vue `--changed`) green on the merged dev tree. Shipped
dev → staging → main; the staging→main promotion also carried jobs #778 and #788 from the soak.
## 2026-09-15 — Three red nightlies on dev were merges, not a broken build: eight fixes and a one-minute pre-merge gate (job #774)

**Symptom.** The watson-1 nightly (`~/command-surface/ops/ci-run.sh`) went red on dev, staging
and main on 13, 14 and 15 September, on three different dev heads (12c1e192, 541480a8, d3e2a89e)
and three DIFFERENT sets of tests. Auto-fix workers #482 and #629 each fixed one night's list
correctly and merged; by the next nightly a fresh day of merges had left a fresh list behind. On
15 September the nightly muted auto-dispatch.

**Diagnosis, from the whole history rather than one log.** Nothing was flaky and nothing was an
environment gap: no test on the list needs DB credentials, and `.vercelignore` (job #694) touches
only the Vercel upload — `pnpm test:api` still discovers 251 files locally and on the nightly. Every
red was a merge whose author ran only the suite beside the file it changed:
- job #683's "minutes round up, hours only from an hour" ruling changed `practiceMinutes.ts` and left
  four component tests asserting the old numbers (CopyPlaySweepCard, CopyTeacherPlayCard, OrgIntelPanel,
  useSchoolData) — and exposed a real defect: `hoursToMinutes(256.6)` became 15397 because
  256.6 × 60 is 15396.000000000002 in floating point and the new ceiling read that noise as a minute;
- job #766 registered `schools.yearGroupTiles.yearShort` in `pending-translation.json` but never added
  the English string `YearGroupTiles.vue` reads;
- job #684's `GET /api/messages` answers its preflight inside `resolveInboxCaller` in `_shared.ts`,
  which the derived scanner (`scanClientApiCalls.ts`) cannot see — it reads the handler file for the
  cors import;
- job #680's `support-inbox-view-no-auth-users.security.test.ts` never joined the pinned roster in
  `securityTestMachineryIntegrity.security.test.ts`;
- job #684's `user_messages_from_support_reply()` is SECURITY DEFINER pinned to `search_path = public`
  without `pg_temp` — the live function too (`pg_proc.proconfig` read 2026-09-15), a real gap.
The 13 and 14 September lists (jobs #306/#340/#354/#379, then #609/#624) had the same shape.

**What changed.** The float fix in `ceilPositive` (proof: `practiceMinutes.test.ts`, red on the old
file, green on the new); the four minutes tests now assert the ruling's numbers (13 and 29 minutes,
"5 h 52 min"); `yearShort: "Y{n}"` in `eng.json`; `applyCors` named in `api/messages/index.ts` itself,
where the scanner looks; the roster gains the #680 file; migration
`20260915a_user_messages_from_support_reply_pg_temp.sql` (ALTER FUNCTION, config only) applied live
and `schema.sql` updated to match.

**The mechanism, so it stops recurring.** `pnpm test:premerge` at the root: the repo-invariant tests
(every test that reads the tree rather than importing it — preflight coverage, the security roster,
definer search_path, locale parity, walkthrough mirrors, and their kin, 22 files) plus
`vitest --changed origin/dev` in both configs, which runs every test importing a changed file. About
a minute; documented in CLAUDE.md's feedback loops. Better: it catches exactly the two classes that
went red three nights running. Simpler: two package.json scripts, no new tooling, the full nightly
untouched. Cheaper: a minute at merge time against an eight-minute nightly, a muted auto-fix lane and
three workers' worth of re-diagnosis. It is a convention, not a hard gate — the surface merges by
hand — so the honest next step, if it recurs, is the command surface running `test:premerge` in the
worker's worktree before it offers the merge.

## 2026-09-14 — Play as class restored beside every class; the playing-as-yourself warning moves to the player; minutes round up; hours only from an hour; View As lands on real numbers; a verification rule for schools jobs (job #683)

**Symptom (Tom, 16:17Z, staging, ten screenshots).** "every single Play as Class button has GONE!!!!
That should be prominent next to the class, not invisible" · "the 'You are now playing as yourself'
makes no sense when in dashboard view - they're not playing anything. that warning should be on the
dashboard top nav when the player is playing" · "round up to the nearest minute, not down. because
learners who start playing and do 20-30s are showing as 0 mins" · "0 hours? it shouldn't round down
to the nearest full hour. it should just give the mins. 0 h 14 mins" · "overall we MAY be rushing on
this, because we're doing logically stupid things like removing massive functionality". At 16:20Z:
the View As picker "should show him examples with ACTUAL data, not default to a teacher with zero
play-as-class minutes".

**Cause of the missing button, established in a real browser before any edit.** Signed in on
staging as a real teacher and a real school leader of the ZZ Test Chepstow scenario school, Play as
class was present on the class page, the classes list row and the teacher home. Under View As of
the same two people it was absent on every surface. The one cause is the 2026-07-16 gate in
`usePlayAsClass.ts` (commit 8ca0f01b2): `canPlayAsClass = isSchoolStaff && !isAdminView`, and
`SchoolsContainer.vue` provides `isAdminView` as `isViewingAs`. Not #651's `showClassVerbs`, not
#662, #675 or #681. Every one of Tom's nine View As screenshots was that gate; the tenth, the 9AWI
class tools page with no band in frame, shows "Mr Williams · Teacher" in the avatar, so it was View
As too. Real teachers never lost the button.

**Ruling applied.**
1. **Play as class is prominent beside every class, and under View As it is SHOWN DISABLED, never
   hidden.** `canPlayAsClass` is staff-only again with no View As term; a new `playAsClassReadOnly`
   drives `:disabled` and a title, "Read only while you are viewing as someone else. A teacher can
   press this.", on the class page, the classes list row, the teacher home card and row, the admin
   lane table and the class tools page. `launchClassSession` still refuses under View As, so the
   #681 write ban stands: the disabled button is its honest rendering. Group leaders stay excluded.
2. **The "You are now playing as yourself" line is off the teacher home.** Nothing plays there. It
   lives in `PlayingAsYourselfBanner.vue`, mounted by `App.vue` on the player route only, shown
   while the player's own transport state says playing, for a school staff account, never under
   View As. Own-account play happens at `/`, the immersive player, which carries no schools nav at
   all, so "the dashboard top nav" is the top of the player itself; the sentence and the Your
   classes link are unchanged. The past-tense own-practice line on the teacher home stays.
3. **Minutes round UP.** `secondsToMinutes` and `hoursToMinutes` take the ceiling of a positive
   value; zero stays zero. The API rounds at the seconds source too (`secondsToMinutesUp` in
   `inAppTime.ts`, used by `class-practice-7d.ts` for the rollup, the daily bars and the caller's
   own minutes), so 25 seconds reaches every page as 1. The copy-onto-the-class card's "N minutes in
   the app" goes through the same rule.
4. **Duration format.** Under an hour "N min"; from an hour "1 h 14 min"; "0 h" never. This
   refines the 2026-09-11 ruling of job #265 ("Why the fuck is hours a thing anyway?"): both say a
   number never rounds to a lying zero, and today's words win where they differ. The header of
   `practiceMinutes.ts` carries both. The only hour formatter reachable from an Insights page,
   `SovereignComparison.vue`, printed "0h 14m" for a raw hours value and now goes through the one
   formatter; none of Tom's ten screenshots shows the "0 h", so that is the best candidate, not a
   confirmed sighting.
5. **The classes list column is no longer a rate.** "Time in app, min/wk" read as minutes per week
   over a value that is the class account's seven-day total; job #673 ruled rates out. It now reads
   "Played as class, this week" in the header, the phone data-label and the CSV. Taste-safe default,
   chosen over the brief's "Time in app, this week" because #673 also ruled every label says whose
   minutes they are. No school surface divides minutes by weeks; the "Active min/wk" column in the
   admin Coverage board is admin-only draft data and untouched.
6. **View As picker lands on real numbers.** `api/admin/users.ts` takes `sort=class_minutes_7d`
   with `role=teacher|school_admin`, ranks the whole role by seven-day play-as-class minutes across
   their classes (`api/_utils/viewAsCandidates.ts`: teachers via `class_teachers`, leaders via every
   class in the school they administer, one diary read of the class accounts) and returns the top
   50; `class_minutes_7d=1` adds the figure and the school name to search results. The picker
   sorts most-active first and writes "School leader · Chepstow · 4 h 32 min this week" under each
   name; no play reads "0 min this week" and sorts last. Group leader stays most-recently-active: a
   seven-day rollup across a whole group is out of price for a picker.

**The process rule (written into WORKLIST.md as well).** Every schools-dashboard job verifies in a
real browser as a REAL signed-in teacher and a REAL signed-in school leader, not View As, before
any done card; and no control may be removed unless the job's landing line names it with
before-and-after screenshots. Tom's diagnosis of the week, in his words: "we MAY be rushing on this,
because we're doing logically stupid things like removing massive functionality, e.g. the Play as
Class button."

**Not changed, and why.** The minutes definition in `inAppTime.ts` (job #673). The per-person
all-time minutes on the roster, students and teachers lists, which still read the sessions ledger
and were out of this job's price in #673 too. Welsh and the other locales: the two new English keys
are enrolled in `pending-translation.json`.
## 2026-09-14 — The in-app message inbox primitive, and the teacher-play copy notice with one-tap undo as its first specimen (job #684)

**Ruling (Tom, via the RBF room, 16:30Z).** "we DO want to be able to send them in-app messages
about stuff like this." The shape he agreed: ONE message primitive per user — a source, a real read
state, an optional one-tap action — not a per-surface strip. Schools Support replies become one
source into it, "the same place Support replies land, Support becoming one source into it rather than
a second inbox". In the learner app, "a card at the top of the Library, once, dismissable, dismissing
into the same inbox reachable from the More menu; not Settings."

**The policy line, Tom's own, which governs every future source:** "the bar for sending a learner
anything is whether it changes what they would do, or the inbox becomes the tab nobody opens." It is
in the doc comment of `sendUserMessage` in `api/_utils/userMessages.ts`, where anyone adding a source
will read it.

**Read state is real.** "Delivered is not seen." A message is unread until the person taps it, or
opens the thing it points at — opening the Support thread marks that thread's reply notices read,
because the reply is on the screen the person tapped for. Listing never marks anything. Dismiss is the
Library card only and is not reading.

**Support lands by trigger, not by cron or poll.** The brief offered the doorbell cron or the thread
poll and said "choose the cron" if ambiguous. Neither is the single point where a reply is known to
have landed: the reply row is written by the watcher on watson-1 with the service key, outside this
app's API, and the cron runs hourly with a three-hour delay, so the avatar badge — an instant
`?peek=1` until today — would have regressed to hourly. An AFTER INSERT trigger on `support_messages`
fires wherever the row comes from, is instant, and fans out to the thread's admins with the same two
admin spellings `schoolScope.ts` uses. It never fails the reply insert. Better (instant, every
writer), simpler (no cron change, no poll change), cheaper (no hourly scan). Deviation from the
brief's default, named.

**Removed from the UI, named:** the unread dot on the Support entry of the schools account menu.
The count now lives on the new Inbox entry above it and as a dot on the avatar. The `?peek=1`
endpoint still exists and still answers; nothing calls it. `useSupportChannel.peekUnread` is
therefore unused code, left in place for one release rather than deleted in the same change.

**Undo is exact and refuses when it cannot be clean.** `undoCopy` deletes precisely the `newId`
rows the audit record lists per table, children before sessions, restores the class cursor to
`cursorBefore.target`, and appends an undo audit row so the trail stays append-only. It refuses when
the class account holds a session or a diary row newer than the copy that the copy did not put there
— then the message says so and offers nothing. After an undo the copy can run again: `priorCopied`
ignores undone runs.

**The seam for the sibling teacher-play sweep.** Nothing to call. `applyCopy` sends the notice
itself, so any caller of the copy engine sends it; for audit rows that predate this, the backfill is
`POST /api/messages/backfill-copy-notices` with an ssi_admin bearer, or `backfillCopyNotices(svc)` in
`api/_utils/copyPlayNotice.ts`. Helper signature:
`sendUserMessage(svc, { recipientUserId, source, title, body, action?, dedupeKey? })`. The dedupe key
`class_play_copied:<audit_id>` makes double-sending impossible whichever lands first.

**Dedupe key for support replies is per recipient** — `support_reply:<message_id>:<recipient>` —
because a school can have more than one admin and one key cannot serve two rows. The brief's
`support_reply:<message_id>` is the prefix.

**Migration.** `20260914e_user_messages.sql`, applied live through the postgres role, additive only:
RLS on, own-row SELECT, own-row UPDATE with a column grant on `read_at` and `dismissed_at` only,
inserts service-role only. `schema.sql` refreshed; the snapshot also picked up job #680's
`support_inbox` view, which had not been snapshotted.
## 2026-09-14 — The one-off teacher-play sweep: five unambiguous copies, and what the strict rule costs (job #685)

**Ruling (Tom, 16:30Z, via the RBF room).** "wherever there is no ambiguity - i.e. one teacher, one
class, and no play as class data, we should copy it all over ... they can always skip back to the
beginning easily on the play as class account." And, on telling them: "we DO want to be able to
send them in-app messages about stuff like this." This SUPERSEDES #662's "there is deliberately NO
bulk apply" — but only for the unambiguous cases. The per-pair admin card stays exactly as it is,
and everything ambiguous stays on it.

**The four conditions, plus two of our own.** A pair is unambiguous when: one teacher on the class,
by the same union of `classes.teacher_user_id` and active class teacher `user_tags` that
`candidates.ts` builds; that teacher on exactly one class ACROSS THE PLATFORM, not just within her
school; the class account with zero play on the course, read as direct row counts in every
COPY_TABLES table and not merely the enrolment row; and real own-account play to copy. Two further
exclusions were ours, both conservative, both listed rather than copied: a class whose only teacher
IS the school admin reads as an admin or test class — Angharad's own account on her own admin class
was one of #662's 27 — and a class belonging to no school is outside a schools sweep.

**The distribution is the finding.** 43 schools, 183 classes, 190 pairs → FIVE unambiguous copies
totalling 336 rows, and 182 ambiguous. Chepstow alone listed 27 candidates under #662's looser
rule; the strict rule takes the whole platform to five. The dominant filter is not play at all: 91
pairs fail because the teacher teaches more than one class, and 38 because the class account
already has play. None of the five carries any practice minutes, so no headline hours move
anywhere; what moves is a class's position and its diary, from S0001 to S0003.

**Reversible by the teacher, not only by an admin.** Every copy sends the teacher one in-app
message whose single tap runs `undoCopy` — job #684's inbox primitive, `POST /api/messages/act`.
The undo deletes exactly the rows that copy created, from its own audit record, and restores the
class's own cursor. `priorCopied` now subtracts anything since undone, so an undo genuinely
restores the pre-copy state and a later copy can run again rather than silently doing nothing.

**Two implementations, one kept.** #684 and #685 both built the undo and the notice. We took #684's
whole — it owns the inbox, the one-tap route, the dedupe key and the backfill — and dropped ours
rather than leave a merge conflict in one file for a human to settle. The one behaviour lost with
it: ours deleted the class's `course_enrollments` row when the class had none before the copy,
where #684's restores a cursor only when there is one. No pair in this sweep is in that case.

**Not done, and why.** The apply is armed and HELD. Tom's own sequence was dry-run plan first,
published, then apply; the plan is published and no reply had arrived by the end of this job, so
nothing was written. One sentence runs it.

## 2026-09-14 — View As never writes in the viewed person's name; today's five empty support threads are gone (job #681)

**Ruling (Tom, 15:51Z, on Watson's finding that four real schools "opened a support thread today and
typed nothing").** "That MIGHT have been me, using View As" — and then, at 15:54Z, his testimony:
under View As he TRIED to send a support message and it would not let him. So the decision: "viewing
as a school admin/teacher must never create rows in that person's name", and the empty threads from
today are removed "if they carry no text". On the shape of the fix, his words: ONE guard covering the
whole support action — creating the thread, sending, marking read — applied once at the entry of the
action, not a second patch on the send step.

**The no-op reading, not the stamped-viewer one.** Tom offered two: no-op under View As, or stamp
`viewer=<actual user>` and exclude from the support inbox. No-op wins on all three legs — it adds no
column, no inbox filter and no new state, and the thing a tour needs from Support is to SEE the
screen, not to write on it. Every write the action can make now stops at
`refuseSupportUnderViewAs` at the entry of `api/support/thread.ts` and `api/support/messages.ts`.
The screen says so in one sentence instead of showing a failure, and the top bar does not peek the
unread dot at all while viewing-as.

**The second gap, which the enumeration found and the commission did not name.** View As LANDS on
the org lens at `/org/<id>`, whose action bar and ways-in ledger write to the group routes: create a
sub-group, rename it, DELETE it, mint demo activity, mint an invite, create or update a school.
Every one of those carries a deliberate ssi_admin bypass, so the protection the rest of the estate
leans on — an ssi_admin has no school or group scope of their own, so the route 403s naturally — does
NOT hold on them. `refuseViewAsWrite` now sits at the entry of all seven, refusing by METHOD so a
tagged GET still renders the lens.

**Who actually created the five threads.** Not View As. Tom's ssi account (`ef65ea1f…`) has no active
school tag, no `schools.admin_user_id` row and no `govt_admins` row, so `resolveSupportScope` returns
null for it and both support routes answer 403 — which is exactly the refusal he felt. The Monmouth
thread at 14:35:19Z, twelve seconds after a View As session started, is a coincidence: that session's
target was Chepstow, which already had a thread from 07:13, and four Monmouth staff self-tagged into
that school at 14:44-14:45, so its own admin was live in the dashboard at the time. All five are job
#677's peek defect, still running on production because the fix is on dev and staging and not yet
promoted to main.

**Production cleanup, applied 2026-09-14 16:06Z.** Each of the five re-read at the moment of
deletion and refused if it had gained a message; none had. Before: `support_threads` 6,
`support_messages` 4. After: `support_threads` 1, `support_messages` 4. The survivor is the ZZ Test
school's thread with job #302's four probe messages. The IME Demo Programme group thread was not one
of Tom's named four but is the same defect with the same emptiness, so it went under the same rule.

## 2026-09-14 — LEGO becomes Phrases in learner and school copy; the Where-you-are rail names only the open view (job #674)

**Ruling (Tom, 14:42Z).** On the word: "can we retire LEGOS for learner-facing language? that's really
internal language for us / we can call it / Phrases? / I think that will cover it." On the rail line
that #628 added beneath you-are-here: "It's not THAT clear that we're in Overview OR Insights / I
think it should only show one of these, right? / I'm not sure it should show both, but if it DOES,
then it should be clearer which one of the 2 views we're looking at right now."

**Decision, the word.** Every learner- and school-facing string that said LEGO or LEGOs now says
phrase or phrases: the teacher table's journey column, the class and school journey bars, the
students and class-detail columns, the student-progress belt line and retired count, the org
children list, the insights rate measure and its caption, the voice-pause panel, the player's
next and previous tooltips and jump messages. The unit and the "Furthest phrase" line on the
insights page come from the two rate-compare API routes, so those changed with the client. The
three teacher-table figures now read as three things: "Journey, phrases" for position in the
course, "Phrases practised this week" for the practice count, and "Rate of progress (new phrases /
week)" for the rate, with the tight figure caption reading "phrases / week" as Tom quoted it.
Handbook sentences on the four capabilities that named the unit were rewritten and re-pinned.

**What stays.** Internal vocabulary is untouched: i18n keys, props, columns, data-walk anchors,
CSS classes, code comments, console lines, the LegoAssembly component, and every admin-gated or
developer surface: the settings view-script and debug-overlay rows, the practising-mode test
switch, the Course Explorer, the methodology page, the /intel boards, the release-notes
placeholder. Handbook keywords keep "lego" so a search for the old word still finds the entry.

**Locales.** Welsh, Spanish, French, Italian and Portuguese had the bare token replaced with the
language's word for phrase in the six non-settings keys. The other twenty locales keep their old
wording for those keys because the pending-translation register only accepts keys missing from a
locale, and these exist everywhere. They are listed as awaiting translation in the job's grep
document.

**Decision, the rail.** `NodeMapRail.vue`'s lens line names the open view only, capitalised as
Tom wrote it, "Insights" or "Overview", as plain text under you-are-here at the same indent. The
"· other" span, the switch handler and its aria-label are gone. The `lens` prop keeps both paths
so neither caller changed; the LensTabs pair top-right is the switch. The #628 entry below
records the state this supersedes; it is left as written.

## 2026-09-14 — Listening Mode: cut the mode captions and the scene progress bar (job #650)

**Ruling (Aran reviewing production, Tom agreeing, 2026-09-14).** "Probably don't need the Each
line four times bit, and I'm not sure we need the progress bar in there"; "The whole scene in
the target language, at your pace, probably don't need that either"; "AI overexplanations etc".

**Decision.** In `ListeningOverlay.vue` the two one-liners under the Immersion / Drill toggle are
gone, and so is the hover `title` that carried the same words. In a dialogue scene the transport
progress bar and its percentage are gone, and so is the 2px ambient hairline at the top edge,
which was the same signal drawn twice. All and Core keep their bar: those lists run to hundreds of
rows and the bar is the only position there. The "Scene N · time" strip stays as the orientation.
Swept the rest of the surface: "N sentences" on a scene card, "N scenes" plus the offline chip on a
pod card, the Speed label and the empty or offline states are information, not explanation, and
stay. "Tap to play / tap to pause" under the All and Core list is a prompt, not an explanation,
and stays. The "Audio only, no speaking" line on the mode tray is outside Listening Mode and was
not touched.

**Better × Simpler × Cheaper.** Better: the scene view reads as the dialogue, not as a manual for
it. Simpler: two fewer strings, one fewer element, one CSS block deleted. Cheaper: nothing new.

## 2026-09-14 — Vercel builds `dev` only when the commit subject carries `[preview]`; staging and main build on every push (job #619)

**Ruling (Tom, 2026-09-14 00:32Z).** Asked "make learning-app dev builds opt-in on Vercel, staging
and main always building. Recommendation stands at yes." Tom: "Yes".

**Why.** The Aug 12–Sep 11 Vercel month was $467, $366 of it Build CPU Minutes. The preview gate of
2026-09-12 removed worker-branch builds; the first build-hours reading, job #610, showed the
remainder: of 12.4 build hours in 24 hours, 10.5 were this app's builds on `dev`, one ~13-minute
build per merge, and nobody looks at most of them.

**The setting, and where it lives.** The Vercel project's Ignored Build Step, PATCHed through the
API, never an `ignoreCommand` in `vercel.json`, which overrides the dashboard rule and is the
mistake the hexagon workers made on 2026-09-13. `vercel.json` here carries no such key; keep it so.

Before, verbatim:

```
case "$VERCEL_GIT_COMMIT_REF" in main|dev|staging|preview/*) exit 1;; esac; printf '%s' "$VERCEL_GIT_COMMIT_MESSAGE" | head -1 | grep -q "\[preview\]" && exit 1; echo "skipped: previews are opt-in (preview/* branch or [preview] in commit subject)"; exit 0
```

After, verbatim, read back from the API:

```
case "$VERCEL_GIT_COMMIT_REF" in main|staging|preview/*) exit 1;; esac; printf '%s' "$VERCEL_GIT_COMMIT_MESSAGE" | head -1 | grep -q "\[preview\]" && exit 1; echo "skipped: dev and other branches are opt-in ([preview] in subject or preview/*)"; exit 0
```

Vercel caps the command at 256 characters, hence the short skip message. Exit 1 means build.

**What it means for everyone.** A plain push or merge to `dev` no longer builds, so the dev alias
`ssi-learning-app-git-dev-zenjin.vercel.app` no longer updates on it. An agent that needs the dev
alias to show its change puts `[preview]` at the start of the merge commit's subject, first line
only. `staging` and `main` build on every push exactly as before, so the release train, the
Colombo test team and real learners are untouched; the release-train scripts push only reports and
notes to `dev` and never needed a build. The same `[preview]` convention as the preview gate.

**The nightly scan.** `command-surface/ops/vercel-gate-scan.js` now treats a learning-app `dev`
deployment whose subject lacks `[preview]` as off-allowlist, so a READY one turns the night RED
like a worker-branch build. Its first run after this change will list the day's pre-change dev
builds as RED once; the window is 24 hours and they roll out the next night. The same commit fixed
the month-to-date figure that Astra #613 found summing overlapping windows.

**Proof.** Two docs-only pushes to `dev`, each a fresh SHA. Push 1, merge `ff5f9fc6e` with a plain
subject: deployment `dpl_E5kotR4qzuc34nWb1y1wxrhJLnm4` CANCELED, container 4 seconds, never READY. Push 2,
merge `77dd34852` with `[preview]` at the start of its subject: deployment
`dpl_BAk8r3K1QtiwH3BkvfGfZXsjTdnx` READY after 14 minutes, holding the alias
`ssi-learning-app-git-dev-zenjin.vercel.app`. This sentence rode a third plain-subject merge, which
was cancelled the same way as push 1. A side-lesson from push 1: the branch commit's subject quoted the literal text
`[preview]`, so the gate built the worker branch; that build was cancelled through the API after four
minutes. Never quote the marker on a subject line unless you mean it.

## 2026-09-13 — Listening Mode: the Senedd pod is a named extra slot for every Welsh (Northern) learner (job #605)

**Ruling (Tom, 2026-09-13 20:31Z).** Open `cym_n_for_eng:senedd-s4c-steve` to all Welsh North
learners. Popty does that by clearing `listening_pods.required_role` (job #605's gated script); this
entry is the player side that the flip depends on.

**What the flip alone would have done.** `resolveListeningPods` listed a topic pod only through the
role arm (rule 5) or the closed allow-list of NAMED core slugs (rule 6). The Senedd pod is
`pod_type='choice'` on its own slug, so with `required_role` NULL it matched neither arm and vanished
from Listening Mode for everyone — Steve included. Found by reading the query before running the
UPDATE; the job's after-check (a plain learner sees Senedd as a card after Pod 1) could not have passed.

**Decision.** `LISTENING_EXTRA_POD_SLUGS` gains `senedd-s4c-steve`, and each named slug now carries
the ONE `pod_type` it may hold (`LISTENING_EXTRA_POD_TYPE`: method-pod → core, senedd-s4c-steve →
choice). The allow-list stays closed and per-slug, exactly like rule 1: `spa_for_eng:music` and
`travel-situations` (live, choice, unrestricted) are still not listed, because nobody has ruled on
them. A named-slot row the server sent on the strength of a role is still recorded `addressed`, so
the offline snapshot rule for holders is unchanged. Main flow never reads any of this: pod-1 plays,
the Senedd pod is a card after it, never in its place (job #544 behaviour, kept).

**Not done, deliberately.** The offline bundle (`api/courses/[code]/bundle.ts`) keeps its own
closed list of `pod-1` and `method-pod`; the Senedd pod is 567 lines of audio and putting it in every
Welsh learner's download is a size call Tom has not made. It listens online, exactly as it did for its
role-holders.

**Proof.** `servedPod.test.ts`: "a PLAIN learner lists pod-1 FIRST, then the Senedd pod under its own
title, once required_role is NULL" — recorded RED on the pre-fix resolver (list was `['pod-1']`),
GREEN after; plus main-flow-untouched and listed-once-for-a-lingering-holder. 63/63 across
servedPod and listeningMetaCache.
## 2026-09-13 — Under View-as, a class row opens the class; the link tree follows the route, and a view-as player writes no telemetry (job #602)

**Decision.** `useSchoolsNav.schoolsLink` decides which URL tree a link belongs to from the route
the caller is standing on — a path under `/admin/` gets the ssi_admin read-view links, anything
else gets the member `/schools` links. The `isAdminView` provide keeps exactly one meaning,
read-only browse, and is never read as "I am on the admin tree". Alongside: `usePlayerLog` drops
its buffer while an admin is viewing-as, and `/api/player-events` refuses the `X-Ssi-View-As`
header through the existing `actAsGuard`.

**Why.** SchoolsContainer provides `isAdminView=true` under view-as so every write control hides
for free, but `schoolsLink` used the same flag to choose the `/admin/schools/:id` tree, and on
`/schools/classes` there is no `:id`, so a class row built `/admin/schools/undefined/classes/<id>`.
The admin route guard bounces that to `/` because admin access is deliberately off while
viewing-as, which is the "class row opens the player" Tom saw on staging at 23:52. The
"Your course was updated" toast was a stale flag from an earlier background revalidation of
his own course, consumed because the player mounted; it is not a write. The player that
mounted DID write: `course_enrollments` upsert and patch on the admin's own learner were
refused in the browser by the fetch guard, but the telemetry flush inserted `player_events`
rows (`infplay_enter`, `cold_start`, `infplay_exit`) under the admin's own learner
`81987d60-0c00-4553-8a36-79f83cdf1774` — the endpoint ignored the header and `sendBeacon`
never passes through the fetch guard. Better: the class opens in place and view-as writes
nothing anywhere. Simpler: the route is the truth for which shell rendered the link, one flag
keeps one meaning. Cheaper: three small edits, no new state.

**Proof.** `useSchoolsNav.test.ts` (red on pre-fix code with exactly the production URL,
green after), `usePlayerLog.test.ts` view-as case and `api/player-events.test.ts` view-as case
(both red before, green after). Reproduced and re-verified on staging with
`e2e/_602-viewas-class-row-probe.mjs`.

## 2026-09-13 — Listening Mode: a pod line never spoken in the target language shows its known text as the line (job #591)

**What the pre-release check found.** Job #591 drove the Senedd pod (`cym_n_for_eng:senedd-s4c-steve`,
567 lines, 160 scenes) on production as a previewer_001 holder, in Immersion, with a headless phone
viewport: start, middle, end, the three clip-less lines, and a full-pod run. The line-by-line walk
holds — the lit card follows the clip, the breath groups walk inside long lines, scenes segue, and
scene 160 wraps to scene 1. Two of the three clip-less lines are the pod's English-only contributions
(scene 15 line 79, scene 17 line 82): `podModalQueue` plays their known clip, as Tom ruled on
2026-09-03, but the card was rendered from `pair.target`, which is empty, and Immersion keeps glosses
off — so the learner heard ~4 s of English over a BLANK white card, lit. The third (scene 13 line 70,
"Fyddwch chi'n embedio hynny hefyd?") has Welsh text and no recording: it is lit for about a second in
silence and the walk moves on. That one is a content gap for Popty, not a player defect.

**Decision.** `playback/podLineText.ts` carries one rule, `podLineShown(target, known)`: a line with
target text shows it, with the known as a gloss; a line with NO target text shows its known text AS
the line, in the known language, with no gloss underneath. Both Dialogues card branches (the
current row's sentence pairs and every other row) render through it. The words on the card are the
words in the ear. Core / All rows are untouched — a seed row always has target text.

**Proof.** `podLineText.test.ts` fails on the pre-fix template and passes after; probe
`$CS_SCRATCH/senedd-probe.mjs` shot the blank card on production before the fix.

**Premise correction (Tom, 21:06Z) and the accounting, verified against the live DB.** Tom's read was
that these lines should already have Welsh text and an Aran take, and that the display fix was
papering over a dropped pointer. Checked line by line: (1) row 70 has Welsh text ("embedio", Aran's
proofread of 11 Sep) and an Aran take on file (clip `2edfb987`, 11 Sep 14:57) — but that take reads
the PRE-proofread wording "gwreiddio", so it does not match the row's text and must not be linked;
the booth already lists row 70 as Aran's one remaining unrecorded line under the new wording, so
his next read closes it with no manual link. (2) Rows 79 and 82 have never had Welsh text: the
11 Sep snapshot says "no Welsh text yet", the audit log shows no edit since the 3 Sep import,
Kai's 10 Sep translation pass did not cover them, and no clip of any Welsh for them exists. That is
a translation gap for Kai, then a read for Aran — not a link. The #569/#590 wrong-voice rows (1,
42, 47, 60, 518, 531, 534, 565) are different rows. So the display rule stays as the fallback for a
genuinely untranslated line, which is exactly what 79 and 82 are today.

## 2026-09-13 — A pre-#544 offline snapshot maps forward on read and heals once online: the Senedd pod is never "Pod 1" offline either (job #553, orchestrator's decision under BSC, finishes #544)

**The gap.** Job #544 fixed the resolver: a role-addressed topic pod is its own Listening Mode card after pod-1, never in place of it. Online and for every new snapshot that held. But a snapshot written to a role-holder's device between 2026-09-03 and 2026-09-13 records the Senedd pod as the served pod and carries no pod-1 at all, and nothing rewrote it: its empty extras list came from a live read, so the once-per-session heal was satisfied, and the content stamp had not moved. Cold-verify #552 reproduced it in memory with the real functions. Offline that device listed the Senedd pod in the first slot, labelled by the slot when the entry predated the title field, and main flow's pod lap played it. The population is role-holders who booted Welsh Northern in that window, which includes Tom's own device.

**Decision.** Copy the pod-0 precedent from job #512: map the old shape forward on read, in the one place every offline reader already goes through. A snapshot whose served slug is anything but pod-1 is treated as pre-fix. On read, the served slot holds pod-1 when a real pod-1 is found among the extras and is empty otherwise, which is exactly what a learner with no pod-1 downloaded has, so main flow never plays the topic pod; the recorded pod becomes an addressed extra after the named ones, under its own row title, or a reading of its slug when the entry predates the title field, because the one label it must never wear is the slot's. Its rows and every clip they name stay, so nothing downloaded goes dark. The read stamps the entry with the slug it found, and the heal gate treats that as a third reason to refetch, so the next online boot rewrites the entry the way the fixed resolver lists it, once, and a healed entry carries the stamp no longer. Cached audio is never cleared. Better: the Senedd pod is never Pod 1 anywhere, and the wrong entry corrects itself. Simpler: one pure function beside the pod-0 one, one extra clause on the existing gate, no new lane. Cheaper: one refetch per affected device, the same refetch the pre-slot and degraded cases already pay.

**Proof.** Five tests in the cache suite fail on the pre-fix module and pass after: the pure map in three shapes, an offline mount of an old-shape entry whose every scene sits under the Senedd title outside slot 0 with no pod-1 scene, and an online heal that refetches the old shape once and never again. The pod-1 snapshot, pre-slot, degraded, once-per-session and mark-after-success cases stay green; sixty tests across the cache and resolver suites; typecheck clean apart from the pre-existing missing `@capacitor/cli`; lint zero errors.

## 2026-09-13 — Pod-0 does not exist: every course's core listening pod is pod-1, and pods by topic carry their own names (job #512, Tom's ruling 14:44Z)

Tom, verbatim, relayed by RBF: "Pod-0 does not exist anymore. There should be zero references to it in code or docs or briefs. There is only pod-1 now. And then pods by topic like Method Pod, Senedd Pod, Health Pod."

This entry and the header of `packages/player-vue/src/composables/servedPod.ts` are the single migration note. What it means for this app: the resolver serves `pod-1` only and every unknown resolves to `pod-1` (never "no pods"); parked slugs are `unrecorded`, `gated-<date>` and `retired-<date>`, and rule 1 stays exactly as hard. The production data was renamed the same day, one transaction per course, learner progress and provenance pointers moving with it. Old ids in old data still carry the old segment; an offline snapshot written before the rename is mapped forward on read in `listeningMetaCache.forwardLegacyPodSlug` — the one place in the app the retired name may appear as live behaviour, and it can be deleted once no device could still hold such a snapshot. Applied-log JSONs under `docs/pod-position-audit/` are the record of writes that happened and keep their ids as written.

## 2026-09-13 — The schools dashboard grades nothing: class, school and student health stripped (job #494, Tom's ruling)

**The ruling.** Tom, on his phone, looking at the classes page, 01:09Z: "Also what are these classifications and how did they arise? We don't make any attributions to any class performance. So this thinking isn't mine. The school admin wants time in app. And that's basically it." Watson proposed stripping the whole health layer; Tom at 12:28Z: "yes strip class grading." A softer flag was offered and declined, so no quiet-this-week marker replaces it.

**What went.** The classification was a worker's invention from the May re-skin, hardened in later jobs. Removed from every learner-facing schools surface: the four summary tiles on the classes page, the Health picker, the Health column and CSV field, and `classHealth.ts`; the school-level bucket in `useSchoolData` and the dot on the leader's schools list and dashboard tiles; the per-pupil grade on the Students page and the class roster, including the "need attention" count in the Students headline. Twenty-seven health i18n keys dropped across all 24 locales; three replacement strings minted and enrolled in the pending-translation register. The Handbook sentences for the classes list, filters, export, year-group tiles and student lookup were rewritten in the same edit and the pack recompiled.

**What stayed.** The page head still says N classes and minutes in the app this week, so the classes page carries its week figure with no second tile; the year-group blocks stay; each class row keeps course, belt, journey, time in app, the sparkline, copy link and play. "Not started" survives as a fact on the belt, journey and minutes cells. `HealthDot.vue` and the four `--schools-health-*` tokens stay in the tree because the admin org tree, `NodeChildrenList.vue` under `/admin`, still renders a per-learner health word; that is an ssi_admin surface outside this ruling and is named here as the one place the grade still exists.

**Proof.** `TeacherDashboard.noGrading.test.ts` fails on the pre-change page, saying "Excellent", and passes after. Twelve covering test files and the locale parity gate green; typecheck clean apart from a pre-existing missing `@capacitor/cli` in the shared install; lint zero errors.

## 2026-09-13 — The six-test fix left the parity gate red on all 24 locales; the ways-in walk's two step-5 keys enrolled, staging promoted (job #483, CI red on staging)

**What the red was.** Staging's nightly at 9ece60b0 showed the same six player reds as dev and main: four 2026-09-12 commits (#306, #340, #354, #379) that outran their test twins. Jobs #482 and #484 landed the four fixes on dev first; this job's copies were byte-identical and were dropped. But a full ci-check of dev's tree with real deps found a second-order red those fixes had not seen: `useI18n.localeParity` failed for every one of the 24 locales, because regenerating the ways-in mirror moved the walk's terminal line from step 4 to step 5 and minted `steps.5.say`, and `i18n/pending-translation.json` still enrolled the old key and neither new one.

**Decision.** Enrol `walkthrough.ways-in.steps.5.say` and `.terminal`, drop the stale `steps.4.terminal`, on dev at 976bd2be5. Then promote dev to staging as one merge, c0bde54a9, carrying exactly the seven files dev held beyond staging: the four test twins, the codeGen set check, the enrolment and the journal. Nothing skipped, no assertion weakened, no timeout raised. Better: staging's gate is green for the right reason. Simpler: the register is the mechanism the parity test itself names. Cheaper: one merge, verified once.

**Ownership on the night.** Three workers were spawned for the same red. Agreed by message with job #486: staging is this job's, main is #486's, dev carried the shared fixes; nobody pushed over anybody.

**Proof.** ci-check on c0bde54a9 with real deps under the CI node20/pnpm8 toolchain: seven of seven green, player-test 3909 passed. The earlier run in the same worktree with node_modules symlinked to the shared checkout was red on typecheck and on SettingsScreen tests for a reason that was the environment, not the code: `@ssi/core` resolved to another branch's dist. A worker verifying a promotion must install its own deps first.

## 2026-09-13 — The api nightly's one red: the codeGen letter test was too slow for a loaded box, not wrong (job #482, CI red)

**What the red was.** `api/_utils/codeGen.test.ts` timed out at 5 s on dev. The code has not changed since the SEC25 keyspace fix; the test made forty-five thousand expect calls over five thousand draws and took 2.8 s the night before, 4 s on main the same night, and past 5 s on dev. The six player reds from the same run were the four Friday-ship commits that outran their tests; job #484, spawned for main's identical red, landed those fixes on dev first and its entry below records them. This job's copies of the same four edits were byte-identical and were dropped in favour of #484's.

**Decision.** The letter test keeps its five thousand draws and checks the set of letters seen, so it proves exactly what it proved before in a few hundred milliseconds. No timeout was raised, nothing skipped. Better: the gate stops flaking under load. Simpler: one loop, three asserts. Cheaper: the slowest api test no longer costs seconds.

**Gap left open.** eng.json's walk mirror is hand-kept and localiseWalk.ts calls it generated; no tool writes it, so it will drift again on the next walk edit. The drift test catches it, which is what happened here. A compile step that writes the mirror would make it impossible. Not done here.

**Proof.** Red on the pre-fix tree under nightly load; green in this worktree with the CI-pinned node, 4 of 4 in the file.

## 2026-09-12 — Preview builds are governed by the Vercel dashboard rule alone; the in-repo `ignoreCommand` is gone (job #460, Watson's decision)

**Why.** The Aug 12–Sep 11 Vercel bill was $467, $366 of it Build CPU Minutes from ~8,962 preview deployments, one per push of every worker branch. RBF set an opt-in Ignored Build Step in the Vercel dashboard on every project: main, dev, staging and `preview/*` always build, a commit whose message carries `[preview]` builds, everything else is skipped. But a 2026-09-09 job had written an `ignoreCommand` into `vercel.json` (main|dev|staging build, everything else skipped) and Vercel gives the in-repo key precedence over the dashboard, so the dashboard rule only governed branches that lacked the file, and there was no route to a preview on this repo at all.

**Decision.** One rule, in one place: the dashboard's `commandForIgnoringBuildStep`. The `ignoreCommand` key is deleted and nothing else in `vercel.json` changes. A worker that wants a preview URL pushes a `preview/*` branch or puts `[preview]` in its commit message; it never edits `vercel.json`. Worker branches cut before this landed still carry the old key and are not re-swept: they merge main when they want a preview. Better: previews exist again, opt-in. Simpler: one rule, not two that shadow each other. Cheaper: the build bill falls by the preview share, and nobody maintains a case list in a JSON string.

**Landing.** This is the promotion train's deploy config, not player code, so on Watson's call the identical commit lands on dev, staging and main directly, the same way the key arrived in `d76264d3`.

**Proof.** The Vercel deployment records after landing, read from the API: dev, staging and main each build READY; a `preview/probe-460` branch builds; a plain branch carrying this commit is skipped.

## 2026-09-12 — Release notes are three learner headlines plus ONE line, enforced by the train; the 2026-09-12 notes hand-edited to that shape and hotfixed to main (job #455)

**Tom's ruling.** "Ok. So, the release notes for the latest version in Main are crazy. 3 biggest headlines and then + plus squished some bugs and stuff." And, relayed the same evening: that shape is already the standing rule for release notes, and this release broke it, so find where the rule lives and why it was bypassed, and make it enforced.

**What shipped, and why the gate let it.** The 2026-09-12 promote regenerated `tools/release-train/notes/2026-09-10.md` from 219 commits: three headlines, two of them raw `Merge cs/NNN:` subjects, and forty one-sentence lines below the fold. The 2026-09-08 gate held exactly what it was written to hold, at most three headlines and one sentence under 140 characters per read-more item, and it fired on the promote path and passed, because nothing had ever capped the catch-all's count, by the 2026-07-31 ruling that nothing shipped goes unmentioned. The merge subjects reached bullets because the process filter recognised only `Merge branch` and `Merge pull request`, not the surface's `Merge cs/NNN: subject` and `Merge cs/NNN-slug into dev` forms, so each merge became a generic bullet beside the commit it merged.

**Decision.** The notes for this ship were rewritten by hand to the three learner headlines, airplane mode, Immersion in Listening Mode, and the Report a bug sheet, plus the one line in Tom's words, and went to main by the hotfix lane, back-merged to staging and dev, because only main deploys to learners. The hand-authored Supabase `release_notes` row was deliberately not used: two sources for one day is the drift the code already complains about. Hand-edited notes are a first-class path and remain so. In the tooling, Tom's 2026-09-12 ruling wins over 2026-07-31 and 2026-09-08 where they differ: `renderFinal` and the Thursday draft both produce exactly three one-sentence headlines and one line below the fold, default "Plus we squished some bugs and stuff."; the per-item record moves into the draft-only coverage block that finalise strips, so a human editing before GO sees what shipped and the learner never does; the finalise gate refuses a final with more than one catch-all line; hand-written headlines take the slots before the machine's; the surface's merge subjects are process commits; and promote.sh, which must never block a code ship on notes, prints the gate's reason in its failure banner and tells the ship's report to carry it. Better: a learner reads three lines and one, never an essay, and the generator is right by construction rather than by hand. Simpler: one constant, one count check, two regexes, no new file or surface. Cheaper: the Friday regeneration needs no human rescue.

**Proof.** `release-notes.test.mjs`: the new test renders a final from three features and six distinct fixes and asserts exactly one line below the fold, and that the gate throws on two; red on the pre-fix generator, which produced six lines, green after. The finaliser run dry over the real promoted range 5ea385e..ca46ec8 reproduces the notes now on main to the letter. 46 of 46 across the two release-train test files.

## 2026-09-12 — Dialogues opens on pod cards, one per pod slot, each with an offline-readiness word (job #428, dev only)

**Tom's ask.** "Can we look at making the Pods more navigable? So perhaps cards at the top linking to each pod rather than the complete lists of scenes?" and "Let's do these on dev so we can promote staging to main cleanly." The method pod vanishing offline had made the flat list feel like it hid pods rather than presented them.

**Decision.** The Dialogues tab opens on one card per pod the course lists, in list order, titled from the pod's own row, and a single-pod course still gets its one card. Each card carries one of three words computed from the clips on the device against the estate's existing ready threshold: Ready offline, Downloading, Not yet. Tapping a card opens that pod's scene list alone; the top-left circle goes back to the cards; play all and scene-to-scene continuation are scoped to the open pod, since a learner who chose a pod wants that pod. Offline with none of a pod's clips on the device, the pod's list shows the existing offline message rather than silence. Cards are stacked full-width rather than a horizontal row, because the real titles are long. Better: what exists, what is playable and what is coming is visible instead of invisible plumbing. Simpler: the grouping is derived from the scene list every path already produces, one pure helper owns the readiness read, and no poller, table or endpoint was added. Cheaper: the readiness recomputes only when the shared download counters move or the learner returns to the cards. Landed on dev only; not promoted, so the staging soak is untouched.

**Proof.** `podReadiness.test.ts` pins the grouping and the three states, red before the helper existed. The compiled-SFC scope test, the other ListeningOverlay tests and the locale-parity test are green.

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

## 2026-09-12 — Listening Mode tidy: one fetch-order primitive, one snapshot story, comments that match the code (job #429·F)

**Commission.** Tom: "Listening Mode probably needs a Fable tidy up. Let's do these on dev so we can
promote staging to main cleanly." Dev only, behaviour byte-identical, landed beside job #428's pod
cards without touching the scene-list region they own. Inventory of the shape first, read-only:
https://watson-1.tail4968cb.ts.net/d/736f4b9b — 18 items, no genuine bug found.

**One fetch-order primitive.** #379's report said both fetch paths shared "one pure builder"; Astra's
cold-verify read two. `playback/offlineDownloadOrder.ts` now has one, `orderTiers(...tiers)`, and
`buildFetchAheadOrder` and `buildOfflineDownloadQueue` are typed views onto it. Order unchanged:
head rounds, every pod slot, Layer-1, the course. Two comments in `LearningPlayer.vue` that still
described the retired 2026-09-01 weave now cite #379; the code under them was already right. The
APML fillBuffer entry said cycles-then-pods, the pre-#379 order; it now says what the code does.

**One snapshot story.** `listeningMetaCache.ts` opens with the snapshot's life in order: write,
first-write-on-boot with its heal, staleness, read, withdrawal. The #379 and #424 heal reasons are
one named predicate, `snapshotListsEverySlot`, rather than two paragraphs of exception in the gate.
`collectListeningMetaAudioIds` composes the pod collector instead of restating it, same ids in the
same insertion order. In `servedPod.ts` the three degraded arms of `resolveListeningPods` read one
snapshot helper instead of two cache reads each; the degraded mark is set exactly where it was.

**Overlay, outside #428's region.** The always-true `showSpeedRow` computed and its `v-if` are gone.
Two orphaned docblocks that described a pre-IndexedDB overlay and an 800 ms gap are replaced by one
accurate line on each of the two functions they drifted away from. The play-loop comments name the
`GAP_*` constants and the one-speed t·k·t·t Drill instead of 50/300/800 ms and 1×/2×/2×. The
exposure-ramp header no longer calls the nine-stage pod playlist retired: it is DB-gated by
`listeningUseStagePlaylist`, live true, as the vocabulary pointer already recorded.

**Left alone, on purpose.** The three walkers of `podScheduler.podSentences` in `LearningPlayer.vue`
carry three different field sets; unifying them changes a download's id set, so they stay and the
inventory says so. `LISTEN_MODES` as a computed over a constant is cosmetic. The scene-list template
and its script region are byte-identical for #428, and a dry merge of #428's branch onto this one
auto-merged with no conflict.

**Proof.** No test expectation edited. `offlineDownloadOrder.test.ts` gains one pin that each named
builder equals `orderTiers` on the existing fixtures, which would have passed before the change.
Scoped suites green: order and boundary 12, snapshot/servedPod/listening-pods 52, the four overlay
pins plus the two ramp suites 110; all four overlay test files load and run. Typecheck clean, lint
0 errors. `tools/vocabulary-pointers-check.mjs` exits zero: 30 pointers had drifted on dev before
this job by line number only and were refreshed mechanically, and two whose deciding line had been
reworded by #350 and #325 were re-pinned to the current line.

## 2026-09-12 — Immersion stack for every long pod line: timings when present, punctuation when not (job #430)

**Why.** Tom, on the #408 tracker: "it will help to not just have a massive block of text in the
longer form pods … we could still split them up into single breaths though." The stacked layout is
the win and is independent of the tracker, and most pod lines have no timings to drive one: on
spa_for_eng 451 of 1,052 live pod sentences carry no word timings, and on the Pod-1 / xAI turns
those are the longest lines in the course.

**One component, two sources of line breaks.** `trackerGroupsFor` now returns a stack, `{ lines,
timed }`. Timings that normalise → the lines are the clip's breath groups and the lit line walks,
exactly as #408 ships; a timed clip with a single breath group is still the card. No usable
timings (null, or the viseme-frame shape) → the same stack with lines cut from the sentence text by
`textLinesForSentence`, and the stack carries `.untimed`: no said / lit / ahead state, no fill, no
clock, every line in the card's own colour. One text line → null → the card, unchanged. Drill is
untouched, pinned byte-for-byte as before.

**The cut order and the cap.** Sentence enders first, never packed together — the sentence is the
unit. Then clause punctuation inside an over-long sentence, clauses packed up to the cap so a list
("en Nueva York, en Tokio, en Buenos Aires") is one breath rather than three stubs, and punctuation
beating the cap: when the next clause would overflow the line ends at the comma, unless what stands
before it is a stub under 12 characters (one real breath in ten is under 10, one in four under 14),
which joins the clause after it, so "Bueno," never stands alone above a wrapped remainder.
Then the cap, words kept whole and the overflow balanced into equal lines rather than a long line
plus an orphan. The cap is 60 characters, taken from the audio rather than guessed: across 1,455 timed pod
sentence clips with two or more breath groups, 3,942 real breath groups measure 23 chars at the
median, 52 at p90 and 66 at p95, so a text-cut line is the size of a long real breath. Scripts
without spaces cut only at their own punctuation. Nothing heard changes; this is display only.

**Addendum (job #425, from the #424 cold-verify).** The snapshot heal in `ensureListeningMetaSnapshot`
is called on every round advance, and a snapshot flagged `extrasDegraded` stays flagged while the
session's degraded-lookup memo stands, so one flaky first fetch had the heal re-reading pod rows and
clip texts and rewriting the snapshot on every advance for the rest of the session. The heal now runs
at most once per session per course, marked beside the degraded memo in `servedPod.ts` and cleared by
the same reset. Snapshots written in the few-hours window before #424 that carry an unmarked empty
`extraPods` are left alone; not worth code.

## 2026-09-12 — Pod dialogue changeovers: a jump-in has no gap and overlaps; a turn keeps its gap (job #470)

**The ruling.** Tom, listening to the Italian method pod in Immersion on staging: "The changeovers
between speakers need to be different depending on whether the speakers are jumping in — in which
there should be no gap, in fact it should be overlap if possible, but if not, at least no gap at
all. Whereas genuine turn taking — asking or answering questions etc. — should be as they are now,
with whatever gap they currently have. So it's more like a proper conversation." Popty (job #471)
marks the line: `listening_pod_sentences.jump_in`, nullable boolean, true only for a line that
interrupts; the app reads it on the same select it already makes and carries it as `jumpIn` on the
sentence, the turn and the offline snapshot.

**One rule file.** `playback/podChangeover.ts` owns the changeover. `changeoverGapMs` returns the
overlay's pre-existing gaps for every turn, unchanged and pinned by test — 90 ms on a speaker
change, 50 ms between one speaker's sentences in Immersion, 90 ms in Drill — and 0 for a jump-in in
Immersion. `jumpInLeadMs` is the overlap: the previous clip's trailing silence, from its own word
timings, plus 120 ms into its last word; 250 ms when the clip is untimed; never more than 700 ms or
the clip itself. The untimed figure is measured, not guessed: the method pod's clips carry no word
timings at all, and ffmpeg silencedetect at -45 dB on its 37 interrupted-line clips gives a trailing
silence of 107 ms at the median, 203 at p90 and 300 at most, so 250 ms lands the interrupter about
140 ms into the last audible word on a typical clip. Tom's "half a second before the interrupting
voice is heard" was that trailing silence plus the 90 ms gap clip plus two src-swap latencies. Media time on both sides, so the playback speed cancels out.

**Two elements, one hook.** The overlay's audio controller grows a second element used for a
jump-in only. It is primed with a silent one-shot inside the learner's play tap, because iOS unlocks
autoplay per element and per gesture. The row before a jump-in resolves the next clip's URL while it
is still playing and hands `play()` a near-end hook: an rAF watch that starts the jump-in on the
second element when the sounding clip is within its lead of the end. The next row adopts the clip
already sounding. Where the platform refuses the early start, or rAF is frozen under a locked
screen, the changeover lands on the zero-gap floor — no silence clip, URL already resolved, one src
swap on the main element. Measured in a phone-viewport headless run of the method pod's scene 1:
today's build on dev plays every changeover at 196–318 ms whether or not the line is a jump-in;
this build plays a jump-in 165–194 ms BEFORE the previous clip ends and a turn at the same 249–342
ms as before.

**Drill is untouched, on purpose.** Drill plays each line as target · known · target · target, so
the sound before a line is the third repetition of the previous line with its translation in
between, not the other speaker's turn. An interruption of a drill rep is not a conversation.

**A defect the trace exposed, fixed in the same controller.** The safety timeout that stops a clip
from hanging the list was a flat 15 s, and it cut every pod line longer than that — the method
pod's 19–20 s lines were skipped at 15 s on dev and staging with a "Safety timeout" warning, which
also meant a jump-in after one of them could never overlap. The ceiling now scales with the clip's
own duration at its rate plus five seconds, never less than 15 s.

## 2026-09-13 — Immersion: an untimed line is lit in full from the moment its clip starts (job #479)

**What Tom saw.** Italian method pod, Immersion, staging: "It illuminates JUST the first letter of
a line / Then speaks the line / Then it emboldens the whole line that just spoke and the first
letter of the next one / So it's offset by one." The desired state is the Spotify grammar the stack
was built for (#408): the whole line being spoken lit, lines already said quiet, lines to come dim.

**The cause was paint, not timing.** The tracker index was on the right line throughout — the
probe on the pre-fix staging build shows the `.live` class moving line by line with the voice. But
#468 implemented "no fill is painted inside an untimed lit line" as "no `--fill` set", and the
timed gradient rule then painted that line at its default 0%: `--text-primary` for the first ~2% of
the run, the dim for the rest. When the walk moved on the line turned `.said` (#6f6761, darker than
the dim), so the eye read "the line that just spoke lit up, the next one shows a letter" — one line
behind by appearance only.

**The fix.** One CSS rule in `ListeningOverlay.vue`, after both timed gradient rules and one class
heavier: `.breath-stack.untimed … .live .breath-fill` is `--text-primary`, no gradient, no
background-clip. The timed stack is byte-identical and pinned by test. Proof:
`ListeningOverlay.breathTracker.test.ts` #479 block, seen failing on the pre-fix source and passing
after; `e2e/_479-untimed-live-line-probe.mjs` read the computed paint of every line per frame on
staging before and dev after (`/d/c46c77c5`).

## 2026-09-13 — Nightly red on dev, staging and main: four Friday-ship commits outran their tests (job #484)

**What the nightly saw.** The 02:02 UTC run went red on all three learning-app branches with the
same six failures in four files, one night after all three were green. Every cause is a commit in
the 2026-09-12 ship that changed behaviour deliberately and left a test or a mirror behind.

**The four causes, and what moved.** (1) Job #306 gave the ways-in walk a sixth step, "Tap Show
all", and recompiled pack.json, but the hand-maintained English mirror in `locales/eng.json` still
carried five — so the localised walk spoke the OLD ledger sentence. The mirror is regenerated from
the pack; this is the one learner-facing fix. (2) Job #340 reordered the ten intel questions into
the top bar's grouped order and the file's own header says the array order may move while `n` is
fixed; the test asserted position. It now asserts the set of numbers. (3) Job #379 made the stamp
lane also call `ensureListeningMetaSnapshot`; the audio-stamp test's mock of that module stubbed
only the older function, so the call threw and the drop reported false. The mock stubs both.
(4) Job #354 added `method-pod` to the bundle's slug allow-list as the third Listening Mode slot;
the test pinned the old two-slug list. It pins the three.

**Rule this re-states.** A walk edit is not done until `eng.json`'s mirror matches the pack — the
drift test is the only thing standing between a learner and a stale translated sentence.

**Landed on all three (job #486).** The api red from the same night, the codeGen letter test timing
out under load, was fixed by job #482 on dev, keeping every assertion. That fix and this entry's four
were cherry-picked onto staging and main as they stand, so the ways-in mirror reaches learners on
production without promoting the unruled Listening Mode soak that staging carries.

## 2026-09-13 — Promote staging→main: the schools grading strip reaches production (job #499)

**Ruling (Tom, 13:29Z):** "Yes. And that's a push without ceremony, it's really a fix for schools
only." The promote carried the whole of staging, as Watson told him it would: 63 commits,
`951439ef3..8d3583777`, main now `1a5dc96bd`, live at saysomethingin.app from 14:06Z.

**Two decisions taken on the way.** (1) `promote.sh` refused: main carried seven hotfix-lane
cherry-picks (#460, #477, #482, #483, #484, #486) never back-merged, so main was not an ancestor of
staging. Resolved by the hotfix lane's own rule — `--no-ff` back-merge of main into staging
(`8d3583777`) and dev (`a810b233c`). One conflict, the `_minted` prose string in
`i18n/pending-translation.json`, where staging's text was a superset; the merged trees were
byte-identical to the pre-merge tips, which is what twin commits predict. Never rebase, never
force. (2) The regenerated release notes led with a `vercel:` config commit as a learner headline
because "dashboard" in its subject satisfied the user-facing gate. `vercel|deploy|infra` join
`KIND_VETO`, with a proving test that fails on the old regex and passes on the new; the notes
that shipped on main carry no such line. The pod-cards headline still carries "(job #428)" and
the two grading bullets are terse — under-claiming, left alone by design.

**Already on production before this ship:** the 20-minute support note (#477) via hotfix
`f5321c274`. **Not in the range:** any "mode/belt stamping on play rows" commit — the phrase in
the commission matches nothing in `main..staging`.

## 2026-09-13 — Release notes hotfix in learner voice, and the generator closes three warts (job #506)

**What shipped wrong.** The 2026-09-13 notes on production led with "Pod cards at the top of
Dialogues, one per pod slot, each with an offline-readiness chip (job #428)." then two "Strip …
grading" lines — a job tag and engineer words in learner-facing text, one headline duplicated, and
the ship's most learner-facing change (Immersion lights the whole spoken line and walks with the
voice, #479/#468/#470) absent altogether.

**Ruling applied (Tom, 2026-09-12).** Three ONE-SENTENCE learner headlines, learner surfaces first,
then EXACTLY one line below the fold. Hotfix to main (`1a647c8ec`, notes text only, no app code):
Immersion line lighting / Dialogues pod cards with offline readiness / schools dashboard grades
nothing. Back-merged to staging (fast-forward, staging = main) and dev (`0f4456e9e`, one add/add
conflict on the notes file, resolved to main's text). Identical on all three.

**Generator hardening, on dev, rides the next train.** (1) `vercel|deploy|infra` join `KIND_VETO`
(#499's unmerged fix, landed). (2) `claimOf` strips job tags — "(job #428)", "(jobs #494, #495)",
trailing ", job #428" — test fails on the old code. (3) `assertShape` requires the fold count to be
EXACTLY `MAX_READMORE`, not merely `≤`: cold-verify #462 found a fold-less note passed. Test fails on
the old code. Both on-disk notes since the ruling still fit.

**Rule this re-states.** Hand-written headlines take the slots first; the generator's job is to
make it impossible for bookkeeping to reach a learner, not to write the headlines.

## 2026-09-13 — Subscription expiry: the #540 clock fix stands, and a renewing payer gets a 7-day grace across the billing rollover (job #549)

**What #540 got right and keeps.** `isSubscribed` and `hasFreeAccess` now depend on a reactive
clock, so a paid period that ends while the app is open fails closed instead of surviving in a
cached computed until the next reload. That stands untouched.

**What it got wrong.** `currentPeriodEnd` is only the end of the CURRENT period. For a
subscription set to renew, Paddle extends it by webhook at the rollover and the app learns the
new end only from the next successful `/api/subscription` answer. A device offline across that
instant still holds the old end in its mirror, so the computed dropped an auto-renewing payer to
the free preview — premium past seed 19 locked, Settings offering a plan they already pay for —
until they next got online. That is exactly the lock-out Tom ruled against, twice: 2026-07-10
"definitely do NOT favour security over paying user experience"; 2026-09-12, job #378, "a payer
offline stays a payer".

**Ruling applied.** `RENEWAL_GRACE_MS` (7 days, exported from `useSubscription.ts`): a
subscription with status `active` and `cancelAtPeriodEnd` false is treated as paid for seven days
past its recorded period end. Seven days covers Paddle's dunning/retry window and any realistic
offline stretch; a real cancellation or failed payment reaches the device as a status change on
the next online refresh, which overwrites the mirror and ends the grace at once. A subscription
with `cancelAtPeriodEnd` set, or any status other than `active`, ends exactly at
`currentPeriodEnd` as #540 has it — there is no renewal to wait for. `hasFreeAccess` stays exact:
a funded-org grant is a fixed-term gift (`org_enrolments.free_access_until`, "their year"), nothing
renews it. UI-only flag; the 30-day offline lease, `useEntitlement` and the server-side content
gate are unchanged.

**Proof.** `useSubscription.renewalGrace.test.ts`: (a) renewing, one day past the end, offline →
still paid — red on the pre-fix code, green after; (b) eight days past → not paid; (c) cancelling,
one minute past → not paid; (d) an online answer with a new period end overwrites the mirror and
wins. The #540 tests stay green.
## 2026-09-13 — A role-addressed topic pod is its own Listening Mode card, never the served pod (job #544)

**Decision.** Topic pods (the Senedd pod, `cym_n_for_eng:senedd-s4c-steve`, role-restricted to
`previewer_001`) sit ALONGSIDE pod-1 in Listening Mode as their own cards, titled from their own
`listening_pods.title`, pod-1 first, topic pods after. They never replace pod-1, and main flow
never reads them: `resolveServedPod` is rule 1 only. A plain learner sees exactly what they saw
before, because RLS returns them no role row and the extras query is re-gated client-side.

**Why.** Rule 5 as first written promoted the addressed pod INTO the served slot, so for its
holders the Senedd pod appeared as a nameless "Pod 1" and the real pod-1 vanished (job #539
probes). Better: holders get both pods, each under its own name. Simpler: one list rule, no
slot override, main flow untouched. Cheaper: same single round-trip, the role arm moved from
the main-flow query to the Listening Mode query.

**Landing.** `18ef7424e` on dev and staging; cherry-picked onto main as `f934a3942` together
with the pod-0 retirement resolver commit (job #512) it depends on, rather than promoting the
whole of staging — the subscription-entitlement work (#540, #549) stays on staging for Tom's
own promotion. Verified live on staging and production as a role-holder and as a plain learner.

## 2026-09-13 — A minute is play to stop, tagged by mode, and Intelligence counts minutes, not people (job #609)

**Decision.** ONE minute definition serves every school surface and Intelligence, and it is
Tom's (22:27Z, via RBF, verbatim): "a minute is everything between user pressing play and user
stopping play through whatever screen hit combination. listening exercises play time ALSO count
... we SHOULD be able to disambiguate listening minutes IN listening MODE, from main-flow
listening minutes." It lives in `api/_utils/inAppTime.ts` as `spansFromDiary`: a span opens at a
`tap_play` (or at a clip when nothing is open, since a lock-screen resume emits no tap), is
extended by every clip's END, and closes at the `tap_pause` when one arrives within the guard of
the last audio-ended point, else at that point. Listening Mode has no taps, so its spans open on
the first `listening_mode` clip or `listening_tick` and close at the last. Each span carries
`mode: main | listening`. **Superseded:** the 2026-09-10 rule in the same file, which sessionised
ANY diary event with a five-minute idle cut-off. The cut-off survives only as a guard against a
missing stop; `cold_start`, `cursor_move`, `round_complete` and the rest now move no span.
Main-flow cycle clips are logged at clip START, so from this build the two target clips carry
`durationMs` on the `audio_play` row; rows before it resolve the span-closing clip through
`course_audio.duration_ms`, and the known-side prompt carries no length in the script so a span
that ends on a prompt closes at that prompt's start.

**Intelligence at Everyone scope IS the insight engine.** `/intel` opens on question 1, reworded
from a count of people to "How many in-app minutes are being done, per course and per person on
the course…", rendered by `NodeRateEngine` + the `RateCompare` widget against a new route,
`/api/intel/minutes`, that speaks the rate-compare contract verbatim (entity / average /
distribution / trend) so the component needed one `endpoint` prop and no second adapter. Measures:
in-app minutes per person on the course (headline, main flow and Listening Mode split beneath),
new enrolments, people with no activity. Windows: today / 7 days / 30 days. Compare: the average
of all courses only — at Everyone scope "everyone on this course" is the entity, so `global` means
nothing. Population = `resolveRealLearners`, production diary rows only. A course-person is a real
learner enrolled on the course at the window's end, or who played it in the window without an
enrolment row (a taste default, flagged). The old count of people stays on the page as the rows
beneath the engine. `?learner_id=` on the route returns that learner's spans so any headline can be
reproduced against a real diary.

**The packed read.** A 30-day production window is ~131k play-relevant rows; PostgREST caps a
response at 1,000, so `diary_play_rows` (`supabase/migrations/20260913_diary_play_rows.sql`,
applied live, service_role only) returns a window as one packed jsonb in ~1.5 s. It selects and
packs; no rule lives in SQL. Better: the 30-day page answers inside the function budget. Simpler:
one round trip, one rule in one file. Cheaper: no new table, no cron, no second implementation.

**Proof.** `inAppTime.test.ts` "THE CHANGE": a play tap, five clips, no stop, a `cold_start` two
minutes on — the pre-change module returned 120 s, this one 53 s, seen red then green. The school
fixtures were flipped to typed play rows because under this rule a tap with no audio is no play
time. Listening Mode minutes are exact on production from 2026-09-13 04:21Z (per-clip rows,
jobs #339/#343); before that only the 30 s tick exists and listening minutes are tick-bounded.

## 2026-09-14 — Intelligence: the average of all courses includes the selected course, is learner-weighted, and total in-app minutes is a measure (job #621)

**Tom's rulings (staging review, 01:29Z).** The 'Average of all courses' comparator moved with the
course (Basque v 11.5, French v 12.7, Welsh North v 13): job #609 had built a leave-one-out mean
(`api/intel/minutes.ts`, `members = ranked.filter(f => f.code !== courseCode)`), "confusing and not
helpful for us as admin". And it was a per-course mean, so dead or near-empty courses dragged it
toward zero and every real course sat at the 92nd–100th percentile. Tom's words: "the averages of
all LEARNERS". Second ruling: a course with a handful of very active learners must not read as
popular, so 'In-app minutes (total)' joins 'In-app minutes per person'.

**Decision.** `averageOfAllCourses(measure, cohort)` is the comparator, pure and exported, over every
course with anyone on it, the selected course INCLUDED — one fixed number for a window and a
measure. Each measure carries a `kind`: `ratio` (minutes per person, no activity) is learner-weighted,
the numerator summed over every course divided by course-people summed over every course, so a dead
course with two enrolments weighs two people, not a whole course; `count` (minutes total, new
enrolments) is the plain mean per course, a total having no denominator to weight by. The
distribution strip stays the siblings, because `RateCompare` adds the entity itself when it ranks.
Each measure's description line says what its average is, and the Handbook entry was re-pinned.
Every school surface's minute is untouched: `inAppTime.ts` did not change.

**On the way: the packed read now agrees with the paged read.** Astra's cold check (needs-you #714)
refuted "one minute definition" by 100 s across ten diaries on 131,804 rows: `diary_play_rows`
dropped a clip's audio id whenever any event followed within 30 s, but `spansFromDiary` closes at
the last audio-ended point on a play tap, a mode switch or a tick, so the dropped clip's whole length
was lost. Measured live: 104,037 unbounded clips, 261 ids carried, 19 dropped that could matter.
Migration `20260914_diary_play_rows_carry_closing_ids.sql` (applied live) drops the id only when the
successor within 30 s is a stop tap or a same-mode clip. Proof: packed v paged over the nine affected
learners, same `sessioniseAll`: 93 s apart before, 0 s after. Carrying every id instead would have
added ~4 MB to the packed payload for the same result.

## 2026-09-14 — One dropdown component everywhere, and every dropdown searchable (job #625)

**Ruling (Tom, 2026-09-14 01:57Z),** reviewing Intelligence on staging as ssi_admin and as a school
leader: the plain bordered boxes beside the nice custom dropdown are "the old style of crap looking
ones", and every dropdown on the site must have a search field at the top of its open panel, even a
short list.

**What changed.** `FrostSelect` is the one dropdown. Its filter is no longer opt-in: the search box is
always at the top of the panel, focus lands in it on open, typing narrows by case-insensitive
substring, arrows and Enter pick, Escape closes, the tick stays on the selected row. It measures the
visual viewport when it opens and again when that viewport changes, so on a phone it opens upward
when the keyboard leaves no room below, and its search field is 16px on touch screens so iOS does
not zoom the page. Rows can be disabled; a `value` and an `option` slot carry flags and tier chips
where a caller had them. Every native `<select>` in the learner app, schools and admin surfaces now
uses it; so do the two hand-rolled dropdowns, the Create class course type-ahead and the onboarding
taught-language menu; `FilterDropdown.vue` is deleted. On Intelligence, Course is a dropdown even
when there is only one course, rather than a static paragraph next to real dropdowns.

**Not dropdowns, left alone.** Segmented rows such as Window and Entity level, the navigation menus
in the top bars, and the card pickers for plan, sector and course. Option lists and what a pick does
are unchanged everywhere: this is the control only.

## 2026-09-14 — Insights page: graph tool first, Overview | Insights as tabs, Where you are names the page (job #628)

**Ruling (Tom, 2026-09-14 02:22Z),** reviewing staging as ssi_admin viewing as a school leader on
class 10E: "the graph tool should be the leading thing"; Overview and Insights should read as a pair of
tabs, side by side on both pages, in the same family as the Window control; and the Where you are card
should say which of the two is open.

**What changed.** On every node's Insights page the window / course / measure / compare block with its
headline figure, over-time chart and "where this sits" now renders first, the "Are they doing it" block
below it, voice last. Order only; neither block was redesigned. The "See insights" button on the node
home and the plain "Overview" button on the lens are replaced by one `LensTabs` component, Overview |
Insights, drawn in the WindowChips pill grammar with the open tab lit, at group, school and class level
on both mounts. The map rail takes a `lens` prop and draws one quiet line under you're-here naming the
open page with the other a tap away. The "Reading your insights" walk step that pointed at the Overview
button now points at the tab pair and was re-pinned. Three English keys minted and enrolled in
`pending-translation.json`; the old `org.nodeHome.seeInsights` key is now unused and left for the
translation pass to sweep.

**Left alone.** Learner level has no member-scope Overview/Insights pair, so nothing changed there. The
"Show me — Reading your insights" link stays where it was. Reads only: a tab and the rail line are
router navigations, so a view-as session still writes nothing.
## 2026-09-14 — Handbook: the clip leads, the prose folds beneath it (job #627)

**Tom (staging, 02:07Z).** "The handbook still appears to be pointing to the prose, rather than the
clips. I know we may not HAVE clips for everything but we certainly have clips for most of the
common things already." Reproduced headless on staging build `119cf6c` as four personas. A school
admin got a Show me on 2 of 98 entries while the How-this-works panel on their own home offered 4
walks; a govt leader's tap on "Bring your first person in" landed on their group and nothing played;
every teacher tap landed on `/schools/classes`, where no surface claims a class-page walk. The
learner's door, the Library hub, offered five clips and played all five: nothing to fix there.

**Causes, in the code.** `HandbookView.vue` rendered four prose blocks and put the one Show me
button last inside a collapsed body — job #302 wired the clip in as a footnote. Its persona gate
asked `walk.personas.includes(persona)` with `persona = school_admin`, but the walks that run on the
node home (`install-the-app`, `set-your-password`, `invite-first-person`) were authored for `leader`
only, because `NodeHomeView.vue:605` calls every member "leader" — two spellings of the same person.
`invite-first-person` carried `kinds: [org]`, so a plain group claimed nothing, and the school-kind
twin `invite-first-teacher` was linked to no entry at all. `PLACE_LINKS['class-detail']` resolved to
the class list, so a class-page clip could never be claimed from the Handbook.

**Decision.** (1) A capability's clips are RESOLVED, not hand-linked: `clipsFor(entry, persona)` in
`walkthrough/handbook.ts` takes the `walk:` line first and then every walk whose steps land on the
entry's anchor, filtered to the reader's persona — so "Choose what role someone arrives as" plays the
invite walk that passes through that field, and coverage grows with every walk authored, with no link
to forget. (2) The tap defers ALL of them: `deferWalk` takes a list and `claimDeferredWalk` starts the
first one offerable at the destination's persona × place × kind, so the org walk runs on an
organisation or group and the teacher walk on a school, from one entry. (3) The walk data says who
actually sees the anchors: `school_admin` joined the account-card walks and the five class-page walks
(`canManageTeachers` is true for a school admin), and `group` joined the invite walk's kinds. (4) The
entry body leads with Show me and one caption line; the four prose blocks sit behind "Written out",
and "Read the lot" unfolds them. A ▶ on the closed row says it plays. (5) A class-page clip goes to
the reader's first class, fetched on mount only when a class-page clip is on offer; with no class yet,
the list.

**Better × Simpler × Cheaper.** More entries play, for the people they belong to, without a walk
being re-authored; one resolver replaces a hand-maintained link that was already drifting; the only
new cost is one classes query on the Handbook for staff who have a class-page clip.

**Result on staging.** See the coverage census published with the job report. Entries with no walk
at all are listed there as the clip-coverage gap, with a proposed clip for each, for a follow-up job.

## 2026-09-14 — Your insights in the Library: me v the course average, never v a person (job #634)

**Tom (02:45Z).** "The library insights tool can be built, all the pieces are there already." A
learner sees how they are doing at a granular level and compares themselves against the course
average — "never against other individuals of course".

**Decision.** (1) One new route, `/api/me/insights`, speaks the rate-compare contract the
NodeRateEngine and RateCompare widget already draw, so the Library mounts the SAME engine as
`/intel` and every school surface with one prop changed. (2) No second minutes query: the population
resolver, the packed diary read, the sessionisation and the per-course facts are imported from
`api/intel/minutes.ts`; that module's facts grew span counts and per-bucket Listening Mode seconds
so the learner's three measures ride the same object. (3) The comparator is the learner-weighted
figure of job #621 — every minute on the course over every person on it, the caller included — or
the same pooled over all courses. (4) A session is the engine's own unit, one play-to-stop span;
nothing new was defined. (5) A percentile appears only against the anonymous course population and
only when 20 or more people were active in the window; below that the server sends no shape at all
and the widget says "not enough people yet". The widget also stops colouring the viewer's own
shortfall as a warning. (6) No all-time window: the packed read carries 30 days in ~2 s and times
out at 90, measured live; the chips say today / 7 days / 30 days and nothing pretends otherwise.

**Better × Simpler × Cheaper.** The learner gets the same honest numbers the admin reads, in the
same shape; one engine, one minute rule, one widget, and a route of ~300 lines whose only new maths
is three learner-weighted divisions and a floor; the cost is one packed read plus the enrolment
scan per open of the panel — the price of not forking the minute — and nothing on the home screen.

**Flag for Tom.** The standing doctrine in `apml/design/learner-profile.apml` argues a windowed
percentile can fall while a learner is away. This tool shows one at 20+ active people because the
brief allows it; if that reads as a streak in disguise, the floor can be set to infinity and the
card still says everything else.

## 2026-09-14 — Aran's Chromebook: the report that "never arrived" and the picker that "would not scroll" (job #652)

**Tom (11:23Z).** "Aran is saying on his Chromebook he can't scroll down on the courses page. He just
tried a bug submit actually, can we see if that's come through?"

**Finding.** Both reports arrived, at 11:23Z and 11:24Z, in `tester_feedback`, the table the floating
tester widget writes and nothing polls; `bug_reports`, the postbox the poller reads, was searched and
found empty. The widget's own failure path was a `console.error` and an open form, never a word on
screen. The scroll complaint is not a scroll defect: his screenshot shows the Choose Your Course sheet
with 中文 selected in the I-speak row, which the picker remembers in localStorage from an earlier tap,
and there are exactly five courses for Chinese speakers. The list was complete and the sheet had
nothing below to scroll to, and said nothing about why. Headless production at 1366x768, 1280x720 and
his own 1616x842, ChromeOS user agent, wheel and touch, with English selected: 42 rows, the panel
scrolls to its end every time.

**Decision.** (1) One postbox: the tester widget files through `useBugReport` with source
`tester_widget`, the route accepts that source, and a failed send says so on the panel. The
`tester_feedback` table stays as it is; nothing new writes to it. (2) The filtered picker ends with
"That is every course for X speakers. Show all languages", one tap out of the remembered filter;
absent in a scoped picker, under a search, or when the catalogue serves one known language anyway.
The filter itself stays remembered: a Chinese speaker should not have to re-pick every open.

**Better × Simpler × Cheaper.** Every report from every door reaches the one channel that is read;
one route and one poller instead of a table nobody watches; the picker change is a computed and a
footer, no new state. Cost: two English strings enrolled for the translation pass.

**Landed.** Branch `cs/652-ssi-app`, rebased on `dev`, not merged, under Tom's 11:27Z hold
("diagnose first, no fixes yet").

## 2026-09-14 — Player advancing on its own: an outside pause is a pause, a silent run stops, and a round knows which loop it is in (job #644)

**Tom (10:40Z).** "Get onto these things that have come up from the forum this morning." Two learners:
one on Welsh whose player "keeps skipping ahead" and whose back button "won't go any further back",
one on Basque with one-second mic gaps before listening laps, exercises moving on a second into the
mic stage, a lone Basque phrase with no framing, the red infinite-play bar appearing mid-course, and
an app that "determinedly keeps on playing" after the car's bluetooth drops. Trace from the
experience backwards for the shared false assumption; do not patch symptoms one by one.

**What the trace found.** The shared false assumption was that the engine can tell what the learner
is hearing from what its timers are doing. (1) An outside pause — bluetooth route lost, headset
button, another app — was only *recorded*; every timer stayed armed, so the stall watchdog skipped
the paused clip after ten seconds and played the next one, and the recovery timer un-paused the
rest. That is the "keeps on playing" and the phantom progress. (2) The skip-on-failure path had no
floor, so a dead block walked the cursor at machine speed with nothing audible. (3) "No intro, debut
or build cycle" was read as "this is an infinite-play round"; a main-loop round whose LEGO has no
audio yet has exactly that shape. Basque seeds 85 to 99 carry 16 such LEGOs, in the reporter's
range, which is the red bar, the frozen belt, the INF PLAY back button and the stuck fast-forward.
(4) Seed-sentence reviews are built from `course_seeds`, which carries audio ids but no durations,
so their mic gap collapsed to the one-second floor. Measured in the reporter's own telemetry:
sixteen seed reviews at 1.6 to 1.8 s, most within thirty seconds of a listening lap. The lone
Basque phrase is the drained seed sandwich, which is by design.

**Decision.** (1) `SimplePlayer.noteInterruption` now halts in place: generation bump, every timer
disarmed, element stopped, `isPlaying=false`, position kept. The conductor mirrors the new
`self_paused` event into `userPaused`. No auto-resume anywhere: `resumeFromInterruption`,
`hasPendingInterruption`, `resumeAfterInterruption` and the visibility wiring are deleted. (2) Every
advance-without-hearing path goes through one door; the fourth consecutive unheard clip stops the
player with `audio_failed` reason `silent-run` and a tap-to-retry banner; three, one hollow cycle,
is still walked through under the plays-what-it-has ruling; a real `ended` on a clip under 50 ms
counts as unheard; `resume()` refunds the budget so each tap in a dead block steps one cycle.
(3) Core `Round.revival` is stamped by all three producers; `isMainLoopRound` reads the stamp first
and falls back to shape only for rounds from a cache that predates it. (4) The bundle route looks up
seed clip durations from `course_audio`, and `computePauseDuration` assumes an ordinary 2.5 s
sentence when both durations are missing rather than collapsing to the floor.

**Better × Simpler × Cheaper.** Better: the player can no longer manufacture progress, and a
learner two seeds past a missing clip stays in the main loop. Simpler: one halt path, one stop
door, one fact on the round instead of a shape inference; the whole auto-resume machinery is
deleted. Cheaper: one extra `course_audio` lookup per bundle build; nothing new at runtime.

**Flag for Tom.** The 2026-08-09 auto-resume was built for his own WhatsApp case; after this change
that case costs one tap. And the content: Welsh North has LEGOs authored to seed 305 of 668, Welsh
South to 334, Basque to 300, so Black belt at seed 400 is unreachable on all three and a learner at
the authored end is dropped into infinite play from every cold start.

## 2026-09-14 — One class page for teachers too; the teacher home reads play-as-class (job #651)

**Trigger.** Ysgol Cas-gwent Chepstow, 2026-09-14: "some teachers say 0 minutes, yet they screenshot
and it says they have done some." Teacher florencecotten, class 10C, code EKA-766: her Library said
12 min total, 9 min on Welsh; her teacher dashboard said "One class on the go, 0 students across
it", benchmarks 0c, "0 students · 0 min practised · 0 sessions". Tom: the WRONG class view, the one
that aggregates the student learners, was still surfacing for teachers.

**What the live data says.** Two causes stacked. (1) Her Wednesday lesson, 07:41 to 08:01Z on
2026-09-09, 125 clips and 737 seconds of audio, sits on HER OWN learner account. The 10C class
account has nothing that day: its rows carry the play-as-class `actor_user_id` stamp and hers do
not. She pressed play from her own account, not Play as class. Thirteen of Chepstow's 34 class
accounts have never played at all while their teachers carry 150 to 722 seconds on their own
accounts on lesson days, so this is the school's pattern, not one teacher's slip. (2) The teacher
home read the pupils' aggregate spine, class_activity_stats and class_student_progress, which is
zero for every class taught from the front, so even the teachers who did use Play as class saw
zeros on that page. Job #624 moved leaders to the class node home and left teachers on the flat
page, whose node-home endpoint refused a teacher.

**Decision.**
- The node home endpoint admits a teacher of the class, to that one class, with no rail above it;
  the payload says `callerTeachesClass`. Every class link for every member role goes to
  /org/:classId. The flat /schools/classes/:id page is the class TOOLS page, reached from the
  class page's own Manage class, open to every member role again. Job #624's leader redirect is
  gone: it had also put Angharad's copy-play card out of a leader's reach.
- The teacher home reads /api/school/class-practice-7d, the same payload the classes list and the
  leader pages read: per class, minutes in the app this week, phrases practised, LEGOs travelled,
  last played, on the ONE minute definition. The benchmarks-in-cycles column is dropped rather than
  recomputed: its inputs are the dead pupil-aggregate spine, and a school-wide play-as-class
  average is a rollup a teacher is not scoped to read.
- The payload carries `callerOwn`, the caller's own account this week, and the teacher home names
  it: "You practised 12 min on your own account this week, last on Wed 9 Sept. That counts for you,
  not for a class. Use Play as class so a lesson counts for the class." Under view-as the persona's
  own account is asked for by `own_user_id`, admin-gated like `school_id`.
- Wherever the pupils' aggregate remains it is a second section headed "Students on their own
  accounts" with a one-line caption, and it is absent when no pupil has an account.
- The copy-play repair card sits on the class page for leaders, and in a self mode for the class's
  teacher. The server always admitted a teacher of the class; only the card was leader-only.

**Better × Simpler × Cheaper.** Better: a teacher sees the same class page and the same numbers a
leader sees, and a lesson that went to the wrong account is named rather than lost. Simpler: one
class page, one link rule, one payload; the cycles benchmark and the dead-spine reads on the teacher
home are deleted. Cheaper: one extra learner id on a diary read the endpoint already makes; no new
table, no new endpoint.

**Not done, and why.** All-time minutes on the one minute definition: the minute engine reads a
window of the diary, and no materialised all-time figure exists for it; the leader pages do not
show one either. Named as a gap, not faked from the pupil spine.

**Flag for Tom.** The prevention is upstream of any dashboard: a teacher who opens the app lands
on their own Library and presses play. A one-line nudge on the learner player for a teacher whose
class is on that course would stop the next fifteen mistakes; that is a learner-surface change and
is his call.

## 2026-09-14 — Teacher home: two figures kept apart; a school-admin sweep for the copy tool (job #662)

**Trigger.** Tom's ruling on #651's diagnosis, relayed at 12:23Z: "Teacher SHOULD be able to see
both: Play-as-class minutes AND an aggregate of the class students own playing times - there wont
be a lot of this at the moment." And: "Angharad Jones as school admin SHOULD have a tool to copy
any individual teacher account stats over to the play as class stats, including progress ... I
THINK we built that tool for her." The tool exists one class at a time; thirteen Chepstow teachers
it had never been run for. Staging only; nothing to main.

**What the code said.** `api/school/class-practice-7d.ts` returned `practiceByClass` as the class
account's play PLUS the pupils' own accounts, one number, and #651's teacher home read that summed
field into every class row and the footer, deriving the pupils' share by subtraction. That sum is
the one figure the ruling forbids.

**Decision.**
- `practiceByClass` is now the PUPILS' own-account seconds only; `classPlayByClass` stays the class
  account's figure. No consumer summed them on purpose: the classes list column, the class page
  header and the teacher home all meant the class account and now read `classPlayByClass`. The
  school headline `rollup.inAppMinutes7d` still adds class accounts and staff/pupil own accounts
  once each — that is a different surface, shared with the leader node home, and untouched.
- The teacher home shows both figures on every class row and in the footer, never a total. The
  pupils' figure is always present; at zero it says "Nothing on pupils' own accounts this week.
  That is usual for a class taught from the front", so absence is never read as breakage.
- The sweep: a read-only `copy-teacher-play/candidates` route, one school per call, admin of that
  school or platform admin, allowed under View-as, lists every (class, teacher) pair where the
  teacher's own account is enrolled on the class course and the planner finds something to copy,
  each with the preview payload built by the same `previewBody` the single-pair preview now uses.
  A card on the leader's OWN school node home, /org/:schoolId, the page a school admin actually
  lands on (the /schools dashboard's admin block is unreachable for her since the 2026-07-30 nav
  unification), renders the rows with one Copy each, calling the existing apply for that pair. No bulk apply exists, by design: apply stays one teacher at a time, refuses
  View-as, and writes `class_progress_copy_audit`.

**Better × Simpler × Cheaper.** Better: a teacher reads the class's own minutes beside the pupils'
own, and a leader clears thirteen mis-played teachers from one page with one look per teacher.
Simpler: the subtraction on the client is gone; the copy tool's fetch and words live once
(`composables/schools/copyTeacherPlay.ts`) and serve both cards; one body builder serves both
server routes. Cheaper: no new table, no new writer; the sweep costs one planner pass per enrolled
teacher, pre-filtered by enrollment so a school of 34 classes plans a dozen pairs, not 34.

**Addition, 12:58Z (Tom: "teachers must play as class, not as themselves, and Angharad is telling
them so").** The steer BEFORE the minutes are lost: when a signed-in teacher presses play in the
learner player on a course one of their classes is on, a one-line bar says "This counts for you,
not for 10C. To make it count for the class, use Play as class", with a link to the class page and
a dismiss. Who: read from GET /api/me/teaching-context, the one capability read, matched on course
code; nobody else sees it, and a failed read means no bar. A steer, never a block. Never under a
class context or in the schools shell (`composables/useOwnAccountPlayNudge.ts`).

**Second addition, 13:03Z (Tom: "We need teacher accounts to open with the dashboard and not the
player").** The player route's guard sends a cached `teacher` role, on the app's FIRST navigation
to the bare `/`, to `/schools` — the teacher home, her classes and Play as class in front of her.
Every in-app Learn / My player tap still reaches the player, so her own play is one deliberate step
away, never the default; deep links with a query keep their intention; school admins, group leaders
and tutors are not in the ruling and keep the 2026-07-24 default (`composables/teacherLanding.ts`).
For teachers this supersedes 2026-07-24. Job #624's leaving teachers on the flat class page was
already reversed by #651 (one class page for every role) and needs nothing more. Known edge: the
guard reads the cached role, so a brand-new device's very first sign-in reaches the player once;
from the next open, the dashboard.

**Third addition, 13:07Z (Tom: "a warning across the dashboard navigation? You are now playing as
yourself. If you want to play as class please go here." and "make it harder for the teachers to
find their own learner account? Maybe that is in a drop down menu by the avatar? Rather than in
the nav itself?").** (1) The Learn button leaves the schools top bar for a TEACHER; her own
account stays one step away as My player in the avatar menu; leaders keep Learn. (2) The warning,
in his words, with a link to her classes, DASHBOARD-SIDE (Tom, 13:11Z: "The regular app does not
have a whole screen top nav at all"; the play-as-class path already names itself in the school
dashboard's top nav, so nothing changes in the player). It sits across the top of the teacher
home, above the welcome, whenever her own account has practised this week — the sibling of the
top nav's "playing as class" strip — and links to her classes. The 12:58Z player steer is gone.
Firmed at 13:13Z: "removing the play button from the top right hand screen and putting it into the
avatar drop down is a definite thing" — done as (1).

**Not done, and why.** No bulk apply, per the brief and the audit model. The sweep is not run
against any real teacher by this job: Angharad runs it. The first live sweep on Chepstow lists 27
pairs, not the 13 of #651's diagnosis: the planner's rule is "anything left to copy", which also
catches teachers whose class has since caught up in position but whose own-account sessions were
never moved, and Angharad's own account on her admin class.

## 2026-09-14 — Insights minutes: one definition, one aggregation, totals per window, real daily bars (job #673)

**Symptom (Tom, 14:39Z, staging, View-as angharadjones · Chepstow · class 7H Insights).** "Practice
minutes per class" read 18.7 for the last 7 days, 11.5 for the last 30 days and 11.5 for all time,
all labelled MIN / WEEK. "last 30 days can NEVER be less than last 7 days ... wrong data is a
disaster - way worse than no data ... how is in-app minutes calculated, and it needs to be
calculated the same way across all metrics, always."

**Cause.** The measure was a per-week RATE: minutes in the window divided by the weeks from first
activity in the window to now, then divided by seven again under Today. One burst of play in the
week of 7 September therefore fell as the window widened. Beside it, the same class's seven-day
minutes were counted three different ways: Insights and the org lens by rolling timestamp, the
classes list and class page by the last seven UTC calendar dates, and the node home carried an
all-time "Minutes practised" off the sessions ledger, which the class account cannot write.

**Ruling applied.** Every window shows the TOTAL in-app minutes inside it, so a wider window is
never smaller by construction. Every minutes figure on a school surface is the one definition in
`api/_utils/inAppTime.ts` (play to stop, pauses included, listening counted, no stop means the last
audio ended, each account once) over the last N × 24 hours by timestamp. Class-level figures are
the class account alone and say "played as class"; school-level figures are classes, staff and
pupils each once and say so. Charts are one bar per bucket, never a spline; a bucket with no play
is a zero bar.

**What changed.** `minutes_per_class` and `hours_total` are one measure, `minutes`, in
`api/groups/[id]/rate-compare.ts` and `api/_utils/rateCompare.ts` (old ids aliased so deep links
still open). `api/school/class-practice-7d.ts` counts the rolling week. `RateTrend.vue` builds
its option in `rateTrendOption.ts` as bars; `TimeSeries.vue` and the theme's line default follow.
The node home and children list no longer show the sessions-ledger all-time figure. Labels on the
classes header, the class page, the school home and the class node say whose minutes they are.

**Enumerating command** (re-run rather than trust; full table with verdicts in
`docs/insights-minutes-readers-2026-09-14.md`):

```
grep -rln "inAppTime\|diarySessionRows\|inAppSecondsByLearner\|inAppTimeByLearner\|sessioniseSeconds\|duration_seconds\|total_practice_minutes\|admin_practice_minutes\|total_practice_hours\|total_practice_seconds\|practice_minutes\|practiceMinutes\|minutesThisWeek\|inAppMinutes7d\|play_seconds\|engagedMinutes" api packages/player-vue/src --include=*.ts --include=*.vue | grep -v '\.test\.' | sort
```

**Not changed, and why.** The per-person all-time minutes on the students list, the class page's
pupil rows, the teachers list, the schools list and the govt tiles still read the sessions ledger
via `api/school/roster.ts` and `school_summary`; the student progress page reads the
`admin_practice_minutes_by_course` RPC; the node home's per-pupil spark reads audio-played seconds.
Moving those to the diary is a per-person read across a whole school and was out of this job's
price; they are listed as the honest gap. The classes-header-versus-school-home difference from
job #301 (174 v 352) is closed by scope labels, not by making the numbers equal: the header is
class accounts, the home is classes, staff and pupils.
## 2026-09-14 — The Viewing-As strip comes off the nav, and the Learn button retires for every school role (job #675)

Tom, 14:50Z, with a staging screenshot of the school-admin dashboard under View-as:

> "this Viewing As feature is great
>
> BUT
>
> it blocks all my nav functionality
>
> and this is staging and the Learn button top right still shows, which I supect takes the school
> admin/teacher to their own player
>
> We have the My Player as a dropdown menu, correctly already, so we can deprecate the Learn next
> to the User Avatar?
>
> THat would make it a lot simpler"

**Measured first, and it was worse than it looked.** A staging probe as ssi_admin viewing as
angharadjones and as florencecotten, at 390x844 and 1280x800, found the pill's box intersecting the
schools top bar at every width — and on the phone the hamburger and the avatar were not merely
covered but UNTAPPABLE: Playwright's click on each timed out, the pill swallowing the taps. That is
the whole complaint, reproduced.

**(1) The strip is now a full-width band across the very top, and the page moves down for it.** It
keeps everything it had — the eye, the name and scope, "read only", Pages with its list, Exit — and
overlaps nothing. The band measures its own height and publishes it as `--viewing-as-h` on `<html>`
with an `is-viewing-as` class; ONE global rule in `style.css` pads the body by it, so every in-flow
shell (schools dashboard, org lens) moves down for free, and only the handful of fixed top chrome
that body padding cannot reach — the tutor tab rail, the player escape, the bug toast — names the
variable itself. It falls back to `0px` when view-as is off, so the rules are inert the rest of the
time. The alternative considered and rejected: a strip rendered per-shell under each header, which
is the same offset written four times and forgotten on the fifth. Better (nothing is covered on any
surface), simpler (one variable, one global rule), cheaper (no per-shell strip to keep in step). The
band is forced to one line — wrapping breaks before the text shrinks, and a two-row band on a phone
eats the dashboard it exists to let you use.

**(2) There is no Learn button in the schools nav for ANY role.** Job #662 had removed it for a
teacher and left school and group leaders with it; `ownPlayInNav` is gone. My player in the avatar
menu is the one and only door to your own player, hidden on player routes exactly as before.

**Scope.** Staging only; Tom promotes to main on the weekly train after he has looked. The TUTOR
surface's own Learn button in `TopNav.vue` is untouched — a tutor is not a school role, and his
ruling named school admin, leader and teacher. Worth asking him about separately.

## 2026-09-14 — One in-app support door for everyone, one table via a view, one watcher (job #677)

**Ruling.** Tom, 15:01Z, to Watson's proposal: "one door for everyone, learner, tester, teacher,
school admin, writing to one table with the account code and build attached, and one poller that
turns each new row into a job in the right project channel": "yes, let's do that". Trigger: Neil
Dickson's report could not be matched to an account by email, and Aran's Chromebook reports sat all
day in tester_feedback, which nothing read.

**What changed.** The player's content flag (`ReportIssueButton.vue`) posts through
`POST /api/report/bug` as source `content_flag`, naming the clip; its `sample_flags` upsert stays
for Popty's QA. Every `bug_reports` row is stamped server-side at report time with account_code
(the code Settings shows), reporter_email from the verified bearer, platform_role,
educational_role, and for staff school_role, school_id and group_id; nothing about identity is
taken from the client and guests carry nulls (`20260914b_bug_reports_identity_and_content_flag.sql`,
applied live). The view `support_inbox` (`20260914c_support_inbox_view.sql`, service-role only)
unions bug_reports, inbound support_messages and, for history, tester_feedback, content_feedback
and handbook_questions, so "are there any messages?" is one query. **Corrected by job #680 the same afternoon:** that view joined `auth.users` five times for legacy email, and under `security_invoker` no API role holds SELECT there, so every PostgREST read returned 403 `permission denied for table users`, even with the service key. `20260914d_support_inbox_no_auth_users.sql`, applied live, recreates the view with no `auth.users` at all: legacy email now comes from `support_messages.author_name` or the learner's first `verified_emails` entry, else null, and the view reads 200 through the API with rows from every door. On watson-1 one user unit,
`ssi-support-inbox.service` running `command-surface/tools/support/inbox.cjs`, replaced the
bug-report poster and the support watcher: a post lane that renders each row once into the
`ssi-learning-app` room, or the `ssi-dashboard-v7-clean` room for a content flag, and stamps
posted_at; and the school admins' draft-only support lane, moved not rewritten.

**Not changed, and why.** Learners are never replied to by an agent (Tom, 2026-09-12); the only
reply is the client's thank-you. The school-admin two-way thread and its draft-for-Tom loop
(2026-09-10) are as they were; teachers still do not get it. No row was moved, deleted or updated
in any old table. Posting is into the channel room, not an automatic dispatch per row: the room
reads and decides what to commission. Known test senders (Tom's own addresses and +tags, Kai,
ssi_admin accounts, test schools, probe bodies) are stamped and not posted, so they never
resurface and never wake a channel chief; a tester-role report such as Aran's is real and is
posted.

## 2026-09-14 — A failed undo is not an undo; the sweep plans from the fresh row (job #689)

**Undo retryable.** `undoCopy` used to write its audit row with `undo_of` even when a per-table
deletion had failed. The next attempt found that row and answered `already_undone`, so a
half-deleted copy could never be finished and was reported as reversed. Now a failed attempt is
written as `undo_failed_of`: it stays on the append-only trail with what it did delete, but the
already-undone check, the prior-copy scan and the copy-notice helper all ignore it, so the copy
stays in force and the undo runs again. Deletions were already idempotent, so the retry completes.
Test: `classProgressCopy.test.ts` "a failed undo is not recorded as an undo" — red on the old code,
green on the new.

**Sweep drift check uses `still`.** `tools/copy-teacher-play-sweep.mjs` rescanned before each
write but then planned from the original scan's learner id and course code. It now plans from the
fresh row, and skips-and-names the pair if the class's course or the teacher's learner id changed
between scan and write. Dry run after the change still reproduces five copies / 336 rows.

## 2026-09-14 — Test files under api/ are no longer compiled as serverless functions (job #694)

**What changed.** A root `.vercelignore` excludes `api/**/*.test.ts`, `api/**/*.spec.ts` and
`api/**/__tests__/**` from the Vercel upload. Vercel treats every `.ts` under `api/` as a function
to compile, so ~250 test files were being built on every deploy; job #690's diagnosis put the
build step at 282s on 25 Aug and 726-925s by 14 Sep, all of it in the function-compile phase, with
`api/admin/testDoors.security.test.ts` alone costing 280-347s because it reads player-vue sources
by path. Install and Vite were unchanged at 40-50s.

**Not changed.** `pnpm test:api` reads `vitest.api.config.ts`, which includes `api/**/*.test.ts`
from the git checkout, not the Vercel upload, so it collects the same 250 files (243 listed with
tests; the seven `.live.test.ts` files skip themselves without a service key, as before). No live
route imports a test file, and `tsconfig.api.json` already excluded tests from typecheck.
`vercel.json` had no `ignore` key and its `functions` block names only real routes.
## 2026-09-14 — Two gaps in job #683: the banner on cold loads and in Listening Mode; the picker tie-break (job #693)

**Who is playing.** The playing-as-yourself banner took teacher-ness from `useSchoolContext`,
which a teacher who opens the app straight into the player never populates, so the banner stayed
hidden for her whole session. It now reads the cached educational role from `useUserRole`
(`restoreFromCache`, the same cache the first-open redirect reads) and still honours school
context when it is there. Teacher, tutor and school leader count; a group leader has no class to
play as. Never under View As, never for a learner, as before.

**What counts as playing.** The main player alone echoed its transport state on the window, so
Listening Mode, which has its own transport inside `ListeningOverlay`, was invisible to the banner
and to the never-interrupt gates. `playback/playbackLiveness.ts` is the one answer now: each
transport reports itself by name and `isAnyPlaybackLive` is the OR; the `ssi-play-state` window
event is dispatched from there when the combined answer changes, so the install banner and the
update prompt keep working unchanged and gain Listening Mode for free. Tests:
`PlayingAsYourselfBanner.test.ts` (cold load with no school context: red on the #683 banner) and
`playbackLiveness.test.ts` (the overlay reports its transport: red on the #683 overlay).

**The picker tie-break.** `rankByClassMinutes` broke ties on `last_active`, but `api/admin/users.ts`
ranked before the enrollment rollup that carries it was loaded, so every tie compared empty
strings. For a ranked read the rollup is now loaded for the whole candidate set first, handed to
the ranker keyed on `learners.id`, and reused for the page. Test: equal minutes rank by the rollup's
last activity, red on the old ranker.

**The record corrected.** The #683 report said the School leader shortcut showed angharadjones with
"272 min". The picker's own function, read live today, gives 144 min for her: class-account
in-app time over seven days, 8,623 seconds rounded up. 272 was the school total including personal
accounts, from a different surface. The picker line and the ranking use the same figure, so there
is no third defect in code.

## 2026-09-14 — The playing-as-yourself strip pushes the player down instead of covering it (job #699)

**Seen on staging a5a37c6.** The strip from jobs #683/#693 was a fixed band across the top of the
player and sat ON it: in the main player it half-covered the belt row's back and forward buttons and
the progress readout; in Listening Mode it covered the tabs and the close circle. Wording and
behaviour were right; only the layout was wrong.

**Same mechanism as the Viewing-As band, and both bands now sum.** The strip measures its own
height and publishes it as `--own-play-banner-h` on `<html>` with a `has-own-play-banner` class,
exactly as `ViewingAsBanner` does with `--viewing-as-h`. Rather than name two variables in every
consumer, `style.css` sums them once as `--top-bands-h`, and that is what the body padding rule and
every piece of fixed top chrome now name: the player escape, the tutor tab rail, the schools top bar
and drawer, the app root, the QA report button. Body padding cannot reach a `position: fixed;
inset: 0` surface, and both the player root and the Listening overlay are one, so each names
`top: var(--top-bands-h, 0px)` itself; a side effect is that the Viewing-As band now clears the
player too, which #675 had claimed and the CSS did not deliver. The strip already pads itself out of
the notch, so while it is up the shell's top inset token is zero under it; the Listening overlay's
three direct `env(safe-area-inset-top)` reads now go through that token, as the tokens file says
they should, or the header and the overlay would pad out of the notch twice on a phone. Better: no
control covered in either mode. Simpler: one summed variable, one class per band, no per-surface
strip. Cheaper: the next band is one term in one calc.

**Proof.** `PlayingAsYourselfBanner.test.ts` gains a case that the variable and class are set while
the strip shows, cleared when play stops, and cleared on unmount: red on the #693 banner, green
here. Staging only; main untouched on Tom's 17:01Z ruling.

## 2026-09-14 — Play as class from the Classes page stamped the teacher on the class's telemetry (job #733)

**Seen on staging c7f9ec8, 21:32Z.** A brand-new teacher launched Play as class for Y7 Welsh from the
Classes page. The `sessions` row for that play belongs to the class, as it should; every
`player_events` row of the same play, and the speaking-opportunities counter, belong to the
teacher's own learner. One play, two owners.

**Cause.** The Classes page builds its own row object for each class and that object carried no
`class_learner_id`, so the shared launcher stored the class payload with `class_learner_id: null`
and the player's learner id fell back to the staff member's own. That fallback is the identity the
telemetry client claims on every batch and the identity the opportunities RPC is keyed on. The
sessions, enrollment and lego-progress writes never saw it, because in class mode they go through
the class-aware stores, which hand the server the class id and let it resolve the class learner
from the classes row. Same bug on `main`: the Classes page row has been shaped this way since it
gained its own Play button, so this is not a regression of tonight's promotion train.

**Fix.** Three parts, all in the launch path. The Classes page row now carries the class learner
id. The launcher's class shape makes `class_learner_id` required and nullable rather than optional,
so a row shape that drops the key is a type error, not a silent null. And when a caller does hand
over a null, the launcher reads the classes row once before storing the payload, so a freshly
created class or any future partial row still launches with the right identity. Better: one
identity for one play. Simpler: no new plumbing, the read reuses the launcher's existing Supabase
fallback shape. Cheaper: one row read, only when the key is missing.

**Blast radius of the mis-stamped rows.** Everything that reads `player_events` or
`learner_speaking_opportunities` by learner: the Time in app column and the class "Not started"
state on the Classes page and the dashboard cards, the dashboard's "you have been playing as
yourself this week" line, daily activity, the intel and diary endpoints, and the copy-teacher-play
candidate sweep, which would offer to copy this play from the teacher onto the class. Practice
minutes on the enrollment and the class's position were right all along.

**By design, not bugs.** No `class_sessions` row: the player still attempts the insert on the
eager-load path, but the class's practice record is the `sessions` row under the class learner
since the class became a first-class learner; the insert is best-effort and logs on failure. No
`lego_progress` row for either learner after a completed round: on the live SimplePlayer path the
per-cycle call that would write lego_progress runs with no current playable item and only advances
the opportunities counter, and the round path writes the position to the enrollment or, in class
mode, to `classes.last_lego_id`. Neither learner was ever going to get a lego_progress row here.

**Proof.** `usePlayAsClass.test.ts` gains a case that launches with the exact row shape the Classes
page handed over and asserts the stored payload carries the id from the classes row: red before
the fix, green after. Staging only; main untouched on Tom's ruling.
## 2026-09-14 — The paywall never sends a learner back to the start of the course (job #734)

**Seen on staging c7f9ec8, 21:33Z.** Tom, a brand-new teacher on the ZZ Test Chepstow school
(platform_status trial, trial_course_code cym_s_for_eng, expires 2027-08-07), pressed Play as
class on Y7 Welsh (cym_n_for_eng), belt-skipped to Yellow, lego-skipped to its last round, and the
wall came up at seed 20; dismissing it put the class at round 0. Two defects, one in each half.

**A — entitlement: bug, not policy.** The server resolver, replayed live for the teacher's auth uid
today, grants cym_n_for_eng through class coverage: the teacher is tagged on the class, the class's
school has a live trial, so the class's own course is covered until the school's date. The
school-staff layer adds cym_s_for_eng from trial_course_code. So the policy answer is "entitled",
and by that policy the wall was wrong. The player did not see it because the entitlement snapshot
it gates on is fetched at boot and on sign-in and then held in memory; the class, and the tag that
grants its course, were created at 21:23:57, after the teacher's sign-in, and nothing asked again
before the wall. Code read, not observed: the phone's snapshot is not in any table. Two refreshes
close it: the play-as-class launch asks again before the player mounts, and the wall itself asks
again the moment it rises, so the existing entitlement watcher closes it and resumes if the fresh
answer grants. The policy question that remains is Tom's, not the code's: the school's trial names
cym_s_for_eng and the class teaches cym_n_for_eng; class coverage covers it today because the
rule is "any class course while the school's platform is live", and that is what shipped 2026-09-09.

**B — the reset.** Both rewind sites called `jumpToRound(0)`: `dismissPaywall` by design
("rewind to the start of the free preview") and the post-init resume gate. The wall was the
mechanism that threw the position away. The rule now lives in `playback/paywallLanding.ts`: a
cursor still inside the preview does not move at all; a cursor already past the wall (the
round-boundary advance bumps roundIndex before the listener pauses; a saved position can resolve
past the wall on a cold load) retreats to the last playable round, never to round 0. Better: the
learner keeps their place. Simpler: one pure rule, two call sites. Cheaper: nothing new to fetch.

**Proof.** `paywallLanding.test.ts` proves the rule and reads LearningPlayer.vue for the wiring:
red on the old `jumpToRound(0)` sites, green here. `usePlayAsClass.test.ts` gains the launch
refresh, red on the old launch. Staging only; main untouched on Tom's word.

**Left for #733 (event identity).** Every player_event in the class session is stamped
user_id = the teacher's own learner with actor_user_id set, while the sessions row and the
enrollment cursor are the class learner's; the teacher's own enrollment also carries the class's
S0008L01/13 cursor from that window. Not touched here.

## 2026-09-14 — A paywall retreat never loses the learner's real position; the content gate learns class and school cover (job #745, follow-up to #734)

**Decision.** Tom's rule (2026-09-14): a paywall never moves a learner's belt or position back.
#734 stopped the rewind to round 0; the retreat to the last free round still overwrote the real
cursor in localStorage on the same tick, so a grant from the wall's own refresh resumed from the
retreat. Now `playback/paywallRetreat.ts` holds the real position when `settleCursorAtPaywall`
retreats; while held, `savePositionToLocalStorage` and `persistLivePositionToDb` skip; the
liveEntitlements watcher jumps back to the round carrying the held LEGO in the live engine queue
before resuming; the memory is spent by the one signal that means "playing on", a cycle prompt
with the wall down. Better: the learner keeps their place across a stale-snapshot wall and across
"Maybe later" followed by a grant. Simpler: one pure memory, three moments, no new fetch. Cheaper:
nothing runs that did not run before.

**Two more losses of place, found by the served-build probe.** (1) `api/_utils/courseAccess.ts`,
the gate on bundle/cycles/infplay-cycles/batch-urls, read only stored rows plus the cascade RPC,
while `/api/entitlement/user` resolves five layers. A class-covered teacher was told she held the
course and then served the preview-only bundle and a 403 past Yellow; her saved LEGO was not in
the preview round map and the player started her at S0001L01 with no wall. The gate now delegates
to `resolveActiveEntitlements`, fail-soft to preview-only. (2) The restore first jumped by the
round index kept at retreat time; the bootstrap queue is a window with the resume LEGO at round 0,
and the full-script handoff swaps in the whole course, so index 0 became "I want". Restore
resolves by LEGO against `getEngineRounds()` and stays put if the LEGO is not there.

**Proof.** `paywallRetreat.test.ts` (memory + wiring + by-LEGO restore) and
`api/_utils/courseAccess.test.ts`, each red on the pre-fix code and green after. Served staging
build dc04740, ZZ Test cover teacher, saved S0031L01/round 56, first entitlement fetch forced
empty: wall up with localStorage still S0031L01; grant; playback resumed on "that you speak"
(S0031L01) with localStorage and the DB cursor unchanged. The first build of this job (627722e)
ended on S0001L01, which is how (1) and (2) surfaced.

**Left open.** A genuinely unentitled learner with a saved position past the wall still gets the
preview-only bundle, whose round map lacks their LEGO, so the player starts them at S0001L01 and
the lifecycle save writes seed 1 to localStorage with no wall shown; the DB cursor is safe behind
the forward-only write. Same family, not this job. Waiting on an in-flight refresh in the resume
gate would not help: nothing is in flight until the wall itself asks.

## 2026-09-14 — An unentitled learner's saved cursor past the wall is held at the wall, never dropped to seed 1 (job #752, follow-up to #734 / #745)

**Decision.** Tom's rule (2026-09-14): a paywall never moves a learner's belt or position back to
the start of the course. #745 left one case open: a learner who is genuinely NOT entitled (lapsed
subscriber, or a free-preview learner whose cursor was carried past the wall) with a saved place past
Yellow is served the preview-only bundle, which has no round for that LEGO. Served staging build
dc04740, +colombo-wall (empty entitlement list), S0031L01 saved on cym_s_for_eng: the local winner
went straight to bootstrap, `/cycles?from=S0031L01` was refused, the legacy walk landed on S0001L01,
and within two seconds the lifecycle save wrote seed 1 over the saved place in localStorage with no
wall shown. The DB cursor survived only because its write is forward-only.

Now the post-init resume gate asks a second question after "did we land somewhere locked": "is the
SAVED place locked?" — the same local-vs-server authority rule the resume uses, against a
`serverCursorSnapshot` read at boot. If it is, `holdSavedCursorAtPaywall` puts the saved LEGO into
the #745 memory (every position write blocked), lands on the last free round of the LIVE engine queue
through `paywallLandingRound`, and raises the wall. The memory is now spent only by a prompt on the
REMEMBERED round (`paywallRetreat.release`), not by any prompt with the wall down, so "Maybe later"
followed by replaying the preview never overwrites the saved place either. Upstream, a local winner
in `resolveStartLegoId` is resolved against the round map like a server one (fail-to-local if the
map cannot be read), and the cache fast-path uses the same `beyondSliceLanding` rule as
`resolveResumeStart`, so a cursor beyond the preview slice bootstraps on the last preview round
instead of asking the server for a LEGO it will refuse. Better: the learner sees the wall on the
round they can play, and a later subscription or code opens the player on the place they really had.
Simpler: one more question in the one gate, one pure rule shared by two resume paths, no new
mechanism beside the #745 memory. Cheaper: one avoided 403 and legacy walk per such open.

**Proof.** `unentitledPastWall.test.ts`: ten assertions red on the pre-fix code, green after
(beyond-slice rule, release rule, gate / phase-watcher / resolver / fast-path wiring);
`paywallRetreat.test.ts`'s "spent by any prompt" assertion flipped on purpose. Local dev build
proxied to staging, +colombo-wall, S0031L01 planted in localStorage and the DB: wall up at 2.5s
on "I was trying" (S0019L01, the last round of the preview map), localStorage and DB cursor
unchanged through 25s, and unchanged through "Maybe later" plus 15s of play. Cold device (DB row
only): same, localStorage stays empty.

**Addition (same job, from a cold verify of #745): a grant resumes only after a verified restore.**
The liveEntitlements watcher tried the restore and then, whether or not it landed — the remembered
LEGO not yet in `getEngineRounds()` (lazy load, or the queue still the preview window), or the jump
throwing — lowered the wall and called `resume()` at the RETREATED position; the next prompt spent
the memory and the cursor writers persisted the retreat. Now `playback/paywallGrant.ts` carries
`restoreHeldPosition` (true only when the engine is verifiably on the held LEGO afterwards; never
spends the memory) and `grantAction` (held and not restored → lower the wall, stay paused; otherwise
lower and resume), and a `roundCount` watcher retries the restore whenever the engine queue grows.
Tested against a fake engine (`paywallGrant.test.ts`), not a source read.

**Left open.** After a grant inside the wall the held LEGO is not in the preview queue, so the
learner is left paused on the preview's last round with the wall down; the restore fires as soon as
rounds carrying that LEGO arrive, otherwise the real place is restored on the next open.
`useBeltProgress`'s boot upsert stamps `last_practiced_at` to now on every open (seen in every probe,
before and after); not a position write, not touched here.

## 2026-09-14 — A grant at the wall recovers the real place and resumes play; never silent-paused at the moment of purchase (job #757, follow-up to #752)

**Decision.** #752 left one honest gap: after a grant INSIDE the wall (a code redeemed, a
subscription completing in-app, a class created after sign-in) the held LEGO was not in the
preview-only queue the player had bootstrapped from, so the wall came down and the learner sat
paused on the preview's last round, indefinitely, until rounds carrying it happened to arrive or
the next cold open. Served staging 657218b showed it: wall down, no resume for 24s. That is the
moment of purchase or redemption and it must not feel broken. The reason waiting could never help:
the preview bundle the server issued before the grant sits in `useCourseBundle`'s in-session map
for the life of the tab, and a locked LEGO never enters a preview queue.

Now `grantAction` answers `lower-and-recover` for a held-and-not-restored grant, and
`recoverHeldPosition` (pure, `playback/paywallGrant.ts`) does the rest: restore if the live queue
already carries the LEGO; otherwise re-fetch under the grant and restore again — true ONLY when the
engine is verifiably on the held LEGO afterwards. The player's `refetchScriptUnderGrant` is the
existing belt-jump pipeline with one difference: `getCourseBundle(code, { forceRefresh: true })`
first, past the in-session map and IndexedDB, so the server gate (which honours entitlements per
request since #745) hands the full bundle; then `generateScript` → `mergeGeneratedRoundsIntoQueue`
(the same `addRounds` path a belt jump uses). While it runs the player shows its own loading line
(`loading.findingProgress`, already translated everywhere); play resumes only once the restore
lands, and only if the wall was up — after "Maybe later" the place is recovered the same way and the
play state is left to the learner. The write-hold stays until the play-on prompt, as in #752; a
recovery that fails (offline, or a server that still says preview) keeps the memory, stays paused,
and the `roundCount` retry remains as the net. Better: the learner hears the phrase they were on
within two seconds of paying. Simpler: one new branch in the one grant rule, one pure async
function, no second loader. Cheaper: one bundle fetch per in-wall grant, the same fetch a cold open
would have paid.

**Proof.** `paywallGrant.test.ts`: the flipped `grantAction` assertion and four `recoverHeldPosition`
cases (refetch brings the LEGO → restored; already present → no refetch; refetch throws or still
lacks it → false, memory kept, nothing moved; nothing held or still locked → no refetch) red on the
pre-fix rule (5 failures), green after; `paywallRetreat.test.ts` asserts the watcher wiring.
Typecheck, the three paywall suites and lint green. Served staging build c150c21 (chunk
PlayerContainer-BvUOQc4l.js carrying the #757 string), +colombo-wall (empty entitlement list),
S0031L01 / round 56 planted in localStorage and the DB, and — new in the probe, `GRANT=db` — a REAL
`user_entitlements` row (access_type full) inserted while the wall's own entitlement refresh was
held, then the refresh continued to the real server:

| Moment | localStorage | DB cursor | Screen | Playing |
|---|---|---|---|---|
| wall up, 1s after open | S0031L01 | S0031L01 / 56 | last preview round | no |
| grant +0.6s | S0031L01 | S0031L01 / 56 | wall DOWN | — |
| grant +1.7s | S0031L01 | S0031L01 / 56 | "that you speak" (S0031L01) | yes |
| grant +10s | S0031L01 | S0031L01 / 56 | "that you speak" | yes |

Planted enrollment and grant rows removed after (204 / 204). The loading line was not seen by the
probe: the whole recovery took about a second on staging.

**Left open.** A client-side fake grant with a server that still serves the preview (the probe's
older `GRANT=1` mode) recovers nothing, by design: the refetch returns the preview, the memory and
the write-hold stay, the player stays paused with the warning logged. `useBeltProgress`'s boot
upsert stamps `last_practiced_at` on every open, as before; not a position write.

**Addition (same job, from a cold verify of #752): the write-hold covers every DB cursor writer.**
Previous-phrase inside the preview after "Maybe later" went `handleRoundBack` →
`persistCursorAtCurrentRound` → `setRemoteCursor` → `ProgressStore.setEnrollmentCursor`, which
permits a backward write — so the DB cursor took a preview position while localStorage stayed
protected. Audit of every cursor writer: `persistLivePositionToDb` and `savePositionToLocalStorage`
already held; `setRemoteCursor` (belt jumps, round back/forward, jump-to-furthest, offline entry)
now returns while the real place is held; the throttled `current_cycle_index` queue now refuses
under the hold too (a preview round's cycle index on the held LEGO's row would mislead the
same-sitting resume); `saveRoundProgress` writes no cursor in the main loop and its INF-PLAY ratchet
is unreachable behind a wall. `paywallRetreat.test.ts` asserts both wirings: red on the pre-fix
source, green after.

**Addition (same job, found by the write-hold probe): the post-init resume gate waits for the
subscription answer.** On served staging c730751 one open in four skipped the hold entirely: no
wall, localStorage rewritten to S0019L01 within two seconds, the DB cursor saved only by its
forward-only write. Cause: `positionInitialized` fired while `/api/subscription` was still in
flight; `checkCourseAccess` treats that window as optimistic access (the morgan1009 rule — never
bounce a payer to the wall on a page-load race), so `canAccessSeed(31)` said yes, the hold was
skipped, and the lifecycle save two lines later wrote the preview landing over the real place.
Now `useEntitlement` exposes `accessPending` and `subscriptionHydrated`, and the gate plus both
lifecycle saves are deferred until hydration — bounded by useSubscription's own 8s timeout, which
fails closed. The optimistic rule itself is untouched: a payer still sees no wall, they just wait
for the answer before the cursor is stamped. Wiring asserted in `paywallRetreat.test.ts`, red on the
pre-fix source, green after; three consecutive served-build opens held at the wall with both
cursors on S0031L01.

## 2026-09-15 — The schools release ships to main; the one-off teacher-play sweep applied (job #758, Tom's GO 00:14Z)

**Promoted** staging → main at `bfda61b8c` (206 commits, promote merge `727a21afa`, notes commit on
top), production serving build `bfda61b` from 00:23Z on `saysomethingin.app`. The #752 follow-up
(job #757, four additions) had landed on staging before the promote and rides in it. The promote
first refused because main carried the rate-compare preflight hotfix `993e1bd50` that staging had
only as job #629's equivalent; back-merged main into staging keeping staging's file, and after the
ship back-merged main into staging and dev again so the promote merge is an ancestor of both.
**Standing shape:** after every promote, main holds the promote merge and the notes commit that
staging does not, so the next `promote.sh` refuses until main is back-merged — do it as the last
step of every ship, not the first step of the next.

**Release notes** hand-drafted on dev before the promote so the finaliser carried them: three
headlines — the wall keeps your place and resumes on a grant; Support replies arrive in the in-app
inbox; teachers open on the dashboard with Play as class and minutes-based Insights — plus the one
line. `tools/release-train/notes/2026-09-15.md`, on main and dev.

**Spot-check on the served build**, `packages/player-vue/e2e/_758-ship-spotcheck.mjs`: the ZZ
Test teacher-only persona's second open lands on `/schools` (the first open reaches the player once
by design — the rule reads the cached role), Play as class present, no LEGO wording, one class
Insights page renders with home and rate-compare 200, the school admin persona's support thread
answers 200 with the composer visible; a teacher's 403 from the support thread and from
`/api/org/intel` are both by design (admins-only channel; teacher lens is `/teacher-insights`).

**Sweep applied** (`tools/copy-teacher-play-sweep.mjs --apply`, actor
`sweep:copy-teacher-play:2026-09-14`, the #689 undo fix in place) only after main was confirmed
live with the inbox. Fresh re-scan first: the same five pairs as the 14 Sep dry run, 336 rows, 0
minutes. Result: 5 copied, 0 partial, 0 failed, 0 drift — Chepstow 11E davidlane 90 rows, 11H
marielane 85, Tredegar 10R Miss Smith 8, SR Mrs Ruttley 102, Monmouth 7GSN Mr Snelgrove 51; five
audit rows and five inbox notices with one-tap Undo, one per teacher, verified in the live DB.
Reconcile re-scan: 0 copies remaining; ambiguous 183 → 188, the delta exactly the five classes now
in `condition_3_class_account_has_play`, every other entry bit-identical. Trial scope untouched.

**Addition (Tom, 00:16Z): the school leaders were told.** Four inbox messages, one per school row,
sent through `sendUserMessage` with idempotent dedupe keys by
`tools/leader-notice-teacher-play-sweep-2026-09-15.mjs`: angharadjones at Chepstow for 11E and 11H,
Miss Morris at Ysgol Gyfun Tredegar for 10R, hughesr310 at the second Ysgol Gyfun Tredegar school row
for SR, Anna Aggleton at Monmouth for 7GSN — Tredegar exists as two school rows with two different
leaders, so each got the note for their own class. The five teachers received nothing further; the
live table holds exactly one `class_play_copied` message per teacher and per leader, nine in all.
## 2026-09-15 — A pending subscription verdict is itself a cursor write-hold; the resume-TTL rewind cannot cross the wall (job #761, follow-up to #757)

**Decision.** While the post-init resume gate is waiting for the subscription answer, nothing may
persist a position the gate has not yet judged. `paywallRetreat` gains `awaitVerdict` /
`verdictReached`; `blocksPersist` is true while a verdict is pending, exactly as it is while a real
spot is held. The `positionInitialized` watcher raises it the moment it defers the gate and drops it
the instant `subscriptionHydrated` flips, right before the gate runs — so the dormant save on
backgrounding, the prompt-entry save, the navigation cursor writer and the cycle queue (all of
which consult `blocksPersist`) are all covered by one flag. Bounded by useSubscription's own 8s
hydration timeout, which fails closed; a guest or an already-hydrated open never enters the window.

**Why.** A cold verify of #757 found the dormant/visibility save in `saveResumeAudio` consulted only
the reset-time sessionStorage flag, and the retreat hold existed only once the gate had run — which
#757 made wait for hydration. An unentitled learner whose saved cursor was S0031L01, bootstrapped
onto the preview's last round, who backgrounded the app inside that window, had S0019L01 written
over S0031L01 in localStorage and the DB. Reproduced in memory by the verifier.

**Proof.** `paywallRetreat.test.ts`: pending verdict blocks a save; verdict landed and gate held
still blocks; verdict landed and entitled lets the save through — red on the pre-fix module (no
such methods), green after; the wiring order (awaitVerdict before the hydration watch,
verdictReached before the gate) asserted on the source. The #752 wiring test in
`unentitledPastWall.test.ts` had been reading the watcher body for a gate #757 moved into
`runPostInitResumeGate`, red on dev since then; repointed at the gate.

**The resume-TTL writer is left alone, by construction.** The 60-day belt rewind calls
`setEnrollmentCursor` directly, without the hold, but `beltRewindTarget` only ever returns a round
that exists in the rounds the server served, and an unentitled learner is served the preview-only
bundle (`api/courses/[code]/bundle.ts` filters rounds to `previewMaxSeed`). A learner past the wall
holds a belt whose first round lies past the wall too, so the target is not in the served rounds,
`beltRewindTarget` returns null, and no write happens. A learner inside the preview rewinds inside
the preview — the feature working as designed, not a paywall move. Hydration does not enter the
computation (it reads the saved timestamp and the served rounds), so pending hydration cannot
change the target either. Nothing to route through the hold.

**Addition (same job): the two lifecycle writers refuse on `accessPending()` themselves.** The #760
test (`LearningPlayer.pendingHydration.test.ts`) drives `saveResumeAudio` and the visibilitychange
callback straight from the extracted source against a hand-built context — no watcher runs, so a
hold raised by the `positionInitialized` watcher is invisible to it. Rather than teach the harness
the watcher's behaviour, `savePositionToLocalStorage` and `persistLivePositionToDb` now also return
while `entitlementComposable.accessPending()` is true: the writer refuses on the source-of-truth
predicate, and the pending-verdict hold in `paywallRetreat` still covers the navigation cursor
writer and the cycle queue. Dev was deliberately red on those two cases until this landed; green
now with the real guard, not the test's in-memory control.

## 2026-09-15 — The long-absence belt rewind waits for the subscription verdict and rewinds only an entitled learner (job #768, follow-up to #761 / review #767)

**Decision.** The resume-TTL belt rewind is a cursor writer, so it obeys the #761 rule that no
cursor writer runs before the subscription verdict, and Tom's rule that a paywall never moves a
position back. The legacy eagerLoad TTL block now `await`s a new `awaitSubscriptionVerdict()` (the
same bounded `subscriptionHydrated` mechanism #757/#761 use; immediate for guests and already-
hydrated opens) and then rewinds only when `entitlementComposable.canAccessSeed` allows the
rewind target's seed — gating BOTH the in-memory landing and the `setEnrollmentCursor` write. A
lapsed subscriber is therefore not rewound while lapsed: they stay on their real place, which the
post-init gate then holds and walls. On their first entitled open after resubscribing the same
days-since-practice check runs and they are regressed then — the regression is deferred, never
escaped. The entitled learner's rewind, its telemetry reason and its landing are unchanged.

**Why.** #761 left the rewind alone "by construction" on the grounds that an unentitled learner is
served the preview-only bundle, so the target is never in the rounds. Review #767 showed the
construction leaks: a same-owner cached FULL bundle outlives entitlement, so a lapsed learner at
S0031 was rewound to S0020 and that cursor written — a position move by the paywall, and a write
before the verdict. The await lands only on the rewind path (a returning learner past the
regression threshold), so no other open pays for it.

**Proof.** `LearningPlayer.resumeTtlEntitlement.test.ts`, Astra's #765 test adopted and
narrowed: pending-at-init-then-unentitled and hydrated-but-expired both leave S0031L01 in memory
and in the store (no write); pending awaits the verdict exactly once; hydrated-and-entitled still
writes the S0020L01 / round 19 regression with the same reason payload. The helper itself is
extracted from the source and shown to resolve at once when nothing is pending and to watch
`subscriptionHydrated` until it flips. Astra's "held cursor" case is dropped with a comment: the
retreat hold is raised by the post-init gate, which runs after this block, so it is unreachable.
Red 5/7 on pre-fix dev, green 7/7 after; the 18 suites that read LearningPlayer's source stay
green; typecheck and lint clean.
## 2026-09-15 — Every school list opens by activity; the year-group tiles show minutes under a big year key (job #766, Tom 00:52Z)

**Ruling.** Tom, reviewing the live Chepstow Classes page as school leader after the 2026-09-15
release: "always sort students/classes/groups of any entity as the default by activity — the most
logical being the in-app minutes". And the year-group tiles, which showed phrases practised as
their big number under a headline reading "2 h 44 min in the app this week", he read as minutes.
So they are minutes, and the year key is the thing the eye lands on.

**What changed.**
- **Default sort is activity everywhere it can be.** Classes page (`TeacherDashboard.vue`): opens
  on time in app this week, busiest first; `?sort=` is written only for a non-default choice, so
  the leader home's "minutes" stat link still lands on the same order. Teacher home rows
  (`DashboardView.vue`) by the class account's minutes this week; the leader and admin-view class
  tables by the average practice column they show. Org home (`NodeHomeView.vue` / `belowTree.ts`):
  class rows under each node by the class account's in-app minutes this week, pupils on a class
  page by their week minutes. Class roster (`ClassDetail.vue`), all-students page
  (`StudentsView.vue`), staff who teach here (`TeachersView.vue`) and the govt schools list
  (`SchoolsView.vue`) by the practice-minutes column each shows. Every Sort by control stays.
- **Tiles show minutes.** `yearGroup.ts` carries `minutes7d` per class and sums it per year group;
  the Classes page feeds each row's own `minutesWk`, the org home a new per-class
  `inAppMinutes7d` on the tree payload (`api/groups/[id]/home.ts`, off the diary read the headline
  already pays for — `inAppTimeSeconds` now returns per-class-account seconds). Formatted through
  `practiceMinutes.ts`: round up, hours only from an hour. The phrases count is dropped from the
  tile — it stays on the data for anyone who wants it, but a fourth line on a 104px tile costs
  more than it says.
- **Big year label.** "Y7", "Y8" … "Other"; the class's own name on a per-class fallback tile;
  the long form "Year 7" on the hover and for the screen reader.
- **One rounding rule on the org home too.** Its headline minutes and the class home's minutes
  used `Math.round` while every school page rounded up (job #683). Both now round up, so the tiles
  beneath the headline share its rule. Fixtures re-pinned: 25-and-a-bit is 26.

**Honest scope.** Lists whose payload carries no minutes-this-week figure are ordered by the
minutes they DO show — all-time practice minutes for the class roster, the students page, the
teachers page and the schools list — and say so in a comment at the sort. Groups and schools as
rows in the org tree carry only counts on their rollup, so they stay alphabetical; a per-subtree
minutes-this-week figure is the one expensive item the #306 review left out and is not built here.

**Proof.** `TeacherDashboard.defaultSort.test.ts` (default order 7H before 6S with no `?sort`,
tiles read the rows' minutes) and `YearGroupTiles.test.ts` (Y7 / Other label, "1 h 4 min" through
the formatter, dash when quiet): both red on the pre-change files, green after. `yearGroup.test.ts`
sums minutes; `belowTree.test.ts` orders classes by minutes; `home.test.ts` carries
`inAppMinutes7d` per class. Stale `DashboardView.minutesHeadline` expectations from #683 re-pinned
("352 min" is "5 h 52 min"). Handbook: both tile descriptions and the Find-a-class sort step
rewritten and re-pinned; `--check` green.

## 2026-09-15 — House re-check of three Astra refutations: all three mechanisms confirmed, all three fixed (job #778)

**Brief.** Re-check, against live code and the live DB, three cold-verify refutations Astra left
open on 14-15 Sep, on the paywall/class-play fixes then on main `bfda61b`. Honesty rule: an honest
"Astra was right" beats a defence. Result: Astra was right about the MECHANISM in all three; one
of the three consequences Astra drew was wrong.

**1. Class play never bumps the playback ledger — CONFIRMED, fixed.** Live
`pg_get_functiondef(bump_speaking_opportunities)` requires `learners.user_id = auth.uid()::text`;
the class learner `2ffd2a0d…` has `user_id = class-learner:d52efceb…`. Tom's test class played
seven `audio_play` events (two `target2`) at 22:11Z on 14 Sep and holds a `sessions` row
(50 s, 2 items); `learner_speaking_opportunities` has ZERO rows for it. The consequence Astra
drew — class dashboard phrase/opportunity counts therefore wrong — is REFUTED: since job #159 the
class figures are deliberately read off the diary (`api/_utils/classPractice.ts`: one phrase per
`target2` clip; in-app time off `player_events` timestamps), never off the ledger, so a teacher
sees the right phrases (2 for that play) and the right minutes today. What WAS wrong: the ONE
definition of a minute silently excluded every class, and the player logged a refused RPC on
every flush. Fix: `/api/school/class-progress` gains `bumpSpeakingOpportunities` (service role,
teacher-scope-gated, onto the class's own learner id, same non-negative-delta-onto-today's-UTC-row
semantics as the RPC); the class-aware progress store carries it; `useLearningSession` tries it
first and falls through to the RPCs when the store reports not-handled. Nothing reads class
ledger rows yet — the diary-based figures stay, so a class that played last month and one that
plays today count the same way.

**2. A same-owner cached FULL bundle outlives entitlement — CONFIRMED, fixed.**
`declarationDisagrees` (useCourseBundle.ts) had three cases: provisional record, preview with a
token, full for another identity. A full record for THIS identity passed all three, and the head
probe compares content versions only, so a lapsed subscriber kept the whole course from IndexedDB
until the content version moved. Cost to a real learner: bounded by the client gates — the
post-init gate, the per-round advance check and the jump check all consult `canAccessSeed`, and
the audio proxy is fail-open by default (`ENTITLEMENT_STRICT` off) — so the bundle was defence in
depth that had failed, not the wall itself; #768 had already conceded and fixed the one gate that
relied on it (the rewind). Fix: a fourth case — full record + the app's own verdict for the course
says preview — plus `setCourseBundleEntitlementProvider` wired in App.vue off the same
`/api/entitlement/user` + `/api/subscription` answers the server's ONE resolver gives, null while
the verdict is in flight (never a disagreement, so boot serves the cache as before). The sweep
runs on `entitlementsReady` and on every `isSubscribed` flip, once per (course, identity,
verdict); the server slices the refetch. A verdict that is wrong the other way (client says
preview, server says full — a covered pupil) costs one refetch of the full bundle, once.

**3. A stale "active" mirror runs cursor writers before the verdict — CONFIRMED, fixed.**
`accessPending()` is `!isPaid && signedIn && !hydrated`, and `isPaid` reads the localStorage
mirror of the LAST `/api/subscription` answer, loaded into state at composable setup. So on a
device holding last month's "active" mirror, accessPending() was false before any answer had
landed: the `positionInitialized` watcher ran the gate immediately with no hold, the two lifecycle
writers wrote behind it, and the legacy TTL rewind's `awaitSubscriptionVerdict` resolved at once.
Cost to a real learner: the writers wrote the REAL position (no retreat had happened), so no
position was lost; the rewind path is unreachable on the live boot path (see the #768 entry);
the exposure was a lapsed learner in the 7-day renewal grace, or cancelled mid-period, playing
past the wall until the answer landed and the next round-advance check caught them. Fix:
`useEntitlement` gains `verdictPending()` = signed in && !subscriptionHydrated; the gate's
deferral, `awaitSubscriptionVerdict` and both lifecycle writers use it. Access checks keep the
mirror's optimism (an offline payer stays a payer).

**Production right now.** Nothing a real learner would notice is wrong on main: class dashboards
show the right figures off the diary; the paywall gates hold on the verdict once it lands; the
only live effect of (2)+(3) is a lapsed-in-grace subscriber's first rounds of a session before
the answer arrives. Not a hotfix; rides dev → staging → the next promotion.

**Proof.** Red on the pre-fix sources, green after, suites run alone: `LearningPlayer.
resumeTtlEntitlement.test.ts` + `LearningPlayer.pendingHydration.test.ts` (3 stale-mirror cases
red, 30/30 green with `paywallRetreat.test.ts`); `useCourseBundle.tierDeclaration.test.ts`
(3 #778 cases red, 8/8 green); `useLearningSessionPhrasesSpoken.test.ts` (2 red, 14/14 green);
`api/school/class-progress.test.ts` (4 red, 18/18 green); `useClassProgressStore.test.ts` green.
Pre-merge invariants and `--changed` green for the API; player-vue `--changed` 41/42 with the one
red suite (`premiumPrompt.orgFreeAccess`) failing on `supportIdForLearnerId` missing from the
SHARED checkout's stale `@ssi/core` dist (branch `perf/journey-baseline-2026-09-01`), which the
worktree's symlinked node_modules resolves to — not this change; typecheck of both packages is
clean against a locally built core.

## 2026-09-15 — Organisation members never read "school" where their workplace belongs (job #786)

**Trigger.** Deborah (SSi staff) set up a test organisation for the National Museum's Welsh
learners, invited herself as Group Leader with a second email, and the Set-a-password card
said "school email filters often swallow those". Tom: "I'll do a sweep for any inappropriate
schools mentions." A customer is waiting, so this rode dev → staging → main in one pass.

**Method.** The static grep is ~1,500 lines, most of them comments and schools-product files,
so the sweep was walked, not grepped: a real organisation was provisioned on staging through
`/orgs`, a second leader and a learner were invited by personal link and a shareable learner
link was minted, and every screen those three people reach was screenshotted with its text
dumped and searched for school / teacher / class / pupil / student. What surfaced, and what
was done with it:

- **Set a password card** (shared by school and org node homes): "school email filters" →
  "some email filters". Neutral, because the card has no idea what it is mounted on.
- **Signed-out sign-in page** at `/org/:id` read "SaySomethingin · Schools / Your classes are
  waiting / School email / you@school.edu / Join school / I'm setting up a new school", and
  promised an **Access code** that only a school admin can mint. The container now reads the
  lane off the URL (`/org/*` vs `/schools/*`) — a signed-out visitor has no role yet — and the
  org lane says organisation / people / work email / `/orgs`, with the no-inbox route being a
  password or a re-sent invite. A school admin bookmarked on `/org/:schoolId` reads the
  organisation wording, which is still true of a school.
- **Support and Inbox** (reached from the org leader's menu): "This thread belongs to your
  school" → "your school or organisation"; "replies on your school's Support thread" → "on
  your Support thread"; and the top bar stops saying "· Schools" on those two `/schools/*`
  pages for a group leader, the same rule it already applied on `/org/*`.
- **Insights** on an organisation read "0 of your 0 classes practised together this week",
  "Every class has practised…", "No class has started the course yet" and the rate engine's
  "No classes below this yet". An organisation is groups all the way down (nodeTerminology's
  neutral preset, derived from the same `/home` payload), so on such a node the class-only
  readings are not shown: the rate engine and the Quiet and Journey questions go, and the
  Practising question asks how many of your people practised. Not a new measure, the people
  line the panel already carried. Schools are untouched — a school with no classes yet still
  reads its three class questions.
- **Redeem / invite screens**: a learner code minted at an organisation or plain group is a
  "Learner Invite" that joins "{group name}", not a "Student Invite" that joins "this class";
  govt_admin codes read "Group Leader" (the word the top bar already uses); the `/group` door's
  facts name people and groups instead of schools; the OTP delivery hints only promise an
  Access code when the code belongs to a school, and the org signup door's hint says work
  email. Settings' "If your school blocks our mail" → "school or workplace"; its join-code
  role label follows the same Student-vs-Learner rule.

**Left alone, deliberately.** `JoinWithCode.vue` ("Someone at your school made you an access
code") — access codes are refused to group leaders by `api/school/staff-signin-link.ts`, so
only school staff can reach it. The Handbook page: 46 of its 122 capabilities are visible to a
leader and almost all are written in school words (classes, teachers, pupils) because they
describe school capabilities; an org handbook is its own job, not a copy sweep. The 21
non-English locales still carry their translated "school" wording for the three reworded
keys (`schools.ui.passwordPrompt.body`, `schools.support.doorLine`, `schools.inbox.lede`) —
the register only takes keys missing somewhere, so they are listed as a gap for the next
translation pass. Server-side rate-compare reason text unchanged (unreachable on an org now).

**Proof.** `OrgIntelPanel.test.ts` (three classless cases) and
`SchoolsPasswordPrompt.orgWording.test.ts` red on the origin/dev sources, green on this
branch; i18n gates (no bare English, t-in-scope, locale parity) green; walkthrough `--check`
green after `--reconfirm`; `test:premerge` invariants green and `--changed` 125 files / 883
tests green once the worktree had its own `@ssi/core` build (the shared checkout's dist gave
the usual false reds).

## 2026-09-15 — Seed-sentence reviews get a real mic gap: the bundle stamps seed clips with their durations (job #793)

**Tom (13:22).** Basque for English speakers, "how to say something in Basque" / "zerbait euskaraz
nola esan" at progress 646: the gap to speak is almost nil, "as if the app is measuring the target
file length completely wrongly."

**What the live check found.** The file lengths are right. `course_audio` holds 2760 ms for both
target voices and ffprobe on the bytes production serves says 2.736 s; a 26-clip sample across the
Basque seeds had zero mismatches. The phrase is seed S0004, and a seed sentence only ever plays as a
full production cycle in the SEED-PHASE spaced-rep review, which on a bundle-enabled course the
server builds from `course_seeds`. That table carries audio ids but no durations, so the production
bundle shipped the seed's target refs bare and `computePauseDuration` collapsed to the one-second
floor. Every seed review on every bundle-enabled course had the same gap: 7,619 seed rows with
target audio across the fifteen courses. Job #644 found this class yesterday; its fix was reverted
under the 11:27Z diagnose-first hold. This ships the gap hunks only.

**Decision.** One `course_audio` lookup per bundle build stamps `durationMs` onto every seed target
ref, and when both durations are genuinely missing the formula assumes an ordinary 2.5 s sentence
rather than the safety floor. No pointer moved, no audio regenerated, no duration number edited.

**Better × Simpler × Cheaper.** Better: a seed review gets the gap its sentence earns, on every
course at once. Simpler: seeds now carry the same fact LEGOs and phrases already carry; no new
shape. Cheaper: one indexed query per bundle build, cached with the bundle.

**Landed.** Merged to `dev`, promoted to `staging` and `main` the same afternoon on Tom's explicit
ship instruction.
## 2026-09-15 — Copy-teacher-play: a lesson is credited to ONE class (job #792)

**The bug, as found.** Chepstow's 7E showed 51 practice items it never played, the headline figure on
that school's dashboard for a week. The scout's hypothesis was a stale class context on the play-as-class
write path. Refuted by the rows themselves: the wrong `sessions` rows share `started_at` AND `ended_at`
to the millisecond with the teacher's own rows, which no per-call server write can produce. They are
COPIES. `class_progress_copy_audit` names the writer: five runs of `/api/school/copy-teacher-play/apply`
by the school admin at 06:54Z on 2026-09-15, of which two put roseribbeck's and kaneesien's own play onto
7E as well as onto their own 11S and 8T. Both carry live co-teacher tags on 7E, so the server's
"teaches this class" check was right to admit them. The planner's idempotency key was the
(source, target, course) PAIR, so the same own-account play was offered on every class the teacher is
tagged on, with identical figures on each sweep row, and a leader copying down the list credited one
lesson to two classes. A third such pair exists in the estate: petrasilva onto 8S and B8.

**Ruling applied.** A teacher's own-account play is credited to ONE class, the one the leader copies it
onto. The prior-record scan is now by source learner and course across every target: a source row any
class account already holds is never offered to, or copied onto, a second class; the cursor follows the
play, so a class with nothing new coming keeps its own position and gains no minutes. Undo releases the
rows again. The sweep names the other rows the same play is listed under, and the class card says where
the play already went. Better: one lesson counts once. Simpler: one scan instead of one per pair, no new
table. Cheaper: the same audit rows, one extra column read.

**Not done here.** The 51 wrong items on 7E are two copies to undo, in reverse order, through the tool's
own `undoCopy`. Reported with ids to the parent job; no row moved by this worker.

## 2026-09-15 — The seed-duration lookup is chunked: one GET with a whole course of ids was a Bad Request, so job #793 stamped nothing live (job #804)

**What the staging check found.** Job #793's fix built and deployed (staging 3725b5bab, then main via
the Friday ship), and `version.json` said so, but the Basque bundle it served carried zero seed
durations out of 298. Running the handler against the live database showed the cause in its own log
line: `[Bundle] seed audio duration lookup failed (non-fatal): Bad Request`. Basque has 1,038 seed
target ids; supabase-js sends `.in()` as a GET, a 38 KB URL the Supabase gateway refuses outright,
and at about 400 ids the echoed headers overflow Node's parser. The lookup is non-fatal by design,
so every seed shipped bare. The unit test could not see it: a mock accepts any list length.

**Decision.** 150 ids per query, pages fetched in parallel, each page's failure logged and skipped on
its own. Nothing else about #793 changes. The formula half of #793 was already doing its job on
production: a seed review with no duration now gets the ordinary 2.5 s assumption, so the phrase's
gap in fast mode had already moved from the 1.0 s floor to 7.8 s. With the duration stamped it
becomes the 8.5 s the sentence earns (2.8 × 2760 ms + 800 ms); easy mode 2.0 s → 9.7 s → 10.6 s.

**Size.** Seed rows with target audio, all of which reviewed at the floor before #793: 11,663 across
the 20 courses live in the new app, 27,433 across the 59 beta courses, 39,096 in all. No seed row with
target audio lacks a `course_audio` duration, so once the lookup works nothing is left on the fallback.

**Lesson.** A deploy that says the right sha is not a verified fix; the served payload is. A handler
whose lookup is non-fatal must be probed against live data at course scale before its landing line
says "verified".

**Better × Simpler × Cheaper.** Better: the gap the sentence earns, on every course. Simpler: same
lookup, paged. Cheaper: seven small indexed queries in parallel instead of one refused one.

- 2026-09-15, #812: additive individual grants ledger on `user_entitlements`, retaining `subscriptions` as Paddle detail and family cover. Source values include admin and email_allowlist. Implementation: `supabase/migrations/20260915_individual_grants_ledger.sql`. Landed by job #837: merged to `dev`, promoted to `staging`, migration applied to the shared database and 7 Paddle grants backfilled. `main` untouched.

- 2026-09-15, #812: transactional Paddle mirror plus service-role Play receipt RPC; verified source windows own individual access, family behaviour retained. Code references include learner ids for reusable codes. Implementation and access gaps: `docs/grants-ledger-build-812.md`; live read-only backfill: `docs/grants-ledger-paddle-dry-run-2026-09-15.md`.

- 2026-09-15, #837: the Paddle mirror trigger is FAIL-SOFT on grant owner mismatch. It fires AFTER
INSERT OR UPDATE on `subscriptions`, so it fires on production's Paddle webhook writes from `main`
too; as written it raised when another learner already held the grant for the same
`provider_subscription_id`, which would have failed the webhook's own write and so a real
subscriber's renewal. Live reading before the apply: 19 subscriptions, all Paddle, no null
`provider_subscription_id`, no subscription id under more than one learner — so the raise was not
reachable on today's data, but an ordinary insert reaches it the moment a subscription id is
re-pointed at another learner (account merge, support reassignment, linked-email stub). It now warns
and leaves the existing owner's grant untouched. The service-role RPCs keep raising loudly: their
callers decide. Proof: `supabase/secfix-toolkit/canary_812_mirror_failsoft.cjs`, rollback-only
against the shared database, red before and green after.

**Better × Simpler × Cheaper.** Better: an additive ledger can never cost a real renewal. Simpler:
one branch of one trigger, no new surface. Cheaper: no webhook retry storms, no support recovery.

- 2026-09-15, #854: CLIPS ARE GATED "AS WE GO". Tom: "the handbook is STILL just a bunch of prose
in most cases … we should be building the clips for everything else as we go along." The wiring
of clips into the Handbook (#302, #627) was already live; the gap was coverage: 17 of 122
capabilities had a walk. Gate 13 in `tools/walkthrough/lib.mjs` reads
`tools/walkthrough/coverage.json` and fails `compile.mjs --check` on any HANDBOOK capability no
walk steps on that is not declared obvious with a sentence or on the missing backlog, and on any
routed page under `views/` with no anchor on it or on what it imports. A registry line whose
subject has since gained a walk or an anchor fails too. Enrolled today: 105 capabilities on the
backlog, 16 pages obvious, 6 pages missing. The support drafter (command-surface
`tools/support/handbook.cjs`, `moves.cjs`) now points on a walked entry even without prose steps
and tells the admin to tap Show me. Closed Handbook rows with a clip carry a Show-me chip.
Inventory: https://watson-1.tail4968cb.ts.net/d/1f70d46b

**Better × Simpler × Cheaper.** Better: a new page or capability cannot ship silently unclipped;
the debt is a list, not a feeling. Simpler: one more gate in the compiler that already exists, one
JSON registry, no new system. Cheaper: the gate runs inside the existing `--check` and vitest run.
