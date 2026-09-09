# Does the microphone work in a remote-origin iOS shell

**2026-09-09. Verdict: YES — the remote-origin shell design survives on iOS, and a remote
https origin is the SAFER choice there, not the riskier one.**

Everything below is a documented conclusion plus source read on this Linux box. Nothing in it
has been run on an iPhone. It belongs in the untested column until a Mac says otherwise.

---

## The question

Tom's 2026-09-08 ruling made the Capacitor shell a WebView onto `https://saysomethingin.app`
rather than a bundled copy. The app is a speaking app; `getUserMedia` is the product. iOS is
historically stricter than Android about microphone capture in a `WKWebView`. So:

> On current iOS, in a `WKWebView` configured by Capacitor 8 whose content is loaded from a
> REMOTE https origin via `server.url` — not from the bundle over `capacitor://localhost` —
> does `navigator.mediaDevices.getUserMedia({ audio: true })` succeed, and under what
> conditions?

What is NOT in question, and was not researched: getUserMedia over https in Mobile Safari on
iOS. Tom's testimony, 2026-09-09 — "we use mic access on the webapp on iOS already and its
fine". Proven in production on this app.

## The verdict

It survives. Three things carry it, and the third is the one that inverts the worry.

**1. The delegate exists and Capacitor implements it, unconditionally.** Since iOS 15 the
public hook is `WKUIDelegate.webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)`.
Capacitor 8.5.1 implements it in `WebViewDelegationHandler.swift:49-57` and the whole body is:

```swift
decisionHandler(.grant)
```

There is no origin test, no bundle test, no allowlist. Whatever origin asks, WebKit is told
grant. So the host app has nothing to add, and the remote origin is not discriminated against
by anything in the wrapper. Read in
`node_modules/.pnpm/@capacitor+ios@8.5.1_.../Capacitor/Capacitor/WebViewDelegationHandler.swift`.

**2. The version floor is already met.** `getUserMedia` reached `WKWebView` in **iOS 14.3**;
the delegate above is **iOS 15.0**. Capacitor 8.5.1's own floor is iOS 15.0
(`Capacitor.podspec`, `s.ios.deployment_target = '15.0'`) and the committed Xcode project
agrees (`IPHONEOS_DEPLOYMENT_TARGET = 15.0`). There is no version below which we ship and
above which the mic works — the floor is the same number.

**3. A remote https origin is the SAFE case; the local schemes are the broken ones.** The
failure reports in the wild are about `capacitor://localhost:8080` and `file://` — non-secure
or odd-port custom-scheme origins that WebKit declines to treat as a secure context. The
Apple developer forum case of a WKWebView loading from local storage over `file:` is fixed by
loading over `https://` instead. Our `server.url` is a plain `https://saysomethingin.app`:
the same secure origin Mobile Safari already grants the mic on, by Tom's own testimony. The
one thread that looks like a counter-example — WebRTC failing in a WKWebView on iOS 14.3 — is
a remote page in an **iframe** inside a `capacitor://localhost` top-level document, which is a
third-party-frame case, not ours. We are top-level remote https.

**4. Nothing else in the config gates it.** `limitsNavigationsToAppBoundDomains` defaults to
`false` (`CAPInstanceDescriptor.m:47`), and the committed `Info.plist` declares no
`WKAppBoundDomains`, so the app-bound-domains restriction — which WOULD bite a remote origin —
is not in play. App Transport Security needs no exception: the origin is https with a public
certificate, which is exactly what ATS's default allows.

## The seven points, answered

| Question | Answer |
|---|---|
| Minimum iOS version | **15.0** in practice — 14.3 for getUserMedia itself, 15.0 for the delegate Capacitor uses, and 15.0 is Capacitor 8's own floor anyway. |
| Is the grant conditioned on the origin? | On it being a **secure context** — yes. On it being the app's own bundle — **no**. Capacitor's decision handler never looks at the origin. |
| Which delegate, and does Capacitor ship it? | `WKUIDelegate.webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)`. **Capacitor 8 ships it and grants.** Nothing for the host app to write. |
| Which Info.plist keys | `NSMicrophoneUsageDescription` — **required**. Already committed. |
| Missing key: deny or kill? | **KILL.** A TCC-protected capability touched without its usage string terminates the process. This is why it is not optional and why its absence does not look like a permission problem. |
| Entitlement? | **None** for the microphone. `UIBackgroundModes: audio`, already in the plist, is a capability rather than an entitlement, and it must ALSO be enabled on the App ID in the Apple Developer portal — that one does need the account. |
| Visible or silent failure? | The **OS** prompt is visible, once, and its refusal is visible. The known silent case is different and worth knowing: WebKit **mutes** `microphoneCaptureState` shortly after the app goes to the background. Our mic use is a foreground pronunciation overlay, so this should not bite — but a mic that goes quiet after a lock/unwind is this, not a broken permission. |
| Does the grant persist? | The **app-level** microphone grant persists, and the learner changes it at **Settings → SSi (dev wrap) → Microphone**. The WebKit per-origin grant is NOT persisted across launches in WKWebView — which is exactly the re-prompting complaint the iOS 15 delegate exists to solve, and Capacitor's unconditional `.grant` means WebKit never re-asks the learner. So in practice: one OS prompt, ever. |

## What must be set for it to work

A short list, all of it already true in the committed tree bar the last line:

1. `NSMicrophoneUsageDescription` in `ios/App/App/Info.plist` — present.
2. iOS deployment target ≥ 15.0 — present.
3. `server.url` an **https** origin, not http, not a custom scheme with a port — present.
4. No `WKAppBoundDomains` key in Info.plist, and `ios.limitsNavigationsToAppBoundDomains`
   left `false` — true by default, now written down explicitly in `capacitor.config.ts`.
5. Microphone capability enabled on the App ID in the Apple Developer portal for
   **background audio** — a Mac/portal step, on the runbook.

## Status

**UNPROVEN UNTIL A MAC.** Every sentence above is documentation, release-note and
read-the-Swift reasoning done on a Linux box with no Xcode, no simulator and no device. The
one thing that would settle it is thirty seconds on a real iPhone: open the practice
pronunciation overlay, see the microphone prompt, speak, see it transcribe.

## Sources

- Capacitor iOS 8.5.1 source, read locally: `WebViewDelegationHandler.swift`,
  `CAPBridgeViewController.swift`, `CAPInstanceDescriptor.m`, `Capacitor.podspec`.
- [Apple: `webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)`](https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:))
- [WebKit: MediaRecorder API / getUserMedia exposed to WKWebView from iOS 14.3](https://webkit.org/blog/11353/mediarecorder-api/)
- [Apple WWDC21 — Explore WKWebView additions](https://developer.apple.com/videos/play/wwdc2021/10032/)
- [Camera and Microphone in WKWebView — plist keys, remote https sample](https://solarana.dev/2021/01/01/camera-and-microphone-in-wkwebview/)
- [Apple forum 692421 — file: origin fails, https resolves it](https://developer.apple.com/forums/thread/692421)
- [Capacitor issue 6759 — `capacitor://localhost:8080` fails where `capacitor://localhost` works](https://github.com/ionic-team/capacitor/issues/6759)
- [Ionic forum 202088 — the iframe-inside-capacitor:// case, not ours](https://forum.ionicframework.com/t/webrtc-in-ios-14-3-iframe-wkwebview-external-resource/202088)
- [WebKit bug 220416 — WKWebView getUserMedia persistent permissions](https://bugs.webkit.org/show_bug.cgi?id=220416)
- [Apple forum 689182 — capture state mutes in the background](https://developer.apple.com/forums/thread/689182)
