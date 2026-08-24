# Phase 0 — Flutter-repo confirmation checklist

**Companion to [`native-migration-feasibility.md`](./native-migration-feasibility.md).**
_Last updated: 2026-06-04._

> **Why this exists.** The feasibility pass was written without access to the
> live Flutter app, so nearly every pillar ends with "confirm against the Flutter
> repo (not on this machine)." Those ~15 scattered open questions actually
> collapse to a handful of artifacts you can read in an afternoon. **Do this
> read FIRST — ahead of the iOS audio spike — because the answers resize the
> whole project** (e.g. "RevenueCat already in Flutter?" can shrink the dominant
> payment lump from ~2 weeks to a few days, and "same Supabase identity?" decides
> whether cutover is safe at all).

This is the single gate before any Capacitor code is written. Every item maps
back to a feasibility-doc decision or risk.

---

## The four sources that answer almost everything

You do not need the full Flutter source. Four artifacts reveal nearly every
native capability and the entire cutover risk surface:

1. **`ios/Runner/Info.plist`** — background modes, permission strings, URL schemes, associated domains.
2. **`android/app/src/main/AndroidManifest.xml`** — permissions, intent-filters, FCM, services.
3. **`pubspec.yaml`** — the plugin list (push, IAP, attribution, audio, deep-link SDKs all show here).
4. **App Store Connect + Play Console** — bundle IDs, product/subscription IDs, SBP enrolment, account ownership.

---

## A. Identity & bundle (the cutover-safety gate)

These decide whether the in-place swap is safe at all. If identity differs, that
is a separate blocking workstream — **do not cut over until it's solved.**

- [ ] **Exact iOS bundle ID + Android `applicationId`.** The entire
  same-listing / funnel-preservation strategy depends on reusing these verbatim.
  _(Info.plist / build.gradle / store consoles)_
- [ ] **Signing certs + provisioning profiles, and which Apple Developer + Play
  Console accounts own them.** Required to ship under the existing listing.
- [ ] **Does Flutter authenticate against the SAME Supabase email-OTP identity
  and the same `learners.id` as player-vue?**
  → If **yes**: re-login restores entitlement from `/api/subscription`
  automatically; cutover is a designed "sign in with your existing email" screen.
  → If **no**: identity migration is a separate hard workstream that **blocks
  cutover**.
- [ ] **Is the auth a typed numeric OTP or a magic-link/redirect?** player-vue is
  numeric-code (no deep-link interception needed). If Flutter relies on a
  magic-link, confirm whether any redirect path must be preserved.

## B. Payment & IAP continuity (sizes the dominant lump)

The single highest-leverage question in the whole project sits here.

- [ ] **Is RevenueCat ALREADY integrated in Flutter?**
  → If **yes**: near-trivial — reuse the same RevenueCat project / entitlement /
  product IDs; the Capacitor SDK inherits existing customer state with zero
  import. Lump shrinks from ~2 weeks to mostly the platform-branch + verification.
  → If **no** (raw `in_app_purchase` / `flutter_inapp_purchase`): adopt
  RevenueCat fresh + client-side `syncPurchases()`.
- [ ] **Exact App Store / Play product + subscription IDs and the entitlement
  identifier.** Must be reused **verbatim** in App Store Connect / Play Console.
- [ ] **Does Flutter set `appAccountToken` (iOS) / `obfuscatedAccountId`
  (Android) on IAP, and does any backend store Apple receipts / Google
  purchaseTokens?** Determines whether legacy IAP payers auto-reconcile or are a
  finite manual-support tail.
- [ ] **What `appUserID` (if any) does Flutter pass to the stores/RevenueCat —
  anonymous or a stable user ID?** The Capacitor build must use the **same stable
  Supabase `user_id`** to avoid creating a second un-linked customer for one human.
- [ ] **Is the App Store Small Business Program enrolled (15% vs 30%)?** If not,
  you're paying 30% unnecessarily today — enrolment is a simple application, not
  automatic.
- [ ] **Is the in-app subscription the ONLY paid SKU, or are schools/teacher
  seats also sold in-app?** **Recommended decision: keep schools/teacher seats
  web-only** — Apple IAP on bulk/B2B seats is a genuine nightmare and must stay
  out of the cutover.

## C. Locked / background audio (sets the bar to beat)

