# World-leading audit — schools + admin dashboards

*2026-07-16. Real-browser, five personas inhabited end-to-end on **staging** (code-identical to prod; the money-path and admin-guard bugs were re-confirmed on prod). One shared live DB, so every fixture was synthetic, `is_internal`-flagged, and deleted — see [Hygiene](#hygiene). This is an audit, not a fix: the founder selects. Screenshots under `docs/audits/assets/2026-07-16/`.*

Method: (1) brand-new school admin from invite-redemption → setup wizard → first class → invite-a-teacher → play-as-class; (2) teacher daily loop on the real Angharad Y7 Welsh class; (3) group/govt leader over the IME Demo Programme; (4) SSi admin across every `/admin` surface; (5) a cross-persona design-cohesion judge grading every screen against the founder-blessed `/admin/stats` + `/admin/methodology` bar. Desktop (1440×900) and mobile (390×844).

---

## The one thing to take away

**A single bug *class* is responsible for the worst finding of three different personas.** Every schools surface resolves the logged-in user and their role *asynchronously*, and each screen hand-rolls its own wait for it — so whichever screen forgets the retry renders confidently wrong. The same root cause, unfixed, produces:

- the **flagship teacher Analytics tab dead forever on any direct load** (no retry when the user resolves late),
- the **Subscribe button stuck on "Loading…" on prod** — a school that wants to pay can't,
- **admin deep-links bouncing to the bare learner player**,
- the **leader's Analytics showing "No classes yet"** despite 257 practised hours,
- and the **dashboard flashing a false "create your first class"** for ~2 seconds on every load.

The staff-landing and group-rollup fixes shipped this week (`7519c0a6`/`1a954dce`) each patched *one* instance of this class reactively. **The world-leading move is to fix the class once** — a shared "resolved context" gate that every schools view and router guard awaits, instead of five surfaces each racing it and three forgetting to retry. That single piece of work clears BROKEN #1, #2, #4, #5, and #10 below.

Two smaller clusters sit underneath it: an **authorization leak** (teachers can write org data and see admin-only controls) and a **design-system cliff** (schools components render completely unstyled when mounted outside `.schools-surface`, and there are two competing admin navs). Both are "fix once, lift many".

And the through-line on information design: **the admin surfaces already lead with decisions** — `/admin/insights` and `/admin/attention` show severity + owned next-actions, the founder's lens made into a component — **while the schools surfaces lead with record-counts** (Students / Hours / Sessions stat strips) and never answer the question each persona actually arrives with. That gap, not any single screen, is what separates this from world-leading.

---

## BROKEN — outright bugs, ranked by persona pain

Bugs outrank polish. These are the ones the founders keep finding by hand.

### B1 — Flagship teacher/leader Analytics is dead on any direct load *(verified in code)*
**Where:** `/schools/analytics` (`TeacherInsightsView.vue`). **Who:** teacher, group leader.
**Now:** the tab calls `fetchClasses()` exactly once at setup (`TeacherInsightsView.vue:95`); if `currentUser` hasn't resolved yet, `useClassesData.fetchClasses()` silently no-ops (`if (!selectedUser.value) return`, `useClassesData.ts:134`) and **never retries** — there is no `watch(currentUser, …)`. A bookmark, reload, or shared link of the Analytics tab shows "How you're doing on **—**", empty Course/Class pickers, and "No classes yet" *permanently*. The only way to reach real analytics is to land on the dashboard first and SPA-click across. The leader worker hit the identical dead-end at group level with 257 real hours behind it.
**Expected:** the flagship insight tool loads its data on direct navigation.
**Fix:** add `watch(currentUser, () => fetchClasses())` mirroring `DashboardView.vue`. Better: the shared resolved-context gate (see headline). **Size: S.**
Evidence: `assets/2026-07-16/leader-analytics-empty.png`, `teacher-analytics-working-via-spa.png`.

### B2 — The money path is dead: Subscribe stuck on "Loading…" *(verified in code, reproduced on prod)*
**Where:** `/schools/upgrade` (`UpgradeView.vue`). **Who:** school admin (the paying persona).
**Now:** `onMounted` picks the school-vs-tutor lane once (`:355`). If school context hasn't resolved at mount, `isSchoolLane` is false, so it runs the *tutor* loader (the observed `/api/teacher/me` 404); when `isSchoolLane` later flips true there is no watcher to fire `loadSubscription()`, so `schoolSubLoaded` stays false and the CTA is `disabled` on `!schoolSubLoaded` forever (`:454`), reading "Loading…". `openCheckout`'s lazy fallback (`:179`) can't help because the button that would trigger it is disabled.
**Expected:** a school admin who wants to subscribe can.
**Fix:** `watch(isSchoolLane/schoolId, load-then)` instead of one-shot mount; or the shared gate. **Size: S.**

### B3 — Any teacher can rename their school (unauthorized org write) *(verified in code + empirically)*
**Where:** `POST /api/school/update-profile` (`api/school/update-profile.ts:69–77`). **Who:** any teacher.
**Now:** the endpoint resolves the caller's school from `user_tags` filtered only on `tag_type='school'` — **no `role_in_context='admin'` check**. A plain teacher (who carries a school tag) resolves a `schoolId` and can `update` `school_name`, `region_code`, and `name_confirmed`. The teacher worker verified it end-to-end with disposable fixtures: teacher bearer token → **200 OK → DB row changed**. The Settings UI compounds it — the editable School-profile form and Billing tab are shown to plain teachers, gated only on `isAdminView` (the ssi_admin cross-org flag), never on `isSchoolAdmin`.
**Expected:** only a school admin renames the school.
**Fix:** add `.eq('role_in_context','admin')` to the `user_tags` fallback; gate `SettingsView.vue`'s profile/billing panels on `isSchoolAdmin`. **Size: S.** *Live on prod today — the one I'd pull forward.*

### B4 — Cold-session `/admin/*` deep-links silently bounce to the bare learner player *(verified in code)*
**Where:** `/admin` + `/methodology` router guard (`router/index.ts:645–651`). **Who:** SSi admin.
**Now:** the guard reads only `restoreFromCache()` (sync localStorage), never the async DB role fetch. On a fresh session, any typed/bookmarked/Slack'd `/admin/*` URL redirects to `/` — dumping the admin into the raw "Chinese for English, White Belt" player with no error. Reproduced 3/3; a second nav in the same tab succeeds once the cache warms. This is the same class as the govt_admin `/schools` race that got a reactive fix in `7519c0a6` — the `/admin` guard never got the same treatment. This is *also* the true cause of the leader worker's "admin group view stuck loading, then player" (one bug, two personas).
**Fix:** reactive re-check once `auth.initialize()` resolves. **Size: S.**

### B5 — A school admin sees their own school as empty; three personas get three truths *(zero-tolerance)*
**Where:** schools composables (`useClassesData`/`useTeachersData`/`useStudentsData` client-direct reads). **Who:** school admin.
**Now:** signed in as the **admin** of "Angharad 001", `/schools/teachers` shows "0 staff · No teachers yet" and the dashboard says "0 students across 1 classes" — while the **teacher** of the same school and the **ssi_admin read-view** both correctly show 1 teacher / 1 student. Cause is the same family the group-rollup fix just addressed for govt_admins: client composables still direct-read RLS-guarded tables (`user_tags`), so cross-user rows silently vanish for the admin identity. A paying leader's first impression is "SSi lost my school."
**Fix:** route these reads through the server scope endpoint (`resolveVisibleScope`/`schoolScope.ts`) — the repoint the RLS-tightening plan already wants. **Size: M.**

### B6 — School-detail contradicts itself and the class drill dead-ends
**Where:** admin/leader school detail (`/admin/schools/:id`, group→school drill). **Who:** group leader, SSi admin.
**Now:** Sunrise Public School's header tiles read **42 students · 130h**, while the classes table directly below shows **every class at 0 students, 0m practice**. Same screen, two stories. Clicking a class row produced no navigation (the worker's "class detail" capture is pixel-identical to the school view). See `assets/2026-07-16/school-detail-rollup-contradiction.png`.
**Fix:** single rollup source feeding both header and rows; wire the class-row link. **Size: M.**

