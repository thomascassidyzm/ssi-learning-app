# Making the Library useful — a proposal

*What this is: the Library screen as it stands today, everything we have already written that explains how the app works, and one recommended shape for putting the two together. Written 2026-08-18, in answer to "start working out how to make this library section much more useful."*

---

## The recommendation, in one breath

**Give the Library a second job — "your place, and how this works" — and fill it almost entirely with prose we have already written and shipped, which currently no learner can reach.**

The reason: the learner-facing "How this works" and "Why this works" sections exist in the repo, are finished, are in Tom's voice, obey every content law, are covered by tests — and live on a page that is *deliberately unlinked from every nav*. Nobody has ever seen them. The Library is the only place in the learner app that is already about "what is this thing and where am I in it", and it is already the place the prose itself points at.

So the expensive part is done. What is missing is a door.

**Your call, one word: yes or no to that shape.**

---

## The finding that decides it

There is a file in the app called `learnerExplainers.ts`. It holds two complete sections of learner-facing writing:

- **How this works** — what pressing play does, what a go is, what a session feels like, the different ways to use it, what the listening stretches ask of you, changing course. Six blocks.
- **Why this works** — say it before you hear it, what happens at around thirty hours, thirty hours spent however suits you, speaking first and deep listening later, why there are no streaks and no points, where all this comes from. Six blocks.

It is warm, brief, British, has no jargon in it, no streaks, no points, and it keeps the thirty-hour promise quietly inside the methodology exactly where it belongs. It is rendered by two working components on a page at `/me`.

That page is marked in the router as **deliberately unlinked from every nav** so it could be tasted on dev without touching a shipped surface. It was never linked up. The taste-pass never happened, so the writing has sat dark ever since.

This proposal is mostly the act of turning it on.

---

## What the Library is today

It is an overlay, not a page. Tapping the bottom-left icon slides a panel over the player; there is an ✕ to close it and you are back where you were. It already has its own address, so a link can open it directly.

Inside, top to bottom: a sign-in nudge if you are a guest, a dashboard link if you run a school or an organisation or tutor, **Your Progress** with the belt pips and the position track and a belt browser that opens inline, **Activity** with three stat tiles for total time, words and phrases, then **All Courses** — a search box and the full grid of every course. At the very bottom, a quiet "Teach with SaySomethingin" link.

Read plainly: **the Library is currently a course switcher with a progress readout bolted to the top of it.** It answers "what else can I learn" well and "where am I" adequately. It does not answer "what is this thing doing to me and why", which is the question Tom is pointing at.

Structurally, three things matter for any change. It is one file of 1,412 lines doing all of it. Its four sections are already cleanly separated, so a fifth costs almost nothing. And the course grid is the biggest thing in it by a distance, which is why the screenshot opens on a wall of course cards rather than on anything about you.

---

## What we already have, and what we do not

**Ready to show a learner, today, no rewriting:**

| | What it is | Who sees it now |
|---|---|---|
| How this works | Six blocks of learner prose on how to use the app | Nobody — page unlinked |
| Why this works | Six blocks on the method and the thirty hours | Nobody — page unlinked |

**Not for learners — internal, and should stay that way:**

The methodology pages inside the app, and the methodology documents in the repo, are working papers. They are addressed to us and to people we are arguing with, they carry live population data and unresolved design forks, and they use every internal term the language wall exists to keep out. They are admin-gated and they should stay admin-gated. There is no learner-ready prose hiding in them; there is source material for prose we have not written.

**The genuine gap — one, and it is small:**

**Belts have no explanation anywhere.** The Library shows a learner their belt, their colour, and how far along they are, and nothing in the app has ever told them what a belt is or that it marks position rather than mastery. That is roughly one short block of new writing, in the same voice as the rest. It is the only new prose this proposal asks for, and it is the one piece the Library most obviously owes the learner, because the Library is where the belts already are.

One correction to note: the "how this works" throb and invitation machinery in the repo is the **admin** side of the house — it explains org-management verbs to people running schools. It is not learner material and is not part of this.

---

## The shape

**The Library's job, in one sentence: this is where you go to see where you are, understand what the app is doing with you, and choose what to learn next.**

Three changes, in the order they matter.

**One — a new section, and it goes near the top.** Beneath Your Progress, before Activity: two quiet lines, *How this works* and *Why this works*, each opening in place to reveal the prose we already have. Closed by default, so the learner who wants to switch courses is not made to walk past a manual to do it. This is the whole of the first slice.

