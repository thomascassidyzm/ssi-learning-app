# The intelligence surface reframe — what a school leader needs in order to act

*Written 2026-09-11, job #212·F, as a differential against what is on `dev` today. Nothing here is built. Every claim about the code was read from the code in this worktree, and every Chepstow figure was read live and read-only from production at 12:08 UTC today through the existing `GET /api/org/intel` handler. Companion to `docs/intelligence-surface-verbs.md`, the acting half, and to the two published notes of 2026-09-10 on the org question set and the cross-read.*

**My read, up front: a page of numbers is not the right shape. The right shape is a coach.** The surface should do Step 1, Notice, on the leader's behalf, say what it noticed in words with a name attached, ask the leader only the Gateway Question about each thing it noticed, and put the one action next to it. The numbers stay, one tap below, as the evidence. Two moves carry nearly all of the value and both reuse what is already built: put notices above the questions, and let the school state one intention so the surface can measure against it instead of against last week. The rest is garnish, ranked at the end.

---

## 1. What is actually on dev

The commission describes the first slice as "TeacherInsightsView at /schools/analytics plus an org-scoped version". That is one ruling out of date, in three ways.

**A school leader never sees TeacherInsightsView.** For a school admin or a group leader, `/schools/analytics` is a redirect. `SchoolsContainer.vue` watches the route and sends them to `/org/:id/insights`, their own node's lens. The teacher-scoped page is still mounted at that URL, but only a teacher lands on it.

**The org three are not a version of the teacher lens.** They are a panel, `OrgIntelPanel.vue`, mounted at the top of `NodeInsightsView.vue`, which is the node lens the leader already had. The page reads top to bottom:

1. The node-home chrome: the where-you-are rail, the school's name, and one verb, Overview, back to the node home.
2. **Attention · practice. "Are they doing it, who is not, and where do they stop."** The three questions from `intel/orgQuestions.ts`, each rendered in the same grammar: the question in small red capitals, one big number beside one answer sentence, one Insight Engine widget, then rows. Practising gets a 28-day line of phrases by day, then classes by phrases this week, then people by own-account minutes. Quiet gets horizontal bars of how long since each class practised, then the quiet classes longest-gone first. Journey gets a funnel of classes reaching each milestone sentence, then classes furthest first. Every class row is a link to that class's node home. Everything comes from one server read, `GET /api/org/intel`, which decides scope from the caller's identity and answers 403 in words for a node outside it.
3. The rate engine: rate of progress in LEGOs per week against an average the leader picks, with four pickers: course, window, measure, compare-to.
4. Voice and pause: microphone uptake and prosody, scoped to the node.

**The teacher gets none of the three questions.** `/api/org/intel` refuses a teacher by design, and the teacher lens is the rate engine alone with a "Your classes" picker over it. A teacher's Monday question, "did my class do its lesson and where are we", is answered on the class node home, not on the analytics page.

Two further facts about what is on dev that the commission's settled list does not carry, and that shape what follows.

**Whole-class time now exists.** The settled bullet says the org lens carries phrases for classes and "no proxy" for time. That is still what the lens says on screen: "No record measures how long a whole class practised together, so no time is shown for it." But later the same evening Tom ruled that school practice time is in-app time, pauses included, and `api/_utils/inAppTime.ts` now sessionises the diary for every learner id including the class account. The node home one tap away already shows "{n} minutes in the app together this week, pauses included" on the class card and carries `inAppMinutes7d` as its headline. In-app time is not a proxy. It is Tom's ruled measure, and the lens is the one surface still refusing it. The Overview and the Insights lens now disagree about whether class time exists.

**The class rows on the node home's Below-this tree already carry practice.** The cross-read's A1 said a child row carries only name, teachers and student count. On dev today `BelowClass` carries `phrases7d` and `lastPractisedAt`, and `NodeBelowTree.vue` renders "{n} phrases this week", "not this week" or "not yet practised together" on each class. So a leader on the Overview can already see which classes are dead, one row each, with the teacher's name beside them. The lens repeats that list without the teacher's name.

### The Chepstow payload, read live today

School id `0f5bd6e4-f40b-4dbf-ac4f-a93478d20255`, one course, `cym_s_for_eng`, 334 sentences long. Thirty-four classes, zero individual student accounts.

