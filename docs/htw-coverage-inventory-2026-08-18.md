# How-this-works coverage — the learner-facing inventory

**Date:** 2026-08-18 · **Branch:** `dev` · **Job:** app-wide How-this-works coverage (A-159 follow-on)

Tom's frame: the app is a self-teaching tool with no documentation, so every learner-facing thing must be **either completely obvious through standard visual convention, or explained by a How-this-works walkthrough**. This document is the enumeration that makes that claim checkable. Each row gets one verdict — OBVIOUS with a one-line justification, or NEEDS-A-WALK — plus what is already COVERED by a walk that exists today.

**How it was made.** Part 1 (the player) is my own read of the source, with the Library half exercised live on a production build. Part 2 (everything outside the player) came from a worker; I independently re-verified its load-bearing claims against the code before publishing — specifically `migrateGuestProgress()`, the three Activity stat derivations, and the seed-jump consequence. Where I did not verify a row, it stands as the worker read it.

**Honest gaps, stated up front:**
- **Not exercised live end to end.** The Library and the walkthrough overlay were driven in a real browser on a production build. The player's own cycle, the mode tray, the paywall and session-complete were read from source, not played through. Verdicts on those are source-grounded, not observed.
- **Two dispatched player-inventory workers died to API 529 overload** before doing any work. I wrote Part 1 myself rather than dispatch a third into a degraded API. It is therefore one pair of eyes, not two.
- **Shared working tree.** Other agents' uncommitted files are present; anything in Part 2 marked "working tree" was read mid-edit.

---

# Part 1 — THE PLAYER (`/`)

Tom called this out as the most important half: "the player and its sections/nav meanings". Walks that reach **inside** the player are explicitly parked, so this part's job is to say precisely what would need explaining in there — not to design it. Everything below is currently **unexplained anywhere**: there is no walk in the pack whose place is the player.

## 1a. The resting state — what you meet before pressing play (`PlayerRestingState.vue`)

| # | Element | File:line | What a learner sees | What it MEANS | Verdict | Justification |
|---|---|---|---|---|---|---|
| P1 | Flag + course name + chevron | PlayerRestingState.vue:78-84 | Flag, language name, a chevron | Tap opens the course chooser | OBVIOUS | A chevron on a title is the universal "this is a picker". |
| P2 | Course subtitle | :85 | e.g. the variant | Which version of the language | OBVIOUS | Plain descriptive text. |
| P3 | Belt badge | :95-97 | Coloured dot + "Orange Belt" | Position in the course, not a grade | **COVERED ELSEWHERE** | `where-you-are-in-this-course` explains belts — but only at the Library, never here where the badge actually is. |
| P4 | **Easy / Fast switch** | :105-123 | Two words in a segmented control | A pedagogical pacing choice — how much room you get to answer — not an audio speed | **NEEDS-A-WALK** | Two bare words with nothing saying what changes; "Fast" reads as playback speed, which it is not. |

## 1b. The bottom nav — five slots (`BottomNav.vue`)

| # | Element | File:line | What a learner sees | What it MEANS | Verdict | Justification |
|---|---|---|---|---|---|---|
| P5 | Slot 1 — Library | BottomNav.vue:181-197 | A 2×2 grid of rounded squares | Opens the Library: your position, the belt browser, all courses, and How this works | **NEEDS-A-WALK** | A 2×2 grid is the universal glyph for "apps / grid view", not "library"; the only label is a `title`, which never renders on a phone. This is the door to the entire hub and it is unlabelled. |
| P6 | Slot 2 — left chevron | :200-206 | ‹ | Jumps back one **LEGO** (`title="Previous LEGO"`) | **NEEDS-A-WALK + DEFECT** | Internal vocabulary in learner-facing copy — Tom's ruling is that no learner surface says "lego" or "seed". And on a phone there is no label at all, so the granularity of the jump is unguessable. |
| P7 | Slot 3 — centre button | :208-230 | ▶ / ■ / ← | Play, stop, or **return to the player** from another screen | OBVIOUS for ▶ and ■; **NEEDS-A-WALK** for ← | Play and stop are universal. The ← state appears only when you have navigated away and is a third meaning on the same button — no convention carries that. |
| P8 | Slot 4 — right chevron | :232-245 | › | Next LEGO, or "skip listening" mid-listening-section | **NEEDS-A-WALK + DEFECT** | Same internal vocabulary, same phone-invisible label, and it silently changes meaning during a listening section. |
| P9 | Slot 5 — gear | :247-259 | ⚙ | Settings | OBVIOUS | A gear is settings everywhere. |

## 1c. The mode tray (`ModeTray.vue`)

| # | Element | File:line | What a learner sees | What it MEANS | Verdict | Justification |
|---|---|---|---|---|---|---|
| P10 | Tray handle | ModeTray.vue:186-207 | A slider/equaliser glyph above the nav | Opens the modes tray | **NEEDS-A-WALK** | The glyph reads as "equaliser/filters"; its only label is a desktop-hover `title`. A learner has no reason to press it. |
| P11 | Pronunciation guide toggle | :211-232 | "Pronunciation" + on/off switch | Adds or removes a **romanisation above** the native script — it is not a switch between two scripts | **NEEDS-A-WALK** | The natural reading of a two-state switch on a script is "swap script", which is wrong; the code comment says so explicitly. |
| P12 | Listening mode toggle | :246-265 | "Listening" + a short description | Removes your speaking turn — you listen rather than produce | **NEEDS-A-WALK** | It changes the method, not a setting; what you lose (the turn that does the work) is not in the two lines. |
| P13 | Offline toggle | :268-297 | "Offline", sometimes "Free offline for 30 days" | Opens a depth picker and bulk-downloads audio, governed by a 30-day lease | **NEEDS-A-WALK** | What gets downloaded is a chosen depth, not the course; the 30-day expiry and the online re-check are invisible. |
| P14 | Download progress ring | :179-195 | A coloured ring round the tray button | Green filling = downloading, green = ready, **amber = lease locked/paused**, red = error | **NEEDS-A-WALK** | A colour-only status vocabulary with no legend anywhere. "Amber means your offline lease expired" is unguessable. |

## 1d. Inside a cycle — the actual learning (`LearningPlayer.vue`)

