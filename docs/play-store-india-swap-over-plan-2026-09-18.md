# Play Store India swap-over — the plan, and what we need from the dev team

*18 September 2026, job #222·H. Written for Tom to forward. Every claim below was checked against the code on `origin/main`, `origin/staging` and `origin/dev` today, or against a named document. Where something could not be checked from this machine it says so, in the open. No code was changed.*

---

## The picture in one paragraph

The old Android app on the Play listing `com.automagic.a3f` is a Flutter app talking to its own backend at `automagic.saysomethingin.com`. It takes Google Play Billing, including UPI, today. The new app is a Capacitor shell that carries no web code and simply opens `saysomethingin.app` in a WebView. **The server half of Play Billing is already built and already on production:** a purchase-verification endpoint, a renewals-and-cancellations endpoint, and a database routine that turns a verified Play purchase into an entitlement row the player already honours. **What is missing is the native half** — a Play Billing plugin in the shell, one branch in the checkout code, and five environment variables that hold the Play Console credentials — plus the release mechanics of putting a new binary under the old listing without stranding anyone. Three of the eight steps below need things only the dev team holds. **One decision is Tom's alone:** whether the new build takes the old listing's package name. Everything else is a job.

---

# PART A — THE PLAN

Each step ends with a go/no-go. Steps 1, 2 and 3 can start today in parallel. Step 4 waits on step 1's answer. Steps 5 and 6 are web-side and can ship before any APK exists. Step 7 is calendar time. Step 8 is IME.

## Step 1 — Same listing, same package name, same signing key

**What must hold.** A Play subscription is tied to three things: the buyer's Google account, the **package name**, and the **product id**. It is not tied to a build. So a new binary uploaded under `com.automagic.a3f` inherits every existing subscriber, and every existing install auto-updates to it. Play also requires every update to be signed by the key it already knows for that listing.

**What breaks if any of the three changes.**

- **Different package name** = a different app to Google. Zero existing installs update. Every existing Play subscriber keeps paying for an app they can no longer get updates to, and their subscription is invisible to the new app. Reviews, ranking and the install base start from zero. This is the one truly irreversible choice, and `capacitor.config.ts` already says so in its header: taking `com.automagic.a3f` "would update the app under every existing user of it, is Tom's decision and is irreversible."
- **Different signing key without Play App Signing** = Play refuses the upload. Full stop. If the old app was never enrolled in Play App Signing and the original release keystore cannot be found, the listing can never be updated by anyone, and the swap-over becomes a new listing under a new name, with everything the bullet above describes.
- **Play App Signing enrolled** = Google holds the app signing key. We only need an *upload* key, and a lost upload key can be reset through Play support. This is the good case.

**Where we stand.** The Play App Signing status is unknown from here. The 3 September assessment searched Tom's whole estate for any keystore, Play credential or Flutter source and found nothing. The new shell is signed with Gradle's debug keystore only; `android/app/build.gradle` has no release signing configuration and `versionCode 1`.

**Go/no-go.** GO when the dev team has confirmed, from Play Console → Setup → App signing, that Play App Signing is enrolled, and has handed over either the upload keystore or agreed to an upload-key reset. NO-GO otherwise, and the whole plan re-forms as a new listing, which is a different, worse plan that needs its own write-up.

**Tom's decision, stated once.** Assuming step 1 comes back GO, the new build takes `com.automagic.a3f`. My recommendation is yes: it is the only way existing subscribers and installs carry over, and the India funnel is that install base. The cost is that every existing user gets the new app on their next update and is signed out of it, because their account lives on the old backend. Step 4 covers what we do about that.

## Step 2 — Production shell build off the new appId

**What exists.** `scripts/build-android-apk.sh` builds a debug APK whose WebView opens a deployment. The default origin is **staging**, by Tom's ruling of 10 September, and production must be asked for out loud: `scripts/build-android-apk.sh https://saysomethingin.app`. The shell declares a native level in its user agent so the web app can tell an installed phone to update from the store when a web change needs a newer shell.

**What has to change.**

