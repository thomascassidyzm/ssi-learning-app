# Colombo retest — Dulmini's findings against current staging

**Date:** 2026-09-10
**Her build:** `ssi-devwrap-7daba4d-staging-debug.apk`, commit `7daba4d`, built 2026-09-06 11:41Z
**Read against:** `origin/staging` @ `4826414bd` — **534 commits ahead** of her build
**Method:** code read only. No build, no emulator, no test suite, no writes. Every file read with `git show origin/staging:<path>`.

---

## The seven verdicts, in one look

| # | Finding | Verdict |
|---|---------|---------|
| 1 | Verification code never arrives for non-registered users | **CANNOT TELL** — but it is **NOT** an app-code gate. Nothing in the send path treats an unknown address differently, and that path is byte-identical to her build. It is delivery. |
| 2a | "Maybe later" destroys Yellow-Belt progress | **STILL BROKEN as a symptom — but it is NOT database data loss for a signed-in learner.** It IS local progress loss for a guest, which is what she was. |
| 2b | Completed belt and next belt not clearly indicated | **STILL BROKEN.** The belt-promotion celebration is dead code — the variable that shows it is never assigned. It cannot ever have fired. |
| 3 | Pause an encouragement → Play starts the next phrase | **STILL BROKEN**, and it is a real gap: pod laps have a resume bookmark, encouragements do not. |
| 3 | Pause a phrase → Play restarts it from the beginning | **STILL BROKEN in her words — but DELIBERATE**, with a written rationale. This is a design question for Tom, not a bug. |
| 4 | Library and Settings mixed into the player controls | **STILL BROKEN / accurate.** They are slots 1 and 5 of the same five-button bar as Revisit, Play and Skip, and they open as overlays, not views. |
| 5 | "Update Version" appears twice | **STILL BROKEN.** Both taps call the *same* function, `handleUpdateToLatest`. Genuine duplication. |
| 6 | "Install App" shows inside the native Android app | **STILL BROKEN.** The row is gated on PWA display-mode only. A seam that answers exactly this question already exists and this row does not use it. |

**Nothing she reported has been fixed.** The only thing that has genuinely changed since her build is the Android shell's architecture, and that changes the *context* of #1 and #6 rather than fixing either.

---

## The one architectural change that matters

Her APK **bundled** the web app and served it from `https://localhost`, pointing its API calls at a deployment.

Since **2026-09-08** — two days after her build — the shell stopped bundling and became a **WebView onto a real origin**, and that origin is now **production**, not staging.

- `packages/player-vue/capacitor.config.ts:33` — `SHELL_ORIGIN = 'https://saysomethingin.app'`
- Commits `a607ee6ee` (stops bundling) and `0ed4a7eca` (points at production), both post-`7daba4d`.

Two consequences for Colombo:

1. **A new APK built today points at PRODUCTION, not staging.** If you want Dulmini re-testing staging, whoever cuts the build must export `SSI_SHELL_ORIGIN=https://staging.saysomethingin.app` first. Nothing warns you.
2. **Nothing from her old install carries over.** The origin changed, so position, sign-in and downloaded audio are all invisible to the new one. The app says so out loud now — `SettingsScreen.vue:393`, `freshStorageLine` — but she should be told, or she will read it as data loss.

---

## Finding 1 — verification code never arrives

Split in two, as briefed.

### (a) The send path in application code — NOT the cause

There is **no** `shouldCreateUser: false` and no existing-learner lookup anywhere on the sign-in path. I looked specifically for that shape.

- `api/auth/send-code.ts:172` mints the code with `svc.auth.admin.generateLink({ type: 'magiclink', email })`. The file's own header, line 18-22, records that this was verified live on 2026-09-02: **minting for an address with no account CREATES the account**, matching `signInWithOtp`'s default `shouldCreateUser: true`.
- `packages/player-vue/src/auth/sendSignInCode.ts:60` — the fallback is a bare `signInWithOtp({ email })`, no options object, so the default applies there too.
- The only `shouldCreateUser: false` in the whole repo is `api/_utils/sendInviteEmail.ts:153`, which is the school-invite path, not sign-in.

**Nothing on this path has changed in a way that could matter since her build.** `git diff 7daba4d..origin/staging` on those two files is 58 insertions of rate-limit refinement, copy and a Resend message-id column. `api/_utils/cors.ts` and `packages/player-vue/src/platform/apiBase.ts` — the two files that decide whether the route is even reachable from the WebView — are **unchanged**.

