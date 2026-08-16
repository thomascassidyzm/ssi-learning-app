# Why a fortnight of offline work sailed past your weak-signal white screen

**16 August 2026.** You took your phone out on a weak cellular signal, opened the dev app, and got a
permanent white screen. In airplane mode, the same app gives you a slightly brown screen and then
the ready-to-play state in three or four seconds — exactly as designed.

The offline work was real and it works. It just could never have fired in the situation you were
actually in. This is the account of why, and what has changed.

---

## The short version

**A weak signal is not a missing signal, and to the app those are opposite problems.**

In airplane mode the phone knows it has no network. Requests fail *instantly*. Every offline path we
built watches for exactly that failure, catches it, and serves you the app out of the cache. Fast,
clean, three seconds.

On a weak signal the radio is up. The phone believes it is online — and it says so. Requests are
accepted and then simply *hang*, forever, without ever failing. So nothing catches. Every piece of
code that asks "are we offline?" is told "no, we're fine", and waits.

Then it got worse than waiting. The app has a watchdog that notices when it fails to start and
concludes the app is broken and needs repairing. Its repair is to delete the offline copy of the app
and download a fresh one. It had a guard specifically to stop it doing this when there is no network
— because deleting the offline copy while offline destroys the only thing that could have worked.
But that guard asked the phone "are we online?" and the phone said yes.

So the watchdog deleted the app's offline copy and reloaded, into a network that could not send it a
new one. That is the white screen — and that is why it was *permanent* rather than merely slow.
There was nothing left to show you, and every reload did the same thing again.

A useful detail from your own screenshots: **brown means the app arrived, white means it did not.**
The warm brown is the app's own first paint. Airplane mode gets that far. Weak signal did not,
because by then the copy that would have painted it had been deleted.

---

## The four questions you asked

### 1. What did the previous offline fixes actually change?

They are genuine fixes to genuine problems, and none of them is wasted:

- **A signed-in learner stays signed in when the network can't say so.** Previously a failed identity
  check logged you out; now it doesn't.
- **Offline changes what plays, never where you are.** Losing the network no longer moves your
  position in the course.
- **The silent first phrase.** The cache check now fails closed, so a missing file can't produce
  silence.
- **Stop waiting on the network when it can only say no.** Removed waits that had nothing to gain.
- **An unexpected offline keeps going forward, and never ends the course.**
- **Play what you have — a weak connection can no longer block the learner.** This one names your
  bug in its title, which is the most pointed part of the story: it addresses *playback* choosing
  what to play. It never had anything to do with whether the app could start at all.

Every one of them is about what happens **inside a running session**. Not one of them is about
whether the app boots. Your failure was at boot, before any of that code existed on the page.

### 2. What condition was each verified under?

I read the probes that shipped with them. The answer is sharper than "they all used airplane mode",
so here it is precisely:

- Most of them establish their condition with the browser's own offline switch — the airplane-mode
  equivalent, where requests fail instantly.
- Two of the most recent ones — the identity fix and the belt-held fix — were *cleverer* than that.
  They deliberately made requests **hang** rather than fail, using a handler that never answers. So
  the team did understand the hanging-network problem.
- But they hung only the **data** requests: the login server, the progress API, the audio bucket. The
  **app's own files** — the page, its code — were always served instantly by a healthy local test
  server, in every single probe.

So the boot path has never once been tested on a bad network. Not in airplane mode, not on a hanging
one. The condition simply did not exist in our test suite.

One probe does throttle the network to slow-3G-style speeds. It cannot catch this either, for a
subtle reason worth recording: that throttle is attached to the page, and the component that decides
whether to serve you the cached app is the service worker, which is a *separate* thing the throttle
never touched. I hit this myself — my first attempt at reproducing your bug reported a perfectly
healthy 116-millisecond boot while your phone was white-screening. The harness was lying to me in
exactly the way it had been lying to everyone else.

### 3. Why could that never have covered the weak-signal case?

Because a test that switches the network **off** exercises the *failure* path, and a weak signal is
the *hang* path. They share no code.

When the network is off, a request comes back immediately with an error. Every offline behaviour we
have is hung off catching that error. When the network is merely terrible, the request never comes
back at all — there is no error, so nothing catches, and the "are we offline?" flag reads `true` all
the way through. A completely green offline test suite is therefore perfectly compatible with a
permanent white screen on a weak signal. That is not a gap in diligence; it is two different
conditions that look like one.

Concretely, of the recent fixes:
- The identity and belt fixes **could** fire in your conditions — they were built for hanging data
  requests. They just live inside a session you never reached.
