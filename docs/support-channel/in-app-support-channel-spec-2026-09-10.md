# The support channel: a school talks to us inside the app

**Spec, 2026-09-10. Design and argument, not a build.**

Angharad Jones, head at Ysgol Cas-gwent, emailed Tom personally today because her dashboard
said **0 hours practised** while her staff were audibly playing. Resolving it took: her email,
his inbox, a screenshot pasted into Watson, a worker dispatched against the live database, a
code fix, and a reply typed back to her by hand. And the thing that actually mattered — that
**103 classes estate-wide were showing the same wrong zero** — was discovered by accident, three
hours into the diagnosis, as a by-product.

Tom's own account of the cost: *"I have to check my emails, then paste screenshots to you, then
make the fix, then email back to her — what a lot of fuss and bother."*

This document says what shape the channel takes so that evening never happens the same way
twice. The section called **The smallest first version** is written to be turned straight into
a build brief.

**Tom's ruling of 2026-09-10 is folded in throughout and it removed a whole layer:** the database
is the transport — a question is a row, an answer is a row — so there is no comms system to design,
no tunnel and no VPN. Async is the default and section 6 argues what it honestly costs. Live is an
upgrade path, named in section 7 and not built. And the Handbook and the intelligence components
belong in the schools dashboard itself, which is section 1, because it decides how much ever
reaches a human at all.

---

## 0. The transport is the database. That is the whole architecture

**Tom's ruling, mid-spec, 2026-09-10:** *"we can simply use DB writing as a question — it comes
straight here, and we can reply straight to her as a DB row response — it doesn't HAVE to be a
live chat."*

That deletes a layer. Both sides already hold credentials to the same Postgres: her dashboard
writes through the app's own authenticated server, and the estate's agents hold the service key.
**A question is a row she writes. An answer is a row written back.** There is no message bus, no
webhook, no tunnel, no VPN, and nothing new to run or keep alive.

The tailnet fact still stands — the command surface is reachable only over Tom's private
Tailscale network, and Angharad will never install a VPN client. It simply stops mattering,
because **we never needed to reach her machine.** We needed to reach a table both sides already
touch.

Two write paths, and that is the entire plumbing:

| Path | Who writes | How | Auth |
|---|---|---|---|
| **Her question** | the schools dashboard | `POST /api/support/messages` → row in `support_messages` | her own Supabase JWT, scope resolved server-side by `resolveVisibleScope` |
| **The answer** | an agent on watson-1, or Tom through one | direct insert into `support_messages` | the service key the estate already holds |

Her side goes through an app endpoint not because a row needs an endpoint, but because the
**envelope must be assembled server-side from her resolved scope** and never from anything the
client claims — §3. That is how the app writes every other row and it is not a new layer.

The answer side needs **no app code at all**. An agent with the service key inserts a row. That
is why this is cheap: the reply path is an INSERT.

**How a question "comes straight here."** One small watcher on watson-1 — the estate's existing
cron machinery, or a `systemd` timer — selects rows with no answer, every few seconds. Polling,
not `LISTEN/NOTIFY` and not Supabase realtime: at the volume of a handful of schools it is
indistinguishable, it has no connection to lose, and it survives a restart without anybody
noticing. Realtime is the upgrade if the volume ever earns it, and it will not for a long time.

**Nothing in the estate's own reply loop changes.** `POST /api/needs-you` still puts the
escalation inline in Tom's Watson conversation, because that is where he already lives. What his
`yes` triggers is now an INSERT rather than an HTTP call to the app. One word from him, one row.

---

## 1. The dashboard answers first, and that is the cheapest support there is

**Tom's ruling:** *"with the proper handbook and the intelligent surface components we have
thought about making it into the schools dashboard itself, we will be a lot better."*

This is part of the design, not a neighbouring project, because **it changes what reaches a
human at all.** Every question the board answers in place is a question nobody writes, nobody
triages, and nobody escalates. The support channel's load is a function of how much the
dashboard explains itself.

Three things belong in her board.

**One: the Handbook, in place rather than in a menu.** Today it is one `router-link` in the user
menu at `/schools/handbook`, and the topbar's own comment defends that — *"tabs are daily
destinations and a handbook is a once-a-term thing"*. Correct for the whole handbook. But the
pack is keyed on `data-walk` anchors, and every capability on the page **has** its anchor, so the
sentence describing a control can be shown *next to that control* — a quiet question mark on the
Teachers page that opens the `teacher-remove` sentence in place, without navigating anywhere.
Rhian's question in Case 2 below is then not a support message; it is a tap. The corpus already
exists, keyed correctly, guaranteed non-stale. Surfacing it in place is close to free.

**Two: the intelligence components, rendered in her own board.** `intel/QuestionPage.vue`,
`QuestionFindings.vue`, `PopulationChip.vue`, `UpdatedStamp.vue` and `ScopeRail.vue` are built,
and today they serve `/intel` for `admin` — the estate looking at itself. The same components
over her own scope answer the questions she would otherwise write to us: which of my classes have
gone quiet, is this week up or down on last, what changed since the fix. **`UpdatedStamp.vue`
matters more than it looks:** a number that says when it was last computed is a number that does
not generate a support message, because the commonest complaint about a figure is not "this is
wrong", it is "I do not know whether this is stale".

**Three: the honest empty state.** `views/intel/NotYetBuiltView.vue` exists precisely because the
frame is ten questions and *"nothing pretends to measure what it does not"*. A dashboard that says
plainly "we do not record this yet" removes a whole class of support message — the one where a
teacher is hunting for a number that does not exist and concludes the app is broken.

**What this changes about §4.** The escalation argument that follows assumes the how-to volume has
already been absorbed by the board. If it has not been, the channel becomes a help desk answering
98 capabilities' worth of Handbook questions by hand, and the agent's job degrades from judgement
to lookup. So: **surface the Handbook in place in the same release as the channel.** They are one
piece of work and separating them makes the channel worse.

