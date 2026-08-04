# French playback regression — 2026-08-04

**Status:** diagnosed, nothing fixed. No writes were made to the live database.
**Reported by:** Tom, live, on his main learner account, ~10:50 UTC 2026-08-04.
**Verdict:** French-specific, and it is a **content defect, not a code regression**.

---

## 1. The verdict on the fork

**French-specific. Confidence: high — measured, not inferred.**

Tom happened to play five courses inside one twelve-minute window (10:37–10:49 UTC),
which handed us a controlled experiment for free: same device, same build, same
session, different courses.

| course | target2 clips shorter than 400 ms | share |
|---|---|---|
| **fra_for_eng** | **542** | **1.11%** |
| deu_for_eng | 908 | 1.92% |
| spa_for_eng | 2 | 0.00% |
| ita_for_eng | 3 | 0.01% |
| every other live course | 0–12 | ≤0.05% |

Restricted to French items that have both voices, **567 of 13,639 texts (4.2%)**
have a `target2` shorter than half its own `target1`. Spanish: **zero**.
Italian: **zero**.

It is not a cache effect and not a code regression. Tom's caching hypothesis was
the right instinct pointed at the wrong layer — see §4, where it does explain
symptom 4.

## 2. The cause

**On 2026-08-03 16:55–16:56 UTC the French course was re-TTS'd end to end, and
the `leo` target2 voice returned a fixed empty artifact for 567 items.**

The whole French audio set was regenerated that afternoon:

| created | role | voice | rows | broken (<400 ms) |
|---|---|---|---|---|
| 2026-08-03 | target2 | `xai_leo` | 13,641 | **468** |
| 2026-08-03 | known | `xai_eve` | 13,060 | 72 |
| 2026-08-03 | presentation | `xai_eve` | 2,163 | 0 |
| 2026-08-03 | target1 | `xai_eve` | 58 | 0 |

Every French `target2` row in the database now dates from that batch, and
**100% of the 567 broken items trace to it** (`voice=xai_leo`, 2026-08-03).

The broken clips are not merely short — they are **byte-identical stubs**. Four
different texts, fetched live through the production proxy:

```
une question  2016 bytes  md5 c3f3b0dd5bfdbc4758867c5de75d05f0
approche      2016 bytes  md5 c3f3b0dd5bfdbc4758867c5de75d05f0
parking       2016 bytes  md5 e18b9d9a58e01e3eba5ac5edc540629b
(S0001L05 t2) 2016 bytes  md5 e18b9d9a58e01e3eba5ac5edc540629b
```

Durations cluster on three values — 144 ms × 336, 168 ms × 86, 192 ms × 39 —
which is the signature of a generator returning a canned artifact, not speech.
`ce qu'il a dit` at 144 ms is physically impossible.

The rows look perfectly healthy to every consumer: real id, real `s3_key`, a
non-null `duration_ms`. Nothing downstream had any reason to complain.

**What would refute this:** the same stub durations appearing in Spanish or
Italian (they do not); or Tom reporting the clipping on a course whose audio
predates 2026-08-03. `deu_for_eng` carries the same defect from the same `leo`
voice on 2026-07-15 — so this is a **voice-level failure mode, not a
French-level one**. French is simply the course that was wholly regenerated
with it most recently and that Tom then played.

## 3. Why one defect produces three symptoms

The pause model sizes the gap off the **native clip durations**, not off what
was actually heard (`packages/core/src/script/computePauseDuration.ts`):

```
ref = reference==='avg' ? (t1+t2)/2 : reference==='target1' ? t1 : t1 + t2
```

So a `target2` recorded as 144 ms instead of ~1,300 ms drags `ref` down by
~1,200 ms, and the pause after that cycle collapses with it. One bad number,
two downstream effects.

