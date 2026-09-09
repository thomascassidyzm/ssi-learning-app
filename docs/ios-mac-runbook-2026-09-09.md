# The iOS shell: what to do on the Mac

**2026-09-09 · branch `cs/711-ios-shell-as-far-as-linux-can-mi` · not merged, not deployed.**

Everything a Linux box could do is committed. What is left needs macOS. Fifteen steps, in
order, assuming Xcode has never been opened for this project. Steps marked **[guess]** are
reasoned from documentation, not from having done them.

Get the branch first: `git fetch && git checkout cs/711-ios-shell-as-far-as-linux-can-mi`,
then `pnpm install` at the repo root, then `cd packages/player-vue`.

1. **Install Xcode** from the App Store, open it once, accept the licence, and let it install
   the iOS platform support it asks for. Then `xcode-select --install` for the command line
   tools if `git` in Terminal ever complains.

2. **Write the holding page.** `scripts/write-shell-web.sh` — one command, no arguments,
   defaults to production. It creates `shell-web/index.html`, which is `webDir`. Nothing
   loads it; `cap sync` refuses to run without it.

3. **Sync.** `npx cap sync ios`. This copies `shell-web` into the iOS project, writes
   `ios/App/App/capacitor.config.json` from `capacitor.config.ts`, and pins the Swift package.
   It already ran clean on Linux, so if it fails here something else is wrong.

4. **Open the project.** `npx cap open ios` — that launches Xcode on
   `ios/App/App.xcodeproj`. Xcode will resolve the `capacitor-swift-pm` package from GitHub
   on first open; give it a minute. There are no CocoaPods in this project, so there is no
   `pod install` step and no `.xcworkspace`.

5. **Sign in to Xcode.** Xcode → Settings → Accounts → **+** → Apple ID. A **free** Apple ID
   is enough for everything up to step 12.

6. **Set the team and check the bundle id.** Select the **App** target → **Signing &
   Capabilities**. Tick **Automatically manage signing** and pick your Team. The bundle id is
   already `com.saysomethingin.devwrap` — a deliberate throwaway, matching what Android uses.
   It is **not** `com.automagic.a3f`, the live published listing; taking that id would push
   this build out to every existing user of it, and that call is yours alone.

7. **Add the Background Modes capability.** Still in Signing & Capabilities: **+ Capability**
   → **Background Modes** → tick **Audio, AirPlay, and Picture in Picture**. `Info.plist`
   already declares `UIBackgroundModes: audio`, but Xcode wants the capability declared here
   too, and this is what writes it into the provisioning profile. **[guess]** on whether Xcode
   silently reconciles the two — check the plist afterwards and make sure your click did not
   duplicate the key.

8. **Plug in the iPhone,** unlock it, trust the Mac when it asks, and select it as the run
   destination in the toolbar. On the phone: Settings → Privacy & Security → **Developer
   Mode** → on, then reboot. iOS 16+ requires this before it will run your build.

9. **Run it.** ⌘R. The first launch fails with "Untrusted Developer" on a free account: on the
   phone, Settings → General → VPN & Device Management → your Apple ID → **Trust**. Then ⌘R
   again.

10. **THE FIRST TEST, and it is the whole question.** Get to a pronunciation practice and let
    it reach for the microphone. Expect ONE iOS permission prompt reading *"SSi uses the
    microphone to hear you speak during practice."* Grant it, speak, and confirm it hears you.
    If that works, the remote-origin shell design is proven on iOS and everything else is
    detail. If it silently does nothing, open Safari on the Mac → Develop → your iPhone →
    the WebView, and read the console for the actual `getUserMedia` rejection —
    `webContentsDebuggingEnabled` is already on for exactly this. Full reasoning:
    `docs/ios-remote-origin-microphone-2026-09-09.md`.

11. **The second test: lock the screen mid-session.** Start a learning session, press the
    side button, and confirm audio keeps playing and the lock screen shows it. If it stops the
    instant you lock, the Background Modes capability from step 7 did not take, or the app has
    not set an `AVAudioSession(.playback)` — that second part is Swift nobody has written yet,
    and this test is how you find out whether it is needed. **[guess]**

12. **Check the notch and the home indicator.** Look at the top and bottom chrome in portrait
    and landscape. iOS insets are read natively through `env(safe-area-inset-*)` and nothing
    in the shell config touches them, so this should be right already — but this is the one
    thing no Linux box could look at.

—— everything below needs a **paid** Apple Developer account, £79/year ——

13. **Enrol** at developer.apple.com, then in the portal → Certificates, Identifiers &
    Profiles → Identifiers, find or create `com.saysomethingin.devwrap` and enable
    **Background Modes** on the App ID itself. The Xcode-side capability in step 7 is not
    enough on its own for a distributed build. **[guess]** on whether a Store-distributed
    build refuses without it or merely loses the capability.

14. **Archive and upload.** Product → Destination → *Any iOS Device*, then Product →
    **Archive**, then **Distribute App** → **TestFlight & App Store**. First upload to App
    Store Connect triggers an export-compliance question — the app uses standard HTTPS only,
    so the exemption answer is the ordinary one. **[guess]**

15. **TestFlight.** In App Store Connect the build appears after processing; add internal
    testers and it installs over the air. Payments are honestly dark in this build —
    `STORE_BILLING_WIRED = false` in `src/platform/paymentRoute.ts` — so no StoreKit work is
    needed for a TestFlight round.

## Two optional things, neither blocking

- **The app icon** is still the Capacitor placeholder. Replacing it is one 1024×1024 PNG
  dropped into `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`; Xcode
  generates every other size. The repo's largest brand icon is 512, so nothing could be
  generated here without upscaling it into something soft.
- **Pointing at staging instead of production:** `SSI_SHELL_ORIGIN=https://staging.saysomethingin.app scripts/write-shell-web.sh` then re-run step 3. One switch, same as Android.