- [ ] **Does the current Flutter app actually play robustly locked /
  backgrounded?** A pre-rendered long file survives lock trivially once playing —
  so this sets the real bar the Capacitor build must MATCH, and raises the
  pressure on the iOS-audio lump if Flutter clears lock-screen effortlessly.
- [ ] **(Device spike, current iOS 17/18, not from the repo):** does an
  app-process `AVAudioSession.setCategory(.playback)` keep WKWebView HTML5
  `<audio>` alive when locked, or does the WebKit ProcessAssertion still expire
  ~15s? Most cited failures are iOS 13-era — **needs fresh real-device
  verification.** This is the binary go/no-go that drives the project's shape.

## D. Feature parity (must-not-lose at cutover)

- [ ] **Does Flutter send push notifications, and for what** (streak / lapse
  reminders, content drops)? Determines whether `@capacitor/push-notifications`
  is a hard v1 blocker (it's also a Guideline 4.2 approval lever) or an
  opportunity. _(pubspec.yaml: `firebase_messaging` / `flutter_local_notifications`;
  AndroidManifest FCM service; Info.plist `aps-environment`.)_
- [ ] **Which install-attribution / MMP SDK is embedded** — AppsFlyer / Adjust /
  Branch / Firebase / AdServices-only? Required to keep the £1-2 paid-install
  funnel measurable. **Don't cut over ad spend until attribution is verified
  live.** _(pubspec.yaml.)_
- [ ] **Does Flutter handle any inbound deep / universal links** (school invites,
  password/redeem flows)? player-vue only needs `/with/:code` handled. _(Info.plist
  `CFBundleURLTypes` + associated-domains; AndroidManifest intent-filters /
  `assetlinks`.)_
- [ ] **Any native-only Flutter features invisible from player-vue** — Siri
  shortcuts, home-screen widgets, CarPlay / Android Auto, biometric app-lock,
  calendar reminders, contacts? Resolve via the Info.plist / AndroidManifest /
  pubspec diff.
- [ ] **Does Flutter bundle/download offline content more aggressively** than
  player-vue currently does, such that testers expect more offline depth than the
  PWA ships today?

## E. Baseline metrics (so rollback thresholds aren't guesses)

Pull these from the existing analytics / store consoles before cutover — the
phased-rollout halt triggers are meaningless without them.

- [ ] **Crash-free session rate** (the bar the Capacitor build must match/beat).
- [ ] **Month-1 churn** for the Flutter cohort (the post-100% verdict comparison).
- [ ] **"Audio stopped while locked" support-ticket volume** (the #1 audio
  regression signal during rollout).
- [ ] **US vs EU vs rest-of-world split of paying consumers** (decides whether
  the US 0%-window external-link button and EU ~10% path are worth the per-region
  complexity).
- [ ] **Renewals vs new month-1 conversions split** (renewals are far more
  steerable to low/zero-fee web checkout without harming install-funnel
  conversion).

---

## How an answer changes the plan (quick reference)

| Confirmed fact | If yes | If no |
|---|---|---|
| RevenueCat already in Flutter | Payment lump ≈ days (reuse project/IDs) | Fresh RevenueCat adoption + `syncPurchases()` (~2 wks) |
| Same Supabase identity | Re-login restores entitlement; cutover safe | **Identity migration blocks cutover** |
| Flutter plays fine locked | Capacitor must match it → pressure toward native playback | Bar is lower; session-hold plugin likely enough |
| Push wired in Flutter | `@capacitor/push-notifications` is v1-blocking | Push is an opportunity, not a blocker |
| MMP SDK present | Port the same SDK (all ship Capacitor plugins) | Add AdServices + Play Install Referrer minimum |
| `appAccountToken` set today | Legacy payers auto-reconcile | Tokenless legacy IAP = finite manual-support tail |
| SBP enrolled | 15% baseline confirmed | Enrol now — you're overpaying at 30% |

---

## Output of this phase

When every box above is ticked, you have the inputs to:

1. **Lock the payment-rail decision** (keep IAP-primary; size RevenueCat work).
2. **Confirm the cutover is identity-safe** (or surface the migration workstream).
3. **Set real rollback thresholds** for the phased rollout.
4. **Finalise the v1 native-plugin scope** (push? attribution? deep links?).

Only then does Capacitor code start — Phase 1 in the feasibility doc.