### B7 — Schools mobile chrome is broken on every screen
**Where:** schools top bar at 390px. **Who:** teacher (runs class from a phone), admin.
**Now:** measured bounding boxes — the hamburger collapses to a **2px-wide** tap target; the Learn button renders **on top of** the "Schools" wordmark; the account pill overlaps both; "School settings" is clipped off the right edge. The nav tabs (Dashboard/Students/Analytics) live *only* in that unusable hamburger, so a teacher on a phone cannot navigate. Roster tables overflow with columns silently amputated ("CLAS", belt "V"). Independently reproduced by three workers. See `assets/2026-07-16/schools-mobile-header-overlap.png`.
**Fix:** real `@media` collapse of the right-side cluster; responsive table→card pattern. **Size: M.**

### B8 — `/admin/classes/:id` and `/admin/users/:id/progress` render completely unstyled
**Where:** admin read-views mounted outside `.schools-surface`. **Who:** SSi admin (support).
**Now:** raw colliding table text ("SeedsPracticeLast active", "White0"), no card surfaces, H1 clipped under the nav. The progress page also greets the *admin* in learner voice — "You're back — let's get this streak going." — about someone else's streak. Root cause: schools design tokens exist only inside `.schools-surface`, so any schools component mounted elsewhere gets no design system at all (the "token cliff").
**Fix:** mount the surface class (as `AdminSchoolsContainer` does) or promote ink/tone tokens to `:root` — the exact move `design-tokens.css` already made for Mist. **Size: S–M.**