| # | Element | File:line | What a learner sees | What it MEANS | Verdict | Justification |
|---|---|---|---|---|---|---|
| P15 | Phase hint text | LearningPlayer.vue:7006-7019, :15406 | "get ready to speak" / "you're meant to be speaking now" / "listen carefully" | Literal instruction for the current phase | OBVIOUS | It is plain-language instruction; this is the app teaching itself, and it works. |
| P16 | **The silent gap** | (SPEAK phase) | Several seconds of nothing | Your turn — you must produce before you hear it | **NEEDS-A-WALK** | The hint mitigates the "has it stalled?" reading, but the *why* — that producing before hearing is the whole method — is the single biggest thing a new learner needs and it is nowhere. |
| P17 | Phase strip — 4 icon segments | :15491-15550 | Headphones · mic-with-filling-bar · person-1 · person-2 | The four-phase cycle, **and a transport**: each is tappable to jump back to that phase | **NEEDS-A-WALK** | Four wordless icons carrying the app's core mechanic, doubling as controls with no affordance saying they are tappable. |
| P18 | Fill bar on the pause segment | :15514 | A bar filling inside the mic segment | Your speaking time running out | **NEEDS-A-WALK** | Reads as a loading/buffering bar — the one reading that would make a learner wait instead of speak. |
| P19 | Cycle chevrons flanking the strip | :15480-15489, :15551-15560 | ‹ and › either side of the strip | Previous/next **cycle** — a smaller jump than the nav's ‹ › | **NEEDS-A-WALK + confusion risk** | Two visually identical pairs of chevrons on one screen mean two different sizes of jump, with no label distinguishing them. |
| P20 | Target text appearing only at voice 2 | :16002 and phase gating | Text you have been waiting for arrives late | Deliberate: no target text until after you have tried | **NEEDS-A-WALK** | The most important rule in the product, and the most likely to be read as a bug ("the text is lagging"). |
| P21 | Interjections | :15425-15429 | A wave animation, sometimes a caption | Your guide speaking over the lesson | **NEEDS-A-WALK** | "Your guide is speaking" exists only as an `aria-label`; a sighted learner hears a different voice with no visible explanation. |
| P22 | Paywall overlay | :15233-15250 | "You've reached the end of the free preview" + price | Preview exhausted | OBVIOUS | Says exactly what it is. |
| P23 | Offline-lease-locked overlay | :15259-15280 | "Offline access paused" / "Free offline trial ended" | Offline play blocked until you reconnect or subscribe | **NEEDS-A-WALK** | It states the block, not the remedy; a learner offline on a train cannot tell whether reconnecting fixes it. |
| P24 | Session complete — belt ring, %, "N items", time, journey dots | SessionComplete.vue:116-186 | A ring, "34% to Blue", "42 items · 18m" | Position, not achievement; "items" is cycles practised | **NEEDS-A-WALK** | "items" has no stated unit, and "% to Blue" invites reading the belt as a level to grind. |

## 1e. Player elements with no `data-walk` anchor

None of the player carries an anchor. If in-player walks are ever unparked, these are the ones worth anchoring first, with suggested ids: `player-mode-easy-fast` (PlayerRestingState.vue:105), `nav-library` (BottomNav.vue:181), `nav-back` (:200), `nav-centre` (:208), `nav-forward` (:232), `mode-tray-handle` (ModeTray.vue:186), `mode-pronunciation` (:211), `mode-listening` (:246), `mode-offline` (:268), `cycle-phase-strip` (LearningPlayer.vue:15491), `cycle-pause-segment` (:15505), `cycle-target-text` (:16002).

Note for whoever does that work: the compiler's destructive-verb denylist matches `/play/i` and `/toggle/i`, so any anchor named `…play…` or `…toggle…` can be pointed at but never click-advanced. That is the gate working as intended — name accordingly.

---

# Part 2 — OUTSIDE THE PLAYER

**Scope note.** Everything below is read from the **working tree** on branch `a159-library-htw` (not HEAD): `components/me/HowThisWorksLibrary.vue` is uncommitted work-in-progress and has just gained a chips + search "hub" layer — rows 21–24 describe the working-tree version. Verdicts are from source reading only; I did not run the app. `/schools`, `/org`, `/tutors`, `/admin`, `/teacher-insights`, `/znotes` are excluded except as entry links on a learner's own screens. The player itself, its overlays (`ProgressModal`, `ListeningOverlay`, the offline depth picker inside `LearningPlayer.vue`) belong to the other worker — I mark the boundary rather than duplicating.

Existing learner walks: **W1** `where-you-are-in-this-course`, **W2** `choose-something-else-to-learn`, **W3** `save-your-progress`. All three are `place: {route: 'library'}`; W3 is `kinds: ['guest']`. Every other learner walk in the pack is `personas: ['leader'/'admin']` — i.e. **no walk exists anywhere outside the Library.**

## A. The Library / Browse screen (`components/BrowseScreen.vue`)

