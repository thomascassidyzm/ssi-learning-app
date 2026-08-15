# Offline message — what was verified on staging, 2026-08-15

## The message, as shipped

> We can't reach new items right now, so here's a chance to practise what you've already covered — new items will come through as soon as we can reach them.

One sentence, no heading, one **Got it** button. It never pauses audio, it is dismissible, and it shows at most once per session.

## Verified live on staging

**1. The words are in the build served to a phone.** The English sentence is in staging's main bundle, and the translations are in each language's own lazily-loaded chunk. Sampled live from `staging.saysomethingin.app`:

| Language | What staging actually serves |
|---|---|
| French | Nous ne pouvons pas accéder à de nouveaux éléments pour le moment, alors voici l'occasion… |
| German | Wir können gerade keine neuen Inhalte laden, also ist das eine gute Gelegenheit, das zu üb… |
| Chinese | 现在无法获取新的内容，正好可以练习你已经学过的部分 — 一旦可以获取，新的内容就会送到。 |
| Welsh | Allwn ni ddim cyrraedd eitemau newydd ar hyn o bryd, felly dyma gyfle i ymarfer yr hyn rwy… |
| Hindi | अभी हम नई सामग्री तक नहीं पहुँच पा रहे हैं, तो यह उसका अभ्यास करने का मौका है जो आपने पहले… |

**2. The staging spinner is gone.** A real browser on a phone-sized viewport started a Chinese lesson on staging, played for 90 seconds, then had its network cut outright. Playback carried straight on: 35 audio plays before the cut, 50 by 45 seconds after it, with the player still advancing through its phases on screen. Staging no longer spins when the network goes; it was simply running a build that predated the cache-first work, exactly as you said.

## What was NOT verified, and why

**The dialog itself was never made to appear on staging.** The notice fires at the moment cached content starts being recycled, and an anonymous guest cannot get there:

- Tapping ∞ to enter infinite play as a guest hits the free-preview paywall instead — an entitlement gate, unrelated to the network.
- Sixty skips forward, offline, hit the same paywall well before the end of the cached material.
- Reaching it the honest way — playing to the tail — takes about thirty minutes of real play on a signed-in account, which the probe had no credentials for.

So the trigger is proven by tests rather than by a live sighting: nine tests cover it, including a rendered check that the message appears in infinite play offline and stays quiet both online and in the ordinary main loop, and a check that every one of the 21 locale files carries it and that none is the English string in disguise.

**When you test it on your phone, signed in and offline, that gap closes.** It should appear once, as the material starts coming round again, with the audio still playing underneath.
