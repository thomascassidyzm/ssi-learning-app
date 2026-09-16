## SHARED DIGEST — how the Handbook / Show me / Take me there actually works (read this, do not re-derive it)

Repo: ssi-learning-app. Your worktree is cut from origin/dev. READ-ONLY AUDIT — no app code changes, no fixes.
Target: https://staging.saysomethingin.app (staging only; never touch production).

### The page
- `/schools/handbook` — `packages/player-vue/src/views/schools/HandbookView.vue`.
- Two scope buttons: **Everything** (default) and **Just what I can do** (`.scope-option`, second one narrows to entries whose `personas` include the viewer's persona).
- "Read the lot" (`button:has-text("Read the lot")`) opens every entry.
- Each entry is `article.entry` with id `hb-<entry-id>`; title `.entry-title`; role badges `.entry-badges .status-pill`; a clip chip `.entry-clip-pill` on the CLOSED row when a clip exists for this viewer.
- Opened entry body: `button.entry-showme[data-walk-offer="<walkId>"]` = **Show me**; `a.entry-goto` = **Take me there**; prose under "Written out".

### Data layer
- `packages/player-vue/src/walkthrough/handbook.ts` + compiled `packages/player-vue/src/walkthrough/pack.json` (fields: `handbook[]`, `walks[]`). Walk JSON sources: `tools/walkthrough/walks/*.json` (83 walks). Handbook entries are compiled from HTML `<!-- HANDBOOK ... -->` comments above the anchored elements in .vue files.
- Personas the engine knows: `admin` (SSi admin), `leader` (govt_admin — group/org leader), `school_admin`, `teacher` (tutor reads as teacher), `learner`. `viewerPersona(platform_role, educational_role)`: ssi_admin→admin, govt_admin→leader, school_admin→school_admin, teacher|tutor→teacher, else learner.
- `clipsFor(entry, persona)` = walks whose steps land on the entry's anchor, FILTERED to walks whose `personas` include the viewer's persona. So a Show-me button only renders when a persona-matching walk steps that anchor. An entry with no matching walk shows prose only — that is BY DESIGN, not a defect.
- `PLACE_LINKS` in handbook.ts maps a walk/entry `place.route` → a router path (node-home→/org/<node>, class-detail→/schools/classes, dashboard→/schools, teachers→/schools/teachers, students, classes, settings, player-settings→/?screen=settings, setup, schools-list→/schools/all, analytics, upgrade, inbox, admin-invites→/admin/invites, intel→/intel, library→/). `Take me there` uses `placeLink(entry, nodeId)` where nodeId = currentUser.group_id || school_id.

### How Show me runs (this is the crux)
1. The walk CANNOT run on the handbook page. Tapping Show me calls `deferWalk(clipIds(entry))` (all candidate walk ids) then routes to `showMeTo(entry)` — the walk's place, with a special case: a `class-detail` walk routes to `/schools/classes/<firstClassId>` when the viewer has a class.
2. On the destination, the first mounted Show-me surface (`WalkOffer.vue` or `HowThisWorks.vue`) calls `claimDeferredWalk(persona, place, kind)` — it starts the walk ONLY if a deferred id is in `walksFor(persona, place, kind)` at THAT page. If no surface there offers it, **nothing plays** and the deferral sits for 10 minutes (`DEFERRED_WALK_TTL_MS`). This is a top suspect defect class: no claimer mounted on the destination route.
3. Running walk stamps `document.documentElement.getAttribute('data-walk-active')` = `"<walkId>:<stepIndex>"` (+`":done"` on the terminal card). Overlay root `[data-walk-overlay]`, card `[data-walk-card]`, spotlight ring `.walk-ring`.
4. **Unanchored steps = Tom's "floats in the middle of the page".** `WalkOverlay.vue` does `document.querySelector('[data-walk="<anchor>"], [data-intel="<anchor>"]')`; if the element does not appear within `ANCHOR_TIMEOUT_MS` the step renders UNANCHORED with a Next button and NO `.walk-ring`. So: **`.walk-ring` present = anchored; `.walk-ring` absent (and not the terminal card) = the step floated.** Also check the anchored element actually matches the one the step's JSON names, and that it is in the viewport / visible.
5. Steps advance `on: "click"` (must click the ringed element) or `on: "next"` (Next button in `[data-walk-card]`). A click-step whose anchor timed out degrades to Next.

### Signing a probe in on staging without OTP (proven recipe)
See `packages/player-vue/e2e/_627-handbook-clips-probe.mjs` — copy its `mint()`: supabase admin `generate_link` (type magiclink) → `/auth/v1/verify` with the `email_otp` → inject the session JSON into `localStorage` key `sb-<projectref>-auth-token` via `ctx.addInitScript`. Env: `set -a; . .env.local; . ~/.ssi-sentinel.env; set +a` from the worktree root (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).

Known staging accounts (from existing probes — VERIFY the role each actually has before trusting the label; if an account no longer holds the role, say so as a GAP):
- `thomas.cassidy+ssi@gmail.com` — ssi_admin (persona `admin`)
- `thomas.cassidy+bumface@gmail.com` — govt_admin (persona `leader`)
- `thomas.cassidy+chepstowtest-leader@gmail.com` — school_admin (persona `school_admin`)
- `thomas.cassidy+chepstowtest-cover@gmail.com` — teacher at the same school
- `thomas.cassidy+e2e-learner@gmail.com` — plain learner
- others seen: `thomas.cassidy+admin001@gmail.com`, `thomas.cassidy+zz.chepstow.leader@gmail.com`, `thomas.cassidy+demo.irish.teacher1@gmail.com`

### view-as
`composables/useViewAs.ts` + `components/admin/ViewAsPicker.vue` (in the admin top bar; `[data-testid="view-as-open"]`, then `[data-testid="view-as-role-<role>"]` or `[data-testid="view-as-search"]` → `[data-testid="view-as-result"]`). View-as is READ-ONLY with a banner. Existing view-as probes to copy: `packages/player-vue/e2e/_675-viewas-nav-probe.mjs`, `_651-viewas-teacher-probe.mjs`, `_301-viewas-classes-probe.mjs`.

### Playwright on this box (it is fussy — use exactly this)
```
cd <your worktree>
set -a; . .env.local; . ~/.ssi-sentinel.env; set +a
TMPDIR=$CS_SCRATCH LD_LIBRARY_PATH=~/.pw-libs/usr/lib/x86_64-linux-gnu:~/.ssi-sentinel-libs \
CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
node packages/player-vue/e2e/<your-probe>.mjs
```
Import playwright by absolute path as `_627` does: `import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'`.
Do NOT run `pnpm install`, do NOT run any test suite — this is a read-only audit. Write scratch files to `$CS_SCRATCH`, never bare /tmp.
