# The Schools Handbook — design

A single searchable page that shows a school admin, teacher or org leader everything this
dashboard can do; a way for them to ask when it doesn't; and a loop that turns each question into
a new line on the page, so it is only ever asked once.

Written 2026-09-07. Design only — nothing is built.

---

## 1. Why not a video

Admins ask for a video because a video is the only artefact they know that shows the whole shape of
a thing. The ask is real; the format is wrong. A video is a photograph of the product on the day it
was filmed, and it rots silently — nothing in the build ever tells you it has gone stale.

Our walkthroughs have the opposite property and the opposite problem.

**The property**: a walk is compiled. `tools/walkthrough/compile.mjs` reads the hand-authored walks
in `tools/walkthrough/walks/*.json` and runs seven gates against the live Vue source. If a walk
points at a button that no longer exists, `gateAnchors` fails the compile. If it points at a place
not in `KNOWN_PLACES`, `gatePlaces` fails it. If a teacher-facing walk anchors to an admin-only
element, `gateOffers` fails it. **The build refuses to ship a walkthrough that lies about the
product.** That is a machine, not a habit, and it is the whole reason this beats a video.

**The problem**: walks are just-in-time. They answer a question you are already asking, standing on
the screen where the answer lives. Exactly right for a learner in flow. Exactly wrong for a leader
who does this once a term and doesn't know what to ask — you cannot search for a capability you
don't know exists.

So: same source, second reading. Keep the walk as the just-in-time answer. Add a **map** — one page
that writes every walk out in full prose, plus everything that has no walk at all, compiled from
the same JSON and gated by the same compiler. A capability deleted from the code takes the page
down with it at build time. A video cannot do that, and that is the argument.

---

## 2. The page

### Where it lives

A full page at `/schools/handbook`, and `/org/:id/handbook` for the org tree: same component, same
shell. Every non-learner persona reaches it: govt admin, org leader, school admin, teacher, tutor.

**Not a new tab.** The top bar has its own rule, written into `SchoolsTopBar.vue` and worth
respecting: tabs are daily destinations, and Settings was deliberately pulled out of them because
it is not one — "fewer tabs means the school name keeps its space." A handbook is used once a term.
By the bar's own logic it does not belong in the bar.

But a page nobody can find is the failure we are fixing, so the discoverability goes where the
confusion actually is, not into a menu:

- **The page is listed in the user menu**, beside Settings. That is its address.
- **Every page's quiet "How this works" link becomes a Handbook chip.** Today
  `components/admin/HowThisWorks.vue` renders a right-aligned, underlined, 12px grey link that
  opens an inline card listing only the walks for the one place you are standing on. It becomes a
  `.btn-ghost` chip reading **Handbook**, at button scale, which opens the page scrolled to this
  screen's section. Same position, same restraint about not interrupting anyone, an order of
  magnitude more visible, and no nav real estate spent.
- **One chip at first run**, on the setup wizard and the first dashboard visit.

This is the louder answer and it costs less than a tab: it puts the door on every page instead of
one, and it **deletes** the bespoke per-place inline panel rather than adding a surface beside it.

### Name

I would call it **Handbook**, not Training. Training is a thing you sit through; a handbook is a
thing you look in when you need it, and this is the second one. Register is your call — say the
word and it changes everywhere.

### What it looks like

The dashboard's own furniture, and specifically the system that actually shipped. The
Frostwell-era components are largely legacy now: `.schools-card` appears 114 times across the
schools views against 8 files still importing `FrostCard`, and `SearchBox` survives in exactly one.
So this page is built from `schools-design.css` — `.schools-card` sections, `.btn-play` for the
primary action, `.btn-ghost` for the quiet ones, `.status-pill` for the role marks — plus the
shared `Greeting` and `Bench` where they fit. No new CSS system, no new components if I can avoid
them. Density respects `useSchoolsDensity` like every other page.

```
  HANDBOOK
  Everything this dashboard can do, written out.
  Search it, or read the lot.

  [  search                                              ]

  ( ) Just what I can do        (o) Everything

  --- Getting people in -----------------------------------
   Bring your first teacher in                           v
   Invite a teacher who isn't here yet                   v
   Ways in - who can get in, and how to change it        v
   Give someone a second role                  ADMIN     v

  --- Running classes -------------------------------------
   Make a class                                          v
   Run your first class session                          v
   Share a class with a colleague                        v
   ...
```

Tap a row and it opens in place:

```
   Bring your first teacher in                           ^

   What it's for
   Getting a colleague into the school with a teacher's
   view, without them signing up for anything.

   Where it is
   Your school -> Teachers -> Invite a teacher

   How you do it
   1. Open Teachers from the top bar.
   2. ...
   3. ...

   Worth knowing
   The link IS their login. Re-minting kills the old one
   on the spot.

   [  Show me on the real screen  ]
```

