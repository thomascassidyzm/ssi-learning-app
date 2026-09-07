# JOB A — porting the Capacitor wrapper to iOS: the size

**2026-09-06, job #737. Sizing only. Nothing was built, signed, uploaded or installed;
no application code was changed by this job.**

This does not re-derive job #558's iOS map (`docs/ios-testflight-map-2026-09-05.md`, on the
unmerged branch `cs/558-ios-cost-divergence-and-the-mac-`). #558 ran on Linux and said so
plainly. What this job adds is the thing #558 could not do: **it went to Holmes.** Two of
#558's assumptions did not survive, and one of its facts turned out to be sitting on the
Mac in binary form.

---

## 0. The headline

**Holmes is a real Mac and it cannot build an iOS app today.** Xcode is not installed —
only the Command Line Tools, and those are from February 2024. There are **zero code
signing identities** in its keychain, no provisioning profiles, no fastlane, no App Store
Connect key, and no Node toolchain at all. And it has **31 GiB free on a 460 GiB disk**,
which is thin for an Xcode install.

Against that: the Apple Developer Program membership question — #558's largest open
unknown — is **settled, from the estate**, because the live legacy iOS app is installed on
Holmes and its code signature names the team.

---

## 1. Holmes — every claim with the command that proved it

All commands run as `ssh holmes '<cmd>'` from watson-1, non-interactively, 2026-09-06.
Holmes is on the tailnet at `100.84.15.13`.

| Claim | Command | Result |
|---|---|---|
| It is a real Mac, Apple Silicon | `sysctl -n hw.model machdep.cpu.brand_string` | `Mac16,13` / `Apple M4` |
| macOS version | `sw_vers` | macOS **15.5** (24F74) |
| SSH works non-interactively as a real user | `whoami; id` | `tomcassidy`, in group `204(_developer)` |
| **Xcode is ABSENT** | `ls /Applications \| grep -i xcode` | **no output** |
| **Xcode is ABSENT (2nd proof)** | `mdfind "kMDItemCFBundleIdentifier == com.apple.dt.Xcode"` | **no output** |
| **Xcode is ABSENT (3rd proof)** | `ls -la /Library/Developer` | only `CommandLineTools` |
| Active dev dir is CLT, not Xcode | `xcode-select -p` | `/Library/Developer/CommandLineTools` |
| `xcodebuild` unusable | `xcodebuild -version` | `error: tool 'xcodebuild' requires Xcode … is a command line tools instance` |
| **No iOS SDK** | `xcrun --sdk iphoneos --show-sdk-version` | `error: SDK "iphoneos" cannot be located` |
| Only macOS SDKs present | `ls /Library/Developer/CommandLineTools/SDKs` | `MacOSX.sdk, MacOSX13.3, MacOSX13, MacOSX14.4, MacOSX14` — **no iPhoneOS.sdk** |
| **No simulator** | `xcrun simctl list runtimes` | `error: unable to find utility "simctl"` |
| CLT are stale | `clang --version` + `ls -l …/usr/bin/clang` | Apple clang **15.0.0**, binary dated **23 Feb 2024** |
| **No signing identity** | `security find-identity -v -p codesigning` | **`0 valid identities found`** |
| **No signing identity of any kind** | `security find-identity -v` | **`0 valid identities found`** |
| No provisioning profiles | `ls ~/Library/MobileDevice/Provisioning\ Profiles/` | `No such file or directory` |
| No fastlane | `ls ~/.fastlane; which fastlane` | absent / `fastlane not found` |
| No App Store Connect API key | `ls ~/.appstoreconnect; ls ~/private_keys` | both `No such file or directory` |
| **No JS toolchain** | `which node npm pnpm brew` | all `not found` |
| Java and git present | `which java git` | `/usr/bin/java`, `/usr/bin/git` |
| Android Studio present | `ls -d /Applications/*.app` | `/Applications/Android Studio.app` |
| Disk | `df -g /System/Volumes/Data` | 460 GiB total, **31 GiB available**, 93% used |
| Holmes is busy | `uptime` | load averages **6.40 5.67 5.31**, up 58 days |

**Nothing was installed on Holmes.** Every command above is a read.

### What this costs

Xcode has to be acquired and installed before any `.ipa` can exist. Three separate
failure modes, each its own line, and they are not the same thing:

1. **Acquisition.** Xcode comes from the Mac App Store (needs Tom's Apple ID at a GUI
   prompt on the machine — not drivable over SSH) or from
   `developer.apple.com/download` as a `.xip` (needs a signed-in developer account
   cookie; scriptable with `xcodes`, which itself needs Homebrew, which is also absent).
   Either way **a human is at Holmes for this step**, or hands over a session cookie.
2. **Disk.** 31 GiB free. Apple's published minimum for Xcode 16 is ~8 GiB for the
   download and considerably more during extraction, with the installed app plus one
   iOS SDK and one simulator runtime landing in the tens of GiB. *This is the one figure
   here I could not measure on this estate — I am not going to invent it.* What I can
   say with certainty is that **31 GiB is inside the margin where it might not fit**, and
   the honest instruction is: clear space on Holmes first and confirm the requirement on
   Apple's own download page at install time. If it does not fit, that is a disk-clearing
   job before the port, not during it.
3. **Headless drivability.** Installing Xcode is not the same as being able to drive it
   over SSH. After install: `sudo xcodebuild -license accept` and
   `sudo xcode-select -s /Applications/Xcode.app` both need an interactive sudo password,
   and first launch installs additional components with its own GUI prompt. **And the
   keychain**: `security find-identity` over SSH reads the login keychain only if it is
   unlocked; a signing build driven over SSH will fail on a locked keychain unless
   `security unlock-keychain` is run with the password, or a dedicated build keychain is
   created. None of this is hard. All of it needs Tom at the machine once.

**Holmes also has no Node.** The wrapper's build is
`pnpm install; pnpm --filter @ssi/core build; pnpm --filter player-vue build; node
scripts/injectPlatform.mjs …; npx cap sync ios`. That whole chain needs Node + pnpm
installed on Holmes, or the `dist/` artefact built on watson-1 and copied across. The
second is cheaper and I'd recommend it: `dist/` is the only thing Xcode needs.

**And Holmes is not idle** — load average 6.4, up 58 days, four users. An Xcode build on
it is not free to whatever else is running there.

---

## 2. Apple account, bundle id, signing, TestFlight

### What is PROVED, from the estate

The live legacy iOS app is **installed on Holmes** at `/Applications/SaySomethingin.app` —
an App Store purchase redownloaded onto Apple Silicon. Its code signature and Info.plist
are readable, and they settle several things #558 could only infer:

| Fact | Command | Value |
|---|---|---|
| **Apple Team Identifier** | `codesign -dv --entitlements - /Applications/SaySomethingin.app` | **`U6RU2PLYFR`** |
| Signed bundle id | same | **`com.saysomethingin.apple`** |
| Publisher of record | `plutil -p …/Wrapper/iTunesMetadata.plist` | **`SaySomethingin.com Ltd`** |
| Sign in with Apple is a live entitlement | same codesign output | `com.apple.developer.applesignin: [Default]` |
| Push is provisioned for production | same | `aps-environment: production` |
| **Background audio already granted** | `plutil -p …/Wrapper/Runner.app/Info.plist` | **`UIBackgroundModes: [audio]`** |
| The legacy app is **Flutter** | `ls …/Wrapper/Runner.app/Frameworks` | `Flutter.framework`, `App.framework` |
| **Apple IAP is live in it** | same | **`in_app_purchase_storekit.framework`** |
| Three social doors | same | `sign_in_with_apple`, `GoogleSignIn`, `FBSDKLoginKit` |
| Installed copy | same Info.plist | v1.0.3 (build 135), min iOS 15.0, built Xcode 15.2 / iOS SDK 17.2 |
| Live store version | `curl itunes.apple.com/lookup?id=6476493414` | **v2.0.15**, released **2026-07-08**, free, 3.8★/26 ratings, 110 MB |
| `com.automagic.a3f` is NOT an iOS listing | `curl itunes.apple.com/lookup?bundleId=com.automagic.a3f` | `resultCount: 0` |
| `com.automagic.a3f` IS the live **Play** listing | `curl play.google.com/store/apps/details?id=com.automagic.a3f` | 200, title "SaySomethingin" |

