# The Android app is now a window onto production

Tom's ruling, 8 September 2026: *"We also want the Android app to be serving main now
right? Now we've tested it."* The staging wrap was the proving ground and it proved.
The shell now loads `https://saysomethingin.app`.

## What changed

One constant. The shell has carried no web code of its own since the remote-shell work
landed — it is a WebView onto a real deployment, and which deployment is a single line in
`capacitor.config.ts`. That line moved from staging to production, and the build script's
own fallback moved with it. A test now pins the value, so a quiet revert cannot ship a
wrap that looks right and serves the wrong code.

The web-side half of the remote-shell work went to production in the same promotion. The
only behavioural change in it is that the service worker now runs inside the WebView, which
is what makes offline play possible there. **Nothing changes for a learner in an ordinary
browser** — the gate it replaced already returned true for every non-WebView build.

## What was proved, on production, headlessly

watson-1 cannot boot an Android emulator — no `/dev/kvm`. The decided substitute is headless
Chromium wearing the shell's own user agent, so the app takes the same WebView branch it
takes on a handset.

**Offline play — all pass.** Against the live production origin: the service worker
registered and precached the shell (520 cached responses), audio played online and landed
in IndexedDB (144 clips), then the network was genuinely cut at the network layer, a cold
navigation still booted from the precache, and **audio played on with no network at all**.

**Tap to update — the half that was still owed.** The previous proof mutated a local build
underneath a running page and said so honestly. This one is against a real deploy, and the
shell was warmed on one production build and updated onto another:

1. A shell was warmed on production and its service worker took control. While production
   had not moved, asking for an update found **nothing** — that negative is what makes the
   positive below mean something.
2. A change was landed on production the ordinary way, down the promotion train.
3. Asking for the update then found a new worker and it went to **waiting**, and
   `controllerchange` fired **zero times** — the update did not seize the live page. That is
   Tom's rule, and the reason for it is that seizing kills the audio in flight.
4. Applying it retired the waiting worker, made the new one the active one, and the app was
   running the **new** build — asserted on the build id production itself chose, not on a
   marker the probe injected.

**One correction worth having, because it changes what the button means.** The first run
against a real deploy failed, and the failure was in my expectation rather than in the app.
Navigations are **NetworkFirst on purpose** — the build config says so in as many words, "so
the next natural page load always sees the fresh shell". So with the network up, simply
opening the app already fetches the new shell; "you are stuck on old code until you tap" is
not true online. What the tap actually owns is the **precache** — the copy the app runs when
there is no network. So the honest description of the button is: it brings the offline copy
up to date, and it never interrupts you to do it.

## What is still not proved here

The tap itself, on Android hardware, by a person. Everything above holds the WebView's
conditions in a desktop browser; it does not press the button in the app. That is the
walkthrough below, and it is the last piece.

## Tom's walkthrough

**The app:**
`ssi-devwrap-0ed4a7ec-remote-production-debug.apk`
https://watson-1.tail4968cb.ts.net:8449/ssi-devwrap-0ed4a7ec-remote-production-debug.apk

1. **Remove the old one first.** The staging wrap and this one share the same app identity,
   so Android will refuse to install over it. Uninstall "SSi (dev wrap)" if it is there.
2. Download the file above onto the emulator and install it.
3. Open it. It loads from the live site, so give it a moment on a cold start.
4. **You will be signed out, and the build card in Settings will say nothing came across
   from the old origin.** That is right, not a fault: the app keeps your state against the
   address it is looking at, and this is a different address from the staging wrap. Sign in
   as you normally would.
5. **Settings → the build row.** It shows a short code and the word `main`. That code is the
   live site's current build — the shell has no code of its own to report, so if that row
   says `main` you are looking at production.
6. **The update test.** Leave the app for a while, come back after something new has shipped,
   and open Settings. When there is new code it offers to update. Tap it. The app reloads and
   the code in the build row changes — that is a real fetch of new web code, which the old
   bundled app could never do.
7. **The offline test, if you want it.** Play for a minute or two with the network on, then
   turn the emulator's network off entirely and open the app again. It should still start and
   still play.