| # | Surface/element | File:line | What a learner sees | What it MEANS/DOES | Verdict | Justification |
|---|---|---|---|---|---|---|
| 1 | Library header + title | BrowseScreen.vue:418-420 | Sticky bar reading "Library" | Names the screen | OBVIOUS | Titled bar is universal. |
| 2 | Close ✕ | BrowseScreen.vue:421 | ✕ top right | Emits `close` → back to player | OBVIOUS | ✕ dismisses; standard. |
| 3 | Guest "Your progress is fragile" banner | BrowseScreen.vue:426-441 | Warning triangle, "Your progress is fragile / Sign in to save it", chevron | Closes Library and opens the auth modal. Guest progress is localStorage-only (`useBeltProgress` L187, L234) | **COVERED — W3** | Anchor `library-save-progress` exists; W3 explains device-only storage and the email-code flow. |
| 3a | — accuracy caveat on W3 | walks/save-your-progress.json (terminal step) | "Everything you have already done comes with you — signing in… never starts you again" | `migrateGuestProgress()` (useAuth.ts:961-975) reassigns **nothing** — it only clears the guest id. Local progress survives *on that device*; it reaches the account only when the learner next plays and `setLivePosition` writes the cursor. On a *second* device before playing again, it is not there | **NEEDS-A-WALK (copy correction)** | The walk asserts more portability than the code delivers. |
| 4 | Organisation Dashboard link | BrowseScreen.vue:444-459 | Building icon, "Organisation Dashboard / Your people, invites & progress" | Routes to `/org/:id` | OBVIOUS | Labelled row + chevron; leader-only, and a leader knows what an org is. |
| 5 | Schools Dashboard link | BrowseScreen.vue:462-476 | "Schools Dashboard / Classes, students & analytics" | Routes to `/schools` | OBVIOUS | Same; only rendered for school roles. |
| 6 | Tutor Dashboard link | BrowseScreen.vue:479-493 | "Tutor Dashboard / Your classes & learners" | Routes to `/tutors/dashboard` | OBVIOUS | Same. |
| 7 | "Your Progress" card (whole) | BrowseScreen.vue:498 | Tappable card | Tapping toggles the inline belt browser | **COVERED — W1** | Anchor `library-progress-card`. |
| 8 | Belt strip — 8 dots | BrowseScreen.vue:500-517 | Eight coloured circles, ticks on past ones | Belt = position by seed count, not a grade | **COVERED — W1** | Anchor `library-belt-strip`; W1 states "position, not a grade". |
| 9 | Position track | BrowseScreen.vue:521-530 | Bar with faint colour bands and a playhead | Completed seeds ÷ course total; bands are belt zones | **COVERED — W1** | Anchor `library-position-track`. |
| 10 | "{Belt} Belt" + "{N}% of the way" | BrowseScreen.vue:533-540 | e.g. "Orange Belt · 34% of the way" | % of *seeds*, from `highestLegoId`, not of time or mastery | **NEEDS-A-WALK** | W1 covers the bar, never says what the % counts; "% of the way" reads as course-completion to a learner. No own anchor. |
| 11 | "View Belts" chevron | BrowseScreen.vue:543-548 | Text + chevron | Same toggle as the card | **COVERED — W1** | Anchor `library-belt-browser`. |
| 12 | Inline belt browser | BrowseScreen.vue:553-560 → CourseBrowser.vue | Expands `CourseBrowser` | Belt list → seed list; picking one **jumps the player there** (`start-seed`) | **NEEDS-A-WALK** | W1 says "start again from any point" but the browser's own two levels, ticks and the consequence of jumping (your cursor moves) are unexplained inside it. |
| 13 | CourseBrowser back chevron / heading | CourseBrowser.vue:5-14 | ‹ and "Course Browser" / belt name | Level up | OBVIOUS | Back chevron. |
| 14 | CourseBrowser belt rows w/ tick | CourseBrowser.vue:19-51 | Belt rows, ticks, chevrons | Tick = belt passed | OBVIOUS | Tick + chevron are standard list convention. |
| 15 | CourseBrowser seed rows | CourseBrowser.vue:57-73 | Sentence rows with ticks | Tap = start the player at that LEGO | **NEEDS-A-WALK** | Tapping silently relocates the learner's position; nothing on screen says so. |
| 16 | Activity → "Total Time" | BrowseScreen.vue:573-585 | Clock icon, e.g. "~4h 12m" | Signed-in: server engaged minutes **across all courses** (`/api/me/engaged-time`). Guest/offline: local session history, **per-course and 30-day-windowed** (useBeltProgress.ts:379-380, 487-489). `~` = position-derived estimate, explained only in a `title` tooltip | **NEEDS-A-WALK** | Two different definitions behind one label; the `~` caveat is desktop-hover-only, invisible on a phone. |
| 17 | Activity → "Words" | BrowseScreen.vue:587-596 | Book icon, a number, label "Words" | It is `completedSeeds` — the **seed ordinal** parsed from `highestLegoId` (PlayerContainer.vue:319-323). Seeds are sentences, not words | **NEEDS-A-WALK** | The label is arguably wrong, not merely unexplained: no learner reads "Words" as "sentences reached". |
| 18 | Activity → "Phrases" | BrowseScreen.vue:598-607 | Mic icon, a number, "Phrases" | Sum of `phrasesSpoken` over local session history — **this course only, last 30 days** | **NEEDS-A-WALK** | Sits beside a possibly all-course, all-time "Total Time"; the windows differ and nothing says so. |
| 19 | "How this works" toggle link + throb dot | HowThisWorksLibrary.vue:76-79 | Small underlined "How this works" with a soft red dot | Opens the explainer panel; dot = never opened, per viewer, in localStorage | OBVIOUS | Underlined link + unread dot is standard; deliberately quiet by design. |
| 20 | Panel intro | HowThisWorksLibrary.vue:82-83 | Kicker + "Take a look round the app, right here on your own page." | Frames the walks | OBVIOUS | Plain sentence. |
| 21 | Walk topic **chips** (working tree) | HowThisWorksLibrary.vue:85-90 | Red-outlined chips, one per offered walk topic | Tapping starts the walk overlay on the real page | **NEEDS-A-WALK** *(meta)* | A chip labelled "Where you are" gives no hint that tapping starts a guided overlay on your own data; chips normally filter. No `data-walk` anchor. |
| 22 | **Search** trigger (working tree) | HowThisWorksLibrary.vue:91-96 | Magnifier + "Search" chip | Opens a modal search over walks | OBVIOUS | Magnifier + "Search". |
| 23 | Search pop-up + input | HowThisWorksLibrary.vue:108-121 | Scrim, search field "What would you like to know?", ✕ | Filters `searchWalks(...)` — only walks this learner is offered | OBVIOUS | Standard search sheet. |
| 24 | Search results / empty state | HowThisWorksLibrary.vue:122-132 | Title + topic rows; "Nothing on that one yet — try another word." | Starts the walk | OBVIOUS | List rows; empty state is plainly worded. |
| 25 | "Using the app" collapsible | HowThisWorksLearner.vue:1-20 (mounted at HowThisWorksLibrary.vue:100) | Underlined link → prose blocks | `HOW_THIS_WORKS_LEARNER` copy | OBVIOUS | Disclosure link; it *is* the documentation layer. |
| 26 | "Why this works" collapsible | WhyThisWorks.vue:1-20 (HowThisWorksLibrary.vue:101) | Underlined link → methodology prose | Methodology explainer | OBVIOUS | Same. |
| 27 | "All Courses" search box | BrowseScreen.vue:616-623 | "Search any language…" | Filters on display name, code, English name **and endonym** of both languages | **COVERED — W2** | Anchor `library-course-search`. |
| 28 | Loading spinner | BrowseScreen.vue:626-628 | Spinner | Catalogue fetch in flight | OBVIOUS | Spinner. |
| 29 | No-results line | BrowseScreen.vue:631-633 | `No courses matching "x"` | Empty filter | OBVIOUS | Standard empty state. |
| 30 | Course grid | BrowseScreen.vue:636 | Grid of cards | The catalogue (`new_app_status` live/beta) | **COVERED — W2** | Anchor `library-course-grid`; W2 covers "tap to switch, nothing is lost". |
| 31 | Course card — flag + language name | BrowseScreen.vue:652-653 | Flag + "Welsh" | Target language | OBVIOUS | Flag + name. |
| 32 | "for X speakers" | BrowseScreen.vue:654 | "for English speakers" | The **known** side: the course teaches *into* X from that language, and the prompts will be in X | **NEEDS-A-WALK** | Direction is the single most confusable thing in the catalogue; "for English speakers" reads as an audience note, not as "your prompts will be English". Not covered by W2. |
| 33 | "Premium" badge | BrowseScreen.vue:650 | Small corner badge | `pricing_tier === 'premium'` **and** you lack access. It does **not** lock the course — it plays free to end-of-Yellow (seed 19), then walls (BrowseScreen.vue:306-322, App.vue:402) | **NEEDS-A-WALK** | The badge implies "locked"; the truth is "free until seed 19". Nothing states the boundary. |
| 34 | "Try free →" status | BrowseScreen.vue:657, 692 | "Try free →" | Same condition as the Premium badge — both render on the same card | **NEEDS-A-WALK** | Two contradictory-looking signals for one state; neither names the limit. |
| 35 | Active-course tick badge | BrowseScreen.vue:645-649 | Tick badge on the card | This is the course currently loaded | OBVIOUS | Tick = current selection. |
| 36 | Belt dot + "N / M" progress label | BrowseScreen.vue:658-661, 693 | Coloured dot + e.g. "132 / 604" | N = **LEGO ordinal** from `course_round_index`; M = `lego_count`. Fallback silently switches to **seed / seed_count** (BrowseScreen.vue:391-406) — a different unit, same-looking label | **NEEDS-A-WALK** | Unlabelled fraction whose unit can change between renders; the dot's colour (belt) is also unexplained here. |
| 37 | Variant group card "N variants ▾" | BrowseScreen.vue:668-680 | "Welsh · for English speakers · 2 variants ▾" | Expands dialect children rather than starting a course | OBVIOUS | ▾ plus a count is standard disclosure. |
| 38 | Variant sub-cards | BrowseScreen.vue:684-694 | "Northern" / "Southern" | Genuinely different courses, separate progress each | **NEEDS-A-WALK** | Nothing says the two variants keep separate positions and are not interchangeable mid-course. |
| 39 | Tapping any course card | BrowseScreen.vue:324-326 → PlayerContainer | Card tap → player | Switches active course; the old one keeps its own cursor | **COVERED — W2** (step 3) | W2 explicitly says each keeps its place. |
| 40 | "Teach with SaySomethingin" card | BrowseScreen.vue:702-710 | "Anyone can teach — share the language you're learning" | Routes to `/tutors` onboarding (a paid tutor product) | **NEEDS-A-WALK** | Reads as an invitation to a free community feature; it lands on a tutor-business onboarding funnel. |