**A Team Identifier and a production `aps-environment` cannot be minted without a paid
Apple Developer Program membership.** So: a membership exists, held by
**SaySomethingin.com Ltd**, team **`U6RU2PLYFR`**, and it was current at least on
2026-07-08 when v2.0.15 shipped. That is as far as the evidence goes.

**Correction to the brief, and to `capacitor.config.ts`'s own comment:** the file says
`com.automagic.a3f` is "the live published listing". It is — **on Google Play**. The live
**iOS** listing is `com.saysomethingin.apple`. The two platforms have different package
identities and the irreversible-id decision has to be taken separately for each.

### What is NOT proved — and cannot be, from here

- Whether the membership is **current this week**. An App Store listing can outlive a
  lapsed renewal by some days.
- **Who the Account Holder is.** Nothing on this estate names them.
- Whether an **App Store Connect API key** exists. None on Holmes (proved above); it could
  exist in someone's downloads or a CI secret store I cannot see.
- Whether the **Small Business Program** (15% instead of 30%) is enrolled.
- What **IAP products** exist under the live listing, and how many subscribers are on them.

These are §5's list for Ivan and Tom.

### Signing: the honest state

`0 valid identities found` on Holmes. That is not a problem — Xcode's automatic signing
mints a development certificate and profile itself on first run, given a signed-in Apple
ID with team access. It IS a problem for anything headless: **a fully scripted build on
Holmes cannot happen until (a) Xcode has run once interactively and signed in, and (b)
either the keychain is unlocked for the SSH session or an App Store Connect API key
exists.** Step 3 of #558's sequence — download the `.p8` key — is the five minutes that
converts this whole lane from "Tom at the Mac" to "a worker can do it".

---

## 3. Capacitor plugins — the inventory, and it is very short

| Question | Command | Answer |
|---|---|---|
| What Capacitor deps exist | `grep -i capacitor packages/player-vue/package.json` | **only** `@capacitor/android`, `@capacitor/core`, `@capacitor/cli`, all `^8.5.1` |
| What plugins the Android build compiles | `cat packages/player-vue/android/app/capacitor.build.gradle` | **`dependencies { }` — empty** |
| What permissions Android asks for | `cat android/app/src/main/AndroidManifest.xml` | **`INTERNET` only** |
| Is `@capacitor/ios` published at the same version | `npm view @capacitor/ios version` | `8.5.1` |

**Confirmed, and it is the single largest fact in Job A's favour: the app uses ZERO
third-party Capacitor plugins.** The usual iOS port cost — auditing a plugin list for iOS
support, finding two that are Android-only, replacing them — is **zero here**. This
matches #558's finding; I re-verified it rather than trusting it.

### SystemBars — checked, because the config file names it

`capacitor.config.ts` configures a `SystemBars` plugin with `insetsHandling: 'css'`, which
looks like a dependency. It is not one:

```
grep -rl SystemBars node_modules/@capacitor/android
  → capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java
```

SystemBars is **built into Capacitor 8's core**, both platforms. No install needed.

**But the two platforms' SystemBars are not the same plugin, and this matters.** I pulled
`@capacitor/ios@8.5.1` and read it:

```
npm pack @capacitor/ios@8.5.1 && tar xzf … && cat package/Capacitor/Capacitor/Plugins/SystemBars.swift
```

The iOS `CAPSystemBarsPlugin` is 133 lines and exposes exactly four methods —
`setStyle`, `setAnimation`, `show`, `hide`. **There is no `insetsHandling` option on iOS
and it never sets `--safe-area-inset-*` CSS custom properties.** So the `'css'` config
line is an Android-only instruction that iOS will simply ignore.

**Is that a defect? No — the app already handles it, and I checked rather than assumed.**
`src/platform/shellSafeArea.ts` `measureInsets()` falls back to reading native
`env(safe-area-inset-*)` through a probe element when Capacitor's properties are absent,
which is exactly the iOS case, and WKWebView with `viewport-fit=cover` reports those
natively. And the Android-specific 48dp nav-bar floor is gated on
`shouldApplyAndroidClearance(nativeShell, ua)`, which requires an **Android user agent** —
so an iPhone will not get Android's clearance rule. The module was written iOS-safe.
**No work here. Verify on a device, don't budget for it.**

### Background audio — the hard one, and it is already half-solved

