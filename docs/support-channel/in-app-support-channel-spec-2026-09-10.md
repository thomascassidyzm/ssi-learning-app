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

---

## 0. The architecture, in one paragraph, because it decides everything else

Angharad cannot reach the command surface. It is served only over Tom's private Tailscale
tailnet — `docs/adding-a-colleague.md` in `command-surface` has the joining process, and it
begins with Tom sharing the `watson-1` machine from the Tailscale admin console and the
colleague installing a VPN client on their phone. Identity is resolved from the
`tailscale-user-login` header. A head teacher in Chepstow will not install a VPN to ask why a
tile says zero, and should not be asked to.

So: **her half lives in the learning app**, on `saysomethingin.app`, behind the auth she already
has, on the page she is already looking at. **Tom's half is the command surface**, because he is
already there and it already does this job — `POST /api/needs-you` puts a decision inline in his
Watson conversation, and `doc-response-routing.js` already proves the loop where he reads one
thing, types one reply, and it lands somewhere that can act on it.

Two things cross the boundary, and only two:

| Direction | What crosses | Carried by |
|---|---|---|
| App → surface | One escalation: a sentence, a recommendation, a population count, a draft reply | `POST /api/needs-you` (exists) |
| Surface → app | One reply, verbatim and attributed to Tom | `POST /api/support/threads/:id/messages` with a bearer secret (**new — the only genuinely new wire in the design**) |

Everything else on each side stays on its own side. That is the whole of the plumbing.

---

## 1. Where it lives, and how she starts a conversation

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
§8.

*Taste-safe default taken: it is called **Support**, plain. Register call is Tom's.*

---

## 2. What the agent already knows the moment she types

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
| standing notes about her school | §8 | new |

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

## 3. Answer, or escalate

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

## 4. Tom is notified once, replies once

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

Between his word and her screen: the surface calls **`POST /api/support/threads/:id/messages`** on
`saysomethingin.app` with `Authorization: Bearer <SUPPORT_RELAY_SECRET>`, fail-closed in
production when the secret is unset — the same shape as every route in `api/cron/`, which is the
estate's existing answer to "an outside caller we trust". The body:

```json
{
  "thread_id": "…",
  "text": "Angharad — you've found a real bug and it's ours, not yours. …",
  "author": { "source": "human", "author": "Tom", "via": "login-header" },
  "in_reply_to": "…"
}
```

The `author` block is `author-stamp.js`'s vocabulary, deliberately, so a thread containing both
Tom's words and an agent's can say which is which from the stamp rather than from the prose. Her
view shows his message differently: his name, and no agent framing around it.

She learns there is a reply two ways. In the app: the unread dot on Support, and a line at the
top of the dashboard. Out of the app: **one email**, sent through the existing
`api/_utils/resendMail.ts` from `contact.saysomethingin.app` — the only verified domain — if she
has not opened the thread within a few hours. That email carries the reply and a link straight
into the thread. It is not a new email loop; it is a doorbell for the one in the app.

He composed nothing, opened no inbox, and pasted no screenshot.

---

## 5. The same message is a bug report

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

## 6. Welsh and English

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

## 7. Privacy and identity

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

## 8. Holding the room over time

**A school's conversation is not a ticket, and the data model should refuse to pretend it is.**
Ticket systems close things. The relationship with Ysgol Cas-gwent does not close, and a `status:
resolved` on Angharad's thread would mean nothing except that nobody is looking at it.

So: **one thread per school, forever.** No status field, no priority field, no SLA, no
reopening — because nothing ever closed. The three sketch tables:

```
support_threads     school_id (unique), created_at, last_message_at, language, standing_notes jsonb
support_messages    thread_id, body, author_source, author_name, author_via, envelope jsonb,
                    signal_key, escalated_at, escalation_test, created_at
support_signals     signal_key, school_id, first_seen_at, last_seen_at   -- the count in §5
```