So: her build could reach the route, the route does not care whether the address is known, and if the route fails for any reason the client falls back to Supabase's own mailer. Two independent senders, neither of which declines an unknown address.

**This is delivery.**

### (b) Delivery and sender configuration — what I can and cannot see

What the code says:

- Provider is **Resend**. `api/auth/send-code.ts:186` posts through `postResendEmail`.
- From address defaults to `SaySomethingin <hello@contact.saysomethingin.app>` (`send-code.ts:53`). The comment there states `contact.saysomethingin.app` is the domain verified in Resend with SPF and DKIM authenticating it.
- Reply-to defaults to `admin@saysomethingin.com`.
- Per-address limit is **5 sends in 15 minutes** (`SEND_CODE_PER_ADDRESS_LIMIT`, line 66). If Dulmini tapped resend repeatedly while nothing arrived, she would have hit this and been refused — and the refusal message is worded as "the last one may still be on its way", which reads like a bug when the first one never came. **Worth asking her whether she saw that sentence.**
- If `RESEND_API_KEY` is missing the route returns 503 and the client falls back to Supabase's mailer — the ugly magic-link-template mail that `sendSignInCode.ts`'s header records as running **40-45% completion against 94% elsewhere** on Welsh school domains. A silent fallback looks identical to success from the outside.

**EXPLICIT GAPS — I could not close these and they are what would settle it:**

- I cannot read live environment values. I do not know whether `RESEND_API_KEY`, `SIGNIN_EMAIL_FROM` or `WEBVIEW_ALLOWED_ORIGINS` are actually set on the staging deployment, so I cannot tell whether her sends went via Resend or fell back to Supabase.
- I cannot read the Resend dashboard, so I cannot see whether her address bounced, was delayed, or was accepted and dropped downstream.
- I have not seen the 16-second video. If it shows the error state on the code screen it may name the failure directly.
- **Sri Lanka is a live hypothesis I cannot prove.** Provider-side geographic filtering, or her mailbox provider silently binning mail from a domain it has never seen, would produce exactly this and would be invisible from the code.

**What WOULD settle it, cheaply.** Commit `0d4d98e25` — post-dating her build — now records Resend's message id on every send and stamps delivery webhooks onto the audit row. So from the next build onward this query answers it outright:

```sql
select created_at, outcome, resend_message_id
from possession_mint_attempts
where email = '<her address>'
order by created_at desc;
```

If there are rows with `outcome = 'signin_code_sent'` and a message id, the mail left the building and it is a delivery problem at her end or Resend's. If there are no rows at all, the request never reached the route. If the rows say `rate_limited_signin_code_address`, she was throttled. That is a thirty-second answer and it did not exist when she tested.

---

## Finding 2(a) — does "Maybe later" DESTROY progress?

**Short answer: not in the database. Yes in local storage, for a guest — which is what she was, because finding 1 stopped her creating an account.**

### The UI symptom is real and it is deliberate

`packages/player-vue/src/components/LearningPlayer.vue:2302`:

```js
function dismissPaywall() {
  showPaywall.value = false
  simplePlayer.jumpToRound(0)
  simplePlayer.pause()
}
```

Three lines. "Maybe later", a backdrop tap and Escape all land here. `jumpToRound(0)` sends the playhead to the very first round of the course.

The belt badge then follows, because **the belt IS the current position, by design** — de-ratcheted with Tom on 2026-05-30, `useBeltProgress.ts:440-446`: *"Belts are a POSITION measure, NOT an award... when the cursor moves back, the belt follows it back."* So the badge flips to White the instant the playhead lands on round 0. Her description is exact.

Her trigger matches too: `PREMIUM_PREVIEW_MAX_SEED = 19` — the Yellow-belt ceiling (`api/_utils/audioAccess.ts:422`). The wall fires the moment she finishes Yellow.

This code has not been touched since her build. The dismiss handler dates to `fd382b279`, 2026-07-16, an ancestor of `7daba4d`.

### The database is safe — two independent guards, both verified in code

**1. The cursor write cannot go backwards.** The round-advance watcher (`LearningPlayer.vue:2194`) writes through `ProgressStore.setLivePosition`, which ends with (`packages/core/src/persistence/ProgressStore.ts:471`):

```js
.or(`last_completed_round_index.is.null,last_completed_round_index.lte.${roundIndex}`)
```

A learner sitting at round 200 whose playhead is thrown to round 0 produces an UPDATE that matches **no row**. The write silently does nothing. That is the intended behaviour, documented at line 439-443.

