# IME demo group

*Built 2026-07-14. Real rows on the live shared Supabase DB (dev/staging/prod share one
DB — this shows on `staging.saysomethingin.app` where the region-tier (groups) feature
lives). Not client demo mode.*

## What exists

**Group:** `IME Demo Programme` (`groups`, `is_demo=true`), governed by the region-tier
group model in `api/govt/*` / `api/code/redeem.ts` (design: the (unmerged)
`docs/schools/region-tier-design.md` on `origin/schools/region-tier-design`).

**Three schools**, all `group_id`-attached to that group, `is_demo=true`:

| School | State | Teachers | Classes | Students | Practice hrs |
|---|---|---|---|---|---|
| Sunrise Public School, Pune | claimed | 3 | 3 | 42 | 85.0 |
| St. Mary's Academy, Kochi | claimed | 2 | 2 | 38 | 79.2 |
| Green Valley International, Jaipur | **awaiting admin** (unclaimed) | 0 | 0 | 0 | 0.0 |

Group rollup (`group_summary`): 3 schools, 5 teachers, 5 classes, 80 students, 164.1
total practice hours.

Green Valley is deliberately empty — `admin_user_id=NULL`, but still group-owned from
birth (`platform_status='trial'`, `trial_kind='free_1yr'`, both join codes registered),
mirroring `api/govt/create-school.ts`'s vacant-seat pattern. That emptiness IS the
"awaiting admin" state — it's a fully functional school waiting for someone to redeem
its admin join code, not a stub.

**Course:** `eng_for_hin` (English for Hindi speakers) — confirmed populated before
picking (668 seeds / 636 legos / 32,189 real audio rows; several other candidate
course_codes had seeds/legos but zero audio and were rejected). Fits an English-medium
Indian-school context.

**Activity:** sessions/seed_progress/lego_progress spread over the last 3-4 weeks with
varied recency, so `school_summary` / `group_summary` / `class_activity_stats` (the
views the dashboards actually read) show non-zero practice hours, active-days, and
health dots for the two claimed schools.

**Identity:** staff (admins/teachers) and the group leader persona are REAL Supabase
auth users (so they can be OTP-logged-into for real, not just viewed via act-as),
created via the service-role admin API — never Clerk-fake string ids. Students are
synthetic-uuid identities (they never log in). Everyone is `is_demo=true` and every
email uses the `+demo.ime.` marker, so the IME set is fully distinguishable from the
existing irish/japanese/welsh demo scenarios and from real users.

## The invite link

One-shot `govt_admin` invite code, `max_uses:1`, minted for the real external IME
recipient (separate from the demo login persona below):

**`https://staging.saysomethingin.app/group/L9F-SGW`**

Redeeming it (email OTP, possession-based — no name/email pre-filled) creates a real
`govt_admins` row for whoever clicks it, attached to the existing `IME Demo Programme`
group and its three pre-seeded schools. It does not consume or affect the demo persona
below.

## Demoing without redeeming anything

The ssi-admin "View the app as" roster (`/admin/access`) now includes a **Group
leader** persona: *IME Group Leader · IME Demo Programme*. Click it to open the live
`/schools` dashboard as the group leader — no redemption, no separate login, and it
doesn't touch or consume the invite code above. (Fallback manual path if you ever want
to actually log in as this user rather than act-as: `thomas.cassidy+demo.ime.leader@
gmail.com`, OTP arrives in your real inbox via `+` addressing; full credential list at
`~/Desktop/SSi-ime-demo-credentials-2026-07-14.md`, not committed.)

## Pitch flow (one line each)

1. **Act as "Group leader · IME Demo Programme"** from `/admin/access` — this is what
   IME's own regional officer will see on day one.
2. **Dashboard rollup** — 3 schools, 5 classes, 80 students, 164 practice hours, at a
   glance, aggregated automatically by group membership (no manual rollup work, ever).
3. **Drill into Sunrise or St. Mary's** — real classes, real (synthetic) students,
   real recent activity: this is a live, working school, not a mockup.
4. **Point at Green Valley** — "and this is what a school looks like the moment you've
   invited it, before anyone's claimed it yet" — same group, same rollup slot, zero
   admin action needed from IME to get there.
5. **Hand over the invite link** — `https://staging.saysomethingin.app/group/L9F-SGW` —
   "this is the actual link your regional lead would click to become the real owner of
   everything you just saw."

## Teardown / reset

The seed script is idempotent and scoped ONLY to IME rows (never touches the other
demo scenarios, verified by rerunning twice against live data — reset counts matched
generation counts exactly, and the irish/japanese/welsh scenarios were bit-for-bit
untouched before and after):

```bash
node scripts/demo-data/generate-ime-demo.cjs --reset-only   # remove all IME demo rows
node scripts/demo-data/generate-ime-demo.cjs                 # reset + regenerate
```

Reset scopes by the `IME Demo Programme` group id and its subtree, plus auth users
matching the `+demo.ime.` email marker — distinct from `generate-demo-suite.cjs`'s
blanket `where is_demo` reset, so the two suites can be regenerated independently.

## Files touched

| File | Purpose |
|---|---|
| `scripts/demo-data/generate-ime-demo.cjs` | IME seed generator (idempotent, scoped reset) |
| `packages/player-vue/src/composables/schools/actAsPersonas.ts` | `fetchDemoPersonas()` now surfaces any `is_demo` govt_admin as a "Group leader" persona (generic — not IME-specific, picks up future regional demo groups automatically) |
| `docs/ime-demo.md` | this file |

Commits: `164d5830` (persona fix), `f9d66d4b` (seed script + data + invite mint), both
on `dev`.