Individual **messages** carry state, because a message can be escalated and answered. The
**thread** carries none, because a relationship has none.

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

## 9. Decided: new tables, not an extension of `tester_feedback`

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
  fields §8 argues a school thread must not have.
- **Simpler.** `tester_feedback` keeps its one clear job: a tester's one-way bug report. Three
  narrow tables with one purpose each beat one wide table serving two audiences whose access
  gates contradict each other.
- **Cheaper.** Three small tables, own-row-plus-school RLS posture declared at creation as the
  repo requires, no migration of live tester rows, no risk to a working widget. The reuse that
  matters costs nothing: **its column list is the specification for the envelope**, and its
  `feedback-screenshots` storage bucket is there if a screenshot is ever genuinely wanted.

Decided: `support_threads`, `support_messages`, `support_signals`, as sketched in §8.

---

## 10. Walked against tonight, end to end

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
8. The surface calls `POST /api/support/threads/:id/messages` with the bearer secret. His words
   land in her thread verbatim, stamped `source: human, author: Tom`. She gets the unread dot, and
   an email doorbell an hour later because she has not opened it.
9. **The fix is a separate job**, commissioned from the escalation, and it already knows its own
   scope — 103 classes, two defects, one in the tile's preference order and one in when the class
   session is opened. The thread stays open, and when the fix lands the agent posts one line into
   it: *"That tile is right now. Your 1h 44m shows where it should."*
10. Angharad's thread is still there next term, with the standing notes, when she asks about
    adding Welsh for the Year 7s.

---

## 11. The smallest first version

**Handles Angharad tonight. Nothing beyond that. Written to be built from without asking a
question.**

**Surface, in the learning app**

1. **One door only: the tile affordance.** Add a `Does this look wrong?` control under the `stats`
   row in `views/admin/NodeHomeView.vue` and under the class-practice block. It opens a sheet
   carrying the tapped anchor and its displayed value. The user-menu **Support** entry lands in
   the same version because it is one `router-link` next to Handbook and the thread has to be
   re-openable, but it needs no design work beyond that.
2. **One thread view.** Messages oldest-first, hers plain, the agent's plain, **Tom's visibly
   his** — his name, no agent framing. One text box, one Send. No attachments, no typing
   indicator, no read receipts. Poll on open and on focus; no socket.
3. **One line at the door** saying the thread is the school's and her school admin can read it.
4. Safe-area padding on the sheet per the repo's standing rule; `t()` on every string, with the
   Welsh keys added for the handful this introduces.

**Server, in the learning app**

5. `POST /api/support/messages` — her side. Builds the envelope server-side via
   `resolveVisibleScope`; writes `support_messages`; calls the agent; writes the reply; returns
   both.
6. `GET /api/support/thread` — her thread, scoped to her school, creating it on first use.
7. `GET /api/support/population?signal=<key>` — **integers only**, `{ schools: n, since }`, with a
   test asserting the response cannot carry an id or a name.
8. `POST /api/support/threads/:id/messages` — the reply-in wire. `Authorization: Bearer
   <SUPPORT_RELAY_SECRET>`, **fail closed in production when the secret is unset**, exactly as
   `api/cron/*` does. Body carries the `author-stamp` block.
9. Three tables per §8, each with its RLS posture declared at creation — own-school read for
   `support_threads` / `support_messages`, service-role only for `support_signals`.

**The agent**

10. Prompt = the envelope + the thread's recent history + **the Handbook pack retrieved by anchor
    and keyword**, never the model's own knowledge of the UI. When the pack has no entry for what
    she asked, it says it does not know and offers the escalation rather than paraphrasing.
11. **Two signal keys in v1, not a framework:** `tile-contradiction:*` and
    `audio-failure:device;build`. Everything else gets no key, no count, and is honest about it.
12. **The five escalation tests, as an explicit list**, and every escalation records which one
    fired and on what — `channel-ask.js`'s `evidence`, same reason.
