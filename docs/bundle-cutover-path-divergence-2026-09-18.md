# The bundle cutover: where the two script paths disagree (2026-09-18)

Read-only behavioural diff of the two live script-generation paths in `packages/player-vue`, against
the code on `dev` at `d73662013` (on this date `origin/dev` and `origin/main` are the same commit, so
this describes production too). No code was changed and no test suite was run.

**Tom's ruling, 2026-08-29 (`delivery-is-the-methodology`) decides every disagreement below:**
first-delivery order and urn behaviour ARE the teaching method, not implementation detail.
**Where the two paths disagree, the original WALK is right by definition.** Column 3 of every table
applies that rule, and says so explicitly in the two places where I think the rule produces an
answer Tom may not want.

## The two paths

| | PATH A — "the walk" | PATH C — "the bundle" |
|---|---|---|
| Generator | `packages/player-vue/src/providers/generateLearningScript.ts` (2,133 lines) | `packages/core/src/script/generateScript.ts` (920 lines) |
| Fed by | ~9 Supabase queries from the BROWSER on the anon key (`generateLearningScript.ts:550`) | `api/courses/[code]/bundle.ts` (1,034 lines), server-side |
| Adapter to `SimplePlayer` | `providers/toSimpleRounds.ts` | `providers/bundleToBackendCycles.ts` → `providers/backendCyclesToRounds.ts` |
| Client entry points | `generateSimpleScript()` at `LearningPlayer.vue:702`; `CourseExplorer.vue:467` | step 5 `useInstantPlayback.ts`; step 6 `bundleFullScript.ts` via `fullScriptFromBundle()` at `LearningPlayer.vue:601` |
| Who gets it | every course NOT on the 15-course allow-list, every fallback on the 15, `?fullscript=walk`, `?bundle=0`, and Course Explorer always | the 15 courses in `BUNDLE_BOOTSTRAP_COURSES` (`useInstantPlayback.ts:210-228`), gate at `:230` |

**Step 5 and step 6 are the same code below `generateScript`.** `bundleFullScript.ts:194-215` calls
`generateScript` → `toBackendCycle` → `backendCyclesToRounds`, which is exactly what the step-5
instant path calls. So there is no step5/step6 divergence to report anywhere in this document: every
bundle-side finding applies to both consumers. That is by design and it is stated at
`bundleFullScript.ts:18-25`.

---

## The divergence table

