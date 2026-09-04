# "How this works" was English for everyone — what a learner sees now vs after

2026-09-04. Read-only fact-find, then a fix, on `ssi-learning-app`.

---

## 1. What a learner sees — now vs after, per language

**The one-line version.** In all 22 interface languages, every word of "How this works",
"Why this works", the six illustrations and the six learner walkthroughs rendered in
**English**. Not one of them was a missing translation. The prose lived in a TypeScript
module and a compiled JSON pack that the locale system had never been pointed at, so no
translation could have reached it even if somebody had written one. **118 learner-facing
strings.** They are all now keyed, and all 118 are enrolled as the translation work order.

| Interface language | Sees today (before) | Sees after this change | What makes it their language |
|---|---|---|---|
| English | Everything in English | Unchanged | — nothing to do |
| Arabic, Azerbaijani, Bengali, Welsh, German, French, Irish, Gujarati, Hindi, Italian, Japanese, Korean, Lithuanian, Punjabi, Portuguese, Sinhala, Spanish, Tamil, Urdu, Yoruba, Chinese (21 languages) | Localised chrome down the profile, then **118 strings of English** the moment they tap "How this works", "Why this works", or any walkthrough chip | **Still English on screen** — but every one of those 118 strings is now a key with an English fallback, so it goes to their language the day a translation lands, string by string, with no code change | A translator. The 118 keys are listed in `packages/player-vue/src/i18n/pending-translation.json` |

**That "still English" is the honest answer and I want it stated plainly.** I did not
machine-translate 118 strings into 21 languages and call it done. What changed is that it
became *possible* — before this, translating it was a code project; now it is a data job
with a work order attached. Verified live on the dev deployment with the interface set to
Hindi: all 24 figure strings and the section prose render through `t()`, the English
fallback is intact, and no raw key leaks onto the screen.

**Screenshots.** Before and after are pixel-identical by design (no Hindi translation
exists yet); the value of the after-shot is that nothing broke. Evidence lives in
`~/htw-evidence/` on watson-1.

---

## 2. The pair question — which known sides can actually be demonstrated

This is the part that makes it more than a string sweep. A course here is pair-specific by
construction: `deu_for_hin` and `deu_for_tam` are different curricula, because Hindi has
grammatical gender so German gender is a mapping and Tamil does not so it has to be minted.
So a demo is a claim about how the method teaches **this** learner.

Answered from the live-DB census the sibling job published today (2026-09-04, 149 course
rows), not from docs. "Substantial" = ≥100 practice phrases AND ≥1,000 audio clips.

| Interface language | Courses with it as the known side | Substantial AND visible | What that learner can actually learn |
|---|---|---|---|
| English | 83 | 48 | 42 target languages |
| Japanese | 15 | 6 | Chinese, English, French, German, Italian, Spanish |
| Chinese | 14 | 5 | English, French, German, Italian, Spanish |
| Spanish | 3 | 3 | English, Catalan, Basque |
| Arabic, Bengali, German, French, Gujarati, Hindi, Italian, Korean, Punjabi, Portuguese, Sinhala, Tamil, Urdu | 1–3 each | 1 each | **English only** |
| Welsh | 9 | **0** | **nothing** — nine courses exist with Welsh as the known side and not one has content and audio |
| Irish, Lithuanian, Yoruba, Azerbaijani | 1 each | **0** | **nothing** |

Three findings worth Tom's attention:

1. **For 13 of the 22 interface languages the entire catalogue is "learn English".** Not a
   supply problem to fix here, but it sets the ceiling on what a demo could honestly show
   them. Whatever we build, for most of these learners it is a demo of *their language →
   English*, and nothing else.
2. **Five interface languages can learn nothing at all.** Welsh is the striking one: nine
   `*_for_cym` course rows exist — Arabic, German, French, Italian, Japanese, Korean for
   Welsh speakers — and every single one is empty or unvoiced. We ship a Welsh interface
   into a catalogue with no Welsh-known content in it.
3. **Kannada, Marathi and Telugu each have a substantial, RELEASED, public course
   (`eng_for_kan`, `eng_for_mar`, `eng_for_tel` — 12–14k phrases and 40–45k clips apiece)
   and no interface language at all.** Three real Indian-market courses whose learners get
   an English interface for an English course. That is the India-relevant one, and it is
   the reverse of the problem this job started on: not interface without content, but
   content without interface.

**And there is no pair-specific demo in the app today.** I checked all three surfaces. The
six illustrations are abstract — lines, gaps, a worn path — and carry no example sentences.
The walkthrough steps point at UI anchors. Nothing anywhere shows a teaching example on a
particular pair. So the "English→Welsh with Hindi captions" failure mode does not exist
yet, and nothing I did creates it. **If we ever add a real demo of the method, it has to be
sourced from the learner's own course, and for 13 of these languages the only pair
available is → English.**

### The one exception, and it is a real one