**2. The ceiling is a forward-only database trigger.** `supabase/schema.sql:16875` fires `ratchet_highest_completed_round()` on every write to `course_enrollments`. Its body (line 5779-5783) lifts `highest_completed_lego_id` **only** when the new value is lexically greater than the old. A backwards cursor write "no longer drags the ceiling down with it" — its own words.

So for a signed-in learner: the rows hold. The learner is navigated to the start, and their real position is recoverable — Settings → Troubleshooting → "Recover a lost position" reads exactly that ceiling (`SettingsScreen.vue:114`).

### The guest case, which is the one she actually hit

A guest has no enrollment row at all — every write primitive early-returns on `isGuestLearner` (`LearningPlayer.vue:1274, 1341, 1366`). Their whole record is `localStorage`, key `ssi_belt_progress_<course>`.

And `setLastLegoId` (`useBeltProgress.ts:619`) writes **both** the cursor and the local high-water mark with no ratchet at all:

```js
lastLegoId.value = legoId
highestLegoId.value = legoId
saveProgressLocal()
```

It is called on every completed round via `setCurrentLegoId` (`LearningPlayer.vue:2733`). So the sequence is: hit the wall at seed 19 → tap "Maybe later" → thrown to round 0 → press Play → finish round 0 → **localStorage is overwritten with the round-0 LEGO**. Next launch, she is genuinely at the start of White Belt and there is nothing anywhere to recover from.

**That is real progress loss, and it is exactly what she described.** It needs a signed-in account not to happen — which finding 1 prevented.

### What would have to change

The narrow fix is that `dismissPaywall` should hold the learner where they are, or send them somewhere that says "you've finished the free preview", rather than silently rewinding to round 0. The wider one is that the local high-water mark in `setLastLegoId` should ratchet the way the database one does.

**I am not proposing either — this is a read-only job. Both are one-line-shaped and both are Tom's call.**

---

## Finding 2(b) — completed belt and next belt not clearly indicated

**STILL BROKEN, and the reason is concrete: the belt-promotion celebration is dead code.**

`LearningPlayer.vue` has a full belt-celebration overlay at line 17964-17992 — particles, glow, a belt SVG, "New belt earned!", the belt name, a Continue button. It renders on `v-if="beltJustEarned"`.

`beltJustEarned` is declared at line 5361 as `ref(null)`. **It is never assigned a non-null value anywhere in the file.** Every other mention is either a read (`!beltJustEarned.value`, four suppression guards) or the reset in the overlay's own dismiss handler. I checked her build too: same, sixteen mentions, no assignment. It has been unreachable for a long time — the last commit to touch the wiring is `36e5b87a4`, "Belt fixes: true white, remove name labels, award only on natural completion".

The composable side is wired and returning the right thing and nobody is listening: `useBeltProgress.checkBeltPromotion` (line 585) logs `🎉 Belt promotion: yellow → orange` and returns the belt so a caller can drive a celebration. Its only caller is internal (line 632) and **discards the return value**. There is no caller in any component.

So at a belt boundary today the learner gets: a console log they cannot see, and a badge whose colour quietly changes. Nothing announces it, and nothing names what is next.

What *does* exist, if she can find it: the belt strip inside the Progress modal, which opens from the belt pill on the resting screen. It carries "you're working on {belt}" and "you've been as far as {belt}" markers (`ProgressModal.vue:242, 246`) and a full display grammar written down at lines 22-40. It is unchanged since her build. **Worth asking whether she ever found that modal** — if she did and it still read as unclear, that is a different and more interesting finding than "there is nothing".

---

## Finding 3 — pause and resume

Two claims, both confirmed, for two different reasons. Neither file has changed in any relevant way since her build.

### Claim 1: pausing an encouragement then pressing Play starts the next phrase

**STILL BROKEN, and it is a genuine gap rather than a design choice.**

The mechanism, in order:

1. An encouragement plays at a **round boundary**, on its own audio element, after the round has ended.
2. By that point `SimplePlayer.advanceRound()` (`playback/SimplePlayer.ts:2189-2196`) has **already advanced `roundIndex` to the next round** and set phase to `idle`, precisely so a resume picks up there.
3. Tapping the button during commentary hits `togglePlayback` (`LearningPlayer.vue:16714-16723`): it stops the commentary audio and sets `userStoppedDuringLap`, deliberately leaving SimplePlayer's state alone.
4. Tapping Play then reaches `handleResume` (`LearningPlayer.vue:9057`), which falls through to `simplePlayer.resume()` → the **next round's** prompt.

