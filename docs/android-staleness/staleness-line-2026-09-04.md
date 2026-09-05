# The Android app can now tell you it is out of date

**Install:** https://popty.app/builds — the top entry, cut from tonight's dev.
It installs **over** the build already on your phone.

**After installing, Settings shows exactly this on the build row:**

    local-<sha>          4 Sept 2026, <time>     Tap to update ›
    ssi-learning-app-git-dev-zenjin.vercel.app

The `<sha>` is the commit named in that build's entry on popty.app/builds — the entry
states the exact string to expect, because it is written after the bytes exist. This file
deliberately does not hardcode it: a doc that names a sha is a doc that is wrong one
commit later, which is the same class of defect as the silence this change cures. If the
row reads `89af35fc` or a `dev-` clock reading, you are holding an older APK and the
install did not take.

**And tonight a fresh install should say nothing more than that.** The line is silent when
the app is current, and this APK was cut from the exact commit dev is deploying — so
there should be no extra sentence on the build row when you install it. Seeing one
tonight would itself be the bug.

**Tomorrow it will start speaking, and that is the point.** The APK compares itself
against what is live on dev, and dev moves constantly. So the first time anyone pushes
work after this build, your phone will start saying it is from 4 September and a newer
version exists — truthfully, because the code in your hand really will be behind. That is
the undetectable lag becoming a self-describing state.

## What changed

The APK bundles the whole web app inside itself and serves it from `https://localhost`.
That stays — your ruling. What it left behind was silence: the app checked whether it was
up to date by fetching `/version.json`, which inside the APK is its own frozen copy. It
asked itself, agreed with itself, and could never notice new code existed.

Now it asks the deployment instead, and when it can **prove** it is behind it says so, in
one quiet line under the build row:

> This app is from 4 September 2026. A newer version is available — install it from popty.app/builds.

Three things about that sentence were the real work.

**It promises the resolution that actually exists.** The belt panel's grammar says a
self-resolving state promises its resolution in one shared vocabulary — "it comes through
as soon as we can reach it". In a bundled APK that would be a lie: no reload, no wait, no
clearing storage ever brings new web code in. Only a new install does, so that is what it
says. A test fails if the copy ever borrows the self-resolving wording back.

**Different is not newer.** Two build ids that disagree do not say which came first. An
APK cut tonight is *ahead* of this morning's deployment, and sending you off to install
an older build would be the nastiest false alarm available. So `/version.json` now carries
a build *time* beside the id, and staleness is decided on the clock.

**Silent when it cannot tell.** No network, endpoint down, no timestamps — it says
nothing. This estate has already shipped a permanent false "Update available" that tapping
could not clear; a false "you are behind" is worse than the silence it replaces.

And it never gates. Plain text, nothing tappable, no modal, no interruption of playback.

## Verification, and one honest gap

Verified on the WebView probe harness, which reproduces the Capacitor runtime where it
matters — page origin `https://localhost`, every `https://localhost/*` request served from
the built Android assets, exactly as Capacitor's `shouldInterceptRequest` does. Six
assertions, both directions, all green:

- fires when the deployment reports a later build;
- asked the **API origin** for `/version.json`, and never its own frozen copy;
- hit-tested, not eyeballed: in the viewport, clear of the safe-area inset, and
  `elementFromPoint` at its centre returns the line itself, so nothing is over it;
- it is a `<p>` with no handler and no button ancestor — a description, not a gate;
- absent on the build that is live.

Screenshots of both states are in the repo at `docs/android-staleness/`.

**The gap:** this is not an emulator. This box has no `/dev/kvm` and no `vmx`/`svm` flags,
so a hardware-accelerated AVD is impossible and a software one is hours. The Android System
WebView binary itself and a real device install were **not** exercised here — only the
origin behaviour that the defect is about, which the harness models faithfully. Your
install tonight is the first real-device run.

## One thing I noticed and left alone

The build row's "Tap to update" affordance still sits above the new line, and inside a
bundled APK it cannot fetch new web code — nothing it does can help. It is pre-existing,
and the new line directly beneath it now gives the real remedy, so I did not touch it. If
you want it suppressed in the native shell, that is a small follow-up.