`packages/player-vue/src/assets/explainer/player-screen.jpg` — the tappable "show me the
screen" shot inside "How this works" — is a **baked JPEG of an English → Chinese player
screen**: the prompt reads "I want", the chip at the bottom says "Chinese", and the banner
says "YOU'RE MEANT TO BE SPEAKING NOW". Every learner in every language sees that picture.
Its four callout labels are now translatable; **the picture is not**, because it is pixels.

A Hindi speaker learning English is shown a screenshot of somebody else's course. It is
milder than a wrong teaching demo — it illustrates the furniture, not the method — but it
is the same shape of defect, and I have not touched it because product imagery is a taste
call. **My recommendation:** re-shoot it neutral (no language chip, prompt text that is
plainly a placeholder rather than a real pair), which is one screenshot rather than 22.
Rendering it live from the learner's own course would be better and is a build, not an
afternoon.

---

## 3. What landed

Four commits, merged to `dev` as `f2efe511`.

| Surface | Was | Now |
|---|---|---|
| `explainer/learnerExplainers.ts` — the two sections' prose | 53 English strings in a TS module | mirrored into `eng.json` under `explainer.*`, read through `localiseSection()` |
| Six figure components (cycle pill, three gaps, spacing returns, listening stretch, worn path, climbing band) | 24 English strings **including every `aria-label`** — a screen reader in Hindi read the pictures out in English | keyed under `explainer.figures.*` |
| `PlayerScreenFigure.vue` callouts | 4 English strings | keyed |
| `walkthrough/pack.json` — the six LEARNER walks | 37 English strings compiled into a JSON pack nothing between it and the overlay had ever passed through `t()` | mirrored under `walkthrough.<id>.*`, localised at the `walksFor`/`walkById` boundary |

**Design, in one paragraph.** The English source stays where it is and stays authoritative —
`learnerExplainers.ts` is still the authored prose, `pack.json` is still the build artefact
of `tools/walkthrough`. `eng.json` carries a generated *mirror* of their strings, and two
new drift tests walk source and mirror together string for string, so a reordered block or
an edited walk step is a red CI run rather than a wrong sentence under a right heading.
`t()` already falls back to English for any key a locale lacks, so a half-translated
language degrades string by string instead of section by section.

**Three things I decided and did not ask about:**

- **The published Popty copy may now only override what an English reader sees.** `DOC_ID`
  is the single string `'htw'` — there is no language dimension in that fetch, so Popty
  publishes one English document. Before this change it overrode the prose for everyone;
  now, on a non-English locale, the localised floor wins. A freshly-published English
  paragraph landing in the middle of Hindi prose is strictly worse than the Hindi it
  replaced. **A language-aware `doc=htw` is a Popty-side job and I did not go near it** —
  three other jobs are live in that repo.
- **The twelve teacher / admin / leader walks are not mirrored**, matching the existing
  product decision that keeps staff surfaces English (the `LEARNER_FACING` list in
  `noBareEnglish.test.ts`). They need no special case: `t()` falls back.
- **Walk `keywords` stay English.** They are search aliases, and they now sit *alongside*
  the localised title and topic in the same search text — so a learner searching in their
  own language matches the localised title, and one searching in English still matches the
  alias. Localised keyword lists are a genuine gap and I am naming it rather than guessing.

**The detector finding, and why it needed no new machinery.** `i18n/noBareEnglish.test.ts`
scans `.vue` templates only. It could not see `learnerExplainers.ts` or `pack.json` — the
two biggest blocks of untranslated learner-facing prose in the app were invisible to the
gate built to catch exactly this. The two drift tests close that hole for these two files by
construction: a new string in either source without a mirror entry fails CI. A *third*
prose-bearing `.ts` module dropped in somewhere else would still be invisible, and that is
worth a rule one day; it did not need one today.

`bare-english-baseline.json` shrank by one file (`CyclePillFigure.vue`, 3 entries). That
list may only ever shrink, and this is it shrinking.

---

## 4. Gaps and open items

- **21 languages still read English on screen.** The blocker is a translator, not code.
  118 keys, listed in `pending-translation.json`, which is exactly the work order.
- **The player-screen JPEG is English → Chinese for every learner.** Recommendation above;
  it is Tom's call.
- **`doc=htw` has no language dimension.** Popty-side, deliberately out of scope.
- **Walk keywords are English-only**, so search in a non-English interface matches on the
  localised title and topic but not on synonyms.
- **Five interface languages can learn nothing** (Welsh, Irish, Lithuanian, Yoruba,
  Azerbaijani) and **three substantial courses have no interface language** (Kannada,
  Marathi, Telugu).

## 5. Method note

Facts came from the running code and the live-DB census, not from docs. Nothing was written
to any database. The `player-vue` gates — full suite (3,020 tests), `typecheck`, `lint` —
were run green on the merged `dev` tree before promotion. `api/` was untouched, so its gates
were not run.