## B. `/me` — the learner profile (`views/me/ProfileView.vue`)

**GAP first:** `/me` is **unreachable in the app.** A repo-wide grep for `'/me'` links returns nothing outside the router; the file header states this is deliberate ("this route is deliberately unlinked from every nav… visiting /me is the flag"). Rows 41–56 are inventoried as designed, but no learner meets them today.

| # | Surface/element | File:line | What a learner sees | What it MEANS/DOES | Verdict | Justification |
|---|---|---|---|---|---|---|
| 41 | "You" header + sample-data note | ProfileView.vue:83-88 | "You"; sometimes "Some of this is sample data…" | Some panels render mock data | OBVIOUS | The note says so in plain words. |
| 42 | Loading "Just a moment…" | ProfileView.vue:90 | Text | Profile API in flight | OBVIOUS | Plain. |
| 43 | Adherence — "N goes this week" | AdherencePanel.vue:5-8 | Big number + "goes this week" | A "go" = one attempt at speaking | OBVIOUS | The panel's own footnote (L16-18) defines it exactly. |
| 44 | Adherence — speaking/listening minutes | AdherencePanel.vue:10-14 | "12 minutes speaking · 4 minutes listening" | Weekly split | OBVIOUS | Self-describing. |
| 45 | "Sample data — not your real numbers yet" | AdherencePanel.vue:20 (and each panel) | Small grey line | Mock payload | OBVIOUS | States itself. |
| 46 | Mirror — "How quickly it comes" | MirrorPanel.vue:3-13 | "2.1s to answer, lately" vs "4.8s when you started" | Median response latency in the PAUSE phase | **NEEDS-A-WALK** | Learner is never told the app *times* their answers; where the number comes from is SSi-specific and slightly surprising. |
| 47 | Mirror — trend chart + "Where this is heading" | MirrorPanel.vue:16-28 | Line plus a dashed projection, keyed "Measured" / "Where this is heading" | Extrapolated, not measured | OBVIOUS | The legend distinguishes the two explicitly. |
| 48 | Mirror — "N things now come back without you reaching" | MirrorPanel.vue:32-34 | Sentence | `unitsSteady` — LEGOs answered fast and consistently | **NEEDS-A-WALK** | "Things" is undefined; the threshold behind "steady" is invisible. |
| 49 | Portrait — CEFR band + interval | PortraitPanel.vue:5-10 | "A2 / somewhere between A1 and B1" | Estimate from difficulty × execution | OBVIOUS | The panel's own paragraph (L19-22) says it is a guess, not a test. |
| 50 | Portrait — confidence meter | PortraitPanel.vue:12-17 | Filling bar + a line | How sure the estimate is; narrows over time | OBVIOUS | Labelled meter with a caption. |
| 51 | Portrait — "The last thing you said" | PortraitPanel.vue:24-28 | Target sentence + known gloss | The position display (position = last LEGO, shown as content) | OBVIOUS | Kicker names it exactly. |
| 52 | Plan — "N hours in" + trail | PlanPanel.vue:5-13 | Big number, a filled bar | Hours done against the 30-hour arc | OBVIOUS | The intro (L15-18) explains the 30 hours. |
| 53 | Plan — route buttons | PlanPanel.vue:20-34 | Named routes with a shape + blurb | Chooses a study cadence; stored preference | OBVIOUS | Pressed-state buttons with descriptions. |
| 54 | Plan — "Fancy a different route?" | PlanPanel.vue:41-43 | Text button | Re-opens the picker | OBVIOUS | Says what it does. |
| 55 | Mode nudge line | ProfileView.vue:96 | One italic-ish line of advice | `suggestedMode(hoursDone)` | OBVIOUS | Reads as advice, is advice. |
| 56 | "Your languages" switch row | CourseSwitchRow.vue:2-27 | Current course + other flags | Tapping switches active course | OBVIOUS | Footnote (L24-26) states nothing is lost. |
| 57 | Settings sketch — "Language you read in" chips | SettingsDirection.vue:6-21 | Language chips | Interface language, **not** the course | OBVIOUS | The sub-line draws the distinction explicitly. |
| 58 | Settings sketch — "How fast things play" | SettingsDirection.vue:23-38 | Speed chips | Slows target audio only | OBVIOUS | Sub-line says "never the explanations". |
| 59 | Settings sketch — "Give me a moment" toggle | SettingsDirection.vue:40-50 | Toggle | Microphone voice-onset detection sets pause length | OBVIOUS | Sub-line covers the mic and "nothing is recorded". |
| 60 | "…the rest" list + sketch note | SettingsDirection.vue:52-60 | Expandable list, then "these labels aren't live controls here yet" | Non-functional | **BROKEN/DEAD (declared)** | Honest, but it is dead UI on a learner-facing page. |
| 61 | "Back to learning" | ProfileView.vue:104 | Underlined link | `/` | OBVIOUS | Plain link. |

## C. Settings — the real one a learner reaches (`components/SettingsScreen.vue`, gear in `BottomNav.vue:89-100`)

