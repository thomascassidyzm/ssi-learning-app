# What's on staging, and what to test

**Six things. About twenty minutes if you do them all, and the first two are the ones that matter.**

Everything below is live right now and I've checked each URL answers. Where I couldn't check something properly, I say so beside it.

---

## 1. Start a course you've never touched, on a bad connection

This is the big one. Before today, a first-time visitor on a slow connection got a blank screen that never resolved — the app gave up after two and a half seconds and fell back to a saved copy that a first-timer has never had. Now it just keeps trying, and it tells you it's trying.

**What to do:** open this on your phone with wifi off, ideally somewhere with poor signal. You should get a card saying *"Still loading — Your connection looks slow. This will start on its own as soon as it comes through, so there's no need to reload."* Leave it. It should come good on its own and give you a play button. What you should never see is a blank screen.

https://staging.saysomethingin.app

---

## 2. Hungarian for English — does it play through?

You asked for this. It boots and it plays: three cold runs on a throttled connection all reached real lesson audio, first phrase "szeretnék" for "I want". What hasn't been checked is a whole session end to end — that's the bit only you can do.

**What to do:** pick Hungarian, press play, and keep going for a few minutes. Listen for the audio actually being there on every phrase, and for it not stalling between them. On a first cold visit expect about twelve seconds before the first sound — Hungarian's course is bigger than most, so it's slower to arrive than Spanish, and that's expected rather than broken.

https://staging.saysomethingin.app

---

## 3. The wait before the play button goes live

The dead six seconds at the start of a lesson were the app building the whole course script in one lump before it would let you press anything. It now does that in pieces and lets you press sooner. Measured on Spanish: five seconds instead of just under eight.

**What to do:** open Spanish while signed in, and just notice how long the play button stays dead. It should feel noticeably quicker off the mark than you remember. Press it — sound should come in about a third of a second.

https://staging.saysomethingin.app

---

## 4. The opening of a course — shortest phrases first

The very first phrases of a course now come in the same shortest-first order as everything after them, instead of arriving in whatever order they were written. So Spanish opens "Quiero hablar", then "Hablar español", then "Quiero hablar español".

**What to do:** start Spanish from the very beginning and listen to the first three or four phrases. They should get longer as you go, not jump around.

https://staging.saysomethingin.app

---

## 5. Script Lab — edit a pod script without loading a course

Your ask: *"I want a single place I can edit the canonical scripts for the pods."* That place now exists. Every canonical script in one index, no course code anywhere, and for each one it tells you — in red, at the top — which shapes the script never reaches.

**What to do:** open the index, click into a script, and check the red deficit list at the top reads like something you'd act on. Try editing a line and see it stick.

https://popty.app/canonical/scripts

---

## 6. Basket Lab — where it now lives

Basket Lab has a proper home: a card in the row beside Listening, Speaking, Pod, Voice and VAD.

**What to do:** open the configs page and check the Basket card is where you'd expect it and opens onto something usable.

https://popty.app/admin/configs/basket

---

# What did NOT go to staging, and why

- **A second, older attempt at the slow-connection fix.** There was another branch doing the same job, written earlier in the day. The version already on staging is newer and better; merging the old one would have undone work. Left alone deliberately.
- **An older version of the edge-caching and pod-splitting work.** Someone is still actively working in that code right now — it's mid-flight, so it isn't safe to promote. The finished parts of it are already on staging by another route.
- **A security audit.** Six commits of security tests and findings. Nothing in it changes anything you can see or press, so it would only pad this list. It's finished and it's safe; it just isn't a thing to test.
- **Three sets of Popty write-ups** — the opening-phrases doc, Aran's health-sector conversations, and a course-consistency scan. Popty has no staging tier, only live, and you said "never to main". They're documents rather than working code, and you've already been sent the two that matter as links. Say the word and they go on.
- **Nothing at all went to production, in either app.** Both live sites are untouched.

---

**One honest gap:** the slow-connection numbers above come from an emulated 3G profile in a headless browser, not a real phone on real mobile data. Your handset will differ. That's exactly why you're testing it by hand.