And one thing it does *not* change. Angharad's message was **not** a question the board could have
answered, because the board was the thing that was wrong. No amount of in-place explanation
substitutes for a way to say "this number is lying to me". Self-service reduces the volume; it
never removes the need for the door.

---

## 2. Where it lives, and how she starts a conversation

**Two doors, one thread.**

### Door one: on the thing that is wrong

Angharad did not go looking for a support page. She was **staring at a tile that said zero**.
The shortest possible version of this feature starts exactly there, and any design that makes
her navigate away from the wrong number to report the wrong number has already lost the
information that made the report cheap.

So every headline stat on the schools and org surfaces — the `stats` row in
`views/admin/NodeHomeView.vue`, the class-practice block, the per-class rows — carries a small,
quiet affordance: **"Does this look wrong?"**. Tap it and a sheet slides up already knowing
which number she tapped, what it currently reads, and what the server computed underneath it.
One text box. One **Send**.

From noticing to said: **three taps and a sentence.** Her real path today was: notice, leave the
app, open Mail, find Tom's personal address, describe her school, take a screenshot, attach it,
send, wait.

### Door two: the standing thread

The same conversation is also reachable as **Support**, in the user menu, directly under
Handbook. Not a tab — `SchoolsTopBar.vue` states its own rule in a comment and it is the right
one: *"tabs are daily destinations and a handbook is a once-a-term thing"*. Support is not a
daily destination either. It sits where Handbook and School settings sit, and it carries an
unread dot when there is something to read.

Both doors open the **same thread**. There is one thread per school, and it never closes — see
§11.

*Taste-safe default taken: it is called **Support**, plain. Register call is Tom's.*

---

## 3. What the agent already knows the moment she types

She should never describe her setup, and she should never send a screenshot. Everything in the
screenshot she sent today is knowable server-side the instant she presses Send.

The envelope is assembled **server-side, from her own resolved scope** — never from anything the
client claims. `api/_utils/schoolScope.ts` (`resolveVisibleScope`) is the existing pattern and
this uses it unchanged.

| Field | Where it comes from | Exists today? |
|---|---|---|
| `route` | the router's `fullPath` | **yes** — `tester_feedback.route` |
| `build_version` | Vite's `__BUILD_NUMBER__` | **yes** — `tester_feedback.build_version` |
| `device_info` | `navigator.userAgent` + screen size | **yes** — `tester_feedback.device_info` |
| `school_id`, school name, region | `resolveVisibleScope` from her JWT | pattern exists, not on any feedback row |
| her role | `useUserRole` / class-teacher auth | pattern exists |
| `anchor` — which element she tapped | the tile's own `data-walk` id | **yes**, as an attribute; never yet captured on a report |
| **the number she is looking at** | the same server call the tile rendered from | **new** — this is the important one |
| **the numbers underneath it** | `school_summary.total_practice_hours`, `staff_practice_hours`, `student_count`, `class_count`; `loadClassPractice()`'s session and `last_practiced_at` signals | all exist and are already computed |
| her school's recent practice shape | `sessions` rows in her subtree, last 7 and 28 days | exists |
| the last five things she said | the thread itself | new |
| standing notes about her school | §11 | new |

Two consequences worth stating plainly.

**The agent sees both numbers.** On the evening in question, `api/groups/[id]/home.ts` already
computed `school_summary.total_practice_hours` — students **plus staff**, off real
`sessions.duration_seconds`, per migration `20260718_headline_hours_include_staff_practice.sql`,
whose own header names Chepstow as its motivating case — and the tile then threw it away, because
`NodeHomeView.vue` prefers `classPractice.hours` whenever that object exists. The agent holding
the envelope holds *both* values. It can therefore see, without any diagnosis at all, that the
displayed number and the computed number disagree. That is the single most valuable thing in this
whole design, and it costs one extra field on the envelope.

**The anchor is the join key to the answer corpus.** She tapped an element with a `data-walk` id;
the Handbook pack is keyed on exactly those ids. So the agent starts every conversation already
holding the code's own sentence about the thing she is complaining about.

---

## 4. Answer, or escalate

This is the heart, so it is argued from cases rather than asserted as a taxonomy. Six messages.
For each: what she wrote, what the agent has in hand, what it actually says, and whether Tom
hears about it.

### Case 1 — Angharad's own

> **Angharad:** "This says we've done 0 hours but I've had three classes on it all week. Am I
> looking at the wrong thing?"

*In hand:* `classPractice.hours = 0`; `school_summary.total_practice_hours = 1.74`;
`staff_practice_hours = 1.74`; 34 classes; class-entity sessions totalling 174 seconds across
seven days against 6,271 for staff; the anchor `node-class-practice`; the Handbook entry for
that tile.

*It replies, immediately:*

> You are not looking at the wrong thing — the tile is wrong. Your school has 1 hour 44 minutes
> of practice logged in the last seven days, all of it from staff accounts. The tile is showing
> a different figure: practice recorded against the classes themselves, and that is reading
> almost nothing, 174 seconds across all 34 of your classes.
>
> Two separate things are going on. The tile is preferring the class figure over your school
> total even when the class figure is empty, which is a bug and I have logged it. And your class
> practice is barely being recorded at all, which is a second and bigger problem — I do not yet
> know why, and I am not going to guess at you.
>
> Nine other schools are showing the same empty class figure this week, so this is ours, not
> something you have set up wrongly. Tom will see this tonight.

*Escalates: yes.* And notice what escalation did **not** do — it did not delay her answer. She
has a true, specific, useful reply within seconds, and she knows both what is known and what is
not.

Notice also the third paragraph. The population count is in her reply because the same query that
produced the escalation produced it. The estate learns about the other schools **on the first
message**, not three hours into a diagnosis.

### Case 2 — the commonest kind, and the agent must never escalate it

> **Rhian, teacher:** "One of our TAs has left. How do I take her off?"

*In hand:* the Handbook entry `teacher-remove`, section `getting-people-in`, place `teachers`,
which reads, in the code, above the button that does it: *"Taking a teacher off your school when
they leave. Their own account survives… The Teachers page, the Remove button on that teacher's
row… Their learners keep every minute they have practised."*

