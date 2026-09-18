# Only the Basque is spoken — mintonman's second report, and what was actually happening (job #149)

Traced from the learner seat backwards on 2026-09-18, against the live database, one Basque
learner's telemetry, and the code on `dev`. Learners are named by the first eight characters of a
learner id, as evidence, not as identity.

## The answer in one paragraph a forum reply could be written from

Deep into a course, a chunk the learner has long since mastered stops coming back as a short phrase
and comes back as the whole original sentence instead — played four times over, to be listened to
rather than produced: the Basque, then the English, then the Basque twice more. There is no gap to
speak into, which is why the four-state bar is correctly absent. But all four of those plays carry
the same sentence, on both sides of the screen, because all four ARE the same sentence — and a
safeguard in the player that strips out a prompt repeated back to back could not tell the difference.
It threw three of the four plays away, and the English one was among them. So what mintonman met was
the wreckage of that review: one lone Basque clip under an English sentence, no bar, the Basque words
starting to deal themselves out and then snatched off the screen because there was nothing left in
the cycle to hold them there. It was not a Basque audio problem — every one of the Basque course's
668 sentences has its English recording sitting in the database, and the player was discarding it.
The review now plays whole, all four clips in order, each one holding its words on screen long enough
to read.

## What the diagnosis rested on

**The item.** The screenshot's hero card reads "But I'm a little tired this morning." That is
`eus_for_eng` **seed 39**, `S0039` — a SEED, not a practice phrase, which is itself the first tell:
the whole parent sentence on screen means a seed-phase review. Its Basque is "Baina gaur goizean
pixka bat nekatuta nago." All three of its clips exist, are linked, and are sound:

| role | duration | text |
|---|---|---|
| known | 2,520 ms | but i'm a little tired this morning |
| target1 | 3,696 ms | baina gaur goizean pixka bat nekatuta nago |
| target2 | 3,696 ms | baina gaur goizean pixka bat nekatuta nago |

Seed 39's two LEGOs (`goizean`, `nekatuta`) have no audio — that is the "39(2)" in job #644's list —
but a seed review does not play LEGOs, so it is not the cause here.

**The learner seat.** Basque learner `c7455b18`, a real thread, 09-16 12:55:

```
12:55:01.080  audio_play  S0073L02_spaced_rep_5154  known     <- an ordinary review: 3 clips
12:55:16.129  audio_play  S0073L02_spaced_rep_5154  target1
12:55:20.417  audio_play  S0073L02_spaced_rep_5154  target2
12:55:25.270  audio_play  S0039L01_seed_rep_5155    target1   <- the seed review: ONE clip
12:55:29.914  audio_play  S0007L03_seed_rep_5159    target1   <- and the next one, also ONE
12:55:34.117  audio_play  S0098L01_use_5163         known
```

Two things to read there. The seed review sounded exactly once, at role `target1` — Basque, with the
English sentence on screen and never spoken. And the cycle counter steps from `_5155` to `_5159`:
**four** cycle ids were minted for that review and three of them never sounded.

Course-wide, across thirty days and ten courses, there are **311 seed-review plays and not one of
them is the English clip.** Every drained seed review on every course was arriving as a single clip.

## The mechanism

At spaced-rep offset >= 144 a review stops drawing a use-phrase and emits the whole parent sentence
as a four-slot comprehensible-input sandwich — target, known, target, target, all at 1x (Tom + Aran,
2026-07-14, `emitSeedSandwich`). Each slot carries exactly one audio track, and the seed's known and
target text on both sides, because each slot displays the sentence.

Two passes in `generateLearningScript` then read those four slots as one prompt repeated four times:

1. **The consecutive-duplicate removal.** It exempts intros, debuts, listening cups, component
   intros, pods and bookends — everything whose repetition is deliberate. It had never heard of the
   sandwich, so slots 2, 3 and 4 were dropped outright. Slot 2 is the English clip.
2. **The A-64 cap** ("no mode should ever repeat the same prompt more than twice consecutively",
   Tom, 2026-08-06) would then have re-interleaved whatever survived, pulling other reviews in
   between the slots.

What survived was slot 1: a single Basque play.

Three further details of the shape mintonman describes fall straight out of that:

- **No four-state bar.** `showPhaseStrip` requires a non-zero pause, and a sandwich slot has
  `pauseDuration: 0` because there is no mic stage. That is correct and stays — a four-state bar on a
  cycle that asks for nothing would be a lie.
- **Words dealing out and vanishing.** A sandwich slot carries no second voice, so the VOICE_2 phase
  ends in the same frame it begins. VOICE_2 is precisely where `LegoAssembly` starts dealing the
  target tiles, 250 ms plus 150 ms per extra tile. The words began to appear and were gone.
- **"Then the app moves on."** With one clip instead of four and no hold after it, the review is over
  in under four seconds.

## Was job #644 right to call it by design?

No, and this is the finding. #644's item "mintonman (3)" recorded the same shape, identified the
sandwich correctly, and concluded "By design; it has no framing clip. No change. Flagged for a
product call." That reading took the shape on screen for the design. It was the design with three
quarters of it missing — and, crucially, with the half that makes it comprehensible input (the
English) missing. A second report of the same shape from the same learner is exactly the evidence
that a learner cannot tell it from a glitch, and it is what sent this one back down to the telemetry.

## The fix

The A-64 law is about the same PROMPT repeating. The sandwich has no prompt: no mic pause, no
production ask, and its repetition is the point. It therefore sits outside the law exactly as a
listening cup and a pod play already do. Its slots are now exempt from the duplicate pass, and each
carries its own identity through the cap, so all four survive, contiguous and in `t-k-t-t` order.
Each slot also gains a 1.6 s hold, long enough to finish dealing the tiles of a long sentence and
read them.

Proven by `packages/player-vue/src/providers/seedSandwichSurvives.test.ts`: three tests that are red
on the pre-fix generator — the sandwich arrives as 1 slot of 4 — and green after.

## Defect versus gap

- **Defect, fixed:** three of four clips discarded, including the English one. Every course, every
  learner past round ~145, since the sandwich shipped.
- **Defect, fixed:** the tiles dealt and snatched away.
- **Correct, unchanged:** the absent four-state bar. It reads as a glitch only because the cycle had
  been stripped to one silent-looking play. With four clips and held text it reads as the listening
  review it is. If it still reads oddly to learners once this is live, framing it with a spoken line
  is a product call, not a code one.
- **Gap, not touched, from #644 and still true:** `eus_for_eng` has 178 LEGOs and 1,958 practice
  phrases with no audio ids at all. That is a content gap for Popty, unrelated to this report; the
  seed sentences themselves are complete.

## Two paths, and only one of them was broken

There are two live script builders, and they do not agree about what a drained seed review is.

- **The bundle path** (`@ssi/core`'s `generateScript`, the instant-playback default): its seed review
  is `buildSeedReviewCycle` — an ordinary three-clip production cycle, English then a mic gap then
  the two target voices, with a phase strip. Cycle ids end `_seedrep`. It has never built the
  sandwich at all.
- **The whole-course walk** (`player-vue`'s `generateLearningScript`, the fallback, and what
  mintonman's own cycle ids name): the four-slot sandwich. Cycle ids look like
  `S0039L02_seed_rep_5185`.

Thirty days of telemetry, seed reviews only:

| path | plays | learners | of which the English clip |
|---|---|---|---|
| bundle (`_seedrep`) | 276 | 8 | 105 |
| walk (`_seed_rep_`) | 311 | 9 | **0** |

The walk is the broken one, and it is the one mintonman is on. That split is worth a decision of its
own, separate from this fix: **the drained sandwich that Tom and Aran designed only exists on the
path that is being retired.** On the path that is becoming the default, a seed review at offset 144
is an ordinary exercise asking the learner to produce a whole sentence they last met 144 rounds ago
— which is not what "drained" was supposed to mean. Which of the two is the intent is a product call.

## Which other items share the shape

Not a list of Basque rows. This was never Basque-specific and never about missing audio: it is
**every drained seed review in every course**, i.e. every spaced-rep review at offset 144 or beyond,
for every learner deep enough to meet one. The thirty-day telemetry names ten courses —
`eus_for_eng`, `cym_n_for_eng`, `kor_for_eng`, `por_br_for_eng`, `ita_for_eng`, `fra_for_eng`,
`ukr_for_eng`, `swe_for_eng`, `lav_for_eng`, `ron_for_eng` — and the single English clip missing from
all 311 plays.
