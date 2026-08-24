# The unrecorded Welsh pods are off live

**6 August 2026.** Acted on Tom's flag: *"Welsh pods should not be live yet — Aran
and Catrin have yet to record them."*

---

## What was exposed

Both Welsh courses were `new_app_status = live`, and their Dialogues pods were
essentially unrecorded. Dialogues is the **default tab** of the listening
overlay, so it is the first thing a Welsh learner meets when they tap listening.

| Course | Pod sentences | With a target take | Scenes fully silent |
|---|---|---|---|
| `cym_n_for_eng` | 232 | 26 (11%) | 12 of 22 |
| `cym_s_for_eng` | 232 | **0** | 22 of 22 |

Worse than a gap: of `cym_n`'s handful of takes, 25 are the *same* empty
834-byte file uploaded under 25 names, so they finish instantly and the pod logs
itself a success. One of them is *"Bore da, Sarah!"* — the first line of the
course. A learner played it twice inside one second on **2026-08-05**.

**I checked the whole estate, not just the rows already known.** Every pod for
every course was measured. Welsh is the only live exposure:

- `deu_at_for_eng` and `fin_for_eng` also have 0-of-142 recorded — both are
  already `not_available`, so no learner can reach them.
- `spa_for_eng` has two entirely unrecorded pods (`music`, `travel-situations`)
  which are unreachable because they aren't on the `pod-0` slug. That turned out
  to be the mechanism worth reusing.
- Every other live course is 139–142 of 142.

**The main Welsh courses are fine and stay live.** Both carry a full ~6,400
target1 / target2 / known clips against ~640 LEGOs and ~5,000 practice phrases.
Aran and Catrin's *course* recordings are done; it is the *pods* that are not.

## What was done

No new flag was invented. Every learner-facing pod path queries the **exact** id
`<course>:pod-0` — the Dialogues list, the offline download, the in-session pod
lap, and Phase 7 pod injection. A pod parked on any other slug is invisible to
learners, which is exactly how the two unrecorded Spanish pods already sit
unreachable.

So the 464 Welsh sentences were re-parented onto `<course>:pod-0-unrecorded`,
and the original `pod-0` row was left in place, childless, as the placeholder
that now reads as "no pods yet".

**Nothing was deleted.** Every sentence, its text and its takes are intact.

Because dev, staging and production share one Supabase, **this took effect for
every learner immediately — no deploy, no promotion needed.**

Alongside it, one small player fix: when a live read reports a course has no
pods, the stale offline pod snapshot is now dropped from IndexedDB
(`clearCachedListeningPodRows`). Without it, a learner who had already
downloaded the Welsh pod would keep replaying the withdrawn copy offline. It is
keyed on "the server says zero", not on a Welsh allow-list, so it needs no
maintenance and reverses itself when the recordings land.

## Verified

Replayed as the **anon** role — what a learner's browser actually is:

| Check | Result |
|---|---|
| `cym_n_for_eng:pod-0` | 0 rows → *"No pods for this course yet."* |
| `cym_s_for_eng:pod-0` | 0 rows → same |
| Phase 7 in-session pod lap, both | `hasPods = false` → skipped |
| `fra` / `heb` / `spa` control | 142 of 142, unchanged |
| Main Welsh course | still `live`, 635/679 LEGOs, ~20k clips, untouched |
| Content preserved | 232 + 232 sentences safe under `pod-0-unrecorded` |

Player loops green: `@ssi/core` build, `vue-tsc` clean, **1603 tests pass**
(one added, covering the offline-snapshot drop), lint 0 errors / 147 warnings —
the documented baseline, unchanged.

**Aran and Catrin are not blocked.** This was the real hazard, and it was
checked rather than assumed: `pods-registration.cjs:164` rejects an upload whose
`podId` doesn't match the sentence's `pod_id`. But `pods-router.cjs` resolves
pods dynamically per course and derives each item's `podId` from the sentence
row itself, so the gate still passes. Verified live: **all 232 sentences per
course remain in the recording plan** (206 north / 232 south still needing a
take) and will register on upload. The `PodStageAuditioner` preview also still
works — it matches on sentence `id`, which was not changed.

## Re-enabling, when the recordings land

```bash
cd ssi-dashboard-v7-clean
RESTORE=1 DRY_RUN=0 node tools/content-gating/gate-welsh-pods.mjs
node tools/content-gating/verify-gate.mjs
```

Do it **per course** — north and south will finish at different times, so edit
`COURSES` in the script to un-gate one at a time. Clients pick it up on their
next pod read.

## Remaining exposure and follow-ups

1. **The 25 silent stub clips still exist** in `cym_n`'s course_audio and are
   *not* pod-only — one sits on `S0001L01`, the first LEGO of the course, which
   is the main flow, not the pod. **Gating the pods does not fix that**, and it
   is still in front of every Welsh-north learner from their first minute. It
   needs regenerating (the xAI empty-200 class). Do **not** "fix" it by
   backfilling `duration_ms` — that would only make the player sit politely
   through the silence instead of racing through it.
2. **Offline holdouts.** A learner already offline with a downloaded Welsh pod
   keeps it until they are next online, when the snapshot is dropped. Unavoidable
   without a deploy they cannot receive; the population is small, since there was
   almost nothing audible to download.
3. **The player-side change is on `dev` only** and has not been promoted. The
   gate itself does not depend on it — the DB change already protects production.
   The player change only closes the offline-snapshot hole, and rides the normal
   dev → staging → main train at Tom's call.
4. **Listening still emits no audio telemetry**, so a silent pod leaves no trace.
   That is why this needed detective work rather than a dashboard glance, and it
   is why nobody was alerted for seven weeks.