The telling detail: **pod laps have a bookmark for exactly this case and encouragements do not.** `pendingLapResume` is set at lines 6422 and 6581 for laps, checked at 9092, and replayed on the next Play tap. Nothing equivalent exists for `playingCommentaryAudio`. So the machinery to fix this is already in the file, one type short.

To change it, commentary would need the same bookmark treatment pod laps already get.

### Claim 2: pausing a phrase then pressing Play restarts it from the beginning

**STILL BROKEN in her words — but it is DELIBERATE, and it has a written rationale.**

`SimplePlayer.resume()`, `playback/SimplePlayer.ts:1267-1305`, ends with `this.startPhase('prompt')`. The comment above it is explicit:

> *"Always restart the current cycle from prompt. If the learner has stopped the app at all, the previous phase's context is gone from their head — they may not remember the prompt that played before the pause-phase silence, the voice they just heard, etc. So we give them the full 4-phase cycle from the top."*

It also names the alternative it rejected: resuming into the silent pause phase looked frozen, with no audio cue that anything had happened. And it records a measurement from 2026-08-09 showing the restart being counted against the repeat ceiling so a phrase can never sound four times.

**Her question — "please confirm whether this is expected behavior" — has a clear answer: yes, for claim 2, by design and for a stated pedagogical reason. Claim 1 is not by design.**

My read for Tom: claim 2 is defensible and I would leave it. What is missing is that the learner is never *told* — the restart is silent and indistinguishable from a bug, which is why a professional tester filed it. If anything changes here it is a cue, not the behaviour.

**One hypothesis I checked and am ruling out.** The standing note that `tap_pause` fires on Library and Settings opens is about **telemetry naming**, not playback: opening those overlays logs an event that looks like a pause in the data. It does not cause either of the behaviours she describes. Both trace to the code above.

---

## Finding 4 — Library and Settings mixed into the player controls

**Accurate, and unchanged.** This is a suggestion, not a defect, and her description of today's code is correct.

`packages/player-vue/src/components/BottomNav.vue` renders one five-slot bar:

| Slot | What | Line |
|---|---|---|
| 1 | Library | 205-219 |
| 2 | Revisit | 222 |
| 3 | Play / Stop / Return | 231 |
| 4 | Skip | 265 |
| 5 | Settings | (`handleSettings`, line 172; rendered at 280-284) |

Slots 2 and 4 are hidden off the player screen (`v-show="isOnPlayerScreen"`), so Library and Settings are the two that persist — they are structurally part of the transport bar. And they open as **overlays over the player**, not as routes: `PlayerContainer.vue:628` says so in one line — `'library': 'player', // library is now an overlay`. The router has no `/library` or `/settings` path at all.

So her observation is exactly right about the code as it stands. `BottomNav.vue` has not been touched since her build.

---

## Finding 5 — duplicate "Update Version"

**STILL BROKEN. Same action, two places, one function.**

Both are in `packages/player-vue/src/components/SettingsScreen.vue`:

- **Top of Settings**, the build card, line 2085-2099: `@click="handleUpdateToLatest"`. It shows the sha, the build time, and either "Update available" or "Tap to update".
- **Settings → Troubleshooting**, line 2967-2974: `@click="handleUpdateToLatest"`, labelled "Update to the latest version".

They call **the same handler**. This is not a labelling problem; it is one action rendered twice. Cheap to fix, and no behaviour is at stake in removing either one.

Her sub-note — *"the clue of the top one is unclear if it's to update the version"* — is fair on her build. The top card leads with a git sha and a timestamp; "Tap to update" is a small hint at the right-hand end. On a phone that reads as a version stamp, not a button.

Neither has changed since her build. `SettingsScreen.vue` has had 21 commits in the range, all about account identity, billing, family plans and the What's-new panel — none touching either update affordance.

---

## Finding 6 — "Install App" in the native Android Settings

**STILL BROKEN, and this is the tidiest of the lot: the fix already exists in the codebase and this one row does not use it.**

The row, `SettingsScreen.vue:3013`:

```html
<section v-if="!isStandalone" class="section">
```

and `isStandalone`, line 1021:

```js
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true
```

A Capacitor WebView does not match `display-mode: standalone`, so `isStandalone` is false and the row renders — inside the native app.

The platform seam already answers this exact question. `platform/capabilities.ts:220`:

```js
export function shouldOfferAppInstall(): boolean {
  return current.shell !== 'webview'
}
```