Six deliberate choices:

- **Full prose, standalone.** Every entry reads without the screen in front of you, because the
  person reading it is often not on that screen — they are working out whether the product does the
  thing at all. This is exactly what the current step copy is not: `say` is pointing text, terse by
  design, meaningless without the arrow.
- **Louder than the clips, on purpose.** The current affordance
  (`components/admin/HowThisWorks.vue`) is an underlined grey `text-xs` link, right-aligned,
  opening an inline card, and it only ever offers the walks for the one place you happen to be
  standing on. Right for a learner in flow; wrong for a leader doing a task once a term. Here it is
  a whole page, headings at the section scale the dashboard already uses for real content, a
  `.btn-ghost` chip instead of a 12px underline as the way in, and a full-width `.btn-play` for
  Show me.
- **Show everything, not just your own permissions, by default.** Hiding what a teacher can do from
  a school admin defeats the point — the person is learning the shape of the product. Things
  outside your role carry a `.status-pill` and are still fully readable; the toggle narrows to yours
  in one tap. This is deliberately the opposite of the walkthrough engine's rule, because the
  engine's job is offering and this page's job is mapping. It is a taste call and the other way is
  defensible.
- **Entries with no walk look identical, minus the button.** The page's coverage is complete even
  where clip coverage isn't — which is precisely the gap an admin falls down today.
- **Search is the same dumb local word match** the learner hub already uses (`searchWalks` in
  `walkthrough/useWalkthrough.ts`): every query word must appear in the entry's title, keywords or
  body. No index, no network, no tokens, works offline. Matches open automatically.
- **Read the lot** is one tap: it opens every entry so the page becomes one continuous scroll. That
  is the honest substitute for "show me a video" — thirty minutes of reading you can skim in three,
  and it is never out of date.

Tap is the only affordance throughout: no drag, no swipe, no long-press. Rows are buttons, Show me
is a button, the toggle is a button.

### What the page has to cover, and the hole it is filling

The census counts roughly **65 distinct capabilities** across the six sections above. Eighteen
walks exist; twelve of them are non-learner; and every one of those twelve points at
`node-home`, `node-insights`, `class-detail` or the ssi-admin-only `admin-invites`.

**Zero walks touch the flat dashboard.** Not Teachers, not Students, not the My Classes list, not
Settings, not the four-step setup wizard, not All-schools, not Upgrade and billing. Which is to say
the entire first-run path — make a class, run the setup wizard, get your first teacher in from the
Teachers page — has no coverage at all, and neither does any destructive action outside Class
Detail: renaming or deleting a class, deleting a school.

That is not a small gap at the edge. It is the exact stretch of the product a new school admin
walks through in their first week, and it is precisely why they ask for a video: the part they most
need explained is the part with nothing on it. Stage 2 of the build is mostly this.

One structural note the census turned up: most non-learner capability no longer lives in the flat
views at all — it has moved to `NodeHomeView.vue` and `NodeActionBar.vue`, THE VIEW, which is where
the twelve existing walks already point. The flat views are the residue, and they are also the
uncovered part, so the page has to span both while that migration finishes.

The census also found **no drift** — every anchor in all eighteen walks resolves to a live
`data-walk` attribute in the source. The gate is doing its job today.

### The prose

Entries follow the explainer rulings already in `tools/explainer/rulings/*.md` and the content laws
in the header of `explainer/learnerExplainers.ts`: mechanism only, no parentheses, no bullets
inside an entry's body, bold only on the term being defined, and the plain voice those files
already set. The `how` array renders as numbered steps because they are steps, which is the one
place a list is honest.

### Where the content comes from

One source, extended — not a second one. Today a walk is:

```json
{
  "id": "invite-first-teacher",
  "title": "Bring your first teacher in",
  "personas": ["school_admin", "leader"],
  "place": { "route": "node-home" },
  "steps": [{ "anchor": "verb-invite-teacher", "say": "...", "advance": { "on": "next" } }]
}
```

It gains a `handbook` block and a `section`, and `steps` becomes optional:

```json
{
  "id": "invite-first-teacher",
  "title": "Bring your first teacher in",
  "section": "getting-people-in",
  "personas": ["school_admin", "leader"],
  "place": { "route": "node-home" },
  "anchor": "verb-invite-teacher",
  "keywords": ["teacher", "invite", "staff", "colleague"],
  "handbook": {
    "what": "Getting a colleague into the school with a teacher's view, without them signing up for anything.",
    "where": "Your school -> Teachers -> Invite a teacher",
    "how": ["Open Teachers from the top bar.", "..."],
    "note": "The link IS their login. Re-minting kills the old one on the spot."
  },
  "steps": [ ... ]
}
```