### B9 — `/admin/groups/:id` read-view 403s to zeros for ssi_admins
**Where:** `api/school/group-summary.ts` (hard-requires `scope.role === 'govt_admin'`). **Who:** SSi admin.
**Now:** an ssi_admin opening a group read-view gets 403, so "Welsh Gov Lang Office" renders as "**Your School** · 0 schools · 0 students" with an unstyled name input + a disabled Create-school button. **The IME rollup fix is verified working for real govt_admins** (govtest loads its group cleanly) — this path just never got an ssi_admin branch scoped to the route param. See `assets/2026-07-16/admin-group-readview-403.png`.
**Fix:** allow ssi_admin with the `:id` param through the scope check. **Size: S.**

### B10 — `/admin/stats` lifecycle Funnel widget throws on every load
**Where:** `Funnel-*.js`, `TypeError: Cannot read properties of undefined (reading 'annotate')`. **Who:** SSi admin. Present on prod.
**Now:** the "Where do learners fall away on the way to paying?" card renders a large void above its narrative; the page otherwise loads. This is on the design-bar page itself.
**Fix:** trace the undefined scale/annotate target; confirm no silent data drop. **Size: S.**

### B11 — "Remove teacher" silently fails while reporting success
**Where:** `TeachersView.vue:91–102,146–209`. **Who:** teacher (who shouldn't see it at all — see B3).
**Now:** the Remove action performs a client-side Supabase write; RLS correctly blocks a teacher removing a colleague (0 rows affected), but the UI does `if (!error) fetchTeachers()` and treats 0-rows as success — no feedback. A false-affordance the founders would trip over. (Invite/Bulk-import on the same page are inert stubs.)
**Fix:** surface an explicit error when a write affects 0 rows; gate the controls on `isSchoolAdmin`. **Size: S.**

**Also noted (not itemised):** dashboard false-empty flash ~2s (`DashboardView` self-corrects via its watcher — the *symptom* B1 lacks a retry for); setup wizard step-1 "Failed to update school" — same fragile `update-profile` endpoint as B3, **[IN-FLIGHT REWORK AREA]**, tagged not double-counted; "0 students across **1 classes**" pluralisation.

---

## TOP 10 GAPS — ranked by persona-felt impact

Decisions, not records. Ranked by how much each blocks a persona from doing their actual job.

**G1 — Schools dashboards lead with record-counts, not the decision the persona came for.**
*Now:* every schools home opens with a Students / Hours / Sessions / Classes stat strip — counts, no interpretation, no action. A teacher's real question ("who needs help, who's coasting, what do we do today") is answered nowhere above the fold; a leader's ("which school do I call this week") likewise.
*World-leading:* copy the pattern the admin side already nails — `/admin/attention` ("15 subscribers · 2 urgent, +13 healthy not shown") and `/admin/insights` (ALARM/WATCH severity + owned next-action chips). The teacher dashboard should open with "3 students need eyes this week" and name them; the leader with "Green Valley is stalling — 0h in 7 days."
*Fix:* a decision-strip component fed by the Insight Engine (`needs-attention` already exists as a metric), replacing the top stat strip on `DashboardView` and the group dashboard. **Size: M** (component + wire one metric).

**G2 — The leader's `/schools/all` can't triage.**
*Now:* a flat table (Students/Teachers/Classes/Hours) with a "Sort by hours" and an "excellent" status pill of unclear basis; "Active in 7d" renders "—", City column all "—".
*World-leading:* the leader's screen is a sales artifact shown to governments. It should rank schools by *movement* (climbing/stalling/dark), surface the one-school-to-act-on, and make "excellent" mean something measured. Fill or drop the dead "Active in 7d"/City columns.
*Fix:* trend + attention columns from the rollup; define the status pill. **Size: M.**

**G3 — `position`-is-LEGO ruling is violated in customer-facing copy.**
*Now:* class detail and students show "Position 1", "0 seeds avg", "Next milestone: seed 11", "SEEDS 0/60" — the exact "seed position" framing the ruling forbids (`feedback_ssi_position_is_lego_not_seed`); it shipped wrong once already and needed a hotfix.
*World-leading:* progress shown as the last LEGO's own content in both languages, no seed/lego numerals in learner/teacher-facing copy.
*Fix:* swap the seed-position renders for the LEGO-content display. **Size: S–M.**

**G4 — Two competing admin analytics surfaces with two different "Stats".**
*Now:* `/admin/analytics` (Platform Analytics — growth/engagement/retention/friction, KPI tiles, zero interpretation) and `/admin/stats` (the Insight Engine boards — the bar) overlap heavily; the legacy bottom nav's "Stats" opens the former, the top nav's opens the latter.
*World-leading:* one analytics home. Fold `/admin/analytics`'s Growth/Retention views in as Stats boards and delete the page + the legacy bottom nav. Fewer, better.
*Fix:* migrate 2–3 views, redirect, remove bottom bar. **Size: L.** *(A taste call — flagged for you, not decided.)*

**G5 — The design-system cliff makes whole pages render unstyled.**
*Now:* the F-tier (B8) exists because tokens are scoped to `.schools-surface`; anything mounted outside is naked. This is latent under every future admin-mounted schools component.
*World-leading:* one management design system; a schools component looks the same wherever it mounts.
*Fix:* promote ink/tone tokens to `:root` (the Mist migration precedent). **Size: S**, lifts many screens.

**G6 — Attention and Activity are off the founder-blessed bar.**
*Now:* both miss the red mono eyebrow and card-grid rhythm; Attention is a bare title + flat list with dead whitespace under "+13 healthy subscribers not shown" (which isn't clickable). Their *content* is A+ triage; their *chrome* is a straggler.
*World-leading:* bring both to the Stats/Methodology template (eyebrow → serif H1 → prose → count-with-delta → cards).
*Fix:* apply the shared page shell. **Size: M.**

**G7 — The Insights discovery feed is 28 days stale on a page that promises "this week."**
*Now:* "28 days ago · 5 findings" on a decision surface whose own copy says "what moved this week." If the generation job died, the product's smartest screen is silently going dark.
*World-leading:* a decision feed is only trustworthy if it's fresh or honestly says it's stale.
*Fix:* confirm the job is scheduled/alive; add a staleness banner if generation lapses. **Size: S** to investigate.

**G8 — Rosters show email-as-name.**
*Now:* Students/Class-detail rosters render raw email localparts where a learner name belongs.
*World-leading:* a teacher recognises their class by name; fall back to a friendly handle, never a raw address.
*Fix:* display-name resolution with email as last resort. **Size: S.**

**G9 — Group dashboard leads with a Create-school form; the leader creates schools rarely and triages daily.**
*Now:* the "Schools in your group" card puts a "School name" input + Create button *above* the school cards.
*World-leading:* triage first (which school needs me), creation as a secondary action.
*Fix:* demote creation to a header button; lead with ranked school cards. **Size: S.**

**G10 — Native `<select>`s and empty-sparkline artefacts break the considered feel.**
*Now:* schools filters use unstyled native `<select>`s; empty sparklines render as a bare underline; the teacher dashboard's "0c" benchmark micro-bars are cryptic.
*World-leading:* the schools side should feel as composed as Stats — designed pickers, honest empty states ("no sessions yet"), legible benchmark labels.
*Fix:* adopt the existing designed select + empty-state components. **Size: M.**

---

## 5 quick wins (each ≤1 day)

1. **B3 authz** — add `role_in_context='admin'` to `update-profile.ts` + gate Settings panels on `isSchoolAdmin`. *(Security, live on prod.)*
2. **B1 analytics** — add `watch(currentUser, fetchClasses)` to `TeacherInsightsView.vue`. *(Unbreaks the flagship tool.)*
3. **Link-first copy** — Setup › Schools copies a bare join code (`SchoolsSetup.vue:907`); Try Links already copies `${origin}/try/${code}` — mirror it. *(Doctrine.)*
4. **B11 feedback** — toast when `handleRemoveTeacher`'s write affects 0 rows.
5. **Copy** — "1 classes" → pluralise; the token-`:root` promotion (G5/B8) is a 1-file change that unstyles nothing and fixes two F-tier pages.

---

## Mobile-specific

- Schools chrome is **broken on every screen** (B7) — the persona who most needs mobile (teacher at the front of the room) can't navigate.
- Roster/table overflow with amputated columns across Students/Teachers/Class-detail *and* `/admin/users` — one responsive table→card pattern fixes all.
- Admin is otherwise acceptable on mobile (Stats stacks cleanly); the redundant top+bottom nav wastes vertical space but works.
- Play-as-class player layer renders cleanly on mobile — no regressions there.

---

## What's verified fixed (fences)

- **Staff/leader landing on dashboard** (`7519c0a6`): verified — a cold-redeemed teacher lands on the dashboard, not the bare player (`assets/2026-07-16/newadmin-dayzero-dashboard.png` shows the guided day-zero).
- **IME group-rollup zeros** (`1a954dce`): verified — the real govt_admin group dashboard shows real numbers (3 schools · 80 students · 257h). The ssi_admin read-view of the same group is *separately* broken (B9).
- **govt_admin first-redemption bounce**: the historical `/schools` bounce is fixed for govt_admins; the *same class* survives on the `/admin` guard (B4).
- Analytics correctly exclude `is_internal`/`is_demo` learners — no "analytics are real or absent" violation found; demo data is behind an explicit toggle.

## Day-zero verdict (new school admin)

Genuinely decent and guided: a "Get started — four quick steps" banner, quick-links, honest empty states, "Create your first class" (`newadmin-dayzero-dashboard.png`). The journey completes end-to-end. The blemishes are the setup wizard's step-1 save error (in-flight rework area) and the mobile header (B7) — not the shape of the flow.

---

## Hygiene

Every fixture was synthetic and is deleted. This audit also cleaned up after its own **failed** new-admin worker, which crashed before reporting and left live rows: 12 orphan schools ("E2E Audit School …", "Debug School Blank Region", "Audit Journey/Mobile School") + their classes/tags, 25 auth users (13 `@ssi-internal.test` + 12 `thomas.cassidy+audit0716-*@gmail.com` real-email fallbacks), 12 invite codes, and 11 orphan learners — all deleted, deletion re-queried and confirmed zero remaining. *(Note: possession-redeem's real-email enforcement (`3305f282`) rejects `@ssi-internal.test`, which is why that worker fell back to `+audit0716` gmail aliases — working as designed.)* Left untouched: the IME Demo Programme data (read-only throughout) and three fixtures from a separate parallel session (`audit-money-1`, `audit-return-1`, `audit-modes-1@ssi-internal.test`) not created by this audit.
