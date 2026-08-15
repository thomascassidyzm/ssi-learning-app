# Cache-first audit — every gate that could block a learner

**2026-08-15.** Walking the boot-to-first-audio path and listing every point where a network
call could delay or prevent playback of content the device already holds — then what was done
about each.

The ruling this implements, in Tom's words:

> The heuristic is that the app should always play whatever it has. It should never allow a weak
> Internet connection to block the learner. … Play what you have. Verify access as and when you
> can. Never as a gate.

---

## The shape of the fix

One new file, `packages/player-vue/src/config/networkGate.ts`, owns three things:

- **One number.** `CRITICAL_PATH_TIMEOUT_MS = 2500` — how long a learner may be made to wait,
  decided once instead of in five files. Background work keeps a longer 9000ms leak-guard,
  because nothing is waiting on it.
- **`withNetworkTimeout`** — race a call against that budget and get a sentinel back instead of
  a hang. It deliberately does *not* swallow a real rejection: a 403 is a different event from a
  hang and the caller should be free to treat it differently.
- **An observed-stall signal.** `navigator.onLine` is not consulted as an oracle. It reports
  *online* on one bar and behind captive portals — the codebase already said so in two comments.
  It is now trusted in one direction only: when the browser admits it's offline, believe it.
  Otherwise we go on what actually happened — `isNetworkPresumedDown()` is true when a
  critical-path call timed out or failed, and clears on any critical-path success, on an
  `online` event, or after 60 seconds.

---

## The gates, in boot order

