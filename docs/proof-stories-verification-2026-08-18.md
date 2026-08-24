# Proof stories: verified URLs, gaps and contradictions — 2026-08-18

Legwork for Tom's four "proof stories" (Irish experiment, Japanuary, Croatian, celebrity videos), done live against www.saysomethingin.com, en.saysomethingin.com/forum, and the SSi Discourse forum. No code touched — `packages/` is untouched. Full curl evidence below every URL.

## 1. Verified URL table

| Story | URL | Status | Frame-blocking? | Evidence |
|---|---|---|---|---|
| **Japanuary** write-up | `https://www.saysomethingin.com/wp/en/japanuary-can-you-really-learn-japanese-in-10-days/` | **200**, verified live | No — same host as the app's existing frameable allowlist | Opening line: *"On January 13th 2025, three determined members of the SSi team, Aran, Tom and Kai, embarked on a bold and ambitious challenge, to learn Japanese in just 10 days."* Matches Tom's account (10 days, January 2025, once he corrected himself mid-sentence) exactly. |
| **Croatian** story | `https://en.forum.saysomethingin.com/t/75-days-of-croatian-livestreaming/42539` | **200**, verified live | **Yes** — `X-Frame-Options: SAMEORIGIN` + a `frame-ancestors` CSP restricted to saysomethingin.com hosts (curl'd headers, below) | Post #1 (Aran, 2026-05-02): *"I'm going to livestream my preparations in the new app for our trip to Croatia in July... I've got no chance... of figuring out in advance when my daily hour is likely to be."* Post #119 (Aran, 2026-08-10, after the actual trip): *"the results were definitely the most encouraging so far from any of the tests we've done... I stuck at it for the first 5 days or so."* Confirms: **Aran alone**, **one hour a day** — matches Tom's recollection, and directly contradicts the in-app copy Tom flagged ("a group of us worked through Croatian an hour a day" in `learnerExplainers.ts`, `WHY_THIS_WORKS` → "Where all this comes from"). |
| **Celebrity videos** — testimonials page | `https://www.saysomethingin.com/wp/en/community/testimonials/iaith-ar-daith-celebrity-testimonials/` | **200**, verified live | No | Named celebrities confirmed on-page: Ruth Jones, Scott Quinnell, Katie Owen, Kiri Pritchard-McLean, Chris Coleman, Amanda Henderson, Rakie Ayola, Steve Backshall, Carol Vorderman. |
| **Celebrity videos** — coaching page | `https://www.saysomethingin.com/wp/en/community/testimonials/iaith-ar-daith-celebrity-coaching/` | **200**, verified live | No | Companion page to the testimonials page above; same "Iaith ar Daith" celebrity-coaching content. |
| **Irish experiment** write-up | *(no dedicated saysomethingin.com page found — see gap below)* | — | — | — |
| **Irish experiment** → radio interview | *(not found anywhere — see gap below)* | — | — | — |

### Frame-ancestors detail (curl'd 2026-08-18, matches the in-app browser's own header note in `useInAppBrowser.ts`)

```
www.saysomethingin.com/wp/en/...            → 200, no X-Frame-Options, no CSP frame-ancestors     → FRAMES
en.forum.saysomethingin.com/t/...            → 200, X-Frame-Options: SAMEORIGIN,
                                                 CSP frame-ancestors 'self' https://saysomethingin.com
                                                 https://www.saysomethingin.com https://www.stage.saysomethingin.com
                                                 https://www.dev.saysomethingin.com                → REFUSES
nation.cymru/feature/...                     → 200, X-Frame-Options: SAMEORIGIN                    → REFUSES
```

The two `www.saysomethingin.com` pages (Japanuary, both celebrity pages) match the app's existing `FRAMEABLE_HOSTS` allowlist in `useInAppBrowser.ts` exactly — they'd open in the in-app overlay for free, no code change needed. The Croatian source and the Irish nation.cymru piece are **not** frameable — the existing composable already sends non-allowlisted hosts straight to an external browser tab, which is the correct, already-built behaviour for both.

## 2. Explicit gap — Irish experiment write-up + radio interview

**I could not find either of these, despite an extensive search, and I am not going to invent them.**

What I *did* verify, on nation.cymru (not saysomethingin.com), written in Aran's own first-person voice, published as part of a 2025 cultural-highlights roundup:

> "In September, perhaps unwisely, I went over to the Connemara Gaeltacht to spend ten intensive days learning Irish – a crash-test dummy approach to see if our new course was any good. The jury's still out – I need to find the courage to try and get a weekly conversation partner set up."

— `https://nation.cymru/feature/cultural-highlights-2025-moments-of-giddying-joy-pedair-riot-women-and-dave-tynan/` (200, verified, `X-Frame-Options: SAMEORIGIN` — would not frame anyway).

I also verified an earlier (May 2025) nation.cymru piece where Aran states the *intention* behind the trip:

> "We're going to do a crazily intensive 10 day course in Ireland to prove that we can chat on TV and radio even as raw beginners."

— `https://nation.cymru/feature/irish-language-learning-course-launched-by-welsh-innovators/` (200, verified).

I searched: the saysomethingin.com blog (full listing, both pages), the SSi forum's Discourse search API (a dozen+ query variants — "Ireland trip", "Connemara", "radio interview Irish", "RTÉ", "TG4", "crash test dummy Irish", "ten intensive days", "went well Irish" etc.), the `SaySomethingin Irish (Beta)` forum thread in full (all 180+ posts, including the September 2025 window specifically), the SSi "events & awards" page (currently "No upcoming events"), the SSi "on the road" and "community history" pages, and general web search for Aran Jones + RTÉ/radio/TV. None produced a write-up of how the trip actually went on saysomethingin.com, nor any trace of a radio interview — no station name, no presenter, no date, no clip.

**This is a genuine absence, not a search failure I'm papering over.** The only after-the-fact account I could find is the "jury's still out" line above.

## 3. Contradictions with Tom's recollection — flagged, not silently corrected

1. **"Went very well"** — the only verified after-action account (nation.cymru, Aran, first person) says *"The jury's still out"*, i.e. an open, unresolved verdict, not a success story. This directly contradicts Tom's "it went very well."
2. **"culminated in a radio interview"** — no evidence found anywhere that a radio (or TV) interview actually happened. What's verified is the *pre-trip intention* to "prove that we can chat on TV and radio" — an aspiration stated in May 2025, not a confirmed outcome. Tom may be right that it happened and it's simply not documented publicly (or he may be conflating the stated intention with an actual outcome) — I can't resolve which from what's public.
3. **"Tom, Kai and Aran all did the Irish experiment"** — the only account is written entirely in the first person singular ("I went... a crash-test dummy approach... I need to find the courage"), with no mention of Tom or Kai. This may just be Aran's personal-essay framing (a reflective end-of-year piece naturally centres the author) rather than proof the trip was solo — unlike Croatian, where Aran's own words explicitly frame it as solo ("my daily hour"). I flag it because I can't confirm either way from what's public.

None of these are corrected in this doc — they're reported as found, per the honesty rule.

## 4. Proposal

**What already exists (read before proposing):** `Onboarding.vue` already carries three verbatim learner quotes with source URLs in comments, under an explicit rule (line ~100) that they are "published on www.saysomethingin.com — never paraphrased, never invented." `learnerExplainers.ts`'s `WHY_THIS_WORKS` → "Where all this comes from" block already references the Croatian story in-app (currently with the wrong framing Tom flagged — a separate worker is fixing that copy). A shared in-app browser overlay (`useInAppBrowser.ts`, landed 2026-08-18) already opens `www.saysomethingin.com` pages inside the app instead of kicking the learner out to a browser tab, with the frameable-hosts allowlist already covering exactly the pages verified above.

**Recommendation: do nothing new — just link the two www.saysomethingin.com pages that already frame cleanly (Japanuary, celebrity testimonials) from "Why this works," the same verbatim-quote-plus-source-URL pattern Onboarding.vue already uses, and open them through the in-app browser that already exists. Leave Irish and Croatian out until the Irish gap closes and the Croatian in-app copy fix lands.**

Better × simpler × cheaper: **Better** — it gives the "Where all this comes from" claim ("action research since 2009... real learners, real conversations") two concrete, verifiable receipts instead of asking the learner to take it on faith, and does it through a browser overlay that already exists rather than a new surface. **Simpler** — zero new components, zero new state; it's two more entries in the same verbatim-quote-plus-URL array Onboarding.vue already renders, opened by the composable that already exists. **Cheaper** — no new build, no new maintenance surface, and it deletes the need for anyone to invent supporting copy — the existing WordPress pages *are* the content.

**The case for doing nothing at all:** Tom's own hedge is real — "once people have come to the app, they will have probably already seen these" — so the marginal learner benefit of surfacing them again in-app may be close to zero, and every new link is one more thing that can go stale (the celebrity page's roster of names, the Japanuary post's framing) without anyone noticing. If Tom's instinct is that in-app real estate is better spent elsewhere, not linking these at all is a legitimate, low-cost choice — nothing about the Irish/Croatian gaps or contradictions forces a surface decision either way.

---

**Landing line:** no commits — this is a research/proposal task only, `docs/` and everything else in the repo is unmodified.