| figure | today | the brief's figure from 2026-09-10 |
|---|---|---|
| classes that spoke phrases this week | 14, up from 1 | 14, up from 1 |
| phrases spoken this week | 437, against 3 last week | 422 |
| people on their own account this week | 17 of 39, 123 minutes | 17 of 39, 124 minutes |
| classes gone quiet | 1, class 6S, 56 days | 1 |
| classes never started | 13 | 13 |
| classes started | 30 | 30 |
| furthest classes | 7 at "I still want", sentence 8 of 334 | 5 |
| busiest | 8H 53, 7H 52, 8P 40 | 7H 52, 8P 40, 8H 38 |

And two things the page says that the payload does not support:

**The page contradicts itself.** Quiet says "1 class has gone quiet, and 13 have never started." Journey, on the same screen, says "30 of 34 classes have started." Thirteen plus thirty is forty-three classes out of thirty-four. Nine classes are counted both ways: they carry an enrollment cursor at sentence 1, "I want", with no practice evidence at all. The cursor came from somewhere other than a lesson, most likely the course assignment itself. Quiet reads `lastPractisedAt`, Journey reads the cursor, and nobody reconciled them. A leader reading both sentences cannot know which to believe.

**"Where they stop" is answered from a photograph, not from time.** The Journey sentence today reads: "Most stop before 'to practice speaking', sentence 5 of 334: 9 classes got to the step before it and no further." Those nine classes practised this week. They have not stopped anywhere. They are in the second week of term and are at sentence 3 because that is how far a class gets in two lessons. The drop-off calculation takes the biggest fall between two funnel stages, which on a school where everyone started at once is simply where the bulk of the school currently is. The only class at Chepstow that has actually stopped is 6S, at "I'm going to", in July. A drop-off place needs a class that reached a point and then went quiet. The data for that exists on the same row. The sentence does not use it.

---

## 2. What it gets right, and why the reframe has to keep it

None of these is a courtesy. Each one is a decision that cost something to make and would cost more to lose.

**The class is the unit.** Chepstow is thirty-four class accounts and no students. A surface built on learner accounts would show the school empty, and the head of department acts on classes and their teachers, never on a pupil they cannot see. This is the worklist's "class is a first-class learner-equivalent" made real, and every proposal below stays at that unit.

**Phrases spoken is honest, and the honesty is in words.** A class is counted in phrases the class was prompted and played back, one per second-voice clip under the class account, and the page says so in a sentence rather than a footnote. In-app time should now join it, as above, but the discipline of naming what a number is and is not has to survive.

**Position is the LEGO's own words, in both languages.** "I'm going to · Dw i'n mynd i", never "seed 3". This is the one place the current surface already speaks the learner's language rather than the vendor's, and it is the seed the reframe grows from: a notice about a class can name where the class is in words a teacher recognises from their own lesson.

**The three questions are written down once, in Tom's words, each carrying the need it serves.** "Adherence, are people actually doing it", "who is not doing it", "drop-off places". One file, one endpoint, one scope check, one panel that computes nothing of its own. That is the Insight Engine as the spine, and it means a reframe is a change to what the payload carries and what the panel says, not a new page.

**Scope is the server's, and a refusal is said, not hidden.** A leader naming another school's node gets 403 with a sentence. A class outside their tree never gets read. The SCOPE PIN test exists. Nothing in what follows touches this.

**Nothing compares this school with a named other.** The rate engine compares against an anonymous k-floored average; the three questions compare the school only with its own last week. A named other organisation is a leak, and the reframe adds no comparison of any kind.

**Insights is a lens on the node, not a place.** The rail stays lit, the name stays at the top, and Overview is one verb away. A leader never loses where they are. The notices proposed below sit inside that chrome.

**The answer-sentence instinct.** Each question already opens with one sentence, one number. That is the right instinct and the reframe is largely an extension of it: more of the page in sentences that carry a name and a verb, less of it in bars and rows.

---

## 3. What it makes a school leader do that they should not have to

Tom's method says Notice is Step 1, and there is no Step 2. It says helpful beats true. It says choose easy. It asks what you WOULD choose. Hold the current page up against that and the shape of the problem is plain: the page is optimised to be true. Every number is exact, every unit is named, every caveat is stated. What it is not optimised for is being helpful, because it stops at the number and hands the leader the noticing, the interpreting, the deciding and the remembering to come back. In Sausage Machine terms it shows the leader what came out and says nothing about what to put in.