| # | Gate | Could it block first audio? | What was done |
|---|---|---|---|
| 1 | `App.vue` → `auth.initialize()` | **Yes — indefinitely.** `getSession()` was already raced against a 5s timeout, but the learner-row read one line *behind* it was not. On weak signal boot stopped there, and everything below it — including the course catalogue — never ran. | Bounded at both levels: the whole `initialize()` at the App boot site, and `ensureLearnerExists()` inside it. On expiry we carry on with the cached record; the session settles behind the learner. |
| 2 | `App.vue` → `fetchEnrolledCourses()` | **Yes — indefinitely.** supabase-js has no default request timeout, so the `courses` select could hang. No course selected means no player mounts and nothing plays, *even with a full cache on the device*. An offline catalogue mirror already existed — it just was never reached. | Bounded. On expiry the mirror serves and the player boots into its cached-content paths. |
| 3 | `useInstantPlayback.bootstrap()` — round-map fetch | Partly. It was already cache-first, and a background revalidate already swallowed failures. But a cold cache waited **9 seconds** before failing. | Cut to the 2500ms critical-path budget. With no cached map there is genuinely nothing to fall back to, so this can still fail — it now fails *fast*, handing the caller to its fallback in 2.5s instead of after nine. |
| 4 | `useInstantPlayback.bootstrap()` — cycles fetch | **Yes.** Cache-first only when the cached copy matched the *current* version and covered the full requested limit. Anything else — an older stamp, a short entry, a hang, a 5xx — went to the network and **threw**, with no cache fallback at all. | Every failure now falls back to `readAnyCachedCycles`, which deliberately ignores the version stamp and the limit. Once the network has already failed, the choice isn't stale-vs-fresh, it's stale-vs-silence. |
| 5 | Entitlement 403 on `/cycles` | **Yes.** A 403 threw and degraded to the slow legacy walk, which was itself unbounded. | Serves the cache. The 403 is still logged loudly, so a genuine token-plumbing regression stays visible. |
| 6 | `bootstrapInfPlay` / `/infplay-cycles` | **Yes — total.** INF PLAY had *no cache at all*. Offline, an INF PLAY learner got nothing. | Write-through cache added, read back only as a last resort after the network has failed. Repeating a round beats silence. (The happy path still never reads it — INF PLAY's per-session randomisation is deliberate.) |
| 7 | `offlinePlaybackActive()` in `LearningPlayer.vue` | **Yes — this is the weak-signal hole.** It engaged on `offlineActive \|\| !isOnline`, and `isOnline` is `navigator.onLine`. On one bar the browser says *online*, so the player streamed `/api/audio` into a hang with a full cache sitting on the device. | Third disjunct added: `isNetworkPresumedDown()`. **This is where the deliberate/accidental distinction is retired** — a learner who forgot the toggle now gets what one who remembered gets. |
| 8 | Enrollment mode pre-check | No — already bounded at 2000ms (pre-existing). | Left alone. |
| 9 | Cache fast path (`getCachedScript`) | No — local read, no network. | Left alone. |
| 10 | `useOfflineLease` | No. Already lazy, hard-timeout, fail-open, no eager boot call, and `checkOfflineLease` self-heals in the background without blocking. | Left alone — it is the shape the rest was made to follow. |
| 11 | `useAccessClaim` | No. Already swallows every failure ("must never break sign-in"). | Left alone — same reason. |
| 12 | Entitlements / subscription init | No. Already fired off-critical-path with localStorage hydration. | Left alone. |
| 13 | `useListeningPods` | **Yes, on weak signal.** Cache-first only when `navigator.onLine === false`; otherwise it ran a *retrying* live read before ever looking at the cache — the slowest possible route to content already on the device. | Now asks `isOfflineish()`, so an observed stall counts too. |
| 14 | `ListeningOverlay` seed load | Same as 13. | Same fix, plus the empty-cache message now keys off `isOfflineish()`. |
| 15 | `checkContentVersion` | No — already fire-and-forget with `// offline is fine`. | Left alone. |
| 16 | `bulkAudioDownload` | No — deliberate, online-only action, already timeout-bounded. | Left alone; out of scope per the brief (this job is gating, not cache policy). |

---

## Taste-safe defaults I took — cheap for Tom to overrule

1. **2500ms** as the budget. Above a normal cold mobile round-trip (a warm Lambda answers
   `/cycles` in 150–300ms), well below where a learner reads the screen as broken. One constant,
   one comment, one place to change it.
2. **The offline toggle stays visible**, repurposed as intent ("don't use the network") rather
   than playback permission. Nothing in the UI changed.
3. **No new indicator.** Running from cache is silent — no toast, no modal, no banner. The
   existing offline affordance already covers it and nothing interrupts.
4. **Stale content beats silence.** A cached copy from an older content version will now play
   when the network can't be reached. It's replaced by the next successful fetch. This is the
   one place the fix trades correctness for continuity, and it only ever applies *after* the
   network has already failed.
5. **60-second stall TTL.** Long enough for a whole boot to behave consistently, short enough
   that a learner walking back into signal recovers on their own. A real `online` event clears
   it immediately regardless.

## What I did not change, and why

- **Write paths stay loud.** Read-path degradation is silent to the learner; PostgREST write
  errors are still surfaced, per the RLS doctrine's no-false-"Saved" rule.
- **Cache policy** — what gets pre-downloaded and how much — is untouched. This job was about
  gating.
- **The empty-cache case still fails**, and should. Airplane mode with nothing downloaded has
  nothing to play; the existing "connect once and download for offline" message is the honest
  answer. What changed is that it can no longer appear when content *is* cached.

## One thing worth Tom's eye

Under this ruling, a learner whose entitlement check can't be completed keeps playing cached
content. That is exactly what "verify access as and when you can, never as a gate" asks for, and
I implemented it as written. The exposure it creates: someone who downloads a course and then
cancels can keep playing offline until the **30-day offline lease** expires — the lease is the
thing that actually closes this, and it is unchanged and still working (lazy renewal, server
authority, revocation kill-switch). So the gap is bounded by the lease, not open-ended. Flagging
it rather than quietly tightening the gate back up.

---

## Verification

- `pnpm --filter @ssi/core build` — pass
- `pnpm --filter player-vue typecheck` — pass
- `pnpm --filter player-vue test` — **2136 passed**, 3 skipped, 224 files
- `pnpm --filter player-vue lint` — **zero new errors.** 4 errors exist in the tree, all in
  untracked local scratch scripts (`e2e/_*.mjs`) belonging to other sessions; none in any file
  touched here.
- `pnpm run typecheck:api` — pass
- `pnpm run test:api` — **1208 passed**, 105 files

New tests, pinning the ruling:

- `src/composables/useInstantPlayback.cacheFirst.test.ts` — airplane-mode-cache-warm;
  weak-signal-cache-warm (requests hang, playback starts on the budget, and the stall is
  observed); **toggle-OFF-no-connectivity, identical to airplane mode** — the case Tom actually
  asked for; 403-serves-cache; empty-cache-still-fails.
- `src/config/networkGate.test.ts` — the budget, the sentinel, the stall signal, and that
  `isOfflineish` trusts `navigator.onLine` in one direction only.

### One thing found while testing, worth recording

`api/admin/demo-schools.test.ts` was failing on `dev` — nothing to do with this work. It pinned
an assertion to the hard-coded date `2026-08-15`, and the handler extends from
`max(current expires_at, now)`. That assertion held only while the date was in the future; it
went off **today**, failing by however far into the day the suite ran. Fixed in its own commit by
asserting the handler's actual rule instead of a wall-clock date.
