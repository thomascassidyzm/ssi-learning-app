# The intelligence surface: usage per class, and tags instead of hierarchy

*Written 2026-09-11, job #215, on branch `cs/215-the-intelligence-surface-tags-us`. Supersedes the reframe of job #212 in its central move. Every claim about the code was read from the code on this branch today. The Chepstow figures are the live read of 2026-09-11 12:08 UTC recorded by job #212, and the brief's own numbers; this job made no database read of its own. The one piece of code here that executes is the contradiction fix, committed on the same branch.*

## The frame, settled

Tom set the frame himself this afternoon, and these are decisions, not preferences. Nothing below reopens any of them.

- **No nudging.** The surface never messages a teacher. Tom: "that's dentist energy".
- **No notices to classes.** Leader-scoped only.
- **Patterns and aggregate behaviour.** Tom: "the intelligence surface is for patterns, for aggregate behaviour". Where a teacher's name appears, it is because a leader asked a question whose answer is a set of classes. The surface never volunteers an opinion about a person.
- **The numbers stay.** Tom: "the numbers as summary are definitely worth it - as are the phrases most spoken summaries" and "the numbers tell the story". Angharad's email is the evidence: one page instead of signing into every teacher's account. Everything here sits on top of what is live.
- **Tags, not hierarchy.** Tom: "to spin up different groups by tag rather than hierarchy". A leader invents the grouping on a Tuesday; the system does not know in advance what "part X of the building" means and must not need to.
- **Usage per class is the headline.** Tom: "they know that SSi works - and all it needs is regular use". The school is not asking whether the method works. It is asking whether the classes are using it.
- **Frictionless admin is part of the product.** Adding a teacher to a class, a supply teacher, a teacher picking up a new class: all easy, all on the same mechanic as the grouping, because Tom put them in the same breath.

The prior reframe recommended per-teacher plain-English notices with a verb beside each. That is the move Tom ruled against, and it is gone from this proposal. What survives from it is its reading of what is live and its evidence of what works, both of which were accurate and are reused below.

## Part A. The differential

### What is live today, verified in code

A leader's insights live at `/org/:id/insights`. The old analytics page is a redirect. The page is the node lens with the org panel at the top: three questions from one server read, scoped on the server from the caller's own identity, refusing a node outside the caller's tree before a single class row is read.

| Question | What it says | Where the number comes from |
|---|---|---|
| Practising | classes that practised together this week against last week, phrases spoken, people on own accounts and their minutes | `player_events` second-voice clips under the class account; the playback ledger for own accounts |
| Quiet | classes gone quiet by how long, classes never started | newest of the enrollment practice stamp or a diary clip |
| Journey | classes started, furthest position as the LEGO's own words, the funnel by sentence | the enrollment cursor |

One tap away, the node home carries the thing Angharad wrote to say thank you for: every class on one page with its minutes in the app together this week, pauses included, its phrases spoken, when it last practised, and its teachers' names, plus the phrases most spoken across the school. That is `api/groups/[id]/home.ts` and it is not touched by anything proposed here.

The units are honest and the honesty is in code. A class cannot write the playback ledger, so a class is measured in phrases spoken and in in-app session time, sessionised off the diary's timestamps per learner id with a five-minute idle cutoff. Tom's ruling of 2026-09-10 is verbatim in the file: "in-app time is in-class time, they want to know that precisely."

### Chepstow, the real school

Thirty-four classes. Zero pupil accounts. Seventeen of thirty-nine staff practised on their own account this week. Fourteen classes ran a lesson this week, up from one, four hundred and thirty-seven phrases spoken. One class, 6S, silent since July. Thirteen classes never started.

And until this afternoon the same screen said thirty of thirty-four had started. Thirteen plus thirty is forty-three classes out of thirty-four.

### The contradiction, fixed

Nine of Chepstow's classes carried an enrollment cursor at sentence 1 with no practice evidence at all. The cursor did not come from a lesson. Opening the class player writes a live position to the enrollment without a practice stamp, deliberately, since 2026-06-11, so that a boot does not read as practice. Journey read that cursor as started. Quiet read the missing practice stamp as never started. One read disagreeing with itself.

The fix is on the reading side and it applies Tom's principle: a class has started when it has practised, not when an adult assigned it a course or opened the player. `computeOrgIntel` now gives a class a position only when it has the same practice evidence Quiet uses, so never-started and started partition the school exactly. A test that puts a class with a cursor and no practice through the handler was red on the old code, five of four, and green on the new. Chepstow will read twenty-one started and thirteen never started, which add up.