| # | Surface/element | File:line | What a learner sees | What it MEANS/DOES | Verdict | Justification |
|---|---|---|---|---|---|---|
| 62 | Bottom-nav gear | BottomNav.vue:89-100 | Gear pill | Opens Settings | OBVIOUS | Gear = settings. |
| 63 | Bottom-nav Library tile | BottomNav.vue:23-39 | 4-square grid icon | Opens the Library | OBVIOUS | Grid icon = browse; the only route to rows 1-40. |
| 64 | Settings ✕ | SettingsScreen.vue:1557 | ✕ | Close | OBVIOUS | Standard. |
| 65 | Build row + "Update available" / "Tap to update" | SettingsScreen.vue:1569-1576 | Version string, pulsing badge | Tap forces the service worker to take the new build | **NEEDS-A-WALK** | A version string being *tappable* is not a convention; nor is what an update costs (nothing — but the learner cannot know). |
| 66 | "What's New" section | SettingsScreen.vue:1586, 1618 | Release notes / "Loading…" | Release notes feed | OBVIOUS | Titled and self-evident. |
| 67 | Guest account CTA | SettingsScreen.vue:1624-1631 | "Sign in to save your progress across devices" + Sign In | Closes settings, opens auth modal | **NEEDS-A-WALK** | Same claim as row 3a — "across devices" overstates what happens to *existing* guest progress. W3 is Library-only; this second door has no anchor. |
| 68 | Display name row | SettingsScreen.vue:1674-1695 | Name + inline editor | Written to the learner row; **teachers see it on class lists** | **NEEDS-A-WALK** | Who can see the name is invisible here (RedeemCode says it at L186; Settings does not). |
| 69 | Set / Change Password | SettingsScreen.vue:1675-1699 | Row → inline password form | Adds password sign-in alongside email codes | **NEEDS-A-WALK** | Learner cannot tell whether this *replaces* the emailed code. (A `set-your-password` walk exists but is `personas: ['leader']`, `place: node-home` — it never reaches here.) |
| 70 | Primary email + verify state | SettingsScreen.vue:1710-1740 | Email, sometimes "Code sent — enter it below" | Verifies/changes the sign-in address | OBVIOUS | Labelled inline flow. |
| 71 | Linked emails + add-email OTP | SettingsScreen.vue:1746-1795 | List, "another@example.com", 6-digit field | Multiple addresses sign in to **one** account | **NEEDS-A-WALK** | "Linked emails" is an SSi concept; the benefit (school address + personal address, one progress) is nowhere stated. |
| 72 | Sign Out | SettingsScreen.vue:1816 | Red row | Ends the session; local progress stays on the device but is no longer synced | OBVIOUS | Standard, and the consequence matches expectation. |
| 73 | Dashboards section (Org / Schools / Admin) | SettingsScreen.vue:1829-1900 | Up to three labelled rows | Entry links only | OBVIOUS | Labelled rows + descriptions; role-gated. |
| 74 | Interface language | SettingsScreen.vue:1877-1900 | Globe + language picker | UI chrome language, not the course | **NEEDS-A-WALK** | Unlike `SettingsDirection` (row 57), this one carries **no** "not what you're learning" sub-line — the exact confusion the /me sketch was written to prevent. |
| 75 | Learning Speed | SettingsScreen.vue:1914-1930 | Slider/chips, "Adjust how fast target language audio plays. Does not affect your known language." | Target-audio playback rate | OBVIOUS | Its own description carries it. |
| 76 | Tools → View Script | SettingsScreen.vue:1946-1955 | "Browse course rounds and lego sequences" | Script browser; dev-flag gated | **NEEDS-A-WALK** | "Rounds" and "lego" are internal vocabulary shown to a learner. |
| 77 | Tools → QA Mode | SettingsScreen.vue:1963-1972 | "Flag phrases that don't sound right…" | Content feedback to the team | OBVIOUS | Description is complete. |
| 78 | Personalised pacing toggle | SettingsScreen.vue:1981-1990 | Toggle + mic explanation | Voice-onset detection adapts pause length; nothing recorded | OBVIOUS | The description covers both the mechanism and the privacy question. |
| 79 | "Enter a code" | SettingsScreen.vue:1996-2040 | Row → `ABC-123` field, Join/Cancel/Close | Redeems invite **or** entitlement codes — same machinery as `/redeem` | **NEEDS-A-WALK** | One field, two unrelated meanings (join a class vs unlock paid access); the learner cannot tell which they hold. |
| 80 | Subscription — Family / Premium status | SettingsScreen.vue:2045-2100 | "SSi Family — covered by your family plan" / "Renews 3 Sep" / "Ends … — you keep access until then" | Live subscription state | OBVIOUS | Dated, plain-English status lines. |
| 81 | Manage family | SettingsScreen.vue:2073-2080 | "Add or remove members, up to 6 accounts" | Opens `FamilyManagementModal` | OBVIOUS | Description states the cap. |
| 82 | Cancel subscription + confirm | SettingsScreen.vue:2087-2095, 1512-1560 | "Stay Premium until … then stop" + overlay | Schedules cancellation at period end | OBVIOUS | Consequence is spelled out before and during. |
| 83 | Payment & invoices | SettingsScreen.vue:2109-2120 | Row, "Opening…" | Paddle customer portal (leaves the app) | OBVIOUS | Named for what it opens. |
| 84 | Go Premium / Go Family | SettingsScreen.vue:2109-2130 | Rows | Opens `CheckoutOverlay` | **NEEDS-A-WALK** | What Premium actually unlocks (past seed 19 on premium courses; community courses are always free) is stated nowhere on this screen. |
| 85 | Reset progress + overlay | SettingsScreen.vue:2140-2148, 1380-1400 | "Start fresh for this course" → "Reset {course}?" | Wipes **this course's** progress only | OBVIOUS | Course name in the confirm makes the blast radius explicit. |
| 86 | Delete Account + DELETE overlay | SettingsScreen.vue:2152-2160, 1477-1500 | "Permanently delete your account and all data"; type DELETE | Irreversible account deletion | OBVIOUS | Type-to-confirm is the standard destructive pattern. |
| 87 | Update to latest | SettingsScreen.vue:2256-2262 | "Reloads with the newest version. Your downloads and progress are kept." | SW update + reload | OBVIOUS | Reassurance is in the copy. |
| 88 | Clear cache and reload | SettingsScreen.vue:2267-2275, 1448-1466 | "Fixes most audio and loading problems. You stay signed in." + overlay offering "Create a free account to keep it" | Drops caches; for a **guest** this can lose progress, hence the account offer | **NEEDS-A-WALK** | The row's copy ("you stay signed in") and the overlay's guest warning contradict each other depending on who you are. |
| 89 | "Recover a lost position" / "Move to your furthest point?" | SettingsScreen.vue:2288-2296, 1421-1430 | Row → overlay → "Position recovered!" | Moves the cursor forward to the ratcheted high-water mark | **NEEDS-A-WALK** | Cursor vs furthest-point is the deepest SSi-specific model in the app and is exposed here with no explanation of the two positions. |
| 90 | Install App | SettingsScreen.vue:2304-2310 | "Add to your home screen for faster, offline access" | Opens `/install` or the native prompt | OBVIOUS | Familiar PWA phrasing. |
| 91 | Community rows (Forum, Classic Welsh Listening) | SettingsScreen.vue:2318-2345 | Rows | External links, leave the app | **NEEDS-A-WALK** (minor) | No external-link affordance; "Classic Welsh Listening" names a legacy product nothing on this screen introduces. |
| 92 | Legal rows | SettingsScreen.vue:2350-2380 | Terms / Privacy / Refund | External policy pages | OBVIOUS | Universal footer convention. |
| 93 | Developer section | SettingsScreen.vue:2164-2240 | Debug Overlay, Verbose Logging, Listening Progression Audit, Fragile Progress Warning | Dev/tester flags | OBVIOUS *(out of learner scope)* | Gated to testers/admins; not a learner surface. |

