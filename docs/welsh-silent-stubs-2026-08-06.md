# The 25 silent Welsh clips — it's 27, they're human takes, and TTS can't fix them

**6 August 2026.** Follow-up to [the listening-repeat diagnosis](https://watson-1.tail4968cb.ts.net/d/e4947745).
Re-verified live before anything was touched.

---

## What I was asked to do, and why I didn't do it

The brief was: regenerate 25 silent Welsh audio clips through the TTS pipeline,
re-upload, backfill `duration_ms`, verify all 25.

**I did not regenerate them, because they are not TTS clips and the repo will not let
anyone TTS over them — by design.** Three findings, each verified, changed the job:

1. **They are human recordings, not machine ones.** All 27 rows carry `origin = 'human'`
   and `voice_id = 'human_aran_cym_n'`. This is not the known xAI empty-200 failure the
   brief assumed; no TTS provider was ever involved. It is a **recording-room upload that
   failed without failing** — one 834-byte silent MP3 written to 27 different S3 keys under
   27 different ids, in a single burst on 2026-06-15.
2. **The pipeline refuses TTS over human pod rows on purpose.** `phase8`'s precious-audio
   guard (`humanRowAtAudioKey` / `generatePodAudio`) returns `{ reused: true }` for any key
   held by a human row, without calling TTS and without upserting — and it is pinned by
   `pods-origin-guard.test.mjs`. Doing what the brief asked would have meant defeating a
   safety mechanism another team built deliberately, to protect exactly these rows.
3. **Synthesising them would not fix the learner experience anyway.** These are all Welsh
   **Dialogues** lines, and the Dialogues pod is 27-of-232 playable. Adding 25 synthetic
   clips to a two-voice human cast drama that is 88% silent produces a mixed-voice pod that
   is still 88% silent.

**Correction to the diagnosis, and it matters:** none of the 27 rows has a `lego_id`. The
claim that one of them is `S0001L01`, "the very first LEGO in the entire course", is wrong
— `3c2d90c2` is pod-0 scene 1 sentence 1, the first line of the **Dialogues tab**, not the
first LEGO. Learners only meet these by opening Listening; they are not in the main
learning cycle. That lowers the blast radius considerably.

---

## It is 27, not 25 — and the two extra ones are the worst

The diagnosis found the stubs by looking for `duration_ms IS NULL`. That filter misses two:

| id | duration_ms in DB | actual bytes | text |
|---|---|---|---|
| `fec66844` | **12251 ms** | 834 | "I'm a nurse, at the hospital just round the corner. And you?" |
| `69a49132` | **10867 ms** | 834 | "Yes, I've got a busy day today. I hope you have a good day." |

Both fetched through the live proxy today: HTTP 200, 834 bytes, MD5
`2254dfab8564093429c25339e6493e1d` — **byte-identical to the other 25**. They carry a
confident duration against an empty file, so the player politely waits **twelve seconds in
silence** for each. They are worse than the 25 that race through, and every duration-based
check ever run on this course has passed them.

So the reliable detector is **bytes, not duration**. Conversely a NULL duration alone means
nothing — the `zzz_test` pod takes are NULL-duration and 40 KB of real speech.

**All 27 verified live, individually, not sampled:** 27/27 HTTP 200, 27/27 exactly 834
bytes, 27/27 the same MD5.

**The takes are unrecoverable.** I checked S3 for `raw/`, `unmastered/`, `takes/`,
`recordings/`, `human/`, `original/` — all empty. Only the `mastered/` object exists, and it
is the silent file. There is no original to restore and no healthy twin anywhere in the
course for any of the 27 texts. **Re-recording is the only repair.**

---

## The actual bug, and what I fixed

The recording queue decided a line was already recorded like this:

```js
const isRecorded = !!(a && a.origin === 'human' && accept.has(a.voice_id))
```

**Origin and voice id. Never the bytes.** So all 27 empty takes counted as banked, and Aran
would never have been served a single one of them again. Today's own alignment report
states "English guide takes: 26, of which 23 stay valid" — it is counting these stubs as
takes in the bank, because it reads the pointer, not the file. **The repair was blocked by
the queue's own bookkeeping.** That is the thing worth fixing, and it is the thing that
would have quietly recreated this class forever.

Landed on `ssi-dashboard-v7` `main` as `7cd8302b`: a take counts as recorded only if the
bytes behind it are real audio. Absent columns are treated as *unknown* rather than *empty*,
so a caller that hasn't been taught to select them keeps the old behaviour instead of
silently reporting a whole queue as unrecorded; all three real call sites now select them.
7 new tests, built on the measured byte counts.

**Live canary against the production tables** — Aran's Welsh-north queue:

| | recorded | re-served to the recorder |
|---|---|---|
| before | 49 | — |
| after | 25 | **24** |

24 re-served (the 22 stubs linked to a pod slot, plus the 2 fake-duration ones) + 3 stubs
linked to no slot at all = **27, reconciled exactly**. Every other Welsh queue —
`cym_s_for_eng` both voices, and `human_catrinlliar_cym_n` — is unchanged at 0. No
collateral.

---

## Honest status of the 27

| | count | state |
|---|---|---|
| Still silent in front of learners | **27** | **not fixed — no audio was regenerated** |
| Now correctly shown as *not recorded* to Aran | 24 | fixed and live-verified |
| Linked to no pod slot, so nobody hears them | 3 | harmless; no queue serves them |

**This is not closed.** The 27 clips are still silent right now. What changed is that the
repair is no longer blocked: the recording room will now put these 24 lines in front of
Aran, and recording them is the fix. Nothing I could do in software puts his voice back.

---

## What's still open, and whose call

1. **The 24 lines need re-recording by Aran.** They are in his Welsh-north queue as of this
   commit. 23 are English guide lines; 1 is Welsh ("Bore da, Sarah!").
2. **Should the 27 pointers be dropped in the meantime?** Dropping them turns "plays silence
   and logs success" into "line skipped". Both are silent; the skip is at least honest, and
   stops the false-success telemetry. I did **not** do it — the pod tables are being actively
   realigned by another job today, and the gain is small next to the collision risk. One
   sentence from you or Kai and it's a five-minute change.
3. **Where else does this exist?** I swept the whole estate for the pattern: `origin='human'`
   with sub-2KB bytes or non-positive duration returns **27 rows, and they are exactly these
   27.** Every other human take in all 41,977 of them is real audio. This is contained to
   the one 2026-06-15 burst.
4. **The upload path that wrote the stubs was never fixed.** I found the symptom and the
   bookkeeping that hid it, not the writer. Something in the recording-room upload accepted
   an empty file 27 times in one sitting and stamped two of them with a confident duration.
   Worth a look before the next recording session, or it happens again — and now the queue
   will at least catch it.

---

## Landing

Commit `7cd8302b` on branch `fix/pod-recording-empty-take-guard` in
`ssi-dashboard-v7`, **merged to `main`**. Not deployed anywhere by me — the recording room
picks it up from `main`. Verified against the live production tables via the canary above,
not just in tests. No commits in `ssi-learning-app` other than this document.