Here is Chepstow's head of department on Monday 14 September, figure by figure. For each: the number on screen, the judgement it silently demands, and what the surface could have said instead.

**"14 of your 34 classes practised together this week, up from 1 last week, 437 phrases spoken."**
The judgement demanded: is fourteen good? The leader has to know it is the second week of term, so "up from 1" is the term starting rather than growth. They have to know that thirteen classes have not started, that six more opened the course this week without running a lesson, and that one stopped in July. They have to decide what "practised" should mean for their school, because the page has no idea what the school intended. Without a stated intention the page can only compare with last week, and last week was the summer holiday.
What the surface could have said: "Second week of term. 14 classes have run a lesson. 6 have opened the course but not run one yet. 13 have not started. 1 stopped in July." Then, if the school had told it what it wanted, "14 of the 30 classes with a course did their weekly lesson."

**"1 class has gone quiet, and 13 have never started."** Then thirteen rows: 10H, 10T, 11C, 11E, 11H, 7E, 8E, 8S, 8T, 9C, 9E, 9H, and a personal class.
The judgement demanded: which teacher owns each of these, is it the same teacher three times, has that teacher ever opened the app themselves, is "never started" even true given that nine of them show a position on the next question, and what do I actually say to a colleague. The page names the class and not the teacher, though the node home one tap away knows the teacher. So the leader opens thirteen class pages, or opens the Overview and reads the tree, and builds the list by hand.
What the surface could have said: "13 classes have a course assigned and have not run a lesson. They belong to 17 teachers. 12 of those teachers practised on their own account this week and 5 have not practised on their own account in the last four weeks." Those are real figures, read today from `classes`, `class_teachers` and the payload's own people rows. Then a row per teacher, not per class, with the classes under each, and one verb.

**"6S, last practised together 2 months ago, at 'I'm going to'."**
The judgement demanded: chase or retire? A class quiet since July at the start of September is almost certainly last year's class list. The page treats it the same as a class that went quiet last Tuesday and files it under the same red bar.
What the surface could have said: "6S has not practised since July. If this class no longer exists, retire it." And the retire verb beside it. A July silence in September is a different notice from a fortnight's silence in November, and the surface knows the calendar.

**"30 of 34 classes have started. The furthest 7 have reached 'I still want', sentence 8 of 334. Most stop before 'to practice speaking'."**
The judgement demanded: is sentence 8 of 334 in the second week good, bad or exactly right? The leader has to know the method's pace, which is not written anywhere on the page. And they have to notice that "most stop" is false, as set out above. Nor can the page tell which of the fourteen classes that ran a lesson moved forward this week and which practised where they were, because it holds a position and not a movement.
What the surface could have said: "N classes moved on this week, N practised where they were, 1 has stopped." Movement is the signal a leader can act on. Position is context. The figure does not exist today; section 5 says what it would cost.

**"17 of 39 people practised on their own account, 123 minutes between them."**
The judgement demanded: who are the 39, should teachers be practising themselves, and does it matter. It matters a great deal, and the page does not say why. A teacher who has practised on their own account can lead a lesson with some confidence. A teacher who has never opened it is being asked to run a class in a language they have not tried. That is a competence question, and it decides what kind of conversation the leader has: the how-to or the reassurance. The page has both lists and never crosses them.
What the surface could have said: the crossing, under the not-started notice above. "5 of the 17 teachers whose classes have not started have not practised on their own account in the last four weeks either." The other 12 practised this week, so for most of Chepstow's not-started classes the conversation is about the lesson, not the language.

**The rate engine's four pickers.** Course, window, measure, compare-to. The judgement demanded: which comparison do I want? This hands the leader the search. A leader wants one sentence: "This school is moving at about the pace of the average for this course." Choose easy: one default sentence, and the pickers behind a tap for the leader who wants them.

**And the thing the page cannot do at all: remember to come back.** Nothing on it happens unless the leader opens it. A class that goes quiet in October will sit in the red bar until somebody looks. Notice is Step 1 and the page currently makes the leader do Step 1 on a schedule of their own devising.

The pattern across all of these is one pattern. The page is true and the truth is left as an exercise for the reader. In the pedagogy DNA the coach's job is to build the distinction that matters, and to move on fast once it is built. "Not started with a teacher who has never tried" versus "not started with a teacher who practises every day" is the distinction that matters here, and the surface has both halves and draws neither.

