# A-159: Proof-story URL verification (2026-08-18)

Research pass to find REAL, VERIFIED URLs on the SSi website for five proof-story items Tom wants
the app to point learners at. Method: `curl` against `www.saysomethingin.com`'s WordPress REST API
(`/wp/wp-json/wp/v2/...` — posts, pages, and the custom `learner-stories` post type), WP site search,
the SSi forum, and WebSearch/WebFetch as a cross-check. Every URL below was hit with
`curl -s -o /dev/null -w %{http_code} -L URL` for status and `curl -s -I -L URL | grep -i -E
"x-frame|content-security"` for frameability. **No URL in this document was invented, guessed, or
pattern-matched — every one was pulled from a live page, WP API response, or search result.**

Sitemap access was attempted first (`sitemap.xml`, `sitemap_index.xml`) but both return an S3
`AccessDenied` XML error — the WordPress REST API was used as the reliable alternative and proved
far more complete (it exposes 99 learner-stories entries and full post history via one query).

---

## 1. The Irish Experiment (Tom, Kai, Aran — 10 days, September 2025, radio interview)

**GAP — could not verify.** No write-up page, blog post, or radio-interview link was found.

What was checked:
- Full WP `posts` listing for the window 2025-07-01 → 2026-01-01 (REST API, `after`/`before` params) —
  only three posts exist in that range: *Building Partnerships in Japan* (14 Jul 2025), *Discover
  the Joy of Learning as an Adult* (9 Sep 2025, unrelated — a Spanish Adult Learners' Week session),
  and *SaySomethingin at the DISC Symposium* (12 Nov 2025, about a Cardiff cross-border policy
  symposium — mentions "the recent launch of our spoken Irish module" in passing, nothing about a
  10-day experiment or a radio interview).
- WP search (`?s=`) and REST search (`?search=`) for: irish, radio, liveline, RTE, Gaeilge,
  "10 days", experiment, Kai — none returned a matching write-up. ("Gaeilge" and "Kai" only surface
  the unrelated 2024 Dublin partnership-building post and the Japanuary post respectively.)
- SSi forum search (`en.forum.saysomethingin.com/search.json`) for Liveline, "radio interview
  Aran", "Irish challenge 10 days", RTE radio — no matching thread.
- WebSearch for the Irish 10-day experiment + radio interview, and for "Liveline" (RTE's radio
  phone-in show, the most likely fit for "radio interview... probably on our website") — Wikipedia's
  Liveline page has no mention of SaySomethingin, Aran, or Tom.
- The one page that DOES exist about Irish is background, not the September 2025 event:
  **SaySomethingin Gaeilge** (11 Mar 2024) — https://www.saysomethingin.com/wp/en/saysomethingin-gaeilge/
  — status 200, not frame-blocked — describes an Aran+Nick Dublin trip building partnerships with
  Conradh na Gaeilge, Foras na Gaeilge, ADAPT, etc. It predates and does not describe the
  Tom/Kai/Aran 10-day experiment or any radio interview.

**Conclusion: the write-up and the radio interview either aren't published on
www.saysomethingin.com/en/forum/blog, or live somewhere this pass didn't reach (a private recording,
an external broadcaster's site, or not yet published).** Recommend asking Tom directly where the
radio interview was recorded (station name) so it can be searched for directly, rather than guessing.

| URL | HTTP status | Title | Frameable | What it is |
|---|---|---|---|---|
| https://www.saysomethingin.com/wp/en/saysomethingin-gaeilge/ | 200 | SaySomethingin Gaeilge | yes (no XFO/CSP) | 2024 background post on Irish-language partnership building — NOT the Sept 2025 experiment or radio interview |

---

## 2. Japanuary (Japanese experiment, 10 days, January 2025)

**FOUND and verified.**

Tom, Kai and Aran began the challenge 13 Jan 2025 in a cottage in Eryri (Snowdonia), Wales — matches
Tom's account exactly (10-day Japanese challenge, January 2025).

| URL | HTTP status | Title | Frameable | What it is |
|---|---|---|---|---|
| https://www.saysomethingin.com/wp/en/japanuary-can-you-really-learn-japanese-in-10-days/ | 200 | Can You Really Learn Japanese in 10 Days? \| SaySomethingin | yes (no XFO/CSP) | The write-up. Published 29 Jan 2025, dated event start 13 Jan 2025. Describes Aran, Tom, Kai's 10-day Japanese challenge in Eryri, tied to a Wales–Japan government cooperation campaign. |

**Gap**: no video was found for Japanuary specifically. The blog lists two related but distinct
Wales–Japan posts (*Building Partnerships in Japan*, *Celebrating Wales-Japan Cooperation at the
Embassy of Japan*) — both institutional/partnership pieces, not a Japanuary video — so they are not
listed as Japanuary proof material.

---

## 3. The Croatian Story (Aran alone, one hour a day)

**GAP — could not verify.** No write-up exists on www.saysomethingin.com matching this description.

What was checked:
- WP REST search for "croatian" and "hrvatski" (Croatian for Croatian) — zero results, both empty.
- Full 99-entry `learner-stories` custom-post-type listing, cross-checked by full-text content search
  for "Croat" — the only near-hit is **Tatjana Prelog** (learner story, published 4 Sep 2023,
  https://www.saysomethingin.com/wp/en/community/learner-stories/tatjana-prelog/), a Slovenian
  learner of *Welsh* whose bio mentions Croatia only as a neighbouring country to Slovenia — not a
  Croatian-language story and not about Aran.
- WebSearch for "saysomethingin.com Croatian Aran one hour a day" surfaced only SSi forum threads
  (e.g. *75 days of Croatian — livestreaming*, `en.forum.saysomethingin.com/t/75-days-of-croatian-
  livestreaming/42539`) — forum discussion, not a website write-up, and title says "75 days" not a
  1hr/day framing Tom described. Not independently confirmed as the same story Tom means.

**Discrepancy note (per Tom's honesty rule — reporting even though it cuts against finding a URL):**
Tom corrected the record that this was Aran ALONE doing one hour a day, not a group. Nothing found
during this pass contradicts that (no group Croatian write-up exists either) — but nothing confirms
it, since no matching write-up was found at all. The only Croatia-adjacent material found is forum
chatter, which cannot be cited as a proof-story page.

**No table rows for this item — zero verified URLs found.**

---

## 4. Celebrity Videos

**FOUND and verified.** Two landing pages, both live, both listing names — this is the "tons of
celebrity videos" Tom described.

| URL | HTTP status | Title | Frameable | What it is |
|---|---|---|---|---|
| https://www.saysomethingin.com/wp/en/community/testimonials/iaith-ar-daith-celebrity-testimonials/ | 200 | Iaith ar Daith Celebrity Testimonials \| SaySomethingin | yes (no XFO/CSP) | Video index — celebrities giving testimonials about working with Aran. Named individuals with embedded video: Ruth Jones, Scott Quinnell, Katie Owen, Kiri Pritchard-McLean, Chris Coleman, Amanda Henderson, Rakie Ayola, Steve Backshall, Carol Vorderman. |
| https://www.saysomethingin.com/wp/en/community/testimonials/iaith-ar-daith-celebrity-coaching/ | 200 | Iaith ar Daith Celebrity Coaching \| SaySomethingin | yes (no XFO/CSP) | Video index — behind-the-scenes footage of Aran coaching celebrities for the S4C "Iaith ar Daith" TV series (this began after Aran taught Welsh to Jeremy Vine live on BBC Radio 2). 20 named individuals across 4 series (2020–2023), incl. Carol Vorderman, Colin Jackson, Ruth Jones, Adrian Chiles, Scott Quinnell (S1); Steve Backshall, Rakie Ayola, James Hook, Chris Coleman, Joanna Scanlan (S2); Katie Owen, Mike Bubbins, Amy Dowden (S3); Joe Ledley, Jessica Hynes, Aleighcia Scott, Neet Mohan, Jayde Adams (S4). |

Both pages are the parent index — each celebrity is a video block on the SAME page (no separate
per-person URL was found; individual video files are served from wp-content but the page itself is
the correct "landing page" deliverable per the task).

Note: this is Welsh-language "Iaith ar Daith" (S4C TV coaching) content, not a language-neutral
"celebrity learners" page — worth flagging since Tom's phrasing ("tons of celebrity videos") didn't
specify Welsh, and this is what actually exists.

---

## 5. Learner Stories (three cited URLs)

**All three FOUND and verified live**, confirmed against the `learner-stories` REST listing.

| URL | HTTP status | Title | Frameable | What it is |
|---|---|---|---|---|
| https://www.saysomethingin.com/wp/en/community/learner-stories/nigel/ | 200 | Nigel \| SaySomethingIn | yes (no XFO/CSP) | Learner story, published/updated per API as of 7 Apr 2026 |
| https://www.saysomethingin.com/wp/en/community/learner-stories/mike-kent/ | 200 | Mike Kent \| Learner Stories \| Saysomethingin | yes (no XFO/CSP) | Learner story, published 26 Jun 2025 |
| https://www.saysomethingin.com/wp/en/community/learner-stories/jeremy/ | 200 | Jeremy \| SaySomethingIn | yes (no XFO/CSP) | Learner story, published 26 Jun 2025 |

Note: the app's cited URLs use the `/wp/en/community/learner-stories/...` path (with `/wp/`
prefix), which matches the canonical `link` field the WP REST API itself returns for these entries —
confirmed as the correct/current URL form, not a legacy path.

The listing page for all 99 stories, also live and frameable:
https://www.saysomethingin.com/en/community/learner-stories/ — 200, no XFO/CSP.

---

## GAPS (explicit, per Tom's honesty rule)

1. **Irish Experiment write-up** — not found anywhere on www.saysomethingin.com (blog, pages,
   learner-stories, or WP search). No matching September 2025 post exists in the site's own post
   history for that date range.
2. **Irish Experiment radio interview** — not found. No Liveline (RTE) reference, no forum mention,
   no WebSearch hit tying Tom/Kai/Aran to a specific radio broadcast. Recommend asking Tom which
   station/show, so a targeted search can be run.
3. **Japanuary video** — no video was found tied specifically to the Japanuary challenge (only the
   text write-up, item 2 above, is confirmed).
4. **Croatian story write-up** — not found anywhere on the website. Only forum chatter exists
   (*75 days of Croatian — livestreaming*), which is not confirmed to be the same story and is not a
   citable website proof-story page regardless.
5. **Croatian story detail confirmation** — Tom's correction ("Aran alone, one hour a day, NOT a
   group") could not be checked against any source page, since no source page was found at all.

## What was NOT invented
No URL, page title, or person's name above was pattern-matched, guessed, or inferred from
similar-sounding SSi content. Every row in every table was pulled from a live `curl` response (HTTP
200 confirmed) or the site's own WordPress REST API JSON. Where nothing was found, that is reported
as a gap rather than papered over with a plausible-looking substitute.
