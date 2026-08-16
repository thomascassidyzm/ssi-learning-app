# Pod stage schedule — what is actually live, 2026-08-10

Two questions, both answered from the live database and the code path a real learner
traverses, not from the code comments — because the code comments turned out to be the
thing that was wrong.

## Short version

**Stage 0 is not being served. It has not been served since 14 July.** Nothing to remove.

**The lego-tile breakdown is not there either.** It shipped on 14 July as Stage 0's
replacement, and it was taken out again eight days later, on 22 July, and replaced by the
karaoke scrolling teleprompter that is on screen today.

So a learner in the main flow right now gets **no breakdown of a pod sentence at all** —
not as audio, not as tiles. They hear the sentence, its translation, the sentence, the
sentence; they read the dialogue scrolling past. The `atom_map` data that used to draw the
tiles is still loaded on every lap and rendered nowhere.

Both findings are **global**, not local to `beunollyn`. Evidence for that is in its own
section below.

---

## Question 1 — is Stage 0 still being scheduled and played?

**No.** It is unreachable by two independent locks, either of which alone would be enough.

**Lock one — the one-mode redesign (7 August) bypasses the stage ladder entirely.**
`usePodLapScheduler.nextLap()` computes a stage number, but then does this:

    const playlist = policy.useStagePlaylist ? stagePlaylistMap[stage] : singlePlaylist

`useStagePlaylist` comes from `listening.listeningUseStagePlaylist === true` on the
`algorithm_config` row. **I read that row live: the key is not present.** So it is `false`,
and every cohort at every age plays `singlePlaylist` — the one four-slot pattern
target · known · target · target. The stage number survives only as a badge and a telemetry
field. There is no learner-facing way to flip that escape hatch; it is an admin DB edit.

**Lock two — even through the escape hatch, there is no explainer in the live playlist.**
The live `pods` row in `algorithm_config` (last written by aran@hey.com, 30 June) overrides
the code defaults completely, and its stage 1 is:

    "1": ["ps", "trans", "ps", "ps"]

No `explainer` slot in any of its nine stages. The code default that *does* carry
`['ps','explainer','ps']` is overridden and dead.

**The separate Stage-0 ladder is also out of the main flow.** `stage0Sequence.ts` and its
loader `usePodStage0.ts` have exactly one non-test consumer, `PodStageAuditioner.vue` — the
admin auditioning page. `fusionDrill.ts` is still load-bearing, but only for Listening
Mode's opt-in Dialogues > Drill surface, never the main flow. The commit that did this is
`4f19da96`, 14 July, "kill Stage 0 in main-flow pods", a founders' decision by Tom and Aran.

**What a learner actually hears, therefore:** four plays per pod sentence — target,
translation, target, target — all at one speed, exposure-ramped and hard-capped at 1.0×.
Every sentence, every age, no ladder.

### Why the code read as if Stage 0 were still alive

Because three comments said so. `DEFAULT_STAGE_PLAYLIST` still describes stage 1 as
"Phase 0 … the explainer plays INSTEAD of the translation … heard exactly twice", which
reads exactly like the two bites at the breakdown you described — and which is precisely
what a search of the repo surfaces first. It is dead code with a live-sounding comment.
That has been fixed (see *What landed*).

---

## Question 2 — is the lego-tile breakdown present with every pod sentence?

**No — it is present with no pod sentence at all.** The history is short and it reverses
itself:

- **14 July, `4f19da96`** (Tom + Aran): Stage 0 retired; `PodTurnDisplay.vue` created as an
  always-visible LEGO-tile breakdown, one tile per `atom_map` entry with its gloss beneath,
  reusing the `LegoAssembly` engine. This is exactly the design you described this morning.
- **22 July, `28c147c9`** (authored by you): *"Replaces PodTurnDisplay's LEGO-tile whole-turn
  ladder with the same scrolling-line teleprompter pattern listening mode's Dialogues view
  already uses."* The tiles came out; the karaoke scroll went in.

Today's `PodTurnDisplay.vue` imports `TeleprompterScroll` and nothing else — no
`LegoAssembly`, no `atom_map` use. It renders the whole dialogue as scrolling lines, the
sounding sentence at full prominence with its known-language gloss, speaker chips on turn
starts. That is the entire pod visual.

`LegoAssembly` itself does render in the player, but never during a pod lap. Its guard is
`currentPhraseLegoBlocks.length > 0 && isPlaying`, and `isPlaying` is
`simplePlayer.isPlaying` — SimplePlayer is deliberately paused for the whole duration of a
pod lap while the pod audio plays separately. Its blocks are the speaking cycle's phrase
anyway, not the pod sentence, so even if it were visible it would be showing the wrong
content.

### The content-side constraint, if the tiles come back

The tiles need `atom_map`, and coverage is patchy. Live census of
`listening_pod_sentences`, all 10,881 rows:

| | count |
|---|---|
| sentences with an `atom_map` | 6,039 of 10,881 (56%) |
| pods where **every** sentence has one | 12 of 71 |
| pods with **zero** `atom_map` anywhere | 26 of 71 |

The zero-coverage list includes real shipped courses — `eng_for_spa`, `eng_for_deu`,
`eng_for_por`, `eng_for_kor`, `hin_for_eng`, `ell_for_eng`, `swe_for_eng`, `ukr_for_eng`,
`nep_for_eng`, both Welsh pods, and the Spanish `music` and `travel-situations` pods. The old
tile component had a graceful fallback — no `atom_map` means one plain tile holding the whole
sentence — so it would not break, but for those 26 pods a "breakdown" would be a single tile
showing the sentence you can already read. Bringing the tiles back is therefore two jobs, not
one: the display, and an upstream `atom_map` fill.

