# Structure — Setup dissolved into the org tree

*2026-07-17, the final act of the week's admin unification. Founder ruling: "do we still need
Setup as well as the whole Invites page? the simpler the better." Answer: no. Setup as a page is
gone.*

## The four admin ideas

- **Structure** (`/admin/structure`) — the tree. Groups, schools, staff and entitlements at the
  node they belong to.
- **Invites** (`/admin/invites`) — the doors. Every way in, one list.
- **Users** (`/admin/users`) — the people.
- **Stats / Insights** — the numbers.

The top bar carries exactly these (Invites came out of the "More" menu — a door can't be one of
the four ideas and live behind a More click). Onboarding and Methodology stay in More.

## What moved where

| Old Setup tab | Now |
|---|---|
| Groups | The tree itself — add organisation at the root, add sub-group inline on any row |
| Schools | Leaf rows of the tree — add school inline at any group; ungrouped schools listed below the tree |
| Staff | A facet of the selected node — list scoped to the school (or subtree for a group), add-staff inline with the school pre-set |
| Entitlements | A facet of the selected node — same course picker, group grants cascade, school grants show the inherited notice |
| Teacher/admin join-code cells | A display-only "ways in" strip on the school's detail — each entry links into `/admin/invites?q=<code>`; creation and management live on Invites |
| "Add a group (invite leader)" form | Gone — that's an invite; the tree links to `/admin/invites` |

Click a node to open its detail panel (rename moved to an explicit pencil on the row). Search
filters the tree and matches school names, so finding a school still works — it just lands you in
the tree. `/admin/setup` and `/admin/schools` redirect to `/admin/structure`; all server
endpoints are unchanged.

## Verification (deployed dev build, real admin session)

`packages/player-vue/e2e/structure-redesign/verify-deployed.mjs` — deploy-gated on
`version.json`, mints a real ssi_admin session, and checks: tree renders, old routes redirect,
group + school detail facets appear, ways-in strip links into Invites, search keeps a matching
school's branch visible, mobile renders. Screenshots in `img/`.
