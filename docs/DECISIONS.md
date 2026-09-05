
## 2026-09-05 — promoted dev to production (ssi-learning-app)

Tom ruled GO in 環 RBF ("yes to dev / yes to promotion"). Shipped `2e3f43e4` → `71b5dbc0`
(66 commits, 235 files, +9,936/−1,132), then `df39befb` correcting the release notes.

**Census taken at the merged union, not on dev.** `git merge --no-ff origin/dev` onto
`origin/main` produced a tree byte-identical to dev (`git diff origin/dev HEAD` empty), so the
union carried no merge-only interaction. Green at that union: `@ssi/core` build, `vue-tsc`,
player-vue vitest (3114 pass / 0 fail), eslint (0 errors, 166 pre-existing warnings), API
typecheck, API vitest (1758 pass), i18n parity (127 pass), the bare-English passthrough gate
(exit 0; 25 non-fatal Latin-script warnings, nearly all loanwords), release-train (30) and
worktree-deps (7).

**Payers proved against real state, not asserted.** Before and after, live Supabase read-only:
entitlement_grants 2/2 active/2 paid, user_entitlements 95, subscriptions 16/4 active, and the
same five entitlement rows and four active subscriptions identical either side.

**Verified live in a real browser at 390×844**, not by assertion: the Settings build stamp read
`df39bef · 5 Sept 2026, 16:02` off the page (branch correctly suppressed on main), the play probe
returned `healthy` with the session clock advancing 0:00→0:35, 172 audio fetches, zero JS errors
and 7× 200 telemetry POSTs, and belt taps landed rather than going silent.

**One defect found and fixed in flight.** The notes finaliser is line-based, so hand-edited
wrapped bullets were truncated mid-sentence, and the What's New panel has no markdown renderer,
so `**bold**` showed as literal asterisks to learners. Corrected in `df39befb` and back-merged to
staging and dev. The generator itself still has both limitations — a future ship must write
one-line, markup-free bullets.

Revert: `git revert -m 1 71b5dbc0 && git push origin main`

## 2026-09-05 — release notes: constrain the generator, don't teach the panel markdown

The Settings "What's new" panel and the release-train finaliser each held their own copy of the
same bullet regex, so a wrapped bullet was truncated mid-sentence twice over and `**bold**` reached
learners as literal asterisks. The fork was: render the markup, or constrain what may be emitted.

**Constrain.** Rendering means a `v-html` sink on a learner-facing production page fed by a
hand-authored Supabase row — a sanitisation surface bought for the sake of bold text. Constraining
deletes a problem instead of adding one, and a constraint that FAILS the promotion is stronger than
a renderer that silently does its best.

Both sides now import `tools/release-train/notes-bullets.mjs` — one definition of "a bullet"
(joining wrapped lines) and one predicate naming markup the panel cannot render. `--finalize`
throws on a violation; `AdminReleaseNotes` refuses to save one.

**The word that reverts it:** render. If bold in the notes ever earns its keep, the change is to
give the panel a markdown renderer plus a sanitiser, drop `assertRenderable` from the finalise
path, and keep the shared extractor — the joining half of the module survives either way.
