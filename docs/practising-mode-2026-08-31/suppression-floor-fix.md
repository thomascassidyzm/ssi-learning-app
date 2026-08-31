# The blocker is closed: a recycled round can no longer move a learner backwards

**Landed on `dev` — commit `fbea498b`. Nothing promoted. `staging` and `main` untouched.**
Read-only on learner data throughout: no learner row was written, read or repaired.

---

## What could have happened to a learner (on dev, tonight)

You are twelve rounds into German. Your connection is poor but working.

The app runs out of new material to play, so it does the right thing and starts
recycling what is already on your phone — phrases you have already done, drawn
at random from anywhere in your history. That part is by design and it is fine.

What was not fine: **as each of those recycled rounds played, the app wrote down
where you were — and what it wrote was the old phrase's position, not yours.**
Your saved place slid backwards, to somewhere you passed weeks ago. Nothing on
screen would have shown it. The next time you opened the app, that is where you
would have started, and it would have stayed that way on every boot after.

The safety net that should have caught this could not: it only checks that the
*round number* is going forwards, and the recycled rounds are added at the end of
the queue, so their numbers are the highest in the session. Forwards by number,
backwards by content.

And it did not need a dead connection to happen. It happened most easily in
exactly the case this whole night's work was about — a **slow but working**
connection, which times out and is reported as "didn't ask", not "failed". Same
for any course that isn't on the fast-start path. And even where the protection
did engage, a recovery check that runs once a minute could switch it off
mid-recycled-round and let that round's write land.

## What now cannot happen

**No progress is written from material the learner has already done. Full stop.**

Two independent conditions now hold that line, and either one on its own is
enough:

1. **PRACTISING** — Tom's ruled trigger, unchanged and untouched: keep playing as
   normal whether the network is good or bad, until the next NEW LEGO cannot be
   fetched; at that point, practising mode.
2. **The floor underneath it** — if a recycled round is what is playing, nothing
   about the learner's position is written down, whatever the mode says.

The rounds the offline recycler deals now carry a stamp saying so, and every
write refuses a stamped round on sight. So it is not "the check was right this
time" — a recycled round cannot write a cursor by construction.

## Three other things fixed in the same pass

- **Our outage no longer costs a learner their progress.** An expired login
  (401/403), our rate limit (429) or our server falling over (5xx) used to freeze
  a paying learner's saved position for the rest of the session, with no retry and
  no way to force a re-check — and an auth wobble would have done it to everyone
  at once. Those are now recognised as *our* problem, not the learner's
  connection: the mode is left alone and the next check simply tries again.
- **A comment that was flatly wrong** — it claimed the app falls back to the
  cached copy first, so a failure meant "unreachable from network and cache". That
  cache is empty by definition for a LEGO the learner has never reached. Corrected
  everywhere it appeared, so the next agent isn't misled by it.
- **The test that asserted the opposite of the ruling, and passed.** It claimed
  the "what the learner heard" telemetry was blocked during practising. The real
  code deliberately keeps it flowing — **usage yes, progress no** — so the test
  protected nothing and would have pushed the next agent into re-breaking the
  ruling. Rewritten to the ruling, with regression tests for every hole above.

## And one thing that was over-blocking, now narrowed

The old flag went up when recycled rounds were **added to the queue**, not when
they were **played**. A top-up in the middle of a real round therefore threw away
that round's remaining position writes — real forward work, silently unrecorded.
The floor reads the round on the playhead, so that is gone in the same change.

## Honesty

- The floor closes the backwards-write path I was sent to close, and I checked
  every writer of the cursor rather than trusting the report: the round-advance
  write, the explicit cursor write, the ceiling ratchet, the round-completion
  write, the throttled per-cycle write and the local snapshot are all behind the
  same predicate now. The only other cursor writer is the boot-time long-absence
  belt regression, which runs off freshly generated course rounds, never recycled
  ones.
- **I could not verify this against live learner data**, and did not try — no
  learner row was touched, by standing rule. Whether any dev-alias session already
  wrote a backwards cursor is a database question I did not answer.
- Two things named in the review were deliberately left alone, as briefed: the
  three writes that fire during the mode (speaking opportunities, session
  checkpoint, pod ratchet) are correct under usage-yes/progress-no and none of
  them touches the cursor; and the unlocked read-modify-write that can zero a
  session's minutes is real, pre-existing, and wants an atomic increment — it is
  separate work and is not in this commit.

## Gates

| Gate | Result |
|---|---|
| `player-vue typecheck` | clean |
| `player-vue test` | **2726 passed**, 3 skipped, 3 todo — 262 files |
| `player-vue lint` | **0 errors**, 159 warnings (all pre-existing) |
| `typecheck:api` | clean |
| `test:api` | **1487 passed**, 5 skipped, 8 todo — 132 files |