## D. Sign-in / OTP (`components/auth/AuthModal.vue` + `SignInModal.vue`)

| # | Surface/element | File:line | What a learner sees | What it MEANS/DOES | Verdict | Justification |
|---|---|---|---|---|---|---|
| 94 | Auth modal shell + ✕ | AuthModal.vue:7-20 | Logo, title, ✕ | Singleton modal (`useAuthModal`) | OBVIOUS | Standard modal. |
| 95 | Step title | SignInModal.vue:66-71 | "Sign in or create account" | One flow does both | OBVIOUS | The title says both. |
| 96 | Email field + "We'll send you a code" | SignInModal.vue:93-129 | Email + hint | Supabase `signInWithOtp` | OBVIOUS | Hint states the mechanism. |
| 97 | Password toggle | SignInModal.vue:145-149 | "Use a password instead" | `signInWithPassword` | OBVIOUS | Explicit switch. |
| 98 | "Got an access code?" | SignInModal.vue:151-153 | Link → code step | Same redemption path as `/redeem` | **NEEDS-A-WALK** | "Access code" is undefined here — invite? entitlement? class join? |
| 99 | Code step + "Continue without a code" | SignInModal.vue:5-50 | `ABC-123` + escape link | Optional code | OBVIOUS | The escape link is explicit. |
| 100 | Context/confirm-role step | SignInModal.vue:58-70 | Context description + back | Confirms what the code grants before redemption | OBVIOUS | Named and reversible. |
| 101 | Entitlement banner "Sign in to activate" | SignInModal.vue:78 | Small banner | Code will be redeemed after sign-in | OBVIOUS | States the sequencing. |
| 102 | Verify step + resend + 20s hint | SignInModal.vue:162-232 | "We've sent a code to …", 6 digits, Resend | `verifyOtp`; double-tap is disambiguated by a live-session check (SignInModal.vue:225-238) | OBVIOUS | Textbook OTP screen. |
| 103 | What sign-in does to existing guest progress | useAuth.ts:961-975 | — nothing on screen — | See row 3a: local progress is not uploaded; the guest id is simply dropped | **NEEDS-A-WALK** | The single biggest unexplained consequence outside the player, and the one the app makes a promise about. |
| 104 | `AuthPrompt.vue` "Save your progress / Create account / Maybe later" | AuthPrompt.vue:1-26 | Card | Signup nudge | **GAP — possibly dead** | I found no mount site for `AuthPrompt.vue` in the working tree; if unmounted it is dead code, if mounted it is a third sign-in door with different wording from rows 3 and 67. |

## E. Code doors

| # | Surface/element | File:line | What a learner sees | What it MEANS/DOES | Verdict | Justification |
|---|---|---|---|---|---|---|
| 105 | `/redeem/:code?` — validating | RedeemCode.vue:710-712 | Spinner, "Checking code…" | Server validation | OBVIOUS | Spinner + status. |
| 106 | `/redeem` bare — "Enter your code" | RedeemCode.vue:716-748 | "Type the code your teacher or admin gave you", `ABC-123` | Manual entry (whiteboard codes) | OBVIOUS | Names the source of the code. |
| 107 | Invalid code | RedeemCode.vue:754-765 | "Invalid Code", reason, "Try another code" / "Go to App" | Dead end with two exits | OBVIOUS | Error + recovery. |
| 108 | Redeeming / success | RedeemCode.vue:769-786 | "Activating your code…", "Access activated!" + Continue | Grant applied | **NEEDS-A-WALK** | "Access activated" never says *what* was granted, for how long, or to which courses — and this is the moment the learner would want to know. |
| 109 | Already-signed-in confirm | RedeemCode.vue:799-806 | "You're signed in as x@y — redeem to this account?" + "use a different email" | Binds the code to the current account | OBVIOUS | Identity is stated before the irreversible bind. |
| 110 | Possession step (name + email, no password) | RedeemCode.vue:814-880 | "Tell us who you are and you're in — no password, no code to wait for." | Possession of the link *is* the credential — creates an account with no verification | **NEEDS-A-WALK** | The learner cannot tell they have just been given a real account, nor how they get back in later on another device. |
| 111 | Pupil name-only step | RedeemCode.vue:880-923 | "What's your name? Your teacher will see it on the class list." | Creates the class-roster identity | OBVIOUS | Visibility consequence is stated on-screen. |
| 112 | Already-registered fork | RedeemCode.vue:924-936 | "An account already exists for x" + sign in / go back | Routes to sign-in | OBVIOUS | Both exits labelled. |
| 113 | Email-code auth + OTP inside the door | RedeemCode.vue:938-1035 | Email → 6-digit code → verify, spam-folder hint | Standard OTP inside the redeem flow | OBVIOUS | Same convention as row 102. |
| 114 | `/group/:code?` landing hero | RedeemCode.vue:697-710 (`variant: 'landing'`, router:765-771) | Logo, eyebrow, heading, sub, fact bullets | **Same** component as `/redeem`, marketing-skinned, for **group leaders** — not a learner door | OBVIOUS *(not a learner surface)* | Presentation-only variant; audience is leaders (router comment L761-764). |
| 115 | `/try/:code` — checking / welcome / auto-redirect | TryLinkGateway.vue:66-81 | "Checking your link…", then "Welcome to SaySomethingin", 1.2s, then `/` | Mints a **time-boxed** entitlement token into `sessionStorage`, then drops the learner on the player | **NEEDS-A-WALK** | Nothing tells the learner they now have temporary paid access, that it expires, or that it dies with the browser tab (`sessionStorage`). |
| 116 | `/try/:code` — "Link not valid" | TryLinkGateway.vue:84-95 | Error + "Visit SaySomethingin" | Dead end **out of the app** to the marketing site | **BROKEN-ish** | The only exit leaves the app entirely — no "carry on as a guest" path back to `/`. |
| 117 | `/board/:code` snapshot | BoardSnapshotView.vue:1-40 (router:781-786) | Frozen board report, "Frozen … — a dated snapshot, not a live view." | Unguessable-URL capability link for **boards/leaders** | OBVIOUS *(not a learner surface)* | Audience is a board reader; the freshness caveat is in the copy. |
| 118 | `/with/:code` teacher landing | views/teach/WithTeacher.vue:34-114 | Class name, teacher, bio, price pitch, Monthly/Annual toggle | A **paid** tutor-class join door a learner is sent by their tutor | **NEEDS-A-WALK** | A learner arriving from a friendly "join my class" message meets a billing decision; what is bought, and what happens to their existing free progress, is not addressed. |
| 119 | `/with/:code` unavailable / not-found | WithTeacher.vue:11-25 | "This link is temporarily unavailable." / "We couldn't find that class." | Revoked vs wrong code | OBVIOUS | Two distinct, plainly-worded states. |