*It replies:*

> Teachers page, then **Remove** on her row. Her own account carries on existing, and her
> learners keep every minute they have practised.
>
> [Take me there →]

*Escalates: no.* Ever. This is 98 capabilities' worth of question and Tom must never see one of
them.

**Answer from the Handbook pack, not from the model's own knowledge.** This is the reuse finding
that matters most in the whole job. Those sentences live in HTML comments directly above the
element that *is* the capability, they are compiled into `pack.json` by
`tools/walkthrough/compile.mjs`, and `--check` fails the build on a capability with no
description, a description whose anchor has gone, or a description not re-read since the
capability changed. The pack is regenerated from source before Vite runs. An agent answering from
that pack is **answering from the code**; an agent answering from its own weights is inventing,
and will confidently describe a button that was renamed in June.

The honest limit, which the repo's own `CLAUDE.md` states and this document will not oversell:
the freshness fingerprint reads one `.vue` file, so a change inside an API route or a composable
does not trip it, and a sentence can go quietly wrong. Which means the agent quotes the Handbook
**and links to the place**, so she can see the button for herself. It never paraphrases a
mechanism the pack does not contain.

The pack's handbook section is ~108,000 characters, about 27,000 tokens. Small enough to hand an
agent whole; better retrieved by anchor and keyword first, since she has usually already told us
which capability she means by tapping it.

### Case 3 — where the line actually is: mechanism versus terms

> **Angharad:** "We'd like to add Welsh for the Year 7s next term as well as the Spanish. Can we
> do that, and what would it cost us?"

*In hand:* five Handbook entries on `upgrade`; `schools.platform_status = 'trial'`,
`trial_course_code`, `trial_kind`, `teacher_seats`; the standing rule that a second different
course requires checkout, which is written on the column comment itself.

*It replies:*

> Yes, and here is the mechanism. Your trial covers one language, which is your Spanish, so a
> second one goes through checkout — that is the **Upgrade** page, and it prices per teacher
> seat rather than per pupil, so adding a language for one year group is not a second whole
> subscription.
>
> What it would cost **you specifically**, next term, with a Welsh school and a year group split
> the way yours is — that is Tom's to say, not mine, and I have asked him. You will have an
> answer from him rather than from me.

*Escalates: yes* — and this is the cleanest statement of the line in the document. **The
mechanism is the agent's. The terms are Tom's.** An agent that says "it'd be about £400" has
committed him to a number he did not agree, to a customer, in writing. That is not a reversible
error and no better-simpler-cheaper narrative rescues it.

### Case 4 — the one that must go somewhere that is not Tom

> **Rhian:** "One of my Year 8s says the Welsh voice pronounces 'llwyddiant' oddly."

*In hand:* nothing about that audio directly from her message; the `content_feedback` table,
whose own comment reads *"User-submitted feedback on audio/content - aggregated by threshold to
surface issues"*, with `audio_id`, `course_code`, `feedback_type`, `session_context`.

*It replies:*

> Logged against that course. Content reports get counted rather than acted on one at a time —
> when several people flag the same audio it surfaces for re-recording, and one report on its own
> sits in the count. So: recorded, honestly not fixed today, and if her class hears others like
> it, more reports genuinely help.

*Escalates: no.* There is already a threshold mechanism for exactly this, built for content, and
this is content. The reply's job is to be honest about what "logged" means rather than to imply a
fix. What the design does add is the missing joining pipe: her thread should be able to write a
`content_feedback` row when the agent recognises a content report, so the school's voice lands in
the same counter as the learner's.

### Case 5 — where a confident answer is worse than a wait

> **Angharad:** "Our governors are asking where pupil data is held and whether we need a DPA in
> place with you."

*In hand:* nothing it should trust itself on.

*It replies:*

> That one I am not going to answer, because a half-right answer about pupil data is worse than
> a slow one. It has gone to Tom and he will answer it himself.

*Escalates: yes, instantly, and it says so in the same breath.* Data protection, safeguarding,
contracts, anything a governing body will hold us to. The test is not difficulty — the agent
could produce fluent paragraphs here, which is precisely the danger. The test is **whether being
wrong is recoverable**. A wrong how-to costs her thirty seconds. A wrong answer about where
children's data lives costs a customer and possibly more.

### Case 6 — the defect the agent cannot explain

> **Siân, teacher:** "It keeps stopping after two or three questions on the school iPads.
> Works fine on my laptop."

*In hand:* her `device_info`; her `build_version`; the audio-failure spine that Question 7 of the
intelligence surface already reads — plays, failures, people, **by day, by build and by device**.

*It replies — after running the population check, not before:*

> I can see it. Audio is failing on that iPad build at a much higher rate than on anything else,
> and it is not just you — it is showing across four schools on the same iPad version this week.
> So do not spend your evening on the wi-fi. It is logged with the device and build attached and
> Tom has it tonight.

*Escalates: yes, carrying the population number.*

Had the population been **one** — her school, her one device, nobody else — the reply would end
differently: *"it is only showing on your devices so far, which usually means something local.
Logged with the details, and if it is still happening on Monday tell me and I will push it up."*
A single-school anomaly with no corroboration is not yet Tom's evening.

---

### The principle, extracted

Six cases, and the pattern in them is not the one the category-list version of this document
would have produced.

**First: replying and escalating are different decisions, and the reply never waits.** Every
message gets an answer within seconds, and escalation is an additional thing that may also
happen. This is the opposite of a ticket system, where "escalated" means "you will hear
nothing for a while". Angharad's message escalated *and* got a complete true answer in the same
breath. If those two were coupled, this design would be worse than her email — because her email
at least reached a human.

**Second: the asymmetry is not the same asymmetry as `channel-ask.js`.** That module is
deliberately conservative because *"a missed ask costs Tom one message he was going to read in
the room anyway; a false positive costs him a plate item per line of chat"*. Correct there — a
colleague is in a room Tom can read. Here **nobody else is in the room.** A missed escalation is
not a message Tom would have seen anyway; it is a customer who was told something wrong, or a
103-class defect nobody looked at. The costs are heavy on both sides, so a single conservatism
dial is the wrong instrument. What replaces it is four specific tests, applied to a message that
has *already been answered*:

1. **Does answering it commit Tom to something he has not agreed?** Money, dates, terms,
   promises, a bespoke arrangement. → escalate. Mechanism is the agent's, terms are his.
2. **Would being wrong be unrecoverable?** Data protection, safeguarding, contracts, anything a
   governing body holds us to. → escalate, and say so plainly rather than stalling.
3. **Is there a defect the agent can see but not explain, and does more than one school carry
   it?** → escalate, **with the count**. One school, no corroboration: hold it, tell her it is
   held, and revisit.
4. **Is it a taste call, or in his voice?** Register, product identity, what we promise, how we
   describe ourselves to a Welsh school. → escalate. Always his.

And a fifth that is about the relationship rather than the content, because this is a customer
and not a chat room: **she asked for Tom by name, or she is plainly unhappy.** A head teacher who
writes "I need to speak to someone about this" has told you the answer to the escalation
question, whatever the topic. Escalate, and tell her you have.

**Third: everything else is answered and logged, never escalated, and Tom reads the digest and
not the thread.** 98 Handbook capabilities' worth of how-to is the volume in this channel, and
the design fails the moment any of it reaches him.

**Fourth: the escalation reason is recorded as a matched test, not as a judgement.** `channel-ask.js`
rides the matched phrase on the candidate as `evidence` for exactly this reason: *"why did this
file?" is answerable months later from the log*. Same here — every escalation carries which of
the five tests fired and on what. When Tom says "stop sending me these", the thing to change is
findable.

---

## 5. Tom is notified once, replies once

He gets **one card, inline in his Watson conversation**, via `POST /api/needs-you` — no board;
the boards were retired on his own ruling of 2026-08-05 because *"it's much less overhead for me
to respond to your questions in the chat"*. It has four parts and no more:

> **Angharad Jones, head at Ysgol Cas-gwent, says her dashboard shows 0 hours while three classes
> have been practising all week. She is right and the tile is wrong.**
>
> Her school has 1h 44m of real practice this week, all staff accounts. The class figure the tile
> prefers reads 174 seconds across 34 classes. **Nine other schools show the same empty class
> figure this week.** Two defects, one in the tile's preference order and one in class-session
> recording.
>
> **My recommendation: send the reply below. I have already told her it is ours and not her
> setup.** Nothing here needs a decision from you — this is a courtesy sight of a customer
> escalation, and the fix is a separate job.
>
> **Draft reply, ready to send in your name:** "Angharad — you've found a real bug and it's
> ours, not yours. Your staff practice is being recorded properly; the tile was showing the wrong
> one of two figures. Fixing it tonight, and I'll come back to you when it's live. Thank you for
> telling me."

**His one action is one word.** `yes` sends the draft in his name. Any sentence he types
*replaces* the draft and is sent verbatim in his name. `no` holds it, and the agent tells her a
person is looking at it rather than leaving silence. That is the three-answer bar the estate
already uses — yes / no / more — mapped onto send / hold / tell-me-more.

**Between his word and her screen there is one INSERT.** The agent holding the service key writes
a row into `support_messages` on that thread. No HTTP call into the app, no endpoint, no relay
secret, no deploy — the reply path is a database write, which is Tom's ruling and it is
straightforwardly better, simpler and cheaper than the endpoint this document proposed before it.
The row:

```json
{
  "thread_id": "…",
  "body": "Angharad — you've found a real bug and it's ours, not yours. …",
  "author_source": "human",
  "author_name": "Tom",
  "author_via": "login-header",
  "in_reply_to": "…"
}
```

The three `author_*` columns are `author-stamp.js`'s vocabulary, deliberately, so a thread
carrying both Tom's words and an agent's can say which is which **from the stamp rather than from
the prose** — the exact hole that module was built to close. Her view renders his message
differently: his name, and no agent framing around it.

She learns there is a reply two ways. In the app: the unread dot on Support, and a line at the top
of the dashboard. Out of the app: **one email**, through the existing `api/_utils/resendMail.ts`
from `contact.saysomethingin.app` — the only verified domain — if she has not opened the thread
within a few hours. It carries the reply and a link straight into the thread. Not a new email
loop; a doorbell for the one in the app.

He composed nothing, opened no inbox, and pasted no screenshot.

---

## 6. Async is the default, and what that honestly costs her

**Tom's ruling:** *"it doesn't HAVE to be a live chat."* Right, and the design should say what
that costs rather than dress it up.

Two different waits live inside this channel and conflating them is the trap.

**The agent's answer is not a wait at all.** The agent replies in seconds — it holds the envelope
and the Handbook pack, it is not waiting for a person. Angharad's Case-1 reply arrives while she
is still looking at the tile. So the overwhelming majority of messages in this channel are
effectively synchronous already, and calling the whole thing "async support" undersells it.

**Tom's answer is the real wait**, and it is honestly *hours*. He is one person, he reads on a
phone, and he is not sitting in a queue. What that costs her, plainly:

- She does not know whether a human has seen it, or whether a machine filed it and nothing will
  happen. That is the actual anxiety of async support, and it is the one worth engineering
  against.
- She cannot ask a follow-up and get it answered in the same sitting.
- If she needed an answer *before* period four, she has not got one.

Four things pay for it, all cheap:

1. **A true answer immediately, every time.** Not "thanks, we'll be in touch" — the agent's real
   reply, with what is known and what is not. This is the single biggest thing async gets wrong
   and the one thing this design does not get wrong.
2. **Say who has it and when.** *"Tom will see this tonight"* is a claim with a time in it, and
   the watcher makes it true. Never "we'll get back to you soon".
3. **Show the state without her asking.** The thread shows one line: *Waiting on Tom since 19:40*.
   Not a status field — §11 argues against those — a rendering of the plain fact that a message is
   escalated and unanswered.