13. Answers in the language she wrote in; where the honest answer is English-only, one Welsh line
    saying so, then the English.

**Tom's side**

14. One `POST /api/needs-you` per escalation, with the four-part body of §4 including the draft
    reply. **No new surface on the command surface at all** — needs-you already is his inbox.
15. `yes` sends the draft; a typed sentence replaces and sends it; `no` holds and tells her a
    person is looking.

**Notification to her**

16. Unread dot on Support; one email doorbell through `resendMail.ts` from
    `contact.saysomethingin.app` if the thread is unopened after a few hours.

That is the build. It would have taken Angharad's evening from *email, inbox, screenshot,
dispatch, fix, reply* down to *three taps, a true answer in seconds, and one word from Tom* — and
it would have surfaced the 103 classes at 19:40 instead of 23:00.

---

## 12. What I would not build

- **No ticket status, priority, or SLA.** §8's whole argument. A relationship does not close and a
  field that says it did is a lie the dashboard tells itself.
- **No thumbs-up "was this helpful?"** It measures politeness. Whether she came back is the real
  signal and it is free.
- **No support surface for Tom on the command surface.** `needs-you` inline in Watson is already
  the thing he asked for. A second inbox is a second place to not check.
- **No attachment or screenshot upload in v1.** The entire point of §2 is that she should not need
  one. Shipping the upload button first is shipping the old workflow with a new coat.
- **No machine-translated Tom.** §6. His voice is his.
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
- **No real-time presence, socket or typing indicator.** Polling on open and focus is
  indistinguishable at this volume.
- **No auto-close, no nudge-if-quiet, no satisfaction survey.** Silence from a school that is
  practising is the correct amount of contact.

---

## 13. Defaults taken, and gaps reported honestly

**Taste-safe defaults taken — each overturnable in one word:** it is called **Support**; the agent
answers in the language she wrote in, falling back to the school's dashboard language; Tom's
English reply goes through **verbatim and attributed**, with a Welsh rendering offered alongside
and never replacing; the agent appears as **SSi**, plainly a helpful system, never a named person
and never as Tom; v1 is the **schools dashboard only**; escalation goes by **`POST /api/needs-you`**.

**Decisions I made rather than handing back:** new tables rather than extending `tester_feedback`
(§9); the reply-in bearer wire as the only new boundary crossing (§0); population answers as
integers only (§7); one thread per school with no status (§8); two signal keys in v1 rather than a
framework (§11).

**Gaps, stated rather than papered over:**

- `cym.json` carries **1,417 of 2,401** keys; **275 of 750 `schools.*` strings are missing in
  Welsh**. Verified in this worktree today.
- **The Handbook prose is not localised at all** — no `handbook` key in either locale. The
  walkthroughs are: 18 localised in `eng.json`, **1 of 18 in `cym.json`**. So the answer corpus is
  English-only today, and §6 is built around admitting that rather than hiding it.
- The Handbook freshness gate **does not guarantee a sentence is true** — its fingerprint reads
  one `.vue` file, so a change inside an API route or a composable does not trip it. Hence
  quote-and-link rather than paraphrase.
- I did not verify any live database numbers myself. The Chepstow figures here — 34 classes, 174
  seconds of class practice against 6,271 staff, 103 classes estate-wide, the tile's preference at
  `NodeHomeView.vue`, the `20260718` migration naming Chepstow — are read from job #150's
  published diagnosis at `/d/3f81730b` and from `api/_utils/classPractice.ts`'s own header
  comment, which records the 2026-09-10 live verification. Job #164 owns her real numbers for
  tonight's reply and #159 owns the telemetry chain; nothing here re-derives either.
- **"Nine other schools" in the Case-1 and §4 reply text is illustrative**, consistent with 103
  classes across the estate. The real number is whatever the count returns.

**What genuinely needs Tom:** the register call on the name; whether his reply is ever rendered
into Welsh; and whether the learner side is the bigger prize than the schools side. Nothing else
in this document is waiting on him.