| # | symptom | explanation |
|---|---|---|
| 1 | second voice clipped | **Explained.** The file *is* 144 ms. Not clipping — the clip is empty. ~5% of French items, spread across the whole course (3–7% in every 50-seed band), so roughly one dead second voice every twenty-odd cycles. "Quite often" is exactly right. |
| 2 | gap timing off | **Explained, same cause.** `computePauseDuration` reads `t1 + t2`; a 144 ms `t2` shortens that cycle's following pause by ~1.2 s. |
| 3 | voices sound fast | **Explained.** French `target2`/`target1` duration ratio is **0.92** — the new `leo` voice is 8% faster than the `eve` target1 it is paired with. Spanish is **1.05** and Italian **1.27**, i.e. their second voice is *slower*, as intended. French's second voice is 15–35 points faster than the house norm. Playback *rate* is innocent: telemetry shows 0.76 on White belt, which is exactly the designed ramp (`beltSpeed` 0.8 × the course's 0.95 `globalSpeed`, `toSimpleRounds.ts:74`). Nothing plays fast — the new voice *speaks* fast. |
| 4 | belt nav not moving; restart partly fixed it | **Explained, different cause — and it is Tom's cache hypothesis.** The French `content_stamp` moved to **10:19:19 UTC, eighteen minutes before his session**. That is the script-cache invalidation key. Telemetry shows a `script_revalidated` for Italian (`from 2026-07-29 → to 2026-08-03`, 6,859 ms to rebuild 3,964 rounds) but **no such event for French** in the whole session — French was still running a script cached against pre-regeneration audio. A restart forces revalidation, which is why it "moves a bit" afterwards. |

Telemetry also shows **11 `cold_start` events in twelve minutes**, corroborating
the restart-thrash Tom described.

## 4. Environment — correcting a stated assumption

The brief assumed production. **Telemetry says otherwise: `client_version`
`0455f62` on every one of the 227 events — that is `origin/staging` HEAD
(`promote dev → staging: /znotes live-copy pass`, 2026-08-03 12:38 UTC).**
Device `mobile`, iPhone, iOS 18.7, Safari 26.5.2.

So **Tom was on `staging.saysomethingin.app`, not production.** This does not
change the diagnosis — the defect is in shared course data, which staging and
production read from the same database, so **production learners hitting French
are hearing exactly the same thing.** It does mean no recent deploy is implicated:
the staging build predates the audio regeneration by a day, and the timing
commits under suspicion in the brief (`17d82439` VAD re-arm, `351214e8` M9 belt
position) are exonerated — the anomaly appears in data created after that build
shipped, on a build that has not changed since.

## 5. Recommended fix — NOT APPLIED

Diagnose-only, per the brief. This is a data repair, not a code change, so there
is no diff to offer. In priority order:

1. **Re-run TTS for the 567 broken French `target2` items** (and the 72 `known`
   items from the same batch). `scripts/audit-broken-target2.mjs fra_for_eng`
   emits the exact list. This is Popty's Phase 8 territory, not this repo's.
2. **Do the same for `deu_for_eng`** — 908 items, same `leo` failure mode from
   2026-07-15, same silent breakage sitting in a beta course today.
3. **Add a floor gate to the audio-generation pipeline**: reject and retry any
   clip under ~400 ms, or under half its paired `target1`. The whole reason this
   reached a learner is that a stub is indistinguishable from a good row
   downstream. This is the durable fix; 1 and 2 are the cleanup.
4. **Consider whether `leo` should stay the French target2 voice at all** — even
   its *working* clips run 8% shorter than target1, against a house norm of
   +5% to +27%. That is a taste call, not a bug.

Symptom 4 needs no fix: it was a one-off stale script cache against a
`content_stamp` that moved mid-session, and it self-healed on restart. Worth
noting only if it recurs when content has *not* just changed.

## 6. Explicit gaps

- **None on telemetry.** `player_events` was read in full via the service-role
  key in Tom's own environment (`~/.ssi-sentinel.env`), reads only. The public
  publishable key is refused (`42501 permission denied for table player_events`)
  as RLS intends — recorded here so the next agent does not conclude "no
  telemetry exists".
- **Not checked:** whether other learners on French report the same thing. Tom's
  session was the question asked; the defect is in shared data, so the blast
  radius is every French learner, but that is inference, not measurement.
- **Not checked:** the 72 broken `known`-role French clips from the same batch.
  They will produce a dead *prompt*, which is a louder failure than a dead second
  voice. Worth a look.
- **Not decoded:** the stub MP3s were confirmed byte-identical and 2,016 bytes,
  but not decoded to prove they are pure silence rather than a fragment. The
  byte-identity across unrelated texts already settles that they are not speech.

## 7. Needs Tom

- Who owns re-running the French TTS batch, and should German ride along?
- Is `leo` staying as French target2? Its working clips are measurably faster
  than the house norm — that is your ear, not a metric.

---

*Tooling: `scripts/audit-broken-target2.mjs` (read-only) reproduces every number
above and generates the repair list.*