**Two — belts get their line.** The belt card already opens a belt browser. It should also be able to say, in three or four sentences, what a belt is and why it moves with your position rather than your performance. New writing, small, and it makes the most prominent thing on the screen stop being unexplained.

**Three — order follows the new job.** You, then how it works, then your activity, then everything you could learn. Courses stay, unchanged, at the bottom. That is a reordering, not a rebuild.

**It stays an overlay.** It already has a working address, so becoming a route buys almost nothing and costs the close-and-you-are-back-in-the-lesson feel, which is the right feel for something a learner dips into mid-session.

**Organised for someone not looking for a manual.** Everything closed until asked for. Two named lines, not a table of contents. Short blocks, no scroll wall, and the learner can shut it and be back in the gap within a second. The prose already assumes this — it is written to be dipped into.

---

## Better, simpler, cheaper — honestly

**Better** — holds. The learner gets an answer to "what is this doing to me", in the place they already go with that question, in writing we already trust.

**Simpler** — holds, and this is the strong leg. It *deletes* a problem rather than adding a surface: an orphaned, unreachable page stops being orphaned. No new concept, no new screen, no new nav item.

**Cheaper** — holds. Two existing components mounted in an existing section pattern. One short piece of new writing for belts. The forever cost is the prose staying true as the app moves, which we are paying already.

Where it is genuinely weaker: the Library gets longer, and the course grid moves further down. That is a real cost to the course-switcher use, and it is the one thing worth watching. It is bearable because the sections above it are collapsed, so the added scroll is a few lines, not a few screens.

**Runners-up.** *A separate "How it works" screen with its own nav slot* — cleanest reading experience, but it spends a nav slot and a whole surface on something read once or twice, and Tom's instruction was that this belongs in the Library. *Explanations scattered in context, each next to the thing it explains* — lovely in principle, but it is many small edits across the player rather than one, and there is then no single place to go when the question arrives late. *Leave `/me` where it is and just link to it from the Library* — cheapest of all, but it sends the learner out of the overlay to a page called "You" that also holds unrelated preview material, and the seam would show.

---

## The first slice, if the answer is yes

Add one collapsed section to the Library holding the two explainer components, and nothing else. No reordering, no belt writing, no new prose. It is the smallest change that makes twelve blocks of finished writing reachable by a learner for the first time, and it is small enough to look at on dev and judge by eye.

Everything else in this proposal waits behind your reaction to that.

---

## Notes on scope

Five judgement calls were taken rather than asked about, each reversible:

The schools, tutor and organisation dashboard links stay exactly where they are and are not touched. The explainer material is assumed to become visible to every learner, not admin-gated — the methodology pages are the exception and stay locked. No new content writing is commissioned beyond the one belt block, which is named as a gap rather than filled. The bottom-nav icon and its position do not change. And this is one proposal rather than a menu, with the runners-up named above so you can see the search was real.

One tension worth naming plainly: a founder ruling of 2026-07-27 says the learner level of the self-explaining dashboard is "deliberately nothing — the learner app must need no explanation." Your instruction of today supersedes it, and the newer one wins. But the older one is why the Library has nothing in it now, and it still sets the bar: the explanation must stay optional, quiet, and never something a learner has to get past.

---

## Appendix — where things live

- Library screen: `packages/player-vue/src/components/BrowseScreen.vue`, opened from `components/BottomNav.vue` slot 1, mounted by `containers/PlayerContainer.vue`, deep-linkable via `?screen=library`.
- Learner prose: `packages/player-vue/src/explainer/learnerExplainers.ts` — `HOW_THIS_WORKS_LEARNER` and `WHY_THIS_WORKS`.
- Components that render it: `components/me/HowThisWorksLearner.vue`, `components/me/WhyThisWorks.vue`, seen-state in `explainer/learnerThrob.ts`.
- The unlinked page: `views/me/ProfileView.vue`, route `/me`, named `learner-profile`, marked unlinked in `router/index.ts`.
- Admin-side explainer machinery, not learner material: `explainer/howThisWorksThrob.ts`, `evaluateRules.ts`, `useNoticingInvitations.ts`, `pack.json`, surfaced in `views/admin/NodeHomeView.vue`.
- Admin-gated methodology: `views/methodology/MethodologyView.vue`, `EmpiricalBaselineView.vue`, guarded in `router/index.ts`.
- Internal papers: `docs/methodology/*.md`, `docs/explainer-pack.md`, `docs/self-explaining-dashboard.md`.
- Belts: `packages/player-vue/src/composables/useBeltProgress.ts`.