---

## 4. Is a page of numbers the right shape? No.

The right shape, in Tom's vocabulary, is a coach running his own coaching flow on the school.

The flow is Listen, then the Gateway Question, then reveal the Script, then clarify what they actually want, then Sausage Machine thinking, then support the conscious choice. Mapped onto a school:

- **Listen** is reading the diary. The endpoint already does this.
- **Notice** is naming what changed and what is stuck, in words, with a name. This is the missing step, and it is Step 1. The surface should do it, not the leader.
- **The Gateway Question** is the only question the surface should put to the leader: for each thing it noticed, what would you choose to do about it? Not "here are 34 rows".
- **What they actually want** is the school's intention, stated once. The surface today has no idea what the school wants and therefore cannot tell it whether it is getting closer or further away. Every notice becomes sharper the moment there is a stated WHAT to measure against, and "closer or further away" is Tom's own decision test.
- **Sausage Machine** is the input side: what is the school putting in? Lessons run, teachers practising. The notices are about inputs, because inputs are what a leader can change on Monday.
- **Support the choice** is the verb beside the notice. One tap. Choose easy.

And the delivery discipline from the coaching engine applies verbatim: one thing per response, then stop. The 9×4 is one focus per week. So the surface leads with a few notices, the first of which is THE thing this week, and it says "Nothing needs you this week" when that is true. A page that shows every number every week is the opposite of one thing at a time.

The numbers do not go away. Helpful beats true does not mean untrue. Under every notice the evidence is one tap down, and the three questions as they stand today become that evidence layer. What changes is what the page leads with and what it asks of the reader.

The estate has already said this once, in the retired metrics architecture: the tutor "opens the dashboard once a day or so, sees the three students at the top, and acts on them. No more, no less." That was written for a tutor and individual learners, with a rule-sum attention score. It was never built for schools. The proposal below is the same shape at the class level, with words instead of a score, and it is worth saying plainly that the retired document carries no authority and I am citing it only because it shows the idea is Tom's own estate's, not mine.

---

## 5. The reframe, concretely enough to build

### Move 1, carries most of the value: notices above the questions

The lens gains a first section, above Attention · practice, called by the school's own name and the week. It is a short ordered list of notices. Each notice is one sentence with a name, one line of why, and at most one verb. Capped at three on the page with "and N more" below. When there is nothing to say, it says so.

The notices are computed on the server, in `api/org/intel.ts`, from the payload it already builds, and returned as a `notices[]` array in the same response. The panel renders them with `NarrativeCard`, which already exists in `insight/widgets/`. No new endpoint, no new page, no new widget. The three questions stay exactly where they are, beneath, as the evidence.

The notice kinds, in the order they rank, and what each needs:

| # | Notice | The sentence, Chepstow today | Needs | Exists today? |
|---|---|---|---|---|
| 1 | Not started, teacher named | "13 classes have a course and have not run a lesson. 17 teachers. 5 of them have not practised on their own account in four weeks." | class → teacher, teacher → own-account row | `classes.teacher_user_id`, `class_teachers` and the people rows are all already in scope; the join is in-endpoint. Yes, cheap. |
| 2 | Stopped | "6S has not practised since July, at 'I'm going to'. If this class no longer exists, retire it." | quiet row + position + calendar | Yes, on the row today. |
| 3 | Opened, no lesson yet | "6 classes opened the course this week without running a lesson." | this-week cursor stamp with zero phrases | Yes, the bucket already counts them; the page never says it. |
| 4 | Moving and not moving | "N classes moved on this week. N practised where they were." Illustrative; the figure cannot be read today. | position at start of week vs now | **Does not exist as a field.** Derivable from the diary rows the endpoint already reads, if the audio_play payload carries the LEGO id as the analytics note in CLAUDE.md says it does. Verify at build time. Cost: one pass over a read already made. |
| 5 | Against the intention | "14 of 30 classes with a course did their weekly lesson." | the school's stated intention | **Does not exist.** Move 2. |
| 6 | Nothing needs you | "Every class with a course ran a lesson this week. Nothing needs you." | the absence of 1 to 4 | Yes. |

Ranking rule, in his terms: closer or further away. Whatever is furthest from the school's intention comes first. A stopped class outranks a not-started one only if the intention says so; by default not-started is the bigger gap because it is the most classes.

The verbs, per notice, honest about what exists:

- **Retire this class**, on a stopped class. The class tree has delete behind `auditAdminDelete`, and `classes.is_active` exists and gates every read. A non-destructive retire that flips `is_active` and keeps the history is one small endpoint with one audit row, in the shape the verbs document already fixes. Not on dev today. Cheap.
- **Send the two-minute start**, on a not-started class. This is a message to a colleague with the Handbook's Play-as-class page in it. Two honest options. Zero backend: a `mailto:` with the text pre-written, the leader's own mail client sends it. Or one endpoint through Resend with an audit row. **Either one sends to a real human and is Tom's call, not the builder's.** The list of who to send to is the surface's job; the sending was ruled out of the intelligence surface for learners, and a teacher is not a learner, so this needs a ruling.
- **Open the class**, on anything. Exists: the row is already a link.

The words on screen, Chepstow, Monday 14 September, top of the lens:

> **Ysgol Cas-gwent · this week**
>
> **13 classes have a course and have not run a lesson.** They belong to 17 teachers; 12 of them practised on their own account this week, 5 have not in four weeks. *Send the two-minute start* · *See the seventeen*
>
> **6S has not practised since July**, at "I'm going to · Dw i'n mynd i". If this class no longer exists, *retire it*.
>
> **6 classes opened the course this week without running a lesson.** *See which*
>
> and 1 more.
>
> *Second week of term. 14 classes ran a lesson, 437 phrases. 17 of 39 staff practised on their own account, 123 minutes.*
>
> ─────
>
> ARE THEY DOING IT, WHO IS NOT, AND WHERE DO THEY STOP
> *the three questions as today, unchanged, as the evidence*

The italic line under the notices is the whole of today's three answer sentences compressed to one, because once the notices carry the action the numbers only need to be present, not prominent.

Better × Simpler × Cheaper, written out:

- **Better.** The leader gets Monday's three things and a tap each, instead of three questions, three charts and thirty-four rows to read and cross-reference by hand. The teacher distinction that decides the conversation is drawn for them.
- **Simpler.** No new page, no new substrate, no new widget. One array on an existing payload, one existing widget, and the three questions demoted a scroll rather than removed. The self-contradiction and the false "most stop" go away as part of the same change because the notices force the definitions to agree.
- **Cheaper.** The diary is already read once per request; the notices are a second pass over the same rows. No new table for Move 1. The only new storage on the whole proposal is Move 2's one value.

### Move 2, makes Move 1 sharp: let the school state one intention

Ask the leader the Gateway Question once, at setup or on the lens: what would you choose for your school? Give it a default so that choosing is easy: every class with a course runs one lesson a week. Store one value per school. Then every notice and every answer sentence measures against it: "14 of 30 did their weekly lesson" instead of "14 of 34 practised, up from 1".

This is what turns true into helpful. Without a stated WHAT the surface can only compare a school with its own previous week, which at term start is meaningless and in mid-term is merely a trend. With one, "closer or further away" becomes computable, the ranking of notices has a basis, and "nothing needs you" has a meaning. It is also the least-action version of a goal: one thing, chosen once, editable, never a KPI grid.

Needs: one column on `schools` or the school's node, a default of weekly, one line in Settings. **Does not exist today.** Cost: a migration for one column, gated as every schools migration is. The counting code changes by one comparison.

What it is not: a target dashboard, a league table, a benchmark. Nothing about it compares one school with another, and the anonymous-average rate compare stays exactly as it is.

### Garnish, ranked, all cheap, none of them the point

1. **Reconcile "never started" with "started".** One definition of started for both questions. The cursor written by a course assignment is not practice. Without this the two sentences on one screen disagree for every school that assigns courses before teaching. Do this first even if nothing else ships.
2. **Retire "most stop before" until it is computed from time.** A drop-off place is a class that reached a point and then went quiet. Replace with "N have stopped, at these points", from the quiet rows, which already carry position.
3. **Adopt in-app minutes for classes on the lens.** Tom's ruling, the Overview already does it, and the lens's honest note now says something the node home contradicts. Keep the note's discipline; change the sentence.
4. **Name the teacher on every class row.** The node home payload already has it; the lens should not make the leader go and look.
5. **One default sentence for the rate engine, pickers behind a tap** on the member mount. The admin mount keeps the pickers.
6. **A weekly note to the leader.** Notice is Step 1, and a page cannot notice for someone who does not open it. The `cron/org-free-year-warnings.ts` pattern already sends org mail on a schedule. The same notices, once a week, by email, to the school admin only, mirroring Tom's line that the support channel is for school admins and not teachers. **Outward-facing, real humans: Tom's call.** I rank it below the two moves because it is a delivery channel for them, not a source of value on its own.

