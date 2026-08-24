# The PWA update crash — what it was, what changed

**2026-08-07.** Your report: *"the PWA update just crashes halfway through updating, and then you
close it and open it again and it's finished updating — pretty shitty behaviour."*

It wasn't a guess this time — the whole thing is measured, with two real builds and a server that
gets swapped underneath a running app exactly the way a deploy swaps it.

---

## What was actually happening

The moment a new service worker **takes over**, it tidies the cache: it deletes every file that
isn't in the new build. On a real pair of our builds, that is **10 of the 21 code files the running
app is made of** — and those files are gone from the server too, because every deploy renames them.

So the app is left alive with a hole where a third of its own code used to be. It looks fine for a
few seconds. Then you open Settings, or the next round starts, or you change screen — it reaches
for a file that no longer exists anywhere, and dies. That's the crash. Relaunching loads the new
version from scratch, which is why it's "finished updating" when you come back.

Three different things were handing the new worker the keys while the app was still running:

- **The Update banner.** It asked the worker to take over, then left the reload to a browser event.
  On an installed iOS app that reload can silently not happen — and then you're sitting in the
  gutted app. (We patched the *symptom* of this on 30 July; this is the cause.)
- **Dev and preview builds — worst of the three.** They were configured to take over *automatically,
  the second a new version finished downloading, with no tap from anyone*. That's a live app being
  hollowed out mid-session while you use it. Since you test on dev, this is very likely the one
  that bit you.
- **Settings → "get the latest version", and the remote force-update switch.** Same move.

## What changed

**The app never hands over the keys while it's running.** Taking an update is now just a reload,
fired inside your tap. The new version takes over on its own the next time nothing is open — which
is exactly when it can't hurt anybody. That's true in every environment now, dev included.

**And a second bug had to go first, or "just reload" wouldn't have worked.** Reloading was supposed
to fetch the latest page from the network — that's what the config says, and what the docs claimed.
It never did: the offline cache was quietly answering first, handing back the *old* page. Which
means the destructive hand-over was, until today, the **only** way new code ever reached a learner.
Fixed — and confirmed live: dev fetches from the network, staging (still on the old code) doesn't.

**If a reload still doesn't take** on a wedged iPhone, nothing has been destroyed — the app keeps
all its code and stays usable — and a couple of seconds later the banner comes back as
**"Update ready — tap to relaunch"**. One tap, which is the thing that unsticks iOS.

## How it was verified

A test harness (`packages/player-vue/e2e/sw-update-probe.mjs`) builds two real production versions,
serves one, lets the app install itself, then swaps the server to the other — a deploy, in
miniature — and drives the real Update button.

| | before | after |
|---|---|---|
| new version downloads in background, app unharmed | ✅ | ✅ |
| taking the update lands you on the new version | ✅ | ✅ |
| **nothing deleted from under the running app** | ❌ | ✅ |
| dev builds don't hijack a live session | ❌ | ✅ |
| a reload fetches new code from the network | ❌ | ✅ |

Plus: offline cold start unchanged (228 files cached, app boots in airplane mode), 1786 unit tests,
typecheck and lint all green, and the live check run against both dev and staging.

## Where it is

On **dev** (`ssi-learning-app-git-dev-zenjin.vercel.app`), verified live there. **Not** on staging or
production — that promotion is yours to call.

One thing to know while it soaks: on dev, a new deploy no longer barges in. You'll get the banner,
or a reload will pick it up. That's the point, but it's a change in feel from what dev used to do.
