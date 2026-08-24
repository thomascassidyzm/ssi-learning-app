# This tree was retired on 2026-08-24

Tom retired the documentation estate on 2026-08-24: *"let's properly archive the docs so the workers are not tempted to read them."* Nothing was deleted — every file moved, with its history, to **`archive/docs-retired-2026-08-24/`**. Go there only for archaeology, and never to answer a question about how the system behaves today.

**The code and the live DB are gospel.** Documentation here was out of date by design, and the cost of keeping it current was higher than its worth. Before acting on any claim you find in a document — an audit, a design spec, a report, a README — verify it against the running code. If the code cannot answer the question, **ask Tom one plain question** rather than trusting a document.

## What is still in this directory, and why

These are not stragglers:

- **`board/reports/*.md`** — a **build-time** `?raw` import in `packages/player-vue/src/views/admin/BoardReportView.vue:21`. Moving it breaks the build.
- **`explainer-pack.md`, `walkthrough-pack.md`** — regenerated outputs written by `tools/explainer/compile.mjs` and `tools/walkthrough/compile.mjs`.
- **Screenshots and captures** in `the-view/`, `the-lens/`, `walkthrough-engine/`, `navbar-redesign/`, `a159-htw-visual/`, `the-model/`, `structure-redesign/`, `explainer/`, `org-account/`, `chepstow-three-bugs/` — these are **output directories** that e2e probe scripts under `packages/player-vue/e2e/` write into. The images stayed; the stale prose reports that sat beside them were archived.
- **Anything created or modified on 2026-08-24**, left where live jobs were writing it.

At the repo root, `CHANGELOG.md` also stayed: it is Tom's own per-promotion prose (`tools/release-train/release-notes.mjs:13`), a ledger rather than documentation.