The write side still leaves the cursor, and the node home's journey bar reads the same cursor for a class card. Whether a bare boot should write a cursor at all is a write-path question for its own job. It is journalled in `docs/DECISIONS.md`.

### What the live surface gets right and must keep

- **The class is the unit.** Chepstow is thirty-four class accounts and no pupils. Every proposal below stays at that unit.
- **Minutes for everyone in one place.** The node home list is the product Angharad thanked Tom for. It is the base everything sits on.
- **Phrases spoken and the phrases most spoken.** Named as what they are, in a sentence, not a footnote. Tom has ruled both stay.
- **Position in the LEGO's own words.** "I'm going to · Dw i'n mynd i", never a seed number.
- **Scope is the server's, and nothing compares this school with any other by name.** The scope pin test exists. Nothing here touches it.
- **One read, one panel that computes nothing of its own.** A change to what a leader can ask is a change to what the payload carries, not a new page.

### What Tom's frame asks for that is not there

- **Usage per class as a sentence a leader can say out loud.** The number exists on the node home, class by class, and the lens has the phrases. Neither says "these are the classes using it regularly and these are not" as one headline over the school, and neither lets her cut it any way but the whole school.
- **Any grouping at all above the class.** There is no way to say "Y7" or "north block" or "pm only" about a class. Zero hits for a class-grouping tag anywhere in code, SQL or migrations.
- **Session times.** Recorded, and thrown away one function short of being usable. See the table.
- **Which classes ran in easy mode, fast mode, or jumped ahead.** Recorded in the diary, never read by any server. See the table.

### What is there that the frame makes pointless

- **"Where they stop" as the biggest fall in the funnel.** On a school where every class started in the same fortnight, the biggest fall is where the bulk of the school currently is, not where anyone stopped. It is not a pattern of aggregate behaviour; it is a photograph. It stays for now because removing widgets is not this job, but nothing should be built on it.
- **The four rate-engine pickers as the leader's first sight.** Course, window, measure, compare-to hand the leader a search. Not wrong, not the point, and left alone.

### Tom's questions, three ways

Tom's justification, verbatim: "all times are recorded so everything can be watched". Checked against the code: true of the raw diary. Every event the class account fires carries `occurred_at` and the class's own learner id, and that attribution is verified server-side against the class the signed-in teacher may drive.

| Question | Answerable today | What it needs |
|---|---|---|
| Usage per class | **Yes**, from data already read: minutes in the app per class this week, phrases, last practised | A headline and a table on the lens; the figures are in `home.ts` already |
| All Y7 classes; all classes in part X of the building | **No** | The tag table and chips in Part B |
| All Mrs Jones's classes | **Yes**, the data exists: teacher to class is a live relationship in `user_tags` | Teacher shown as a chip you can slice by; no new write |
| Session times for all classes | **New read over existing data.** `sessioniseSeconds` computes the blocks and returns only their sum | Export `sessioniseBlocks` beside it, additive, changes no live figure |
| Do classes do more or less in their afternoon session? | **New read over existing data**, once blocks exist | Bucket block starts as morning or afternoon by local time |
| Sessions on Monday? | **New read over existing data**, once blocks exist | Weekday from the block start |
| Do pm-only classes do more or less time on average? | **New read over existing data**, once blocks exist | A class whose every block starts after midday is pm-only; average its minutes against the rest |
| Which classes are on easy mode, which on fast? | **Yes, recorded; new read.** `learning_mode_selection` fires once per session with the active mode, and `learning_mode_toggle` on every change, both through the player log under the class account | One more event type in the diary read; the latest per class is its mode |
| Which classes are skipping ahead? | **Yes, recorded; new read.** `cursor_move` with kind `explicit_nav` carries from and to LEGO for every deliberate jump, belt pick and jump-to-furthest, under the class account | One more event type in the diary read; a forward move larger than one round is a skip |

Two honest gaps. First, no school has a timezone on record. `occurred_at` is UTC, and morning or afternoon needs local time. The smallest honest answer is a per-school timezone defaulting to Europe/London, a dial and not a ruling, and the default is right for every school on the platform today. Second, that the mode and jump events exist under class accounts in the live diary was verified in the code paths, not by reading production rows; the first build should confirm it with one read before it promises the answer.

The mode question has one subtlety worth stating. Easy or fast is a setting on the teacher's device and account, not on the class. What the diary records is the mode each class session actually ran in, which is exactly what Tom's question is asking.

## Part B. The smallest first slice

**In one sentence:** the lens gets a usage-per-class headline and table, a leader can put tags on classes and slice every existing figure by a tag, and the class's teachers appear as chips on the same strip so adding a teacher, covering a class, or giving a teacher a new class is the same gesture as tagging.