## F. Install, updates, offline, recovery

| # | Surface/element | File:line | What a learner sees | What it MEANS/DOES | Verdict | Justification |
|---|---|---|---|---|---|---|
| 120 | `InstallBanner` | InstallBanner.vue:8-16 | "Install SaySomethingin / Faster, offline, full-screen" + Install + ✕ | Native `beforeinstallprompt` | OBVIOUS | Standard install banner. |
| 121 | `/install` — already installed | InstallGuide.vue:13-15 | "You're all set!" + countdown | Auto-redirect | OBVIOUS | Says so. |
| 122 | `/install` — native path | InstallGuide.vue:21-34 | Benefits list + Install / "Not now" | Fires the prompt | OBVIOUS | Standard. |
| 123 | `/install` — iOS/Android manual walkthrough | InstallGuide.vue:66-173 | Share-sheet steps, mock screenshots, Back/Next/Done | Browser-specific manual instructions | OBVIOUS | It *is* a walkthrough already. |
| 124 | "Works offline — learn anywhere" claim | InstallGuide.vue:26, 186 | Bullet | Installing does **not** download audio; offline play needs the separate offline download (row 127) | **NEEDS-A-WALK** | A promise the install alone does not keep — the classic offline-coverage misunderstanding. |
| 125 | `PwaUpdatePrompt` | PwaUpdatePrompt.vue:12-25 | Small prompt: update / dismiss / relaunch | Applies a waiting service worker; polls every 5 min | OBVIOUS | Standard update toast. |
| 126 | `AppEscape` back pill | AppEscape.vue:2-10 | "Back" / "Go to {label}" | Contextual escape from a sub-surface | OBVIOUS | Labelled back control. |
| 127 | Offline mode row in the mode tray | ModeTray.vue:268-283 | "Offline" row; for non-payers a "Free offline for 30 days" nudge (LearningPlayer.vue:1808-1813) | Opens the full-screen depth picker → bulk download; governed by a **30-day lease** (`useOfflineLease`) | **NEEDS-A-WALK** | What gets downloaded (a chosen *depth*, not the course), that it expires after 30 days, and that it re-checks online, are all invisible. |
| 128 | Offline download progress ring | ModeTray.vue:179-195, 44-57 | Coloured ring round the tray button: green filling, amber, red | amber = **lease locked/paused**; red = error; green partial = "ready" | **NEEDS-A-WALK** | A colour-only status vocabulary with no legend; "amber = your offline lease has expired" is unguessable. |
| 129 | Offline depth picker + `ProgressModal` offline notes | LearningPlayer.vue / ProgressModal.vue:111-197 | Depth choices, "belt not downloaded" hints | Chooses download scope | **BOUNDARY — player worker** | Lives inside `LearningPlayer`/`ProgressModal`; flagged so it is not dropped between the two inventories. |
| 130 | `/reset` route | router/index.ts:826-833 → App.vue:75-105 | Nothing — hard-redirects to `/?reset=1`, then a clean app | `localStorage.clear()`, `sessionStorage.clear()`, deletes **all** IndexedDB, unregisters SWs, clears caches | **NEEDS-A-WALK / HAZARD** | For a **guest** this is total, silent, unconfirmed progress destruction. No confirm dialogue, no warning, no mention of signing in first — unlike the Clear-cache overlay (row 88), which does offer it. |
| 131 | 404 catch-all | router/index.ts:836-838 | Player screen | Any unknown URL silently redirects to `/` | **NEEDS-A-WALK / minor defect** | A mistyped or expired code link lands on the player looking as if it worked; nothing says the link failed. |
| 132 | `/methodology` | router/index.ts:800-822, MethodologyContainer.vue:5-33 | "Back to Admin" top bar; non-admins get a permanent "Loading…" | **Admin-gated** — `useAdminGate` | **NOT A LEARNER SURFACE + defect** | A learner following this URL sits on an endless spinner rather than being told or redirected. |
| 133 | Kill-switch overlay | App.vue:762-764 | A bare message, no controls | Remote disable | **NEEDS-A-WALK / unlabelled** | A blocking full-screen message with no action, no branding and no route out. |

---

## (1) Elements with NO `data-walk` anchor that would need one

Only **7** anchors exist app-wide outside the player, all in `BrowseScreen.vue` (`library-save-progress`, `library-progress-card`, `library-belt-strip`, `library-position-track`, `library-belt-browser`, `library-course-search`, `library-course-grid`). Everything below is unanchored.

**Library (`components/BrowseScreen.vue`)**
| file:line | element | suggested anchor |
|---|---|---|
| :533 | belt name + "% of the way" | `library-percent-label` |
| :572 | Activity stat grid (container) | `library-activity-stats` |
| :573 | Total Time card | `library-stat-total-time` |
| :587 | Words card | `library-stat-words` |
| :598 | Phrases card | `library-stat-phrases` |
| :640 | a single course card | `library-course-card` |
| :654 | "for X speakers" | `library-course-direction` |
| :650 | Premium badge | `library-premium-badge` |
| :657 | "Try free →" status | `library-try-free` |
| :658 | belt dot + N / M label | `library-course-position` |
| :668 | variant group card | `library-variant-group` |
| :683 | expanded variant list | `library-variant-list` |
| :702 | Teach with SaySomethingin | `library-become-teacher` |
| :444 / :462 / :479 | dashboard entry links | `library-org-link` / `library-schools-link` / `library-tutor-link` |

**How-this-works hub (`components/me/HowThisWorksLibrary.vue`, working tree)**
| :76 | toggle link | `library-how-this-works` |
| :85 | chip row | `library-htw-chips` |
| :91 | search trigger | `library-htw-search` |

**Belt browser (`components/CourseBrowser.vue`)**
| :19 | belt row list | `belts-list` |
| :57 | seed row list | `belt-seed-list` |

**Settings (`components/SettingsScreen.vue`)**
| :1569 | build/update row | `settings-build-update` |
| :1624 | guest sign-in CTA | `settings-save-progress` |
| :1675 | set/change password | `settings-password` |
| :1746 | linked emails | `settings-linked-emails` |
| :1877 | interface language | `settings-interface-language` |
| :1914 | learning speed | `settings-learning-speed` |
| :1981 | personalised pacing | `settings-personalised-pacing` |
| :1996 | enter a code | `settings-enter-code` |
| :2109 | Go Premium | `settings-go-premium` |
| :2140 | reset progress | `settings-reset-progress` |
| :2267 | clear cache and reload | `settings-clear-cache` |
| :2288 | recover a lost position | `settings-recover-position` |
| :2304 | install app | `settings-install-app` |