### (a) SEED REVIEWS — the spaced-rep tier at offsets ≥ 144

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **A drained review plays the whole original sentence as four listening slots — target, English, target, target — with no mic gap, each slot holding its words on screen for 1.6 s.** | **WALK ONLY.** Built by `emitSeedSandwich`, `generateLearningScript.ts:1362-1400`; flags and linger applied in `toSimpleRounds.ts:376`, `:408`, `:426` (`SEED_SANDWICH_LINGER_MS = 1600` at `:27`). | **WALK.** This IS the design (Tom + Aran, 2026-07-14), and it is the speaking-side twin of the Layer-1 cup sandwich. | On the bundle the same review is an **ordinary three-clip production exercise with a real mic gap**: `buildSeedReviewCycle`, `generateScript.ts:750-790`, ids ending `_seedrep`. The learner is asked to produce, cold, a whole sentence they last met 144 rounds ago. |
| **The four slots are exempt from the consecutive-duplicate pass and from the A-64 cap, so all four survive contiguously.** | **WALK ONLY** (nothing to exempt on the bundle). `isSeedSandwichItem` at `generateLearningScript.ts:401`, used at `:1993`; `cyclePromptIdentity` special-case at `capConsecutiveRepeats.ts:217`. | WALK. | n/a — the bundle's seed review is one cycle, so no cap interacts with it. |
| **State today.** The walk was BROKEN until 2026-09-18 — slots 2, 3 and 4 were dropped as duplicates, so every drained review course-wide arrived as one lone target clip with English on screen and never spoken (311 plays / 9 learners / 0 English clips over 30 days). It is **fixed now**, proven by `providers/seedSandwichSurvives.test.ts` and live on staging. | Fix + evidence: `997faff61` and `docs/only-the-basque-is-spoken-2026-09-18.md`. | — | The bundle was never broken in that sense and was never right either: it has **never built the sandwich at all**. |
| **A seed review needs only `target1` audio to fire; the English slot is dropped, never silenced, when the seed has no known clip (3 slots instead of 4).** | WALK: `generateLearningScript.ts:1638` (`seed && seed.target1_audio_id`) and the role list at `:1380-1382`. | WALK — "plays what it has", Tom 2026-08-06. | BUNDLE requires **known + target1 + target2** (`generateScript.ts:756-758`) and otherwise falls back to an ordinary use-phrase review. On a course with incomplete seed audio the bundle learner **never sees a seed review at all** where the walk learner gets one. |
| **The four slots carry `singleAudio: true`, which makes `isTeachingCycle()` true, which exempts them from every Easy-mode selection filter.** | WALK: `toSimpleRounds.ts:407`; `modeCycleSelection.ts:102-103`, `:131`. | WALK. | The bundle's seed review is a plain `spaced_rep` cycle with no `singleAudio`, so **Easy's course-wide phrase-LENGTH cap applies to it** (`modeCycleSelection.ts:205-207`). A full seed sentence is by construction among the longest phrases in the course, so on Easy a bundle seed review is a prime candidate to be filtered out of the round entirely, subject only to `PRACTICE_FLOORS`. (The known-side syllable filter does not bite: `reviewSyllableFilterMaxRound` is 100 and an offset-144 review is past round 145 — `useAlgorithmConfig.ts:535`.) |
| **A seed that has "graduated" drops out of USE-phrase spaced rep but stays eligible for seed-phase review.** | **WALK ONLY.** `graduatedSeeds` at `generateLearningScript.ts:1183`, filled at `:1740-1747` (a seed graduates `listeningConfig.offset` = 90 rounds after its last LEGO — `:171-180`), enforced at `:1614` and `:1813`. | **WALK.** This is the retirement rule — "nothing truly retires; whole-sentence production continues at growing cadence". | **`grep -rn graduat packages/core/src` returns nothing.** On the bundle **no seed ever graduates**: every LEGO keeps drawing ordinary use-phrase reviews at every Fibonacci offset forever, alongside the seed reviews. The bundle learner's late-course rounds are fuller of short old phrases than the design says they should be. This is the largest silent divergence in this document. |

### (b) LEGO IDs PER CYCLE — is `190104618` fully landed?

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **Every cycle names all the LEGOs it contains, so the brain can record which chunks fired together.** | **BOTH, as of `190104618`.** Core spreads `decomposition` in `baseCycle` (`generateScript.ts:887`) from both phrase builders (`:737`, `:822`); `bundleToBackendCycles.ts:95` forwards it; `backendCyclesToRounds.ts:324-327` derives `componentLegoIds`. **Step 6 shares that exact chain** (`bundleFullScript.ts:203-215`), so the fix reaches BOTH consumers. Nothing is half-fixed. | — | Fixed. Before it, every bundle-course learner wrote zero rows to `learner_lego_pairings` since the cutover. |
| **A phrase with NO authored `decomposition` still gets component LEGO ids, derived by greedy longest-match segmentation of the target text — with CJK character-level sliding-window support and a synthetic `_SYN####` id for anything unmatched.** | **WALK ONLY.** `decomposePhrase` at `generateLearningScript.ts:1229-1305`; CJK branch at `:1233-1259`; synthetic minting at `:1218-1227`. | **WALK** under the ruling — but see the caveat in the next row, which is why I flag this one for Tom rather than calling it settled. | On the bundle a phrase with no authored `decomposition` column yields **one lego id**, hence **no pairs** and **no multi-tile rendering**, exactly the shape `190104618` fixed for phrases that DO carry the column. `zho_for_eng`, `jpn_for_eng` and `zho_for_gle` are on the allow-list and are precisely the courses the CJK branch exists for. **GAP: I did not measure how many rows on the fifteen courses have a null `decomposition`.** That number decides whether this is a footnote or a second job #158. |
| **Synthetic `_SYN####` ids are written to `learner_lego_pairings` as though they were LEGOs.** | **WALK ONLY.** `expandFiredLegoIds` (`buildLegoPairs.ts:55-64`) and `buildPairs` (`:19-43`) apply no filter; `LearningPlayer.vue:2800` passes them straight in; `learner_lego_pairings.lego_a/lego_b` are plain `text` with no foreign key (`supabase/schema.sql:11588-11589`). The renderer knows they are filler (`ensureTileCoverage.ts:127`) — the telemetry does not. | **Neither.** This is the one place where "the walk is right by definition" produces a wrong answer: it is a walk-side defect, not a method. Flagging rather than deciding. | Walk learners have junk rows in their pairing table; bundle learners do not. |
| **Component TARGET text in native script on a romanised course.** | WALK: real native strings, from `componentsByLegoNative` / `legoIdToTextNative` (`generateLearningScript.ts:1203-1208`). | WALK. | BUNDLE **fakes it**: `backendCyclesToRounds.ts:362-366` and `:377-379` set `componentsNative` and `componentLegoTextsNative` to the *same roman arrays*, with the comment "backend doesn't emit a separate componentsNative today". Live on `hin`, `tha`, `heb`, `zho`, `jpn`, `zho_for_gle`. A learner who toggles to native script sees roman tiles under a native sentence. |