*Verified in the repo:* `packages/player-vue/src/playback/silentWav.ts` exists and its
header describes the lock-screen protocol in terms of **iOS Safari's own constraint** —
"iOS Safari freezes JS timers on a backgrounded or screen-locked tab, so ANY playback gap
driven by a bare setTimeout dies under lock… play a silent one-shot clip on the SAME
element the real clips use and advance on its natural 'ended'". `mediaSession` is used in
`SimplePlayer.ts`, `LearningPlayer.vue` and `ListeningOverlay.vue`. There is a
`useAudioSessionKeepalive` and there are shipped commits titled *"the keepalive holds the
iOS session through an interruption"* (`b95158cb`) and *"another app taking the audio
session no longer kills the session"* (`9a3f3d61`).

**So the hardest iOS-specific audio problem in this product was solved months ago, on iOS
Safari, and WKWebView is the same WebKit engine.** The native wrapper starts from a better
position than the PWA, not a worse one.

*Verified from the legacy binary:* `UIBackgroundModes: [audio]` is already granted on
`com.saysomethingin.apple`, and **Apple has already reviewed and approved a background-audio
justification for this product**. That materially de-risks the review argument.

*Asserted, and only a device settles it:* whether the silent-WAV keepalive is still needed
once a native `AVAudioSession(.playback)` holds the session, or whether the two fight. The
first hour with an iPhone is: build, play, lock the screen, wait 30 minutes. Binary. No
amount of reading answers it.

*Already in the scaffold:* #558's branch added `UIBackgroundModes: audio` and
`NSMicrophoneUsageDescription` to the generated `Info.plist` — the latter because
`getUserMedia` without that string is a **process kill** on iOS, not a denied prompt.

### In-app purchase

Nothing exists on the Capacitor side, on either platform. Proved:

```
grep -ril "storekit\|revenuecat\|play_billing" api/ --include=*.ts   → 0 files
grep -n STORE_BILLING_WIRED packages/player-vue/src/platform/paymentRoute.ts
  → export const STORE_BILLING_WIRED = false
```

`paymentRoute.ts` is genuinely good work: **one** declaration, `webview → 'store'`, every
payment affordance gating on `canTakePayment()`, and seat purchase excluded from a webview
build at compile time via a Vite `define` so it is not in the artefact to be flipped. iOS
needs **no new abstraction** — only the StoreKit wiring behind the existing seam, and only
when Tom wants iOS to take money. **A TestFlight build with payments honestly dark is a
valid deliverable and does not need any of this.**

---

## 4. THE SIZE

### What exists already (verified, not assumed)

- The Capacitor wrapper, **merged to `origin/dev`** — `git cat-file -e
  origin/dev:packages/player-vue/capacitor.config.ts` succeeds. (The brief said it was not
  on `dev`; it is. 53 files under `packages/player-vue/android/` on `dev` too.)
- Zero third-party plugins to port.
- The platform seam (`capabilities.ts`), the payment seam (`paymentRoute.ts`), the
  safe-area module — all platform-general, all already iOS-aware where it matters.
