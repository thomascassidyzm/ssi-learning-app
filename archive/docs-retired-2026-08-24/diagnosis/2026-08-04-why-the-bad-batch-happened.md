# Why the bad batch happened, and why nothing caught it

Follow-up to `2026-08-04-french-playback-regression.md`, answering the two
questions that matter for prevention: **what triggered it**, and **why it went
undetected**. Read-only investigation; nothing changed.

---

## Q1. What triggered it — it was NOT the reprocessing

The leading hypothesis was the xAI de-hiss / de-click reprocessing work. **The
data exonerates it.**

Stub rate (clips of exactly 144/168/192 ms) by day, across fra/deu/ita/spa, every
day with ≥500 clips rendered:

| date | stubs / clips | rate | note |
|---|---|---|---|
| 2026-01-17 | 151 / 1,322 | **11.42%** | bad |
| 2026-02-18 | 0 / 19,924 | 0.00% | Azure |
| 2026-06-17 | 0 / 22,457 | 0.00% | Azure |
| 2026-06-28 | 0 / 950 | 0.00% | **leo, clean** |
| 2026-07-11 | 192 / 28,149 | 0.68% | |
| **2026-07-15** | **226 / 8,849** | **2.55%** | bad — **14 days BEFORE de-hiss** |
| 2026-07-21 | 0 / 13,831 | 0.00% | |
| **2026-08-03** | **529 / 30,967** | **1.71%** | bad — the French batch |

The de-hiss commits are `df61179a` (2026-07-29) and `58a18d37` (2026-07-30).
**They sit between two bad days.** 2026-07-15 has the same defect, the same
144/168/192 ms fingerprint, the same voice, a fortnight before the change
existed. The defect does not need the reprocessing, and there is no sign the
reprocessing made it worse — 07-15 ran at 2.55%, 08-03 at 1.71%.

**"The leo voice is broken" is also wrong.** 2026-06-28 rendered 950 leo clips
with **zero** stubs.

### What actually correlates: sustained xAI batch volume

Within the 2026-08-03 French run, stubs per 5-minute bucket:

```
14:30   0.11%
15:00   0.43%
15:20   1.08%
15:45   2.40%   <-- target2/leo phase begins
15:55   5.26%  ##
16:35   4.51%  #
16:50   3.66%  #
17:00   0.00%   <-- run winds down
17:15   0.00%
```

The failure rate **climbs steadily through a long run and returns to zero when
the run tails off**. That is not a code path — a bug in the chain would fail at a
constant rate from the first clip. It is load-dependent degradation.

And it is **provider-specific**: Azure days of 19,924 and 22,457 clips are
spotless. Only xAI days degrade.

**Read:** on a long, high-volume xAI run the provider starts returning
empty-or-near-empty 200 responses, and the pipeline accepts them.

**Confidence: high on the correlation, moderate on the mechanism.** The
load/provider correlation is measured. That the empty response comes from
throttling specifically is inference — I have no xAI-side request logs, and that
is the one thing that would confirm or refute it. **Explicit gap.**

**How to avoid it next time:** cap sustained xAI batch size and/or throttle the
run rate, and — more importantly — validate the output (Q2), because you cannot
control a provider's behaviour but you can refuse its bad output.

## Q2. Why it wasn't detected — the pipeline launders an empty response into a valid file

Three failures stacked, and each one individually would have caught it.

**1. The TTS response is never size-checked.** `services/tts-service.cjs:318-324`
(dashboard repo):

```js
if (!response.ok) {
  throw new Error(`xAI TTS API error (${response.status}): ${errorText}`);
}
const arrayBuffer = await response.arrayBuffer();
return { audioBuffer: Buffer.from(arrayBuffer), wordBoundaries: null };
```

`response.ok` is the only gate. A 200 carrying an empty or near-empty body sails
through — no `byteLength` floor, no content check. The ElevenLabs path
(`:151-157`) has the identical shape.

**2. The mastering chain turns that into a plausible file.** The near-empty
buffer goes through denoise → compress → limit → anti-click fade, plus the
~100 ms silence pad, and comes out as a **well-formed, playable MP3**. The
durations are the tell: 144/168/192 ms are exactly **6, 7 and 8 MP3 frames** at
24 ms/frame — the encoder's minimum viable output, not a recording. Different
texts produce **byte-identical** files, because the content is pure silence and
the encoder is deterministic. The chain does not fail; it manufactures a valid
artefact from nothing.

**3. Every consistency check passes, because the DB is faithful to the file.**
`duration_ms` is computed from the produced file, so the row and the object agree
perfectly. A cross-table audit finds zero mismatches — I ran one, 1,556 legos
checked, 0 discrepancies. The corruption is *internally consistent*, which is why
normalisation and renormalisation checks never saw it: they compare
representations of the same wrong thing.

**And "0 failures" means no exception was thrown.** The de-hiss commit reports
"142,973 files, 0 failures". That is an honest statement about exceptions, not
about whether any file contains speech. Nothing in the pipeline has ever asked
"is there speech in this clip".

### The detection that should exist

Two checks, both essentially free, either of which catches 100% of these:

1. **Byte floor at the source** — reject a TTS response under a few KB before it
   enters the chain, and retry. Cheapest possible fix, one line, catches it
   before any spend on mastering.
2. **Post-batch output gate** — reject any clip under ~400 ms, or under half its
   paired `target1`. This is exactly what
   `scripts/audit-broken-target2.mjs` does; it runs across the whole estate in
   under two minutes from metadata alone, no audio download. It found every one
   of these instantly, months after the fact.

A third, stronger check if it's ever worth the cost: RMS/silence detection on the
output. `-91 dB mean` is unmissable. But the byte floor makes it unnecessary.

## On ownership

**There is nothing of Kai's to revert.** The de-hiss change is exonerated above,
and the fix for this is *additive* — a size check at the response boundary and a
gate after the batch. It doesn't touch the mastering chain, the denoise filter,
or anything in the de-hiss or de-click work. So the "stepping on each other"
risk doesn't arise for this particular fix.

Worth noting the de-click tool (`tools/declick-tail.cjs`) already has the right
instinct — a whisper-based "amputation guard" that refuses a trim which would cut
speech, and a `held` state that reports rather than acting. That is precisely the
pattern missing at the generation boundary. The discipline exists in the repo; it
just isn't applied where the clips are born.
