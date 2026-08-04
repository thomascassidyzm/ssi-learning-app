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

**The files are digital silence — confirmed by decoding, not inferred.**
`S0530L02` "pour que je puisse" target2, pulled from S3 and run through
`ffprobe` / `ffmpeg volumedetect`:

- DB says 144 ms; the file is actually **100 ms**
- **mean −91 dB, peak −91 dB — digital silence. There is no speech in it.**
- The paired target1 for the same phrase is a real 1.104 s recording
  (mean −17 dB, peak −1.9 dB)

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

The live `algorithm_config.normal_mode` sets `pause_reference: "avg"`, so
`ref = (t1 + t2) / 2` with `pause_assembly_threshold_ms: 750`,
`pause_assembly_lin: 3.5`, `pause_assembly_quad: 75`. Worked on a real cycle
from Tom's session (t1 1800 ms, t2 1584 ms):

- healthy: `ref` 1692 → over 942 → assembly ≈ **3,363 ms**
- with a 144 ms stub: `ref` 972 → over 222 → assembly ≈ **781 ms**

**The pause loses ~2.5 seconds on a longer phrase**, and collapses to pure boot
on a short one. One bad number, two downstream effects. (An earlier draft said
~1.2 s assuming `reference: 'sum'`; the live config is `avg`, and the real
magnitude is larger and phrase-length dependent.)

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

## 5a. A separate latent bug found on the way — real, but NOT what Tom heard

`backendCyclesToRounds.ts:203-207` deliberately bakes no `playbackSpeed`, on the
stated assumption that the runtime override reapplies the belt curve at play
time. **That assumption is false** — `getPlaybackSpeedMultiplier`
(`LearningPlayer.vue:9264-9266`) returns a hard `1.0` unless Turbo is on. It only
ever *cancels* a baked ramp; it never *applies* one. So cycles built on the
instant-playback boot path play flat 1.0× and, because speed doubles as the belt
proxy in `computePauseDuration` (`beltProgress(1) = Green`), also get the fully
tapered Green-belt pause.

**This is visible in Tom's telemetry — and it is not his symptom.** Measuring the
actual `playbackSpeed` on every French cycle against the designed ramp
(`0.95 globalSpeed × beltSpeed`):

| belt | expected | actual | cycles |
|---|---|---|---|
| White | 0.76 | **0.76** | 84 |
| Yellow/Orange | 0.9 | **0.9** | 2 |
| Green+ | 0.95 | **1.0** | 7 |
| Green+ | 0.95 | 0.95 | 1 |

The 86 cycles where the ramp *matters* were all correctly baked. The defect shows
up only on 7 green-belt cycles, where the error is 0.95 → 1.0 — **5%, inaudible**.
At White belt it would be a 32% error and unmissable, but White belt was baked
correctly, so the boot path did not serve those rounds.

So: a genuine latent bug worth its own ticket, but it did not cause this
incident. Logged here so the next reader does not re-find it and mistake it for
the root cause.

**A second latent gap, also not the cause:** `AudioCache.ts:249-276` stores
fetched bytes with no `Content-Length` check, no minimum-size floor and no
integrity check, and treats a 206 as success like a 200; on read, a truncated
MP3 typically decodes to a short-but-valid WAV rather than throwing, and the bad
blob is then memoised and never re-fetched. That is a real robustness hole worth
closing. **It is not what happened here**, and the test is one line of data: if
the client had truncated the bytes, `course_audio.duration_ms` would still read
~1,300 ms and only the local blob would be short. It reads **144 ms in the
database**, and the file fetched fresh through the production proxy — bypassing
every client cache — is the same 2,016-byte silent stub. The corruption is at
the source, upstream of any cache.

**A third latent gap, also not the cause:** `SimplePlayer.onAudioEnded`
(`:1281`) is the only advance path without a `playGeneration` guard, so a late
`ended` from a superseded clip could in principle advance the cycle. Unproven,
and not implicated here — logged for the ledger, not for this incident.

## 6. Explicit gaps

- **None on telemetry.** `player_events` was read in full via the service-role
  key in Tom's own environment (`~/.ssi-sentinel.env`), reads only. The public
  publishable key is refused (`42501 permission denied for table player_events`)
  as RLS intends — recorded here so the next agent does not conclude "no
  telemetry exists".
- **Not checked:** whether other learners on French report the same thing. Tom's
  session was the question asked; the defect is in shared data, so the blast
  radius is every French learner, but that is inference, not measurement.
- **Confirmed since first draft:** the stubs decode to digital silence (−91 dB),
  and there are **~75 broken `known`-role French clips** from the same batch —
  those produce a dead *prompt*, a louder failure than a dead second voice.
- **Alternative for symptom 4, not eliminated:** `isInfPlayActive` can
  false-classify a round and freeze `beltAnchorSeed` at `null`
  (`LearningPlayer.vue:3894-3927`); the `watch` guard then writes nothing and the
  belt holds its last value until an in-memory flag clears — which a force-kill
  does. The M9 regression suite (`beltPositionSync.test.ts`) never constructs a
  pure-`spaced_rep`/`use` round, so that path is untested. The stale-script-cache
  explanation in §3 is the one with telemetry behind it (no `script_revalidated`
  for French all session, `content_stamp` moved 18 min before); this one is
  code-plausible but unevidenced. Both can be true.
- **`voice_config` changed 2 hours before the bad batch** (fra
  `voice_config.updatedAt` = 2026-08-03 13:46, batch ran 15:45–16:56). Whether
  that change *caused* the failure is unestablished — Italian uses the same xAI
  "Leo" voice cleanly, so the voice alone is not sufficient.

## 7. Needs Tom

- Who owns re-running the French TTS batch, and should German ride along?
- Is `leo` staying as French target2? Its working clips are measurably faster
  than the house norm — that is your ear, not a metric.

---

*Tooling: `scripts/audit-broken-target2.mjs` (read-only) reproduces every number
above and generates the repair list.*
