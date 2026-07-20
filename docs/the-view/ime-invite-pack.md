# IME invite pack — six PERSONAL links (species 1: the link IS the login)

**Date:** 2026-07-20 · **All DEMO** — six pre-provisioned accounts in the IME Demo Programme tree,
display names like "IME Programme Leader". Each link signs its person **straight in — ZERO
screens, no dialog of any kind** — onto the role-matched surface. Redeemable repeatedly; revocable
from the node's ways-in (or `invite_codes.is_active`). Full run: `packages/player-vue/e2e/the-view/
ime-personal-pack.mjs` — **ALL PASS** (6/6 roles + repeat-click ×2 + revoked-fails-friendly).

> **PRODUCTION VERIFIED 2026-07-20 ~07:30 UK.** All six links walked in fresh incognito contexts
> against `saysomethingin.app` itself: zero dialogs, correct landings, ALL PASS. Leaders land on
> their node home (`/schools/org/<their node>` — THE VIEW member mount). Send the production
> forms.

| # | Who (display name) | Signs in as | Lands on | Production link | Staging link (live now) |
|---|---|---|---|---|---|
| 1 | IME Programme Leader | Group leader, IME Demo Programme | Programme node home (9 schools rollup) | `https://saysomethingin.app/group/QJM-868` | `https://staging.saysomethingin.app/group/QJM-868` |
| 2 | IME Region Leader | Group leader, Pilot Districts Region | Region node home (3 schools · 200 students) | `https://saysomethingin.app/group/YSZ-629` | `https://staging.saysomethingin.app/group/YSZ-629` |
| 3 | IME School Leader | School admin, Sunrise Public School, Pune | School dashboard | `https://saysomethingin.app/redeem/KJJ-726` | `https://staging.saysomethingin.app/redeem/KJJ-726` |
| 4 | IME Teacher | Teacher, Sunrise Public School, Pune | Teacher dashboard | `https://saysomethingin.app/redeem/ZKD-834` | `https://staging.saysomethingin.app/redeem/ZKD-834` |
| 5 | IME Student | Pupil, Grade 6A (Sunrise) | Player, ON THE CLASS COURSE (English for Hindi speakers) | `https://saysomethingin.app/redeem/EMU-671` | `https://staging.saysomethingin.app/redeem/EMU-671` |
| 6 | IME Learner | Learner, Pilot Districts Region (no class) | Player | `https://saysomethingin.app/redeem/FZB-346` | `https://staging.saysomethingin.app/redeem/FZB-346` |

Evidence: `ime-invite-pack/p-<role>-landing.jpg` (fresh-incognito landing per role, name visible in
the shell for staff) · `personal-links.json` (codes + bound accounts).

## What each click was verified to do (fresh incognito, per role)

1. **ZERO dialog** — a 300ms-interval watcher asserted no form element ever rendered between
   click and landing.
2. **Role-matched landing** — leaders on their node home, school leader + teacher on the school
   surfaces, student in the player **on the class's course**, learner in the player.
3. **Named identity** — the shell shows the pre-provisioned display name (e.g. "IME Programme
   Leader · Govt Admin").
4. **Repeatable** — second fresh-context click on the same link: straight in again.
5. **Revocable** — a revoked personal link fails friendly ("Invalid code"), mints no session.

## The two species (founder-ruled 2026-07-20 — THE-MODEL §1.13/I12)

- **PERSONAL (this pack):** account pre-provisioned at mint (role + node + name, optional email);
  the link is the login; zero screens. Node verb: **Invite a person**.
- **OPEN shareable:** person unknown at mint → ONE identity-capture screen (name + email for named
  roles, name only for pupils), then in as a real named account. Node verbs: **Get a shareable
  link** / **Get join link**.

*These six are demo artifacts. For the real IME send, mint fresh personal links from the live tree
("Invite a person" on the node) — same zero-screen behaviour, real names/emails.*