### What this reuses, named

The engine and its spec, `InsightWidget` and `NarrativeCard`, `OrgIntelPanel` unchanged as the evidence layer, `NodeInsightsView`'s chrome and rail, `GET /api/org/intel` and its scope pin, `loadClassPractice` and the diary read, `inAppTime.ts`, the teachers-per-class data the node home already joins, `classes.is_active`, the verb contract from the verbs document with its confirm-first and audit-row rules, and the Handbook comment above each new element so the leader's own handbook describes it.

### What does not exist, said plainly

- Movement per class per week. Derivable from the diary; not stored. Small.
- The school's intention. One column. Small, but a migration.
- A retire-class verb that keeps history. One endpoint. Small.
- A way to message a teacher. Zero backend as `mailto:`, or one endpoint through Resend. Small, and Tom's call because it sends.
- Expected pace through the course. Not needed if the surface reports movement against intention rather than position against a norm, so I propose not building it.

---

## 6. The teacher lens, briefly, secondary

The commission named the leader and the leader is primary. The reframe touches the teacher differently and I am flagging it rather than folding it in.

A teacher today gets the rate engine and nothing else on the analytics page; their Monday is answered on the class node home. The notice shape scales down to one class without change: "7H ran its lesson on Tuesday and moved on to 'I still want'. Next lesson starts there." One sentence, no verb needed, and for a teacher with three classes, three sentences. That is the whole teacher lens. It would reuse the same `notices[]` computed for a class node, which the endpoint already supports as a scope, and it needs the teacher to be allowed a class-scoped read of `/api/org/intel` for their own classes, which today refuses them by design. That is a scope decision, not a build detail, and it needs a ruling before anyone builds it.

---

## 7. A position on the cross-read's section A

The cross-read of 2026-09-10 listed signals the schools surfaces should show and do not. Taking a position rather than repeating it:

- **A1, which classes have gone dark on the tree.** Partly landed since it was written: `BelowClass` carries phrases and last-practised on dev and the tree renders them. What is still missing is the teacher beside the dead class on the lens, which is garnish item 4 above.
- **A2, trials about to end on the child rows.** A group leader's concern and a vendor's fact, not a head of department's Monday. Out of this reframe's scope. If it lands anywhere it is a notice at group scope, and it is not one of the two moves.
- **A3, where this class stumbles in the course.** A teacher's question, and a good one, but it is not what a leader acts on. It belongs to a second teacher-lens slice after the scope ruling in section 6.
- **A4, who is behind the number.** Agreed, and the cross-read's own B2 has the right rule: say who is in the number, never take them out. The notices inherit this by naming the teacher and the class rather than summing them.

---

## 8. What needs Tom, one look each

1. **Move 1 and Move 2 as the next slice**, in that order, with garnish 1 to 3 riding along. Yes or not yet.
2. **The intention default.** "Every class with a course runs one lesson a week." Right default, or a different one.
3. **Messaging a teacher from the surface.** Not at all; `mailto:` only; or through Resend with an audit row. This is the only outward-facing item in the proposal.
4. **Teachers reading their own class's notices.** Allow a class-scoped read for a teacher's own classes, or keep the teacher on the class node home only.
5. **The weekly note by email to school admins.** Later, or now with the slice.

---

## Gaps, stated

I could not see the lens rendered as a school leader. There is no local admin session obtainable from a worktree, and I did not spend time trying to get one or create an account. Everything above about what the page says is read from the templates and the copy strings in the code, and every figure is from the live payload read read-only through the real handler with only the JWT check stubbed to the Chepstow school admin's uid, the same method as the existing live proof. The teacher figures came from three further read-only reads of `classes`, `class_teachers` and `learners` for that school, joined to the payload's own people rows. The teacher's page is likewise read from code only.

I did not verify that the audio_play payload carries the LEGO id; CLAUDE.md's analytics section says it does, and Move 1's fourth notice depends on it. It is named as a build-time check, not assumed.

Nothing was written to any database, no test suite was run, and no application code was changed.