- `appId` and `applicationId` from `com.saysomethingin.devwrap` to `com.automagic.a3f` — one line in each of `capacitor.config.ts` and `android/app/build.gradle`. The `namespace` in the Gradle file can stay as is.
- `versionCode` must be **higher than the old app's current versionCode** or Play rejects the upload. We do not know the old app's number. Dev team item.
- A **release** build producing an **AAB**, not a debug APK. Play requires app bundles for new uploads. Release signing config wired to the upload keystore, with the keystore and its passwords kept out of git.
- `SHELL_NATIVE_LEVEL` bumped from 1 to 2 in the same change that adds the billing plugin in step 3, because a plugin is a native change and that integer is the repo's only declaration that a store release is needed.
- Store compliance for an update in 2026: Data Safety form, privacy policy URL (`saysomethingin.app/privacy` exists), content rating, account-deletion path (`api/account/delete.ts` exists), and the target SDK floor. Capacitor 8 targets SDK 36, which is current.

**A review risk worth naming.** Google's minimum-functionality policy allows it to reject an app that is only a WebView onto a website. Ours plays audio offline from its own cache, holds the lock-screen media session and, after step 3, takes native billing. That is a defensible app, but the first review of a wholly changed binary under an established listing is slower and more likely to get a human look. Budget calendar time for it.

**Go/no-go.** GO when a release-signed AAB under `com.automagic.a3f` installs on a real phone, opens `saysomethingin.app`, plays audio online and then offline, and Settings shows the build row saying `main`.

## Step 3 — Play Billing in the new shell