Separately: 2,158 sentences carry an `explainer_audio_id` — recorded explainer audio that
nothing in the main flow plays any more.

---

## Global or local? Your open question from earlier

**Both of today's findings are global.** `algorithm_config` is a flat key/row table —
`key`, `config`, `description`, `updated_at`, `updated_by`, `version`. There is no learner,
enrollment or course scoping column, so the `pods` and `listening` rows apply to every
learner on every branch. And the display side is code, identical for everyone. Nothing here
is specific to `beunollyn`.

Worth separating from the *other* global-or-local question in the same thread. Your
"I'm still getting the full first couple of scenes in Beuno's listening" symptom was
answered on dev this morning by the pod-cohort census (`90efaf64`) and it came out **local**
— the algorithm is correct and debuts one exchange per lap globally, but that account carried
an inflated `completed_pod_rounds` of 11 from the old regime, which was reset to 0. Two
different questions, two different answers: the intake volume was local, the missing
breakdown is global.

---

## What landed

One documentation commit on `dev`, `1e23d6be`. **No behaviour changed, because nothing needed
to change to answer the questions** — Stage 0 was already gone, and the fix for the missing
visualisation is a product decision, not a bug fix.

What it corrects, in the three places that asserted a breakdown no learner gets:

1. `usePodLapScheduler.ts` — `DEFAULT_STAGE_PLAYLIST` now carries a header stating it is dead
   on the learner path and naming both locks.
2. `usePodLapScheduler.ts` `nextLap()` and `LearningPlayer.vue`'s scheduler call site — both
   claimed the breakdown "now comes from the always-visible LEGO-tile display". Corrected to
   say the tiles were themselves replaced on 22 July and no breakdown exists.
3. `apml/learning/listening-layers.apml` — the 2026-07-14 tile design was still written as
   current. Added the 2026-07-22 entry that supersedes its tile half, keeps its Stage-0
   retirement half, and states plainly what a learner gets today.

Gates green in a clean worktree off `dev`: `@ssi/core` build, `player-vue` typecheck,
2,060 tests passing, lint 0 errors (150 pre-existing warnings). **No test was flipped** — no
test asserted the stale behaviour, because the one-mode tests
(`listeningOneMode.test.ts`) already lock the four-slot pattern as shipped and reach the
explainer only through the deliberate escape hatch.

## What failed

Nothing, and the gap is now closed. A live browser probe of the dev deployment watched three
consecutive pod laps end to end and confirms both answers by observation, not inference:

- **Question 1.** The real `player-events` telemetry for those laps shows only
  `pod_intro` → `ps` → `trans` → `ps` → `ps` per sentence → `pod_outro`. The role `explainer`
  does not appear once, in any lap.
- **Question 2.** A mid-lap DOM check found `PodTurnDisplay` mounted and `LegoAssembly`
  absent from the DOM entirely, in all three laps. The twelve screenshots show the karaoke
  scrolling dialogue and nothing else.

Evidence — screenshots, raw telemetry, DOM dump, console logs — is under
`docs/pod-lap-probe-2026-08-10/` in the repo, uncommitted.

The probe noted one residual doubt of its own: it observed a single course (Chinese for
English, guest, white belt), so it could not rule out a per-course config enabling the stage
ladder somewhere else. **That doubt does not survive the DB read.** The escape hatch is
`listeningUseStagePlaylist` on the ONE global `listening` row in `algorithm_config` — there
is no per-course or per-learner variant of that row, and the key is absent from it. It is off
for every course and every learner.

---

## What needs you

**One decision, and it is a reversal of your own call.**

The design you described this morning — Stage 0 retired, the breakdown done visually with
lego tiles alongside each pod sentence — is exactly what shipped on 14 July. You replaced the
tiles with the karaoke scroll on 22 July, in a commit whose reasoning was that dialogues are
linear so lines should scroll rather than cram onto one screen. That reasoning is still true.
Bringing the tiles back means either undoing it or finding a shape that holds both.

Three options:

**A. Leave it.** The teleprompter stays, there is no per-sentence breakdown, and the
"how this sentence breaks down" job is simply not done in pods. Cheapest, and honest about
the fact that the 22 July decision was made after the 14 July one and with more information.

**B. Tiles on the sounding line only.** The teleprompter keeps the whole dialogue scrolling,
but the one currently-sounding sentence renders its atoms as tiles instead of a plain line.
This is the version that satisfies both rulings — linear scroll for the dialogue, tile
breakdown for the sentence in play — and it is my recommendation if you want the breakdown
back. It needs the `atom_map` fill above for 26 of 71 pods to be worth anything there.

**C. Revert to tiles.** Back to the 14 July display wholesale. This re-creates the cramming
problem you fixed on 22 July, so I would not.

My read: **B, and only if you want the breakdown badly enough to also fund the `atom_map`
fill.** Otherwise A — because a tile row that says nothing more than the sentence already
says, on more than a third of pods, is worse than no tiles.

I did not build any of these. The 22 July decision is yours and reversing it silently would
have been wrong.

## Assumptions I relied on, flagged

- **"Stage 0" maps to the pre-Stage-1 breakdown pass in whatever form.** I checked both
  candidate readings — the `explainer` role inside scheduler stage 1, and the separate
  per-atom `stage0Sequence` ladder — and both are dead in the main flow, so the mapping
  question does not change the answer.
- **"Shows with each pod sentence" means every sentence, every encounter**, not just the
  first. Read that way throughout.
- **The belt-ramped speed curve on Stage-0 / fusion clips** flagged by an earlier job was
  left alone, as instructed. Removing Stage 0 did not make it dead — `fusionDrill` still
  serves the opt-in Drill surface — so there was nothing to remove.
- **No learner data was written.** The 86 inflated pod counters remain untouched per your
  ruling.