4. **Tell her when it lands, out of the app.** She will not sit on the page. Unread dot on
   Support, plus **one email doorbell** through the existing `api/_utils/resendMail.ts` from
   `contact.saysomethingin.app`, carrying the reply and a link into the thread.

**Where async genuinely fails, and what to do about it.** A school in the middle of a lesson with
thirty pupils and nothing playing does not want a thread. That is not a support case, it is an
outage, and the answer is not live chat — it is the agent recognising the shape and saying
something useful in the first reply: whether the estate is seeing failures on her build right
now, and whether it is her or us. §8's population count already answers that. **The fix for
urgency is a better first answer, not a faster human.**

---

## 7. Live, later: the upgrade path and what has to be true first

**Tom's ruling:** *"we COULD make it so with the same approach we use for popty — the ngrok one."*
Named, not built.

**The precedent, accurately.** Popty's `start-automation.cjs` reads `NGROK_URL` and hands it to
every phase server as `ORCHESTRATOR_URL`, *"use ngrok URL for external agents"* — a service on a
private box given a public URL so something outside can reach it, with no VPN on the other side.
That is exactly the shape live support would need: a socket her browser can hold open to
something running on watson-1.

**What live would actually add**, since the async design already covers most of it: a human typing
while she watches. Nothing else. The agent is already instant; the notification already lands; the
thread already persists. Live buys **presence** — the felt difference between talking to someone
and leaving a note.

**What would have to be true before it is worth building.** All of these, not some:

1. **Somebody is actually there.** Live chat with nobody on the other end is worse than a thread,
   because it promises presence and withholds it. This is a staffing fact, not a technical one,
   and it is the real gate.
2. **The async version is in real use and the thread has been read.** If schools are not using the
   door at all, presence is not the missing thing.
3. **Escalations are frequent enough that batching them into an evening is the bottleneck.** At a
   handful a week it is not.
4. **A tunnel is worth running.** ngrok or equivalent is one more thing that can be down, and it
   is down at exactly the moment a school is in trouble. The database transport has nothing to be
   down.

**And the honest alternative to a tunnel**, worth saying because it is probably the right answer:
live does not need one. The same table, polled every two seconds instead of every thirty, with a
typing row, is live enough for a conversation between two people who are both present. Supabase
realtime over the same table is the version after that. **The database transport scales to live
without a tunnel** — which means the Popty precedent is the fallback rather than the plan, and
point 4 above mostly answers itself.

Not v1. Not v2 unless point 1 becomes true.

---

## 8. The same message is a bug report

Angharad's message was two things at once, and the system treated it as one. That is the actual
failure of today, more than the fuss and bother.

The mechanism is a **signal key**: a short, stable, machine-made description of the *shape* of a
complaint, minted by the agent when it recognises one, and independent of her words.

```
tile-contradiction:node-home:class-practice:zero-vs-nonzero-school-total
audio-failure:device=iPad;build=1174
```

When the agent mints a key it does two things before it replies.

1. **It counts.** One server-side query: how many *distinct schools* carry this signal key in the
   last seven days, and how many carry the same underlying data shape whether or not anyone has
   complained. The second half is what turns one teacher's message into an estate fact — the
   query "how many nodes right now display zero class practice while holding non-zero school
   practice" returns 103 whether or not anyone has asked. Nobody had to ask.
2. **It writes the count into both the reply and the escalation.** She learns it is not her
   setup. Tom learns the blast radius in the first sentence rather than the fourth hour.

Three notes on this.

**The idea is already in the estate and was only ever applied to content.** `content_feedback`'s
own table comment says *"aggregated by threshold to surface issues"*. Somebody had precisely this
thought about audio and nobody had it about support. The graft is to reuse the thought, not the
table.

**Question 7 of the intelligence surface is the right destination for the estate-facing half.**
`views/intel/WorkingView.vue` already answers "is the app working right now, and did my last fix
land?" over real plays, by day, **by build and by device**. A support signal with a population
count belongs on that surface as a finding, not in a separate support dashboard. I looked, and
that is the whole of my judgement on it: one shared spine, one new source of findings, no second
surface. Not v1, but the place it goes.

**A signal key is minted, never guessed at scale.** If the agent invents a fresh key per message
the count is always one and the mechanism is decorative. So the keys are a small, growing,
*named* list, and an unmatched complaint gets no key and no count — which is honest, and which
shows up as a gap worth naming a key for.

---

## 9. Welsh and English

The Welsh question is not "how do we translate the UI". `composables/useI18n.ts` carries `cym`
with north and south dialect aliases, `SettingsView.vue` already offers **Cymraeg (Welsh)** as a
school language, and `i18n/noBareEnglish.test.ts` gates untranslated user-visible strings against
a baseline with a written reason required per allowlist entry. That machinery exists and this
design uses it unchanged.

What I checked, and must report as a gap rather than paper over:

- **`cym.json` carries 1,417 of `eng.json`'s 2,401 keys.** Of the 750 `schools.*` strings, **275
  are missing in Welsh**, concentrated in setup, billing and parts of the dashboard.
- **The Handbook prose is not localised at all.** Neither `eng.json` nor `cym.json` has a
  `handbook` key; `HandbookView.vue` renders the English straight out of `pack.json`. The
  walkthroughs *were* localised — `localiseWalk.ts` mirrors all eighteen into `eng.json` — and
  `cym.json` currently carries **one** of the eighteen.

So: **the agent's answer corpus is English-only today, and it must not pretend otherwise.**

The design:

- **It answers in the language she wrote in.** Detected from her message, falling back to the
  school's existing dashboard language setting when that is ambiguous. She is never asked to pick
  a language before she can ask a question.
- **When the honest answer only exists in English, it says so in Welsh and then gives the
  English.** One line: *"Mae'r ateb hwn yn Saesneg yn unig ar hyn o bryd"* and then the Handbook
  sentence as written. A machine-translated mechanism the agent cannot verify is a worse outcome
  than an English mechanism she can follow — she is a Welsh-medium professional reading English
  software all day, and being lied to fluently in Welsh is not respect.