and its own header, lines 215-219, records that this function was written *because* the install banner's gate was `display-mode: standalone`, which is false inside a WebView. `App.vue:427` and `InstallBanner.vue:32` both use it. **`SettingsScreen.vue` does not.** It is the one caller that was missed.

### Her wider question — "maybe there are more options not related to a mobile build"

I checked. Two things worth knowing, and they now point in opposite directions:

- **Troubleshooting → "Update to the latest version" and "Clear cache & reload"** were meaningless in her bundled APK — the header of `capacitor.config.ts` says it outright: *"a bundled APK's 'Tap to update' can never fetch new web code — the button lied."* Since 2026-09-08 the shell loads the deployment and runs the deployment's service worker, so these two are now truthful and should stay.
- **The "app is behind live" staleness line** existed for bundled builds and has been switched off everywhere — `shouldDescribeStaleness()` returns a hardcoded `false` (`capabilities.ts:251`) — so she will not see it again.

So on today's shell the **only** unambiguously web-only row left in Settings is "Install App", and one line changes it: swap `!isStandalone` for `!isStandalone && shouldOfferAppInstall()`.

---

## What needs a human on a real Android handset

Three of these cannot be closed from code, and each is a thirty-second job for one person with the phone. **Please ask Dulmini for exactly this and nothing more.**

1. **Finding 1 — what does the screen SAY when the code does not arrive?** Specifically: does she ever see the sentence *"We've sent a few codes to that address already, and the last one may still be on its way"*? That sentence means she was rate-limited at 5 sends in 15 minutes, which is a completely different bug from the mail not being sent. A screenshot of the code-entry screen after the last attempt settles it.

2. **Finding 2(b) — did she ever open the belt panel?** Tap the belt pill on the resting screen. It opens a Progress modal with a belt strip that says "you're working on X" and "you've been as far as Y". If she never found it, the finding is discoverability. If she found it and it still read as unclear, that is a design problem worth having. One screenshot of that modal answers it.

3. **Finding 5 — which "Update Version" did she mean at the top?** I am confident it is the build card, but it carries a sha rather than the words "Update Version", so I want her screenshot confirming what she was looking at before anyone edits copy.

Two more things to tell her rather than ask her:

- **A new APK will point at PRODUCTION unless somebody overrides it.** Whoever cuts her next build must set `SSI_SHELL_ORIGIN` to staging or she will be testing the wrong deployment without knowing.
- **Nothing carries over from her old install.** The origin changed on 2026-09-08. Her position, her sign-in and her downloaded audio are all gone from the new build's point of view. That is expected, it is not a new bug, and if nobody warns her she will report it as one.

**Findings 3 and 4 do NOT need the handset.** I traced both to specific lines and they are settled. #3 is half deliberate and half a missing bookmark; #4 is a design suggestion the code confirms.

---

## What I could not determine, and why

Stated plainly, because a gap papered over is worse than a gap.

1. **Whether Dulmini's sign-in codes were ever actually sent.** I cannot read live environment variables, so I do not know if `RESEND_API_KEY` is set on staging — which decides whether her mail went through Resend or fell back silently to Supabase's much worse-delivering template. I cannot read the Resend dashboard, so I cannot see accepts, bounces or delays. The query above closes this from the next build onward.

2. **Whether Sri Lankan delivery is being filtered.** Named as a live hypothesis. Unprovable from here.

3. **The 16-second video.** I have not seen it. It is described as showing "a low quality audio issue and an issue right after the encouragement" — and "right after the encouragement" is precisely finding 3's first claim, which I have traced to `advanceRound` at `SimplePlayer.ts:2189`. So the video probably **corroborates** what I found rather than changing it. But the audio-quality half is not in her written report at all, is not covered by any of the seven items, and I cannot assess it. **If there is an audio-quality problem, it is an eighth finding nobody has retested.**

4. **Whether the belt celebration was ever wired.** I established it is dead today and was dead in her build. I did not spend the archaeology to find the commit that unhooked it, because it does not change the verdict.

5. **Runtime confirmation of any of this.** Everything above is a code read. Confident, file-and-line, but no build was run and no behaviour was observed. Where I could not prove something from the code I said CANNOT TELL rather than guessing.

---

## Read against

`origin/staging` @ `4826414bd`, fetched 2026-09-10. Where a verdict depends on something not having changed, the range `7daba4d..origin/staging` was checked on that specific path and the result is stated inline. I did not find a dev-vs-staging difference that changes any verdict.
