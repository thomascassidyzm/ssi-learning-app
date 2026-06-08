# The Buffer — one system, two tiers

> First principles, 2026-06-01. Replaces the earlier Fibonacci-chunking /
> SW-as-audio-server design, which added cleverness that wasn't load-bearing and
> put the network back in the play path. Rebuild from `main`, not from the
> scrapped rework.

## Scope: this is about SUPPLY, not lock

This document is about **supply** — making the right audio available to the
player at the right moment, so playback is *instant* to start and *permanent*
through weak signal, backgrounding, and deliberate offline.

It is **not** about holding the iOS locked-screen audio session alive. That is a
separate, already-solved problem and the two must never be conflated (doing so is
how the last rework broke). See **Lock is a separate concern** below before
touching anything audio-related.

## The one principle

**The player only ever reads from the cache. The network's only job is to fill
the cache ahead of the playhead.**

Offline's *supply* works because its play path never touches the network
mid-clip — so backgrounding, lock, and weak signal can't starve it. The old
online path broke that by reaching the network (and routing audio through the
service worker) during playback. That is the supply regression.

So we don't have an online system and an offline system. We have **one** system.
Online just fills the cache from the network instead of from a pre-download. Same
player, same blob-from-cache playback.

**The service worker comes out of the audio path entirely.** It caches the app
shell and nothing else. It is never an audio server.

## Two tiers: download ≠ play-ready

"The cache" is really two stores, because what we *have* is not what we can
*play*:

| Tier | Format | Size | Holds | Policy |
|------|--------|------|-------|--------|
| **Download store** | MP3 | small | a lot (30 min … hours) | generous — this is the depth knob |
| **Decode window** | WAV | large | almost nothing (~1–2 min ahead) | ruthless — evict hard behind the head |

The player can only play a **WAV** blob (WebKit will not play an mp3 blob URL), so
there is a decode step. WAV is expensive, so we keep almost none of it.

Pipeline: **network → MP3 store → (decode) → thin WAV window → player.**

End-state: only MP3 is persisted; WAV is ephemeral and just-in-time. The decoder
is the bridge between "what we have" and "what we can play." The trap: no matter
how many MP3s are downloaded, the current player will not play them until they're
decoded to WAV.

## The head-miss rule (cold-start + restart unifier)

**On a cache miss at the playhead, stream that one item straight from the network
while the MP3 → decode pipeline catches up behind it.**

One rule dissolves every special case:

- **First-ever play / first clip** — head miss → stream the first clip, instant
  (Spotify-style), pipeline fills behind it. The screen is on here, so a streamed
  head item is fine.
- **Course welcome (~1 min)** — on a cold start the head item *is* the welcome.
  It's a miss → it streams. No "download the whole thing" stall, **and the clunky
  optional pop-up is deleted.** A generic welcome baked into the app becomes a
  nice-to-have, not a requirement.
- **Warm restart** — keep the head warm so there's *no* miss. Usually the last
  session's cache is still present. On app hide/close, **burst-stage the next
  cycle — ideally decoded to WAV** — so restart is instant from cache (local WAV
  beats network: no round-trip, no decode-on-the-spot). If it wasn't staged, the
  head-miss rule streams it anyway. Graceful either way.

## Three "modes" are one mechanism at different depths

One rolling buffer; the only knob is **how far ahead the MP3 store fills**:

| Mode | What changes | Play path |
|------|--------------|-----------|
| Normal online | fill a little ahead, evict behind | cache |
| Spotty / backgrounded | fill *deeper* so playback rides through gaps | cache |
| Deep offline (plane) | bulk pre-fill ~N hours (sized by *time*, like a Spotify playlist), then roll | cache |

"Offline mode" as a separate thing dissolves. Deep-offline is just "fill a couple
of hours ahead before you go," sized by duration.

## Eviction (the only genuinely hard part)

Two policies, straight out of the two tiers:

- **WAV window** — tiny, ruthless. ~1–2 min decoded just ahead of the playhead;
  evict aggressively behind.
- **MP3 store** — generous sliding window with a hard size cap; evict well behind
  the head. The cap *is* the depth knob. Mobile quota is far smaller than
  desktop's ~1.5 GB, so the cap must be conservative and self-trim *before* the
  browser starts erroring.

## Lock is a separate concern — DO NOT let the buffer touch it

(Read this before changing any audio code.)

**Agreed, uncontested guardrails (both `CLAUDE.md` and field notes concur):**
- During PAUSE the main `<audio>` element must simply **idle**, exactly like
  `main`. The `pauseTimer` owns the advance, not audio.
- **NEVER** add silent audio *on or alongside the main element* to "keep it
  alive" — no silent-WAV loop, no `playSilentKeepalive`, no second `<audio>`.
  The tell is the lock widget flickering play/pause and playback dying after ~1
  cycle — *even with everything cached* (so it is NOT a supply problem, and the
  buffer is a red herring for that symptom). Re-introduced and reverted twice.
- Supply (this doc) and liveness are orthogonal. **The buffer rebuild changes
  supply only** and must not touch the keepalive.

**Unresolved (do NOT assume; confirm on a device before building on either):**
There are two conflicting accounts of what holds *screen-off lock* (not just
backgrounded-screen-on):
- `CLAUDE.md`: the session-wide **AudioContext silent oscillator**
  (`useAudioSessionKeepalive`, sits below the element) is sufficient — "verified
  30+ min locked."
- Field instrumentation (player_events, `audioDebugState`): the oscillator is
  *not* sufficient — once the screen is locked iOS refuses to **start** a new
  `<audio>` source at all (currentTime frozen at 0 on every clip after lock), so
  true lock needs **continuous Web Audio scheduling** (decode clips → AudioBuffers
  → schedule on one running AudioContext) so nothing ever has to "start" while
  locked.

This is a live question for Tom to settle on-device. It does not block the supply
rebuild, but it determines whether a later "output" rework is needed — and note
that the Web-Audio-scheduling option, if it wins, *plays decoded AudioBuffers*,
which dovetails with this doc's decode tier.

## The one supply unknown to test

Liveness is solved. The open *supply* question for long locked / offline play:

**Does the MP3 → WAV decode keep running while the app is backgrounded / locked?**

- If yes → the 1–2 min WAV window is enough forever; the decoder keeps feeding it
  from the big MP3 store even while locked.
- If no (iOS throttles decode while locked) → a long locked stretch drains the
  WAV window and stalls despite hours of MP3 ready. Then we pre-decode a larger
  WAV reserve before backgrounding — which fights storage cost.

`main` already plays 30+ min locked, so its supply path evidently survives lock;
the rebuild must preserve that property and measure it explicitly.

## Build order

1. Route **online** onto the MP3 → decode → WAV → cache path with the head-miss
   rule. Kills the welcome pop-up; unifies the system. Keepalive untouched.
2. **Confirm lock on a real device** (online + offline) — the floor must hold.
3. Measure **decode-while-locked** → fixes the WAV window size.
4. Add **MP3 eviction** (size-capped sliding window); test a couple of strategies
   under the small mobile quota.
5. Add **deep-offline depth** (download ~N hours by time; roll past the chunk).
6. Add **warm-restart staging** on hide/close (burst + decode the next cycle).

## Deliberately dropped

- Fibonacci cycle-chunking — not load-bearing; complexity without payoff.
- Service-worker-as-audio-server (206 ranges) — put the network back in the play
  path. The SW caches the app shell only.
- Any element-level silent keepalive — see "Lock is a separate concern."

## Test discipline

Lock / background / offline behaviour is validated on **deployed staging + a real
device**, never local `pnpm dev`. Offline blob playback can be sanity-checked on
desktop Safari; lock is device-only.