Every live number stays. Nothing is hidden, replaced or renamed.

### 1. Sessions become visible: `sessioniseBlocks`

In `api/_utils/inAppTime.ts`, export `sessioniseBlocks(timestampsMs, opts)` returning `{ startMs, endMs, seconds }[]` under the identical idle and cap rules, and reimplement `sessioniseSeconds` as the sum of its blocks. Additive. Every live figure is unchanged by construction.

Test, `api/_utils/inAppTime.test.ts`: for a handful of stamp sets including the existing ones, the sum of `sessioniseBlocks` equals `sessioniseSeconds`; a gap over the cutoff yields two blocks; a block longer than the cap is capped.

Add `inAppBlocksByLearner(svc, learnerIds, sinceIso)` beside `inAppSecondsByLearner`, same paging, returning the blocks.

### 2. The tag table: `class_tags`

```sql
create table class_tags (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id),
  tag text not null,                 -- the leader's own word, as typed, trimmed
  added_by text not null,            -- auth uid
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index class_tags_one_active on class_tags (class_id, lower(tag));
alter table class_tags enable row level security;  -- service-role only; no policies
```

One label, no kind. The archived think-piece of June argued for kind plus value, year, department, faculty. That is a hierarchy wearing a tag's clothes: a leader who wants "north block" or "Mrs Jones covers on Fridays" has to find a kind first, and a Welsh primary's "Blwyddyn 5" does not want to be told it is a year. A tag is a word the leader chose. Discover-first prevents drift: the picker offers the school's existing tags before accepting a new one, so "Y7" and "Year 7" do not both happen by accident. The unique index is on the lowercased word, so a soft-removed tag is reactivated rather than duplicated, the same rule `ensureClassTeacherTag` follows.

Same posture as every new table: RLS on, no policies, service role only, writes through one server route. Dev, staging and production share one database, so this is one additive migration and it is applied by the builder, canaried, not by this job.

### 3. The write route: `POST /api/school/class-tags`

Body `{ class_id, action: 'add' | 'remove', tag }`. Auth: `resolveGroupTreeCaller` plus `callerCanSeeGroup` on the class's own node, the same predicate the lens and the node home enforce; a teacher gets 403, a leader of another school gets 403. Add reactivates a removed row and is idempotent. Remove sets `removed_at`. `GET /api/school/class-tags?nodeId=` returns `{ tag, classes }[]` for the caller's subtree, the discover-first list.

Test, `api/school/class-tags.test.ts`: the negative pin first, a leader naming a class outside their subtree gets 403 and no row is written; add then add again leaves one active row; remove then add reactivates; a teacher of the class is refused.

### 4. The read: `GET /api/org/intel` grows, nothing shrinks

New query parameter `tag=`, repeatable. The handler filters `classes` by active tag before calling `computeOrgIntel`, one line, so every figure on the page, the three sentences, the line, the bars, the funnel, the rows, is the sliced school by construction. The rule in the file's header that Overview and Insights can never disagree about a number holds for slices the same way.

Each class row gains `inAppMinutesThisWeek`, `teachers: { userId, name }[]`, `tags: string[]`, and `sessions: { startedAt, minutes }[]` over the twenty-eight day look-back. The `practising` block gains `inAppMinutesThisWeek` and `inAppMinutesLastWeek` summed over the classes. The people rows are untouched.

Test additions in `api/org/intel.test.ts`: `?tag=` narrows the classes and every headline count with it; a class with no tag is absent from a tagged slice; the per-class minutes agree with `sessioniseSeconds` over the same stamps.

### 5. The panel: usage per class, and the slice strip

`OrgIntelPanel.vue` gets, above the three questions, a slice strip and one new question. The strip shows the school's tags and its teachers as chips; tap one and the page re-reads with `tag=` or filters by teacher. Tapping nothing is the whole school, as today.

The new question is written down once in `intel/orgQuestions.ts`, in Tom's terms:

> **Usage.** Which classes are using it regularly, and how much?

The sentence, in the same grammar as the other three, one number and one line: "21 of 34 classes used it this week, 338 minutes in the app together." Then the table, sorted by minutes this week: class · teachers · minutes this week · phrases this week · last practised · this week's sessions as day and half, "Mon am · Wed pm". The class row's chips sit on the row. The table is the numbers; nothing on it is a judgement about a person.

Test, `OrgIntelPanel.test.ts`: the usage sentence renders from the payload; chips render from the rows' tags and teachers; tapping a chip emits the slice the view re-reads with.