- The rest are gated on a request failing or on the offline flag, so on your phone **none of them
  could fire at all**.
- And the boot watchdog, the one piece that did act, acted *destructively*, because it trusted the
  same flag.

### The sharpest part: we had already learnt this lesson, one layer too late

The day before your test, on 15 August, a ruling went in that says almost exactly what this
post-mortem says: *a phone claiming to be online proves nothing on a weak connection, so stop
trusting that flag.* It is written into the spec in as many words, and the playback code was
reworked around it — timeouts on the critical path, cache fallbacks, an observed-stall signal
replacing the flag.

That work stopped at the app's front door. The boot watchdog runs *before* any of the app's own
code exists, so it cannot use any of that machinery — and it was still asking the old question. It
is also the one component whose mistake is destructive rather than merely slow.

So this was not an unknown failure mode. It was a known one that had been fixed everywhere except
the single place where getting it wrong deletes the app.

### 4a. Was the service worker even serving the shell cache-first?

No — and it was not supposed to be. The app deliberately asks the network for the page first, and
falls back to the cache after three seconds. That choice is well-argued: it is what makes "just
reload to get the new build" true, and it was paid for by a previous incident.

Under a hanging network that three-second fallback does fire correctly, and I confirmed it: the
cached app comes back and starts in just over three seconds. So on a *uniformly* dead-slow network,
the design already worked.

What breaks is the case where the network is bad but not uniformly bad — which is what a real weak
signal is. The page itself is tiny, about 11 KB, and can squeak through inside those three seconds.
The app's actual code is several hundred kilobytes and cannot. And here is the trap: **dev
re-deploys constantly**, so the fresh page that squeaked through names code files that your cached
copy has never seen. Those downloads then hang with **no timeout at all** — the three-second rule
covers the page only, nothing beneath it. The app paints brown and never starts. Fifteen seconds
later the watchdog decides the app is broken and deletes the cache, and brown becomes white.

I reproduced that exact sequence, and it is now a committed test.

### 4b. Was the fix even deployed to the URL you tested?

Yes — this one is clean, and I checked rather than assumed. The dev deployment reports build
`1f863d5`, which is precisely the latest commit on the dev branch, and the boot watchdog in the
bytes actually being served is byte-identical to the one in the source. The offline work was in the
code you loaded. The deploy is not the story.

---

## What has changed now

Two things, both at the boot line.

**1. A bad network can no longer be mistaken for a broken app.** Before deleting anything, the
watchdog now demands that the network *actually answer* — a tiny request with a two-second deadline.
A phone claiming to be online is not evidence; a reply is. Genuine repair still happens for the case
it was built for, a real broken deploy on a network that answers. But no signal, and no *useful*
signal, can now destroy your offline copy.

**2. If the app hasn't started in three seconds, it starts the copy you already have.** Rather than
waiting on downloads that will never arrive, the boot swaps in the cached app, whose files are
guaranteed to be present. That is what makes a weak signal behave like airplane mode, which was the
decision you made. Being one build behind for a few minutes is not something a learner can detect; a
white screen is.

Fresh code still arrives normally on a network that can carry it, and reloading on a good connection
still picks up a new deploy — I checked both, because breaking those would trade your bug for
someone else's.

There is one deliberate subtlety: the rescue is allowed to happen again on a later reload. An
earlier version of my fix rescued you once per session, and the second reload on a bad signal
white-screened again — which is the "permanent" in your report, so it had to go.

## What we can now catch that we could not before

There is a new test that hangs requests **at the server**, which is the only faithful way to imitate
your phone. It runs four situations against one build: airplane mode, a uniformly hanging network, a
hanging network during a fresh deploy — the one that actually got you — and a healthy network.

Before the fix, the third of those never started the app at all and its second attempt would not
even load a page. After it, all four reach the ready state in about three seconds, and none of them
loses the offline copy.

We had no test that could ever have caught this. Now we do.

## Honest gaps

- **I could not inspect your phone.** Everything above is reproduced on a desktop browser against the
  same build. The mechanism explains all three of your screenshots, and the fix is verified against
  the reproduction — but the final word is your retest on a real weak signal.
- **Which reload of yours did which** I cannot know: whether the very first weak-signal open showed
  brown before turning white, or whether you arrived after the cache had already been deleted. Both
  land in the same place and are fixed by the same two changes.
- **Mid-session behaviour on a weak signal is out of scope here** and I have not changed it. If
  playback misbehaves on lie-fi once you are in a session, that is a separate pass.