- **Tom's reply goes through verbatim, in English, attributed to him**, with a Welsh rendering
  offered *alongside* rather than in place of his words. **Flagging this loudly: it touches his
  voice, which is his.** A machine-translated Tom reads as a machine, and a Welsh school that
  hears from the founder himself in his own words has had something real. Default taken; one word
  overturns it.
- **The 275 missing `schools.*` strings and the unlocalised Handbook are named as a gap in this
  document and not fixed by it.** They are a separate, scoped, mechanical job. The support
  channel does not need them to ship, and it will make their absence visible, which is the right
  order — a Welsh school asking a question in Welsh is the first honest measurement of how Welsh
  the dashboard actually is.

---

## 10. Privacy and identity

Two different problems live under this heading and only one of them is new.

**A teacher must never see another school's data.** Solved, and this design touches none of it.
`api/_utils/schoolScope.ts`'s `resolveVisibleScope` is the server-mediated pattern,
`classTeacherAuth.ts` is the class-teacher authorisation, `composables/schools/rlsGuard.ts`'s
`assertScope()` is the dev-loop net, and the repo's own settled division of labour is that RLS
answers exactly one question — *is this my row?* — while all hierarchy authorisation lives in
server endpoints with tests. The support envelope is built inside that boundary, from her JWT,
by the same helper. There is no new identity model here and none should be invented.

**An agent must never leak one school to another.** New, and a design question rather than an RLS
one, because the leak vector is what the agent is *handed* and what it is *allowed to say*.

Three hard constraints:

1. **One school per context, always.** The agent's prompt for a message in Chepstow's thread
   contains Chepstow's envelope, Chepstow's thread history, Chepstow's standing notes, and the
   Handbook pack. It never contains another school's rows, and there is no cross-school memory
   between threads. Not a rule the agent is asked to respect — a property of how the context is
   assembled.
2. **Population questions return integers, never identities.** "Is anyone else seeing this?" is
   answered by a server-side count endpoint whose response shape is `{ schools: 9, since: "…" }`
   and which cannot return a school id, a name or a region, so the honest answer *"nine other
   schools"* is reachable and *"yes, Ysgol X"* is not expressible. **This wants a test that
   asserts the response shape**, the way the estate tests every other shape it depends on.
3. **The escalation to Tom is the one place a school is named**, because he is the one person
   entitled to know. Nothing named in a needs-you card ever travels back into another school's
   thread — the reply-in endpoint takes a `thread_id` and writes to exactly that thread.

One more, smaller: the thread is the **school's**, not one person's. Angharad and her teachers see
the same thread, and staff turnover does not lose the history. That means anything a teacher
writes there is visible to her school admin, and the Support door should say so in one line before
she types the first time. A teacher writing something about a pupil into a channel her head can
read is a real hazard, and one sentence at the door is the cheap fix.

---

## 11. Holding the room over time

**A school's conversation is not a ticket, and the data model should refuse to pretend it is.**
Ticket systems close things. The relationship with Ysgol Cas-gwent does not close, and a `status:
resolved` on Angharad's thread would mean nothing except that nobody is looking at it.

So: **one thread per school, forever.** No status field, no priority field, no SLA, no
reopening — because nothing ever closed. The three sketch tables:

```
support_threads     school_id (unique), created_at, last_message_at, language, standing_notes jsonb
support_messages    thread_id, body, direction, author_source, author_name, author_via,
                    envelope jsonb, signal_key, escalated_at, escalation_test,
                    answered_at, created_at
support_signals     signal_key, school_id, first_seen_at, last_seen_at   -- the count in §8
```

Individual **messages** carry state, because a message can be escalated and answered — and
`answered_at` is precisely what the watcher on watson-1 selects on, which is the only reason it
exists. The **thread** carries none, because a relationship has none. That is the whole difference
between this and a ticket table: state lives on the exchange, never on the relationship.

**What the agent remembers**, in two tiers:

- **The thread itself**, bounded to the recent past. Cheap, exact, and it means she never repeats
  herself inside a conversation.
- **Standing notes**: a small structured record of the things it would be rude to ask twice. She
  is the head, not a teacher. Thirty-four classes. The pupils are on school iPads. Welsh-medium.
  They came in on a free year. She prefers a straight answer to a reassuring one. Written by the
  agent, visible to her, correctable by her — because a system that has silently formed opinions
  about your school and will not show you them is not a colleague.

What it does **not** remember: her numbers. Those are fetched fresh on every message from the
live scope, never carried forward. A cached figure is how you end up telling a head teacher
something that was true last Tuesday, which is the exact class of error this whole channel exists
to stop.

---

## 12. Decided: new tables, not an extension of `tester_feedback`

Handing this back as a question would be mis-altituded, so it is decided here.

`tester_feedback` carries `user_id`, `display_name`, `feedback_type`, `title`, `description`,
`route`, `device_info`, `build_version`, `screenshot_url`, `status`, `priority`, `admin_notes`.
It is genuinely close on the technical half of the envelope — and it has **no notion of a reply,
a thread, a school, or a language**. Its component, `TesterFeedback.vue`, is gated to
`isTester || isSsiAdmin` and **explicitly hides itself on `/schools` routes** with the comment
*"feedback is for learner-facing testing"*.

- **Better.** A new shape can hold a two-way conversation, which is the entire point. Extending
  the old one means adding thread, direction, author-source, school and language columns, and
  inverting the gate that deliberately excludes the schools surface. That is not extension, it is
  replacement with legacy columns riding along — including `status` and `priority`, the two
  fields §11 argues a school thread must not have.
- **Simpler.** `tester_feedback` keeps its one clear job: a tester's one-way bug report. Three
  narrow tables with one purpose each beat one wide table serving two audiences whose access
  gates contradict each other.
- **Cheaper.** Three small tables, own-row-plus-school RLS posture declared at creation as the
  repo requires, no migration of live tester rows, no risk to a working widget. The reuse that
  matters costs nothing: **its column list is the specification for the envelope**, and its
  `feedback-screenshots` storage bucket is there if a screenshot is ever genuinely wanted.