### 6. Frictionless admin on the same strip

On a class row, the chip strip's plus offers three things from what already exists: the school's existing tags, the school's existing teachers, and a cover link. Choosing a teacher calls `POST /api/teacher/class-teachers` with `action: 'add'`, the live route, and the chip appears. The cover link is the existing class-scoped co-teacher link from `ClassDetail.vue`, minted on demand for one colleague, surfaced here so a supply teacher is one tap from the same place a leader is already looking. A teacher taking on a new class is a teacher chip on that class. Nothing new is written for any of the three; the strip is one door to three routes that today live on three pages.

### 7. Time-of-day and weekday, in the same slice

With blocks in the payload, the panel derives, never stores, three cuts and offers them as chips on the strip beside the leader's own: morning, afternoon, and each weekday. The boundary is midday in the school's local time, Europe/London by default until a school says otherwise, a dial. With those chips the questions read: afternoon selected, "Afternoon sessions: 12 classes, 19 minutes a session on average"; Monday selected, the same shape. "PM-only" is a derived chip too: every block after midday.

### What I would NOT build

- **Any message to a teacher, in any softness.** No nudge, no prompt, no "message Ms Mehta", no coaching line beside a row. Ruled out today.
- **A notice feed for classes or teachers.** Ruled out today.
- **A kind on a tag, a folder tree, year-group levels, a department schema.** The archived design's `group_kind` enum is the hierarchy Tom rejected, one column at a time.
- **Tags on people, schools or groups.** Classes only in this slice. Teacher chips are the existing relationship, not a new tag.
- **A stored morning or afternoon label, or a stored weekday.** Derived from block starts every time, so a changed cutoff never leaves stale rows.
- **A per-class mode or pace setting in admin.** The question is what mode a class ran in, which the diary answers. A setting would be a second source of truth.
- **A ranking of named teachers.** A leader can slice by a teacher's chip and read the numbers. The surface never sorts staff into an order of its own.
- **Any comparison with another school by name.** The existing rule holds unchanged.
- **The write-path cursor change.** Named as a follow-up above; not proven, not done here.
- **A new page.** Everything lands on the lens and the node home a leader already has.

### The next slice, named so the shape is visible

Mode and skipping. `loadClassPractice` reads two more event types under the class account: `learning_mode_selection` and `cursor_move`. Each class row gains `mode: 'easy' | 'fast' | null` from the latest selection, and `jumpsAhead` from forward `explicit_nav` moves. Two more derived chips, easy and fast, and a question in Tom's words: "Which classes are on easy mode, which on fast, and which are jumping ahead?" First step of that slice: one production read confirming class-account rows of those two types exist in the diary.

### Better × Simpler × Cheaper

- **Better.** A head can say the one thing she wants to say, usage per class, and cut it by anything she can think of on a Tuesday: a year, a block of the building, a teacher, the afternoon. She still gets every number she thanked Tom for. The two sentences that contradicted each other now add up.
- **Simpler.** One new table with one label column. One new write route on the auth predicate that already exists. One query parameter on the read that already exists, filtering the list the read already builds. Teacher chips reuse the live relationship and its live route, and put three admin moves behind one gesture. No new page, no new scope model, no stored derived labels. The tag mechanic replaces, rather than adds to, the need for any grouping hierarchy.
- **Cheaper.** No new instrumentation: sessions, mode and jumps are in the diary today. `sessioniseBlocks` is additive and changes no live figure. The migration is one table. Runtime cost is the diary read the lens already makes, kept, plus one small table join. Maintenance is a label column and a chip strip.

The multiplication holds without a story being told. Where it was tempting to argue harder, kind plus value on tags, a notices layer, a per-class mode setting, the honest answer was that each of those lost on Simpler, and they are in the list above.

### Taste-safe defaults taken, one line each

- Tag vocabulary is discover-first: the picker offers existing tags before accepting a new word; no starter taxonomy ships.
- Tags go on classes only in this slice.
- Morning and afternoon are derived from block starts, boundary midday local time; a dial, not a ruling.
- Local time is Europe/London per school by default; no school carries a timezone today and this is an explicit gap.
- Within a leader's scope names are fine; nothing compares her school with another by name.
- British English, no parentheses in leader-facing prose, mechanism only.

### Gaps, stated

- No production read was made in this job. Chepstow's figures are job #212's live read of this morning and the brief's.
- Mode and jump events under class accounts are verified in code, not in live rows.
- No school timezone exists; morning and afternoon need one and the default above is an assumption.
- The write-path cursor on boot remains; the node home's journey bar still reads it for a never-practised class.