This is the step the brief expected to be the biggest, and it is smaller than it looks, because the server rail was built on 15 September (job #812) and is on production.

### 3a. What is already built and where it runs

| Piece | File | State |
|---|---|---|
| Purchase verification | `api/store/play-verify.ts` | on `main` |
| Renewals, cancellations, refunds | `api/store/play-rtdn.ts` | on `main` |
| Google Play Developer API client, no SDK, service-account JWT | `api/_utils/playPublisher.ts` | on `main` |
| Grant logic: ownership, acknowledgement, expiry, hold/pause | `api/_utils/playGrant.ts` | on `main` |
| Database routine writing the entitlement row | `apply_play_grant` in `supabase/schema.sql` | on `main`, migration applied to the shared database |
| The entitlement predicate the player honours | `api/_utils/courseAccess.ts` via `resolveEntitlements.ts` | on `main`, unchanged by Play |

How it works: the app posts `{ purchaseToken, courseCode }` with its signed-in bearer token to `/api/store/play-verify`. The server fetches the purchase from Google's `subscriptionsv2` endpoint, checks the product id is in the allowlist, acknowledges the purchase with Google if not yet acknowledged, and writes one row in `user_entitlements` with `source = 'play'` and `access_type = 'full'`, which is the same catalogue-wide unlock a Paddle subscriber gets. Renewals and cancellations arrive at `/api/store/play-rtdn` as authenticated Google Pub/Sub pushes, and the same routine re-verifies and re-writes. Duplicate notifications, out-of-order notifications, refunds and upgrade-linked tokens are all handled and tested (14 handler tests, per the #812 write-up).

This matches the India entitlement design of 4 September on the one thing that matters: **Play purchases become rows in the existing entitlement table, not a second source of truth.** It departs from that design in one way: the design named RevenueCat, and the build went direct to Google's API with no middleman and no fee. I would keep the build as it is. RevenueCat would now be a second ledger beside a working one, and the identity model of 3 September already ruled that RevenueCat could only ever be a ledger, never an authority.

### 3b. The native bridge — plugin recommendation

**Recommend `@capgo/native-purchases`.** Checked against its README today, not run on a device:

- Wraps Google Play Billing Library 7.x and StoreKit 2, which covers iOS later with the same call.
- `purchaseProduct` takes `productIdentifier`, `planIdentifier` for the Play base plan, and `appAccountToken`, which it maps to Google's `obfuscatedAccountId`. **That last one is non-negotiable:** the server routine reads `obfuscatedExternalAccountId` from Google's purchase record to decide which learner owns a new token, and requires it to be the learner's `learners.id` UUID.
- Returns the Android `purchaseToken` on the transaction, which is exactly what `/api/store/play-verify` wants.
- Has `restorePurchases()` and an `autoAcknowledgePurchases` option. Set that option **off**, because the server acknowledges, and double acknowledgement is harmless but a client acknowledging a purchase the server never saw is a refund waiting to happen.

Why not the other two. **RevenueCat's Capacitor SDK** would put a paid middleman between the app and a server rail that already talks to Google directly, and the 4 September and 8 September scoping documents that recommended it predate the #812 build. **cordova-plugin-purchase** is capable and does ship a Capacitor package, but it is a larger cordova-era surface for the same three calls. If `@capgo/native-purchases` fails on a real handset in step 8, cordova-plugin-purchase is the fallback, and the server side does not change either way.

**One thing to verify at upload time, not from here:** Google raises the minimum Play Billing Library version on an annual cadence. The plugin says 7.x. Check the floor Play Console states the day the AAB is uploaded, and pick the plugin version accordingly.

### 3c. The app-side wiring, which is small by design

Every payment control in the app already asks one question, `canTakePayment()` in `packages/player-vue/src/platform/paymentRoute.ts`, and that file already answers `'store'` inside the shell and `'paddle'` on the web. The work is:

1. A `platform/storeBilling.ts` module wrapping the plugin: `purchase(productId, basePlan, learnerId)`, `restore()`.
2. One branch in `useCheckout.startCheckout()`: `'store'` → plugin purchase → post the token to `/api/store/play-verify` → refresh entitlement. Today the composable simply returns early when `canTakePayment()` is false; there is no store branch yet.
3. A **Restore purchases** control in Settings, shown only when the route is `'store'`. None exists today.
4. Flip `STORE_BILLING_WIRED` to `true`. That one constant switches every native payment affordance back on; the fourteen surfaces were funnelled through it on 4 September so that no screen-by-screen sweep is needed.

### 3d. The five environment variables

None of these are set on Vercel as far as the #812 write-up knew, and I cannot read Vercel's environment from this machine, so treat them as unset until someone checks:

| Variable | What it holds | Who supplies it |
|---|---|---|
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.automagic.a3f` once step 1 says GO | us |
| `GOOGLE_PLAY_SUBSCRIPTION_IDS` | comma-separated product ids the server will honour, **including the old app's existing ones** | dev team |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | service-account key with Android Publisher access | dev team |
| `GOOGLE_PLAY_PUBSUB_AUDIENCE` | the exact audience string of the authenticated push subscription | dev team, or us if we create the topic |
| `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` | the identity Pub/Sub pushes with | same |

**Go/no-go.** GO when a licence-tester account on a real phone buys the monthly product through the shell, `user_entitlements` gains a `play` row for that learner, the padlock opens without a reload, and a cancellation made in the Play Store arrives at the RTDN endpoint and closes the row at period end. Test on **staging** first: the endpoints are on staging too, and the shell's default origin is staging for exactly this reason.

## Step 4 — Existing subscribers

**The account question, answered as far as it can be from here.** Old-app users are **not** in our database. Evidence: the new app's `subscriptions` table holds 16 rows, all Paddle, none Play; the old app talks to `automagic.saysomethingin.com`, a backend this estate has no credential for; and the 6 September cutover sizing could not count legacy subscribers at all. So when an existing subscriber's phone auto-updates, they open a new app that has never heard of them, signed out, with no progress.

**What carries them across: their Google account, not their email.** Their subscription lives in Play under their Google account and `com.automagic.a3f`. The path is: open the new app → sign in or create an account → **Restore purchases** → the plugin hands back their existing purchase token → `/api/store/play-verify` → an entitlement row on the account they just signed in to. No mapping table between old and new accounts is needed for the money. Progress is a separate matter and is not recoverable by the new app from the old backend; that is a known loss and should be said in the release notes.

**One code change this needs, found by reading the grant routine.** `refreshPlayGrant` resolves the owner of a token in this order: an existing `play` row for that token, then a row for a linked token, then Google's `obfuscatedExternalAccountId`. For a token the old Flutter app created, none of those is a `learners.id` UUID, and the routine throws "Verified purchase has no canonical learner identity". So a legacy restore fails today. The fix is one rule: when a token is unknown to us and Google's account field is absent or not one of our ids, the signed-in caller becomes the owner. That is safe, because the caller's phone had to be signed in to the Google account that owns the purchase for the plugin to return the token at all, and Google's own ledger stays the authority on whether it is still paid. It is a small, tested change, and it should carry a test that fails on the current code.

**A second wrinkle, product ids.** Existing subscribers stay on whatever product ids the old app sold. Those ids must go in the allowlist above, alongside any new one. The 4 September design's `full.v1 / monthly` naming is right for anything new; it does not apply retroactively.

**Go/no-go.** GO when a real existing subscriber, ideally an IME tester who bought on the old app, updates, signs in, restores, and the padlock opens.

## Step 5 — The Upgrade fork and the browser-taster handover

**The fork exists, but it is by platform, not by country.** In the shell the route is the store; on the web it is Paddle. That is already the right shape for "India buys through Play", because the India go-to-market is the app. What the code does **not** do is stop an Indian learner on the website from buying through Paddle at the web price. The 4 September design took the position that the India price is Play-only and the web stays as it is. If the brief's "Paddle must never serve India" means the web must refuse or redirect Indian buyers, that is new work: an IP-country check at checkout that sends India to the Play listing. It is small, but it is a product decision, and it is not built. My read: leave the web alone for launch, measure Indian traffic at the web paywall, and build the redirect only if the number says so, which is what the design already argued.

**The handover, and what a learner's position is.** A learner who tasted in the browser as a guest has a guest id and their position in that browser's local storage. The shell is a different browser context, so none of that is visible to it. The only thing that carries a position from browser to app is **an account**: progress saved server-side under a signed-in learner is there the moment they sign in to the shell. So the handover is: the padlock in the browser offers **Get the app**, and the sign-in offer comes before it, so the position travels. A guest who declines to sign in and installs the app starts again, and that is the honest cost of declining. Note that Android App Links, which would let a link tapped in Gmail open inside the installed app, are not set up: there is no `.well-known/assetlinks.json` on the site. Nice-to-have, not launch-blocking.

**Go/no-go.** GO when a learner signs in on the web, plays past a few LEGOs, installs the shell, signs in, and lands on the same LEGO.

## Step 6 — Sign-in and locale, from job #655

Both defects Tom named on 8 September have been answered in code, and both are on `main`:

- **First open no longer lands in Chinese.** `containers/firstOpenDefaultCourse.ts` picks a free course whose known language is English when there is nothing else to go on. Verified on `main`.
- **Google sign-in is on the account screen, above the email field.** `auth/googleSignIn.ts`, verified on `main`. **But it is dark:** its own header says Supabase has `external_google_enabled: false` and no client id, so the button returns "Unsupported provider" until an OAuth client is created in Google Cloud and its id and secret are pasted into Supabase Auth. That is a console job, and it is on the dev-team list below because they hold the Google Cloud project.

**Go/no-go.** GO when a stranger's first open in the shell shows an English-known free course, and the Google button on the account screen signs a tester in.

## Step 7 — Staged rollout and rollback

Play Console tracks, in order: **internal testing** (up to 100 named testers, minutes to appear) → **closed testing** (IME's phones, needs a tester list) → **production at 10%** → **100%**. Halting a staged rollout stops the update reaching more phones; it does **not** take it back from phones that already have it.

So the rollback story has two halves, and the 18 September update-channel write-up already spells out the first:

- **Anything in the web app:** revert the Vercel deployment. Every installed shell is a window onto that deployment and takes the reverted code on its next launch. This covers most of what could go wrong after launch, and it needs no Play action at all.
- **Anything native** — the billing plugin, a manifest change, the WebView settings: only a new AAB through Play fixes it. Halt the rollout to contain it, then ship the fix. There is no way to push the old binary back onto an updated phone.

**Go/no-go per track.** Internal: the team's own phones pass steps 2 to 6. Closed: IME's list below passes. 10%: no rise in support tickets and RTDN traffic looks like renewals, not refunds, for a few days. Then 100%.

## Step 8 — What IME tests on real phones

On mid-range Indian handsets, on mobile data, not only Wi-Fi:

1. Fresh install from the closed-testing link: first open lands in an English-known free course, not Chinese.
2. Google sign-in on the account screen works; email code sign-in still works.
3. Play a free course online, then switch to airplane mode and play on.
4. Hit the padlock at the end of Yellow belt in a premium course; the price shown is the INR price.
5. Buy with UPI through the Play sheet as a licence tester; the padlock opens without reopening the app.
6. Uninstall, reinstall, sign in, Restore purchases; the padlock opens.
7. On a phone that has the **old** app with a live subscription: update, sign in, Restore purchases; the padlock opens.
8. Cancel in the Play Store app; access continues to period end and then closes.
9. Settings → the build row says `main`; the update tap reports "already latest" or "newer version ready" and does not interrupt audio.
10. Kill the app mid-play, reopen, and the position is where they left it.

## Order and parallelism

| Now, in parallel | Then | Then |
|---|---|---|
| Step 1 console check (dev team) | Step 2 release build under the confirmed package name | Step 7 internal → closed |
| Step 3 native bridge on the dev appId, tested against staging with a licence tester | Step 4 legacy-restore code change and IME subscriber test | Step 8 IME list |
| Step 6 Google OAuth client (dev team) and step 5 web-side handover copy | Step 3d env vars on staging then production | 10% → 100% |

**The one thing Tom must decide:** the package name, once step 1 reports. Everything else follows from that answer.

---

# PART B — THE ASK OF THE DEV TEAM

Paste from here. MUST-HAVE items block a step above; NICE-TO-HAVE items save time or risk.

**Play Console and ownership**

1. **MUST** — Play Console access for SaySomethingin's own Google account at Admin level on the developer account that owns `com.automagic.a3f`, or a documented transfer of the app to a developer account we own. Name which Google account owns the developer account today.
2. **MUST** — From Play Console → Setup → App signing: is **Play App Signing enrolled** for `com.automagic.a3f`? A screenshot of that page is enough.
3. **MUST** — The **upload keystore** file with its store and key passwords and alias, delivered out of band, never by email or chat, or written confirmation that it is lost so we request an upload-key reset from Play support. If Play App Signing is **not** enrolled, the original release keystore instead, and the same rule applies.
4. **MUST** — The old app's **current production versionCode and versionName**, and the track it is on.
5. **NICE** — The Play Console export of the listing: store copy, screenshots, content rating answers, Data Safety answers, so we reuse rather than re-author.

**Billing configuration**

6. **MUST** — Every **subscription product id and base plan id** configured on the listing, with their INR and other-country prices as set today. We expect a monthly at ₹299 and an annual at ₹2,990; we need the exact ids to allowlist.
7. **MUST** — Any **offers** on those base plans, and the grace period and account-hold settings, as configured.
8. **NICE** — Current **active subscriber count** per product, and the last 90 days of new subscriptions, cancellations and refunds, from the Play Console financial reports.
9. **NICE** — Confirmation of whether the old app sets Google's `obfuscatedAccountId` on purchases, and to what. It changes nothing in the plan, but it tells us what Google's records will say for existing subscribers.

**Server access**

10. **MUST** — A **Google Cloud service account** linked to the Play developer account with **View financial data** and **Manage orders and subscriptions** permissions, and its **JSON key**, delivered out of band. Or, if you prefer we create it, Owner access on the Google Cloud project linked to Play.
11. **MUST** — **Real-time developer notifications**: either the existing **Pub/Sub topic name** and the service account that pushes from it, or permission for us to create a topic and a push subscription to `https://saysomethingin.app/api/store/play-rtdn` with an OIDC token. We need the push identity's email and the audience string either way.
12. **MUST** — A **Google OAuth client** in the same Google Cloud project for Google sign-in on the web app, or Owner access so we create one. We need its client id and secret, delivered out of band.

**Testing**

13. **MUST** — **Internal testing track** access for our named Google accounts, and **licence tester** status for them and for IME's test accounts so purchases can be made without real charges.
14. **MUST** — A **closed testing track** with IME's tester list attached.
15. **NICE** — Two real subscribers on the old app who will act as the step-4 restore test, with their consent.

**The old app, for reference**

16. **MUST** — The old app's **account model**: how a user is identified in `automagic.saysomethingin.com`, whether Google and Facebook sign-ins map to an email, and whether purchases are recorded against that account. One page is enough.
17. **NICE** — The Flutter app's **billing flow source** and the backend's Play verification code, read-only, so we compare behaviour on edge cases such as grace and hold.
18. **NICE** — Read access, or an export, of the legacy backend's subscription and entitlement tables with emails, so we can size the migration and honour promotional grants. The 6 September sizing named this as the first question to ask and it is still open.

---

## What this document could not verify, stated plainly

- Whether Play App Signing is enrolled, the old app's versionCode, its product ids, and its subscriber count: all live in a console this machine cannot open. Items 2, 4, 6 and 8 above.
- Whether the five Play environment variables are set on Vercel: not readable from here, assumed unset.
- The plugin's behaviour on a real handset: its README was checked today; nothing was installed or run, and this box cannot run an Android emulator.
- Whether old-app purchases carry an account identifier Google will report: unknown; the step-4 code change is designed so that it does not matter.
- The current Play Billing Library floor Google enforces at upload: verify in Play Console on the day.