Decided: `support_threads`, `support_messages`, `support_signals`, as sketched in §11.

---

## 13. Walked against tonight, end to end

1. **19:40.** Angharad opens her dashboard and the class-practice tile reads **0h**. Three classes
   have been on it all week. Underneath the tile: *Does this look wrong?*
2. She taps it. A sheet: *"You tapped Class practice, showing 0h. What looks wrong?"* She types
   **"This says we've done 0 hours but I've had three classes on it all week. Am I looking at the
   wrong thing?"** and sends. **No screenshot. No description of her school. Three taps.**
3. The server builds the envelope from her scope: school Ysgol Cas-gwent, 34 classes, route
   `/org/<id>`, build `1174`, anchor `node-class-practice`, displayed value `0`, and underneath it
   `total_practice_hours 1.74`, `staff_practice_hours 1.74`, class-entity sessions 174s over seven
   days against 6,271s staff.
4. The agent sees the two figures disagree, mints the signal key
   `tile-contradiction:node-home:class-practice:zero-vs-nonzero-school-total`, and runs the count.
   **The count comes back 103 classes across 9 schools** — the estate learns it here, at 19:40, on
   the first message, from one query, rather than at 23:00 as a by-product.
5. **19:40, seconds later.** She reads the Case-1 reply: her real number, both defects named, the
   nine other schools, and *"Tom will see this tonight."* She closes her laptop. She has not
   written an email and she is not waiting on one.
6. Tests 3 and 5 both fire — a defect she cannot be expected to explain, carried by more than one
   school, from a customer who came to the founder by name. One `POST /api/needs-you` lands
   **inline in Tom's Watson conversation**: the one-sentence summary, the two defects, the
   population number in bold, the recommendation, and a draft reply in his register.
7. **Tom reads it on his phone and types `yes`.** That is his whole evening's involvement in the
   customer half. No inbox, no screenshot, no composing.
8. **The agent writes one row.** `support_messages`, on her thread, with `author_source: human,
   author_name: Tom`. No endpoint, no secret, no deploy — an INSERT. She gets the unread dot, and
   an email doorbell an hour later because she has not opened it.
9. **The fix is a separate job**, commissioned from the escalation, and it already knows its own
   scope — 103 classes, two defects, one in the tile's preference order and one in when the class
   session is opened. The thread stays open, and when the fix lands the agent posts one line into
   it: *"That tile is right now. Your 1h 44m shows where it should."*
10. Angharad's thread is still there next term, with the standing notes, when she asks about
    adding Welsh for the Year 7s.

---

## 14. The smallest first version

**Handles Angharad tonight. Nothing beyond that. Written to be built from without asking a
question.**

**Her side, in the learning app**

1. **One door: the tile affordance.** A `Does this look wrong?` control under the `stats` row in
   `views/admin/NodeHomeView.vue` and under the class-practice block. It opens a sheet carrying
   the tapped `data-walk` anchor and the value displayed. The user-menu **Support** entry ships in
   the same version because it is one `router-link` next to Handbook and the thread must be
   re-openable — no design work beyond that.
2. **One thread view.** Messages oldest-first, hers plain, the agent's plain, **Tom's visibly
   his** — his name, no agent framing. One text box, one Send. **One line showing state when a
   message is escalated and unanswered:** *Waiting on Tom since 19:40*. No attachments, no typing
   indicator, no read receipts. Poll on open and on focus; no socket.
3. **One line at the door** saying the thread is the school's and her school admin can read it.
4. **The Handbook in place, in the same release.** A quiet question mark next to controls that
   already carry a `data-walk` anchor, opening that capability's compiled sentence inline. Section
   1's argument: it is the thing that keeps the channel about judgement instead of lookup, the
   corpus already exists keyed on those anchors, and it is close to free.
5. Safe-area padding on the sheet per the repo's standing rule; `t()` on every string, with the
   Welsh keys for the handful this introduces.

**Server, in the learning app — three endpoints, and no reply wire**

6. `POST /api/support/messages` — her question. Assembles the envelope server-side via
   `resolveVisibleScope`, writes the row, calls the agent, writes the agent's reply, returns both.
7. `GET /api/support/thread` — her thread, scoped to her school, created on first use.
8. `GET /api/support/population?signal=<key>` — **integers only**, `{ schools: n, since }`, with a
   test asserting the response cannot carry an id, a name or a region.
9. Three tables per section 11, each with its RLS posture declared at creation as the repo
   requires — own-school read for `support_threads` and `support_messages`, service-role only for
   `support_signals`. **There is no reply-in endpoint.** The answer path is an INSERT by a
   service-key holder, which is the ruling and the whole simplification.

**The estate side, on watson-1**

10. **One watcher.** A `systemd` timer or the surface's existing cron machinery, selecting
    `support_messages` rows that have no answer, every few seconds. Polling — nothing to keep
    alive, nothing to lose, survives a restart unnoticed. It is the thing that makes *"Tom will
    see this tonight"* a true statement.
11. **The agent.** Prompt = the envelope + the thread's recent history + **the Handbook pack
    retrieved by anchor and keyword**, never the model's own knowledge of the UI. Where the pack
    has no entry, it says it does not know and offers the escalation rather than paraphrasing.
12. **Two signal keys, not a framework:** `tile-contradiction:*` and `audio-failure:device;build`.
    Everything else gets no key, no count, and is honest about it.
13. **The five escalation tests as an explicit list**, each escalation recording which one fired
    and on what — `channel-ask.js`'s `evidence`, same reason.
14. Answers in the language she wrote in; where the honest answer is English-only, one Welsh line
    saying so, then the English.

**Tom's side**

15. One `POST /api/needs-you` per escalation, with the four-part body of section 5 including the
    draft reply. **No new surface on the command surface at all** — needs-you already is his inbox.
16. `yes` writes the draft as a row in his name; a typed sentence replaces and writes that; `no`
    holds and the agent tells her a person is looking.

**Telling her**