Three new gates in `tools/walkthrough/lib.mjs`, beside the seven that already run:

1. **Every entry has a `handbook` block** with a non-empty `what`, `where` and `how`. An entry
   without prose does not compile.
2. **Every entry names a real anchor** — `anchor` for prose-only entries, the step anchors for
   walks — checked against the live `.vue` source by the existing `gateAnchors`. This extends the
   no-drift property to the entries that have no clip: delete the button, break the build.
3. **`section` is one of a known list**, lockstep-checked against the runtime the way
   `KNOWN_PLACES` already is.

The compiler emits the same `pack.json` the player already bundles, now carrying the handbook index
alongside the walks. The page is a static read of that file: zero requests, zero tokens, works
offline, and it cannot be edited into a lie without failing a build.

**Better x simpler x cheaper.** Better: the map an admin actually needs, in prose, which a video
cannot be. Simpler: it deletes the question "which artefact is authoritative" — one file per
capability, and the walk is a view of it rather than a sibling. Cheaper: no new runtime, no new
data source, no model at read time, and the maintenance cost is a compile gate we already pay for.

---

## 3. Asking a question

### The flow

At the bottom of the page, and at the bottom of any search that finds nothing:

```
   Not in here?

   [  Ask                                              ]
```

Tap, a box opens, they type, they submit. Before anything is written, the same local search runs
against the question text; a strong match shows as *"This might be it — <entry>"* with the entry
opened underneath and **Ask anyway** beside it. That deflection is free: no network, no model.

On submit the question is written to the database like telemetry — one row, fire and forget — and
the person is told the truth:

> Asked. The answer gets written into this page, so it will be here for the next person too.
> Usually the next day.

Their own questions and answers appear in a small **Your questions** section on the page.

### The write path — matching what already works here

There are three precedents in this repo and they are not equal. `content_feedback` and
`tester_feedback` both insert straight from the browser via supabase-js; they disagree with each
other about what their identically-named `user_id` column holds, one of them is currently
world-readable, and nothing in this repo reads either. `player_events` is the one built properly:
browser -> `api/player-events.ts` -> service-role insert, identity verified server-side from the
bearer token, RLS on with **zero** client policies, so a browser cannot touch the table at all.

Follow `player_events`:

- **One server route**, `api/handbook-questions.ts`. POST writes a question, GET returns the
  asker's own rows. The client never touches the table.
- **Identity is stamped server-side** from the bearer token, into `auth_user_id` holding
  `auth.uid()::text` — this is an admin acting as themselves, not a learner. Named `auth_user_id`
  rather than `user_id` so the column states which identity it holds, per the repo's own
  convention. Nothing identity-shaped is accepted from the client.
- **The route is gated** with the existing `api/_utils/operatorGuard.ts`.
- **RLS on at creation with no client policies**, per the standing rule that every new table gets
  an explicit posture. Own-row filtering happens in the route, where it can be tested.
- **Rate limit** adapted from `api/_utils/codeAttemptThrottle.ts` — the estate's one throttle
  pattern, currently keyed on IP hash; here it keys on the auth uid. A handful per person per day.
  It is a support box, not a chat.

### The table

`handbook_questions` — telemetry-shaped, append-mostly:

| column | type | what it holds |
|---|---|---|
| `id` | uuid pk | |
| `created_at` | timestamptz | |
| `auth_user_id` | text | the auth uid, stamped server-side, never from the client |
| `node_id` | uuid | the school/group/org they were in |
| `persona` | text | admin / leader / school_admin / teacher / tutor |
| `route` | text | the page they were on when they asked |
| `question` | text | their words, untouched |
| `status` | text | `new` / `duplicate` / `answered` / `in_page` / `declined` |
| `matched_entry_id` | text | the handbook entry that already answered it, if deduped |
| `answer` | text | what they were told |
| `answered_at` | timestamptz | |
| `answered_by` | text | `batch` or `human` |
| `entry_id` | text | the handbook entry this question became, once it lands in the page |

---

## 4. The answering loop, and why it cannot run away

**A question is a gap in the page.** That single reframe is what makes this affordable: the model is
spent once per genuinely new question, ever, and never once per asking.

The batch runs nightly as a Vercel cron, on the scaffolding that already runs the payouts and
demo-school-expiry jobs — `api/cron/*.ts`, the `crons` block in `vercel.json`, `checkCronAuth`
against `CRON_SECRET`. That machinery is proven. The only new thing about this job is that it makes
a model call, which nothing in either repo does on a schedule today; I have sized it as new ground.

Five steps:

1. **Pull** everything at `status = 'new'`. No model.
2. **Deduplicate locally.** Normalise the text and word-match it against every existing handbook
   entry and every previously answered question. A match sets `status = 'duplicate'` and
   `matched_entry_id`, and shows the asker the entry that already answers them. **Zero model spend,
   and this is where most of the volume goes** — the second person to ask a thing is answered by
   the first person's answer.
3. **Answer what's left, capped.** At most **20 a night**. One model call per question, producing
   two things: a short direct answer for the asker, and a drafted handbook entry in the schema
   above.
4. **The answer goes on the row**, and the asker sees it next time they open the page.
5. **The entry draft goes onto a branch** as a JSON file in `tools/walkthrough/walks/`, where the
   compile gate checks it like any other entry — it must name a real anchor in the live source or
   it does not build. You merge it. On deploy it is part of the page permanently and the question
   becomes `in_page`.

### The ceiling, concretely

- **Cost is per distinct question, not per asking.** Ten admins asking the same thing cost one
  answer; after that, zero, because the page answers them.
- **The set of distinct questions is bounded by the set of things the product can do.** That is a
  finite, enumerable list, and it has now been counted: **about 65 capabilities**. Allow a couple of
  angles per capability that the first draft of the page misses, and lifetime new-question answers
  is on the order of **130**.
- **Per answer**: roughly 3k tokens in (the question, the nearby entries, the schema) and under 1k
  out. On Sonnet that is about **1p**.
- **So the lifetime bill for filling the page is about a pound fifty**, plus a thin tail as the
  product grows — a new feature adds capabilities, each worth a handful of answers once.
- **And there is a hard mechanical cap that does not depend on any of that reasoning being right:**
  20 answers a night. About **20p a night, six pounds a month, worst case, forever** — including
  the case where somebody sits hammering the box, because near-duplicates are deflected at step 2
  before the model runs, and the cap holds regardless of queue length.
- **The curve goes down.** Every answer closes a gap. A question arriving twice is a defect in the
  page, and the loop is what fixes it. Nothing here scales with learners, sessions or page views —
  the read side is a static file.

Batch is what makes it cheap, and batch is fine: nobody needs an instant answer to "how do I move a
teacher between classes" at 11pm.

### The one soft spot, named

Between a question being answered and its entry being merged, the answer lives in the database
rather than in the compiled pack — so for that window it is not covered by the compile gate. I would
render that tier explicitly as *"Answered on 14 March, not yet checked into the handbook"* rather
than pretending it is page content, and the merge retires it. It is a real gap in the no-drift
property and it should be visible rather than papered over.

---

## 5. Build plan

| Stage | What | Size |
|---|---|---|
| 0 | Schema extension, three compiler gates, and hand-write the `handbook` block for the existing walks. No UI. | **S** — half a day of code, plus prose |
| 1 | The page: route, nav item, sections, search, tap-to-open rows, Show me, role toggle, Read the lot. Static, no database at all. | **M** — 1-2 days |
| 2 | Fill the gaps: entries for the ~50 capabilities with no walk today, first-run path first — setup wizard, make a class, Teachers, Students, Settings, billing. Mostly prose, barely any code. | **L** — the bulk of the value, and the bulk of it is writing |
| 3 | The question box: table, server route, rate limit, Your questions. No model anywhere. | **S** — half a day |
| 4 | The batch answerer: local dedupe, capped model pass, entry drafts onto a branch. | **M** — 1 day |
| 5 | Replace the inline "How this works" panel with the Handbook chip on every page, and delete the per-place card. | **S** — a net deletion |

**Stage 1 ships on its own and is worth shipping on its own** — the page with the existing walks
written out is already more than the video they asked for. Stage 2 is where the real value is,
because that is the first-run path that has nothing on it today. Stages 3 and 4 are what keep it
filling itself; they are not prerequisites for anything.

---

## 6. What I am unsure about

- **The name.** Handbook or Training — your call, it is register.
- **Everything-by-default versus your-role-by-default.** I have argued for everything and would
  ship it that way, but it is a taste call.
- **The chip, rather than a tab.** The read of the top bar says a handbook is not a daily
  destination and should sit in the user menu; I have taken that and added the per-page chip,
  because a user menu on its own is the same too-quiet failure in a different place. If you want it
  in the bar it is one line, at the cost of the school name's space.
- **Nothing in either repo currently calls a model on a schedule.** The cron scaffolding is proven;
  the model call inside it is new ground. That is the one genuinely unproven piece of the build,
  and why stage 4 is a day rather than an afternoon.
- **Whether drafted entries should auto-merge when the compile is green.** I have written it as
  needing your merge, because the page is prose in your voice going to other humans. If that
  becomes a bottleneck the gate could accept them and route the prose to you afterwards.