### (c) THE CUPS / LISTENING INTERLUDE, and the ≥144 tier — my reading is below the table

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **The cups listening interlude** — a 30-cup wheel, one cup poured at the end of every round, each seed in the cup played as a four-slot target/known/target/target sandwich on the belt ramp. | **NEITHER SCRIPT PATH.** It is a runtime scheduler: `composables/useLayer1Scheduler.ts` (spec in its header, `:1-62`), mounted in `LearningPlayer.vue:4860` on nothing but the presence of `supabase`, fired from the round-boundary handler at `:6663-6668` and `:6961-6966`. It does its own Supabase reads via `listeningMetaCache`. | n/a — **no divergence.** Both paths get it identically. | — |
| **Layer-2 pod laps.** | **NEITHER.** `composables/usePodLapScheduler.ts`, mounted at `LearningPlayer.vue:4774`, same conditions. | n/a — no divergence. | — |
| **Layer-1 main-flow emission** (`listening`, `listen_intro`, `listen_outro` script items). | **REMOVED from the walk on 2026-05-19** (`generateLearningScript.ts:153-155`, `:1736-1739`). Never existed on the bundle. | n/a. | — |
| **Pod emission from the script** (`emitPodLap`, `l2FiresAt`, `STAGE_PLAYLIST`, `podActivationRound`). | Dead code retained on the WALK for hot-fix rollback: defined at `generateLearningScript.ts:802-811`, `:754`, and **never called** — the main loop says so at `:1749-1754`, and `LearningPlayer.vue:684-687` explicitly declines to merge anything into it. | n/a. | — |
| **Cost of the dead listening machinery.** The walk STILL runs three Supabase queries per script generation that nothing consumes: listen-bookend audio (`:573-579`), pod sentences (`:589-604`), and a whole-course LEGO catalogue (`:612-620`, still a bare `.limit(10000)`). Only the third feeds anything real — the graduation ordinals. | WALK. | Bundle is cheaper here and loses nothing. Not a method divergence; a tidy-up. | — |
| **Pod-0 is gone; only `pod-1` is ever served.** | Enforced in ONE place, path-agnostic: `composables/servedPod.ts:21-30` (Tom's ruling 2026-09-13, `a4c55e430`). The walk reads it at `generateLearningScript.ts:590`; the bundle route queries `.in('slug', ['pod-1','method-pod'])` directly at `api/courses/[code]/bundle.ts:591`. | No divergence in what is served. | — |

### (d) LISTENING CONFIG generally

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **`DEFAULT_LISTENING_CONFIG` = `{ enabled: true, offset: 90, podActivationRound: 6 }`.** Of its three fields only `offset` still does anything, and what it does is **seed graduation**, not listening. | WALK: `generateLearningScript.ts:171-180`. **The bundle has no listening config at all** — the only occurrence of the word in `packages/core/src/script/` is a comment at `generateScript.ts:219`. | **WALK**, for the same reason as the graduation row in (a): this knob is now the retirement rule wearing a listening name. | See (a): no graduation on the bundle. |
| **Layer-1 cup knobs** (`cups: 30`, `activationCount: 30`, `maxSeedsPerCup: 20`, `clusterStep: 5`) are admin-tunable from `algorithm_config['listening']` and merged at runtime. | Path-agnostic: `useLayer1Scheduler.ts:274-280`, wired at `LearningPlayer.vue:4835-4845`. | No divergence. | — |
| **The bundle DOES ship pod sentences and listen bookends** (`api/courses/[code]/bundle.ts:591`, `:612`, `:923`, `:936`) — `generateScript` ignores them entirely. They are there for the offline snapshot, not for the script. | — | No divergence. | — |

### (e) SCRIPT-SHAPE OVERLAYS AND MODE

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **Easy/Fast no longer reshape the script at all.** Both generators are built MODE-NEUTRAL: the walk is called with every Easy lever off (`MODE_NEUTRAL_WALK_OPTIONS`, `repeat: 1`, `LearningPlayer.vue:721-735`), the bundle with `MODE_NEUTRAL_REPEATS` (`:624`, defined `:764`). Selection, filtering and repetition are decided live per step by `playback/modeCycleSelection.ts` and the `getCycleRepeatCount` override. Tom's architecture call, 2026-08-09. | BOTH, identically. | **No divergence in the lever itself** — and this is the good news of this audit. `easyUseWordCap`, `easyRepeatCycles`, `easyReviewSyllableFilter` test the shared runtime rule; `easyRepeatInstantPath.test.ts` and `a64RoundAdapters.test.ts` exist precisely to pin the bundle adapters to the same behaviour; `modeToggleMidSession.test.ts` pins the reshape. | — |
| **The mode consequences still differ, because the CYCLES differ.** `modeCycleSelection` decides from `cycle.type` and `cycle.singleAudio`, both of which the two generators set differently. | — | — | Concretely: the seed-review row in (a), where the walk's sandwich is exempt and the bundle's plain review is not. |
| **The global `algorithm_config.script_shape` row** (spacedRepOffsets, maxBuildPhrases, useConsolidationCount, maxSpacedRepPhrases, n1PhraseCount). | WALK reads it LIVE on every generation: `scriptShapeForMode(learningMode.value)` at `LearningPlayer.vue:719`, resolved at `useAlgorithmConfig.ts:1150`. BUNDLE gets it BAKED at API time: `api/courses/[code]/bundle.ts:709-713`, resolved at `generateScript.ts:119-125`. `bundleFullScript` passes no `shape` override (`bundleFullScript.ts:196-201`), so the baked value always wins. | Defensible as built, not a bug: the route serves a `scriptShapeVersion` on a HEAD probe (`bundle.ts:461-480`) so a client can invalidate its cached bundle. | An admin shape change reaches walk learners on their next script build and bundle learners only when their cached bundle is re-validated (`Cache-Control: private, max-age=300, s-maxage=86400` at `bundle.ts:1023-1026`). **GAP: I did not verify that the client actually runs the version HEAD probe before reusing a cached bundle** — I read the route, not the caller. |
| **The PER-MODE `scriptShape` overlay** (`ModeConfig.scriptShape`). | WALK only, via `scriptShapeForMode`. The bundle has no mechanism to receive it. | Currently moot and DOCUMENTED as a trap at `LearningPlayer.vue:707-718`: both shipped modes carry `{}`, so the walk is genuinely mode-neutral today. **Setting a non-empty overlay would split the two paths silently** — and would re-break the mid-session toggle on the walk. | Nothing today. A future admin edit to `easy_mode.scriptShape` would change round sizes for non-bundle learners only. |
| **Turbo** was retired in `d5548fdc`; only `easy` and `fast` remain. | Both. | No divergence. | — |

### (f) EVERYTHING ELSE — both directions

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **The A-64 cap** — no prompt repeats more than twice consecutively. | **BOTH.** One rule in `playback/capConsecutiveRepeats.ts`, applied at the walk generator (`generateLearningScript.ts:2075`), in `toSimpleRounds.ts:20`, AND in `backendCyclesToRounds.ts:56` — which both bundle consumers go through. Pinned by `a64RoundAdapters.test.ts` for exactly this reason. | No divergence. | — |
| **Bare-LEGO build guard** — a build row whose text IS its own LEGO must not replay after the debut. | **BOTH.** Walk: `generateLearningScript.ts:1495-1500`. Core: `generateScript.ts:289-300` and `isBareLego` at `:313`, honoured in the shared selector at `phraseSelection.ts:360`. | No divergence. | — |
| **Debut phrase selection** — shortest-first by target syllables, per-LEGO urn for reviews. | **BOTH, by construction**: the walk's algorithm was extracted into `packages/core/src/script/phraseSelection.ts` and the bundle calls it. `selectionParity.test.ts` asserts debut selection **byte-identical** against real baskets from all fifteen courses, using an independent restatement of the walk. | No divergence — the strongest guarantee in the cutover. | **What it deliberately does NOT cover** (`selectionParity.test.ts:23-28`): review draws are asserted structurally only, on Tom's own 2026-08-29 ruling. It also covers nothing about seed reviews, graduation, intros, listening or mode. Every finding in this document lives in that uncovered space. |
| **Romanised courses: which text is measured for length and syllables.** | BUNDLE counts `targetTextNative ?? targetText` — the NATIVE one; the WALK counts `target_text` — also the native one, since `targetText` on the walk is `target_text_roman || target_text`. The core file flags this explicitly at `generateScript.ts:162-172`. | Stated as reconciled in code. | **GAP: I read the reconciliation note and the two call sites but did not run the two selectors over a real romanised basket to prove they agree.** `selectionParity.test.ts` runs against real fixtures from all fifteen courses including `hin`/`tha`/`heb`/`zho`/`jpn`, which is strong indirect evidence they do. |
| **Revised-audio refs** (`<uuid>.vN`) — a re-recorded clip must not be served from the old cached blob. | **BOTH.** Walk: `providers/revisedAudioRefs.ts`, applied at `generateLearningScript.ts:712-716`. Bundle: `api/courses/[code]/bundle.ts:671`, `:695-703`, `:923`, `:945`. | No divergence in mechanism. | **GAP:** the bundle's stamp is frozen at bundle-build time behind an `s-maxage=86400` CDN cache, invalidated by `courses.content_version`. **I could not verify from this repo whether Popty bumps `content_version` when a clip is revised.** If it does not, a bundle learner can hear a stale clip for up to a day after a re-record where a walk learner hears the new one immediately. That is a one-query question for the Popty repo. |
| **Intro audio: when does a LEGO get an intro cycle at all?** | WALK requires **prompt (presentation, or known as fallback) AND target1**; target2 optional, the phase is skipped gracefully. `generateLearningScript.ts:1423`, `:1441`, `:1449`. BUNDLE requires **target1 AND target2**; the prompt is optional and may resolve to an empty url. `generateScript.ts:631-640`. | **WALK** — its rule is stated as the deliberate per-item audio invariant, and it is the one that never emits a silent prompt. | Two opposite failures. A LEGO with presentation + target1 but no target2: **walk plays the intro, bundle emits none** — the learner never hears the chunk introduced. A LEGO with target1 + target2 but no presentation and no known clip: **walk skips it, bundle emits an intro whose prompt is silence**. |
| **Missing-audio telemetry when an intro falls back to the known clip.** | BOTH: `reportIntroAudioMissing` at `toSimpleRounds.ts:343-352` and `backendCyclesToRounds.ts:295-303`. | No divergence. | — |
| **A LEGO with no playable audio must not shift every later round number.** | BOTH, and both count rounds audio-aware. Walk: `mainLoopRoundCount` at `generateLearningScript.ts:2120-2124`. Bundle: `bundleFullScript.ts:145-151` and `:103-112`, which numbers the revival tail from the last round NUMBER rather than the count for exactly this reason. | No divergence. | — |
| **The revival/INF-PLAY stamp on every Round.** | BOTH: `toSimpleRounds`, `backendCyclesToRounds`, `infPlayCyclesToRounds`, pinned by `revivalMarker.test.ts`. | No divergence. | — |
| **Cycle ids name the phrase they play**, so the class brain parses one shape from both producers. | BOTH, deliberately converged (`cycleIdNamesPhrase.test.ts`, job #128). `api/_utils/classBrain.ts:288` reads `/_seed_?rep/` to catch the walk's `_seed_rep_` and the bundle's `_seedrep`. | No divergence. | — |
| **The 10,000-row phrase cap.** Both paths page `course_practice_phrases` in 1,000-row pages after an exact count: walk `fetchAllPracticePhrases` (`generateLearningScript.ts:336-371`), bundle `fetchAllBundlePhrases` (`api/courses/[code]/bundle.ts:392-420`), and the bundle's comment says it mirrors the walk's. | No divergence — **both are fixed.** | The **one remaining bare `.limit(10000)`** is the walk's listening LEGO-catalogue query at `generateLearningScript.ts:619`. It feeds graduation ordinals only, and no course is near 10,000 LEGOs, so it is a latent bug, not a live one. | — |
| **Phrase roles admitted to the pools.** BUNDLE takes `['build','use','practice','eternal_eligible']` (`bundle.ts:373`). | **GAP: I did not establish the walk's role filter precisely enough to assert they match.** The walk folds `practice` into build or use at `generateLearningScript.ts:989-1000`, which is the same intent, but I did not read its query's role list. Worth ten minutes before anyone relies on parity here. | — | — |
| **The walk does NOT fetch `decomposition` or `display_tiling` across the course** (`PRACTICE_PHRASE_COLUMNS`, `generateLearningScript.ts:321-322`) — it deliberately relies on `/cycles` to supply authored tiling per round, and derives the rest by text segmentation. The bundle fetches both (`bundle.ts:382`). | Split. | This is the inverse of the (b) finding: the **bundle** carries the authored tiling the walk's own script items lack. | Not a learner-visible loss on the walk, because `/cycles` fills it in at play time — but it means the walk's cached script and the bundle's rounds are not the same object even where they agree. |
| **`pauseConfig` passed into `generateScript` is inert on the client.** Core computes `pauseDuration` (`generateScript.ts:783-787`), `toBackendCycle` drops it (`bundleToBackendCycles.ts:82-105` carries no pause), and `backendCyclesToRounds.ts:343-350` recomputes it with `DEFAULT_FAST`. | Bundle only. | Harmless today — `DEFAULT_FAST` is what the walk uses too (`toSimpleRounds.ts:415`). Worth knowing before anyone tries to tune the mic gap through the bundle. | — |
| **Cycle type vocabulary.** Walk emits 11 types; core emits 3 (`intro`, `debut`, `review`). `bundleToBackendCycles.ts:69` maps `review` → `spaced_rep`, and build/use come through the phrase builder. | Reconciled at the adapter. | No divergence downstream — but it means `reviewItemKind` has **no bundle-side equivalent**, which is the mechanism behind the Easy-filter row in (a). | — |

---

## My reading of (c), with the evidence

**The question.** Tom's ruling of 2026-09-18 (`ssi-cups-listening-interlude-not-late-revisit`) says "the
sandwich" means the CUPS LISTENING INTERLUDE — after seed 30, 3 seeds between rounds, its phrases
dropping out of spaced repetition — and that "the late-revisit sandwich is OLD CODE". Does that mean
the ≥144 seed-phase tier should be DELETED?

**My reading: they are two different features that coexist, and the ruling is about a NAME collision,
not a deletion order. But one clause of the ruling has already come true in a way that makes me
genuinely unsure, so I am not going to pretend this is settled.**

The evidence for "two features":

1. **The code says so, in the file, in the same breath.** `generateLearningScript.ts:126-130`:
   "Distinct from L1 listening (the 30-cup model): cups are passive INPUT (hearing whole sentences
   you've stopped producing); a seed-phase spaced-rep review is active PRODUCTION (recalling the
   whole sentence from a known cue). Complementary channels, not redundant — so a graduated seed
   (dropped from use-phrase review) stays eligible for seed-phase production review." That is an
   explicit, dated statement that the two are designed to coexist, and the code enforces it: the
   graduation filter at `:1614` and `:1813` reads `!reviewItemIsSeed(offset)`, i.e. graduation
   removes a seed from use-phrase review and *deliberately leaves the ≥144 tier alone*.
2. **They live in different layers.** Cups are a runtime scheduler with no script involvement at all
   (`useLayer1Scheduler.ts`, mounted at `LearningPlayer.vue:4860`). The ≥144 tier is a script
   construct in both generators. Deleting one does not touch the other.
3. **"Phrases drop out of spaced repetition" is ALREADY IMPLEMENTED, and it is the graduation rule** —
   `listeningConfig.offset: 90` at `generateLearningScript.ts:177-179`, applied at `:1740-1747`. A
   seed graduates 90 rounds after its last LEGO, i.e. one round after the last Fibonacci use-phrase
   review (89) has fired. The comment at `:174-177` spells that arithmetic out. So the clause in
   Tom's ruling that sounds like new work is a description of existing walk behaviour.

The evidence that makes me uneasy, which I think is the real finding:

4. **The two "sandwiches" were deliberately built to be the same thing on two channels.** The walk's
   seed-sandwich docstring (`generateLearningScript.ts:1364-1366`) says it "mirrors the Layer-1
   listening cups sandwich", and `useLayer1Scheduler.ts:40-42` says the trailing 2× rep was cut
   "matching the SPEAKING-mode drained-seed review". Same four slots, same t→k→t→t order, same
   1× speed, designed within days of each other by the same people. If Tom now says only one of them
   is the sandwich, the honest question is not "delete the ≥144 tier" but **"is the ≥144 tier still
   supposed to be a listening sandwich, or should it go back to being a production review?"** — and
   the bundle path has quietly been answering "production review" for the entire cutover.
5. **Which means the two paths are currently a live A/B of exactly that product question,** with
   nobody choosing. That is what `997faff61`'s own doc says in its last paragraph, and I agree with
   it: "the drained sandwich that Tom and Aran designed only exists on the path that is being
   retired… Which of the two is the intent is a product call."

**What does not match, and I cannot resolve from code: "3 seeds between rounds".** The cup scheduler's
numbers are 30 cups, one poured per round, activation at 30 *introduced* seeds, and
`seedsPerCup = min(20, floor(introduced / 30))` (`useLayer1Scheduler.ts:20-24`, `:274-280`). So
"after seed 30" matches activation exactly. "3 seeds between rounds" matches **nothing** directly: a
cup is poured EVERY round, and seeds-per-cup only reaches 3 at 90 introduced seeds. I cannot tell
whether Tom means "3 seeds in each cup" (i.e. `maxSeedsPerCup`-ish, a knob that exists and is
admin-tunable), or "a cup every 3 rounds" (a cadence knob that **does not exist** — the wheel has no
interval; only Layer-2 pods have `roundInterval`). **Those are different builds and I am not going to
guess.** This is the one thing in my slice that needs a sentence from Tom before anyone writes code.

**So, concretely, what I would put in front of him:**
- The ≥144 tier is not dead code by any reading of the code; it is load-bearing and it is the ONLY
  thing `graduatedSeeds` still gates.
- The genuine unresolved question is whether a drained review should be **input (the walk's sandwich)
  or production (the bundle's three-clip cycle)**. Both ship today, to different learners, by accident.
- "3 seeds between rounds" does not map onto the cup wheel as built. Needs one clarifying sentence.

---

## Explicit gaps

Each of these is a thing I could not determine, with the reason.

1. **How many phrase rows on the fifteen bundle courses have a null `decomposition`.** This decides
   whether the bundle's missing segmentation fallback (row 2 of (b)) is a footnote or a second job
   #158. Not determined because it needs a live DB count, and this was a read-the-code brief.
2. **Whether the client actually runs the bundle's `scriptShapeVersion` / `contentVersion` HEAD probe
   before reusing a cached bundle.** I read the route (`bundle.ts:458-481`) and not the caller
   (`getCourseBundle`). If it does not, the bundle path's script shape is frozen for as long as the
   cache lives.
3. **Whether Popty bumps `courses.content_version` when a clip is re-recorded.** Decides whether a
   bundle learner can hear stale audio for up to a day after a revision. Answerable in the
   `ssi-dashboard-v7-clean` repo, not this one.
4. **The walk's `phrase_role` filter.** The bundle admits `['build','use','practice','eternal_eligible']`.
   I established the walk folds `practice` into build/use but did not read its query's role list, so
   I cannot assert the two pools start from the same rows.
5. **Whether the two paths really do measure romanised phrase length identically.** The code claims
   reconciliation (`generateScript.ts:162-172`) and `selectionParity.test.ts` runs against real
   romanised fixtures, which is strong indirect evidence — but I did not run the two selectors over a
   real basket myself, and I ran no tests.
6. **"3 seeds between rounds"** — see the (c) reading above. Not a gap in the code; a gap between the
   ruling as quoted to me and any knob that exists.
7. **What proportion of live learners are on each path right now.** Out of scope for a code read, but
   it is what turns every "wrong path" column above into a number of people.

---

*Read-only. No code changed, no tests run. Every claim above is anchored to a file:line or a commit
sha on `d73662013`.*