17. Unread dot on Support; one email doorbell through `resendMail.ts` from
    `contact.saysomethingin.app` if the thread is unopened after a few hours.

That is the build: five things on her screen, three endpoints, three tables, one watcher, one
agent, one needs-you card. It would have taken Angharad's evening from *email, inbox, screenshot,
dispatch, fix, reply* down to *three taps, a true answer in seconds, and one word from Tom* — and
it would have surfaced the 103 classes at 19:40 instead of 23:00.

---

## 15. What I would not build

- **No ticket status, priority, or SLA.** §11's whole argument. A relationship does not close and a
  field that says it did is a lie the dashboard tells itself.
- **No thumbs-up "was this helpful?"** It measures politeness. Whether she came back is the real
  signal and it is free.
- **No support surface for Tom on the command surface.** `needs-you` inline in Watson is already
  the thing he asked for. A second inbox is a second place to not check.
- **No attachment or screenshot upload in v1.** The entire point of §3 is that she should not need
  one. Shipping the upload button first is shipping the old workflow with a new coat.
- **No machine-translated Tom.** §9. His voice is his.
- **No learned or ML escalation classifier.** Five named tests with recorded evidence, as
  `channel-ask.js` does it. A model that "judges importance" cannot answer *why did this file?*
  months later, and that question is the one that actually gets asked.
- **No knowledge-base authoring tool, and no separate help corpus.** The Handbook is the corpus,
  it lives above the button, and the build gate keeps it honest. A second corpus would be stale
  within a fortnight and would be the thing the agent quoted.
- **No agent that writes the fix.** It reports; a commissioned job fixes. An agent that both
  diagnoses and patches from a customer's sentence is how a support message becomes a deploy.
- **No learner-side or family-side channel in v1.** Schools only. The learner side may well be the
  bigger prize and it is a different design — volume, safeguarding, and children.
- **No live chat in v1 — but it is an upgrade path and not a refusal.** Section 7 names what would
  have to be true first, and the first thing is that somebody is actually there.
- **No message bus, webhook, socket, tunnel or realtime subscription.** The table is the transport.
  Every one of those is a thing that can be down at the moment a school is in trouble, and the
  database transport has nothing to be down. Polling on open and on focus is indistinguishable
  from realtime at this volume.
- **No `LISTEN/NOTIFY` and no Supabase realtime for the watcher either.** A poll every few seconds
  has no connection to lose and survives a restart unnoticed. Realtime is what the volume earns
  later, if it ever does.
- **No auto-close, no nudge-if-quiet, no satisfaction survey.** Silence from a school that is
  practising is the correct amount of contact.

---

## 16. Defaults taken, and gaps reported honestly

**Taste-safe defaults taken — each overturnable in one word:** it is called **Support**; the agent
answers in the language she wrote in, falling back to the school's dashboard language; Tom's
English reply goes through **verbatim and attributed**, with a Welsh rendering offered alongside
and never replacing; the agent appears as **SSi**, plainly a helpful system, never a named person
and never as Tom; v1 is the **schools dashboard only**; escalation goes by **`POST /api/needs-you`**.

**Decisions I made rather than handing back:** new tables rather than extending `tester_feedback`
(§12); the watcher as a poll rather than realtime or `LISTEN/NOTIFY` (§0); population answers as
integers only (§10); one thread per school with no status (§11); two signal keys in v1 rather than a
framework (§14); the Handbook surfaced in place in the same release as the channel rather than after
it (§1).

**What Tom's mid-spec ruling changed in this document, so the diff is legible:** the database is now
the transport, which deleted the `POST /api/support/threads/:id/messages` reply-in endpoint and its
`SUPPORT_RELAY_SECRET` entirely — the answer path is an INSERT by a service-key holder. Async is
stated as the default with its costs argued rather than apologised for (§6). Live is named as an
upgrade path with the Popty `NGROK_URL` precedent cited and a gate list, and the honest finding
there is that **live would not need a tunnel at all** — the same table polled faster is live enough
(§7). And the Handbook and the intelligence components moving into the schools dashboard is now part
of this design rather than a neighbouring one (§1), because it decides how much ever reaches a
human.

**Gaps, stated rather than papered over:**

- `cym.json` carries **1,417 of 2,401** keys; **275 of 750 `schools.*` strings are missing in
  Welsh**. Verified in this worktree today.
- **The Handbook prose is not localised at all** — no `handbook` key in either locale. The
  walkthroughs are: 18 localised in `eng.json`, **1 of 18 in `cym.json`**. So the answer corpus is
  English-only today, and §9 is built around admitting that rather than hiding it.
- The Handbook freshness gate **does not guarantee a sentence is true** — its fingerprint reads
  one `.vue` file, so a change inside an API route or a composable does not trip it. Hence
  quote-and-link rather than paraphrase.
- I did not verify any live database numbers myself. The Chepstow figures here — 34 classes, 174
  seconds of class practice against 6,271 staff, 103 classes estate-wide, the tile's preference at
  `NodeHomeView.vue`, the `20260718` migration naming Chepstow — are read from job #150's
  published diagnosis at `/d/3f81730b` and from `api/_utils/classPractice.ts`'s own header
  comment, which records the 2026-09-10 live verification. Job #164 owns her real numbers for
  tonight's reply and #159 owns the telemetry chain; nothing here re-derives either.
- **"Nine other schools" in the Case-1 and §5 reply text is illustrative**, consistent with 103
  classes across the estate. The real number is whatever the count returns.
- The Popty precedent in §7 is verified only as far as `start-automation.cjs`, which reads
  `NGROK_URL` and hands it to every phase server as `ORCHESTRATOR_URL` with the comment *"use
  ngrok URL for external agents"*. I did not read how the tunnel is provisioned or kept up, and
  §7 argues the tunnel is the fallback rather than the plan, so I did not spend the tokens.

**What genuinely needs Tom:** the register call on the name; whether his reply is ever rendered
into Welsh; and whether the learner side is the bigger prize than the schools side. Nothing else
in this document is waiting on him.