**Auth (`components/auth/SignInModal.vue`)**
| :93 | email step | `auth-email` |
| :151 | "Got an access code?" | `auth-code-link` |
| :162 | verify step | `auth-verify` |

**Offline (`components/ModeTray.vue`)**
| :268 | Offline row | `mode-offline` |
| :179 | download progress ring | `offline-progress-ring` |

**/me (`views/me/ProfileView.vue` and children)** — no anchors anywhere; if these are ever linked, `me-adherence` (AdherencePanel.vue:2), `me-mirror` (MirrorPanel.vue:2), `me-portrait` (PortraitPanel.vue:2), `me-plan-routes` (PlanPanel.vue:20), `me-course-switch` (CourseSwitchRow.vue:2), `me-settings-direction` (SettingsDirection.vue:2).

**Doors** — `redeem-code-input` (RedeemCode.vue:36), `redeem-possession-form` (RedeemCode.vue:814), `with-teacher-price` (WithTeacher.vue:51).

## (2) Broken, dead, unlabelled or hazardous things a learner can reach

1. **`/me` is unreachable.** No link exists anywhere in the app (grep for `'/me'` outside the router returns nothing). Rows 41–61 are, today, an unlinked preview surface — deliberate per the file header, but it means the app's best explanatory panels are invisible.
2. **`/reset` destroys guest progress with no confirmation** (App.vue:75-105). `localStorage.clear()` runs on page load with no dialogue, no warning, and no "sign in first" offer — the very offer the Clear-cache overlay does make (SettingsScreen.vue:1457). A guest told "go to /reset" over the phone loses everything, silently.
3. **`/methodology` hangs for non-admins** (MethodologyContainer.vue:30-33). The gate renders a permanent "Loading…" spinner instead of a denial or a redirect. Its top bar also reads "Back to Admin", which is nonsense for anyone else.
4. **404 catch-all fails silently** (router/index.ts:836-838). A mistyped or expired `/redeem/...` / `/try/...` URL redirects to the player with no message, so a broken link is indistinguishable from a working one.
5. **`components/AuthPrompt.vue` appears to be dead code** — I found no mount site. If it is live somewhere I missed, it is a third sign-in door whose wording ("Create a free account to keep your learning history") differs from both the Library banner and the Settings CTA. **GAP: unresolved.**
6. **`SettingsDirection.vue`'s "the rest" list is declared non-functional** on a learner-facing page ("these labels aren't live controls here yet", L58-60). Honest, but dead.
7. **Premium badge and "Try free →" render on the same card** (BrowseScreen.vue:650, 657) from the same condition — visually contradictory, and neither names the seed-19 boundary.
8. **The "Words" stat is mislabelled**, not merely unexplained (BrowseScreen.vue:594): it displays a seed ordinal.
9. **The "Total Time" `~` caveat is a `title` tooltip** (BrowseScreen.vue:582) — unreachable on the phones this app is built for.
10. **`/try/:code` failure dead-ends off-app** (TryLinkGateway.vue:94): the only exit is the marketing website; there is no way back into the app as a guest.
11. **The kill-switch overlay is an unlabelled blocking screen** (App.vue:762-764) — raw text, no title, no action, no way out.
12. **The W3 walk's closing promise overstates the code** (walks/save-your-progress.json, terminal): "Everything you have already done comes with you" — `migrateGuestProgress()` migrates nothing (useAuth.ts:961-975); continuity is device-local until the learner next plays.
13. **Offline status is colour-only** (ModeTray.vue:50-57): amber specifically means "lease locked", and no legend exists anywhere.

## GAPs in this inventory

- **Not run live.** All verdicts are from source; I could not confirm render conditions (e.g. which Settings rows a plain non-tester learner actually sees) by exercising the app.
- **Working tree ≠ HEAD.** `HowThisWorksLibrary.vue` was being edited by another agent during this pass; rows 21–24 describe uncommitted code.
- **`AuthPrompt.vue` mount site unresolved** (item 5 above).
- **Player boundary.** The offline depth picker, `ProgressModal` and the in-player paywall are named but not inventoried — they belong to the player worker, and row 129 exists so they are not lost between the two halves.


---

# Part 3 — What this pass landed, and what is left

## Walks live at the Library today (six)

| Walk | Topic chip | Covers |
|---|---|---|
| `where-you-are-in-this-course` | Where you are | Belts, the position track, the belt browser door |
| `choose-something-else-to-learn` | Other languages | The search box, the grid, keeping your place in each course |
| `save-your-progress` | Saving your progress | Guest-only: what device-only storage means, the email-code flow |
| `what-your-numbers-mean` | Your numbers | Activity: Time (and the `~`), Phrases (and its recency) |
| `reading-the-course-list` | Reading a course card | Direction, position, Premium/Try free, regional variants |
| `go-back-over-something` | Going back over things | Opening the belts, and that picking something **moves** you |

## The shape of the remaining gap

- **Everything still uncovered is either inside the player (parked by Tom) or on a surface with no How-this-works door yet.** The Library is the only place the engine runs, because it is the only place a hub is mounted.
- **`/me` is unreachable** — no link to it exists anywhere in the app. It holds some of the best explanatory panels in the product and nobody can get to them.
- **Settings is the biggest un-doored surface.** Thirteen learner-reachable rows, several consequential (reset progress, clear cache, learning speed, personalised pacing), none explained and none anchored.

## Decisions genuinely needing Tom

1. **The "Words" stat is mislabelled.** `BrowseScreen.vue:594` shows `completedSeeds` — a course position derived from `highestLegoId` — under the label **Words**. It is not a word count. I deliberately did not write a walk step for it, because any honest step would contradict the label on screen. Rename, or rule that the label stays and I write around it.
2. **`save-your-progress` promises more portability than the code delivers.** Its middle step says "your position is yours on any device you sign in on". Verified: `migrateGuestProgress()` (`useAuth.ts:961-975`) migrates nothing; it clears the guest id. Local progress survives on that device, and reaches the account only when the learner next plays. So a learner who signs in and immediately opens a laptop finds nothing there. One-line fix I'd propose, for your ear: *"We send you a code, you type it in, and once you have played a little more, your position follows you onto any device you sign in on."*
3. **"Seeds 1–7" is on a learner screen.** `CourseBrowser.vue` labels every belt row with a seed range. That is internal vocabulary in front of learners, against the standing ruling. Same for the nav's `title="Previous LEGO"` / `"Next LEGO"`.
4. **`/reset` destroys guest progress with no confirmation** (`App.vue:75-105`). No dialogue, no warning, no "sign in first" offer — unlike the Clear-cache path, which does offer it.
5. **Un-parking the player.** The list at 1e is ready when you want it. My read is that P16 (the silent gap), P20 (late target text) and P17 (the phase strip) are the three that actually change whether a new learner understands what is happening to them.
