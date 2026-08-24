# What learners have not found yet

The honest answer to "what have we got in there that isn't being used?"

**The headline.** Personalised pacing — the microphone thing — is on for **1 active
learner out of 36**. Across the entire database only two real learners have ever
produced a single microphone-derived row. Meanwhile the learner's own page, the one
place in the app that would show them their own progress and plan, is **built,
finished and linked from nowhere**: no learner can reach it without typing the URL.
And the engine that would do the noticing and the offering — rules, walkthroughs,
the pulsing dot — is already built and working, but every one of its rules is
pointed at teachers and school admins. Not one is pointed at a learner.

**Read the percentages with care.** Only **36** learners clear a fair bar of real
use — non-demo, non-staff, two hours of play or more, active in the last 90 days.
So one learner is three per cent. The ranking below is about *shape*, not precision.

---

## The ranked list

Ordered by how much it would be worth if learners used it, against how little they
actually do.

| # | Feature | Who has it | The call |
|---|---|---|---|
| 1 | **Personalised pacing (microphone)** | **1 of 36** | Highest value, lowest use. It is the only thing that fits the gap to the actual person rather than to an average. Push it hardest. |
| 2 | **Their own page — progress, plan, how they're doing** | **0, by construction** | Built and unreachable. The single cheapest big win in the app: it needs a link, not a build. |
| 3 | **Offline downloads** | **5 of 36 started; 0 observed finishing** | High value for schools, commutes and bad signal, and we sell it. Something is also wrong: the "download finished" event exists in the code and has never fired once. |
| 4 | **Listening mode** | **11 chose a mode, 4 ever actually listened** | Real methodology value and the drop from choosing to doing is steep. Worth a nudge and a look at why it stalls. |
| 5 | **The How-this-works library itself** | can't tell — see gaps | Not a feature so much as the vehicle for all of the above. Six walkthroughs exist for learners; none of them covers pacing, the microphone, offline, listening or their own page. |
| 6 | **Pronunciation practice** | **unreachable by anyone** | Record yourself, compare with a native. Fully coded, and no switch anywhere in the app can turn it on. Decide: wire it up or delete it. |
| 7 | **Playback speed** | **28 of 36 change it** | Already adopted — the most-used optional control we have. Leave it alone. Odd footnote: the Settings row for it is visible to testers only, so they are changing it somewhere else. |
| 8 | **Switching courses** | **31 of 36 play two or more** | Thoroughly found. Exactly the "basic stuff" not worth surfacing. |
| 9 | **Redeem a code** | **11 of 36** | Working as intended. |
| 10 | **Turbo** | **8 tried it, nobody anywhere kept it on** | Already retired, and the numbers say that was right. |
| 11 | **QA mode, script view, debug tools, the methodology pages** | admin-only | Not learner features. Nothing to surface. |

**The one that isn't on the list, and matters most.** The adaptation engine reaches
**22 of 36** without any microphone at all — it runs on behaviour. So the pacing
*brain* is broadly live; it is only the microphone *input* that nobody has switched
on. Turning the mic on is an upgrade to something already working, not a switch from
off to on, and that is a far easier thing to offer someone.

---

## Two things worth correcting

**Personalised pacing is not admin-only.** It carries no role gate at all — every
signed-in learner has always been able to see that row. The problem is not who can
see it. It is that it is one row among 38 on a screen nobody browses for pleasure,
and it asks for a microphone with nothing in return that the learner can feel.

**The noticing machinery is finished.** There is a rules engine that reads the data a
page has already fetched, costs no extra queries, offers at most three things at a
time and forgets a refusal for a fortnight. There is a walkthrough engine that walks
someone round their own real page. There is the quiet pulsing dot that stops once
opened and re-arms when something new appears. All built, all tested, all live — and
all eight of its rules are about classes, schools and organisations. Pointing it at
learners is writing rules and walks, not building an engine.

---

## What we simply cannot measure

Most learner switches live on the device and never reach the database. Where a number
is missing below, it is missing honestly.

- **Whether someone turned the microphone on.** We can only see a consequence — a row
  that only appears once the microphone has produced something usable. Someone who
  agreed and never got a clean reading is invisible; someone who agreed and later
  changed their mind still looks like a yes forever.
- **Whether anyone opens the How-this-works panel.** Its "seen" state is on the device
  only. So the six learner walkthroughs might be well used or never touched, and we
  have no way to tell.
- **Whether anyone installed the app to their home screen.** Nothing records an
  install. We only record refusals, and only on the device.
- **Script view, pronunciation mode, listening mode being switched on** (as opposed to
  actually played), and **speed as a decision** rather than as a side effect.

**One change buys nearly all of it.** A single event recorded whenever any switch is
saved — just which switch, and what it was set to. No new table, no migration, one
event type rather than ten. That would make the microphone, script view,
pronunciation, listening mode and speed all measurable at once.

Two smaller ones worth having: record the home-screen install when the browser tells
us it happened, and find out why the "offline download finished" event has never once
fired despite existing in the code.

And one trap to know about: this database is dominated by demo learners. Session
completions look healthy at 170 learners until you exclude demo accounts, at which
point they reach exactly one real learner. Any query on this data that does not
exclude demo accounts is measuring the demo generator.

---

## Method

**Active learner** means: a real learner row — not demo, not a class placeholder, not
SSi staff or a tester — with at least two hours of recorded play and a session in the
last 90 days. That is **36 people**. Loosening the bar to 30 minutes gives 50;
dropping the time bar entirely gives 123. Demo accounts were excluded on the
generator's own flag, which is clean and decisive: of the 271 learners with any
microphone-derived data, 269 are demo.

Two of the 36 are content-team accounts using the player for real, which you could
argue either way. Every figure was recomputed without them and nothing moved by more
than two learners.

The numbers come from a live read of production on 19 August 2026, with a sanity gate
confirming full-access credentials, and identity columns verified by sampling rather
than assumed. Nothing was written. No code was changed.

*One thing to push back on if you want to: the two-hour bar. It is the reason the
population is 36 rather than 123, and it is my choice, not a fact.*
