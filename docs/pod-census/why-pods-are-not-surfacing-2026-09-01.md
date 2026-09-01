# Why the listening pods aren't surfacing — the answer, 2026-09-01

**Two different things, and only one of them is broken.**

## Online: nothing is broken, and your own boundaries prove it

The every-5-rounds pod cadence is firing. It is anchored to your **absolute
round number**, and the Layer-1 seed cup fires on **every** boundary. Checked
against your own `player_events` rows, not against a document:

| When | Course | Rounds you finished | Pod was due at |
|---|---|---|---|
| 31 Aug 22:10–22:44 | Spanish | 826, 827, 828, 829 | **830** |
| 1 Sep 09:26 | French | 211 | **215** |

Four Spanish boundaries in a row, and the fifth — the pod — is the one you
stopped before. Again. In French you crossed one boundary and it wasn't the
fifth. Every listening block you got in those sessions was the Layer-1 seed cup;
the French one at 09:26 says so in its own telemetry now (`isLayer1: true`, from
today's naming commit).

Other learners are getting real pods on the same build. A French learner got a
158-play pod lap at 19:58 tonight, right on his round-200 boundary, with 8-play
seed cups on the three boundaries before it. That is the healthy pattern.

There is a real consequence hiding in that, and it isn't a bug: **your rounds
run about ten minutes**, so one-in-five puts a pod roughly fifty minutes away,
and your session preference is fifteen. At your pace the pod is further away
than your whole session. That's a cadence question, not a defect, and it's
yours to call — not something to change under the cover of a fix.

## Offline: this one is a real defect, and it produces your symptom exactly

On a pod boundary the dialogue pod and the seed cup are **one segued lap**.
Offline, that lap was filtered down to whatever audio is on the device **as a
single unit**. The seed plays are ordinary course audio and are nearly always
cached. The pod's dialogue often isn't.

So the dialogue got trimmed away sentence by sentence, the seed cup survived
whole, and what played was a listening block that was **all seeds and no
dialogue** — which is your words for it. Worse: because the surviving block
played to the end, it counted as a completed pod lap, the ratchet moved on, and
a pod round you never heard was spent. Nothing anywhere recorded that the
dialogue had gone missing.

A second fault sat in the same function: pod sentence numbers and course seed
numbers both start at 1 and both travel in the same field, so pod sentence 211
and seed 211 were treated as one unit — a missing clip on either side deleted
the other.

### What changed

The download side already refuses to call a pod cached until every clip of it is
("the WHOLE pod first, not most of it"). That rule now applies at playback too:

- The pod is judged **on its own**, before the seed cup is segued on. A pod that
  is not wholly on the device **does not fire at all**.
- It **stays due** — the ratchet is untouched, so you get it once the audio is
  there.
- The **seed cup still runs** in its place, and the boundary is logged with
  `reason: 'offline_incomplete'`, so this silence can never be invisible again.
- Pod sentences and seed sentences are keyed apart.

Both faults are pinned by tests that were seen failing before they passed.

## The honest gap

I cannot prove this is what bit you on the plane. Offline sessions don't reach
the telemetry, so there is no row to point at — the flight is invisible by
construction. What I can say is that the code did exactly this, that it produces
your symptom word for word, and that it is now fixed. The online explanation
above fully accounts for the two sessions I *can* see.