- `api/_utils/cors.ts` already allowlists `capacitor://localhost` — **but only on `dev`**
  (#558's finding; staging and main cannot answer a wrapper until it promotes).
- The lock-screen audio protocol, written against iOS's constraint.
- **A generated iOS Xcode project already exists**, on the unmerged branch
  `cs/558-ios-cost-divergence-and-the-mac-` (commit `46e5aad2`) — SPM-based, no CocoaPods
  step, deployment target iOS 15.0. **Never compiled.** Treat as plausible, not working.
- An Apple Developer Program membership, team `U6RU2PLYFR`, publisher SaySomethingin.com Ltd.
- Background-audio entitlement already reviewed and approved for this product on iOS.

### What is genuinely new work

| # | Step | Order of magnitude | Who | Confidence |
|---|---|---|---|---|
| A1 | Clear disk on Holmes so Xcode fits (31 GiB free today) | ~1 hour | worker or Tom | **wide** — depends on Xcode's real requirement, unmeasured |
| A2 | Acquire + install Xcode + iOS SDK on Holmes | half a day, mostly download | **Tom at the machine** (Apple ID GUI prompt) | medium |
| A3 | Post-install: licence accept, `xcode-select -s`, first-launch components, keychain policy for SSH | 1 hour | Tom once, then scriptable | medium |
| A4 | Confirm membership is current; note SBP enrolment | 10 min | **Tom / Ivan** | high |
| A5 | **The bundle-id decision** | one sentence, forever | **TOM ONLY** | — |
| A6 | Register identifier + Background Modes capability; create App Store Connect API key (`.p8`, downloadable once) | 15 min | **Tom** | high |
| A7 | Build `dist/` on watson-1, stamp with `injectPlatform.mjs … ios`, copy to Holmes, `npx cap sync ios` | 1 hour first time | worker | high |
| A8 | Open in Xcode, automatic signing, run on a real iPhone | half a day first time — this is where unknown-unknowns land | Tom + worker | **wide** |
| A9 | **The audio go/no-go**: play, lock, 30 minutes | 1 hour, on a device | Tom or Kai | binary, unknowable until run |
| A10 | If A9 fails: AVAudioSession category in AppDelegate (~5 lines Swift) and re-test | half a day to 2 days | worker | wide |
| A11 | Archive + upload to App Store Connect; TestFlight internal group | half a day | Tom (first), worker after A6 | medium |
| A12 | Storage behaviour under WKWebView for a large offline course | half a day of device testing | worker | wide |

**Honest total for "an iOS build in a tester's hands on TestFlight": two to four working
days of worker time, plus roughly one hour of Tom's own time spread over steps A2–A6, plus
one download-shaped wait.** The uncertainty is not evenly spread: A1–A7 are dull and
predictable, and **A8/A9 carry almost all of it**. A first Xcode build of a never-compiled
generated project can be twenty minutes or it can be a day.

Store *release* (as opposed to TestFlight) is a separate and larger job and is not sized
here — it drags in Guideline 4.2 minimum-functionality review risk, IAP wiring, and the
bundle-id decision's consequences. Say so to anyone who asks.

### What could kill it

1. **Xcode does not fit on Holmes and nobody can free 20+ GiB.** Cheapest failure, easiest
   to check first, and the reason A1 is step one.
2. **Nobody can sign in to the Apple Developer account.** If the Account Holder is not Tom
   and not reachable, everything downstream stops. This is the single highest-value
   question on the Ivan list and it should be asked tonight, not at step A4.
3. **The membership has lapsed since July.** Recoverable — a card payment — but it is a
   day of Apple's clock, not ours.
4. **A9 fails and cannot be fixed from the WebView.** If locked-screen audio genuinely
   needs a native session and the native session fights the keepalive, that is real Swift
   work in a codebase with no Swift in it. Bounded — the legacy Flutter app does it, so it
   is possible — but it is the one place a "port the wrapper" job turns into "write native
   audio code".
5. **Holmes is a single point of failure** — one 58-day-uptime machine at load 6.4, on a
   tailnet, that is also somebody's desktop. It is fine for a first build. It is not a
   build server.

### The one thing I'd do differently from #558's sequence

#558's step 6 says clone and `pnpm install` on the Mac. **Holmes has no Node, no npm, no
pnpm and no Homebrew** (proved above), so that step is really "install a JS toolchain on
Tom's desktop Mac" — and it is avoidable. Build `dist/` on watson-1, where the toolchain
already works, and copy the folder. Xcode needs the artefact, not the build.

---

## 5. What only Ivan or Tom can answer — Job A

Each answerable in one line.

1. **Who is the Account Holder on Apple Developer team `U6RU2PLYFR` (SaySomethingin.com Ltd), and can Tom sign in at developer.apple.com/account today?**
2. **Is the membership currently paid, or has it lapsed since 8 July 2026?**
3. **Is the Small Business Program (15% commission) enrolled?**
4. **Does an App Store Connect API key (`.p8`) already exist anywhere, and who has it?** (None on Holmes — proved.)
5. **Does anyone hold a distribution certificate / provisioning profile for this team on any other machine?** (None on Holmes — proved.)
6. **The bundle-id decision, Tom's alone:** does the new iOS build take `com.saysomethingin.apple` — which eventually updates the app under every existing paying user of it — or ship as a new listing starting from zero installs? A third door: a throwaway id for TestFlight only, deciding later. *An id, once uploaded under, can never be renamed or reused.*
7. **Can 20–30 GiB be freed on Holmes, or should Xcode go on a different Mac?**
8. **Who has an iPhone available to run the A9 audio test — Tom, Kai, or Aran?**

