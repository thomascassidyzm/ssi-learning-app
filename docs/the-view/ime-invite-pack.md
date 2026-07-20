# IME invite pack — six role-shaped links, redeemed and evidenced

**Date:** 2026-07-20 · **Build:** deployed dev (`ssi-learning-app-git-dev-zenjin.vercel.app`) ·
**All DEMO** — minted from the IME Demo Programme tree, personas named `(demo)`, emails are
plus-addressed test addresses. Full run: `packages/player-vue/e2e/the-view/ime-invite-pack.mjs`
(ALL PASS, 6/6 roles). Evidence images in `docs/the-view/ime-invite-pack/`.

Every link was redeemed in a **fresh incognito context**: capture screen → landing surface →
account identity. Zero OTPs, zero email round-trips, zero `link-<uuid>` ghosts for named roles.

| # | Role | Minted at | Link | Capture screen | Lands on | Account (DB truth) |
|---|---|---|---|---|---|---|
| 1 | **Group leader** | IME Demo Programme | `/group/GXK-737` | "You've been invited to lead IME Demo Programme's SSi rollout" + name/email | Programme node home (`/schools`: 3 regions rollup) | `thomas.cassidy+ime-lead@gmail.com` · "Imogen Marsh (demo)" · govt_admin |
| 2 | **Sub-group leader** | Pilot Districts Region | `/group/JRT-919` | "…invited to lead Pilot Districts Region's SSi rollout" + name/email | Region node home (3 schools · 200 students · 666.4h) | `thomas.cassidy+ime-region@gmail.com` · "Rhodri Vaughan (demo)" · govt_admin |
| 3 | **School leader** | Sunrise Public School, Pune | `/redeem/WPV-386` | "You've been invited to help lead Sunrise Public School, Pune" + name/email | School dashboard (`/schools`) | `thomas.cassidy+ime-schoollead@gmail.com` · "Carys Puw (demo)" · school_admin |
| 4 | **Teacher** | Sunrise Public School, Pune | `/redeem/YNS-182` | "You've been invited as a teacher at Sunrise Public School, Pune" + name/email | Teacher dashboard ("Welcome back, Gethin." + Create class) | `thomas.cassidy+ime-teacher@gmail.com` · "Gethin Rees (demo)" · teacher |
| 5 | **Student → class** | Grade 6A, Sunrise (class join code) | `/redeem/DEMO-IME0-3` | "You're joining Grade 6A — Sunrise Public School, Pune" + name ONLY | Player, on the class course (English for Hindi speakers) | "Alys (demo)" · student · placeholder email BY DESIGN (pupils have none) |
| 6 | **Learner → group** | Pilot Districts Region (learner join) | `/redeem/FXZ-847` | "You're joining Pilot Districts Region" + name ONLY | Player | "Begw (demo)" · student (group-affiliated) · placeholder email by design |

Exact link codes + URLs: `ime-invite-pack/links.json` (all revocable from the node's ways-in;
mark: **demo** — mint fresh ones from the live tree for the real IME send).

## Evidence index

Per role, three shots: `<role>-1-capture.jpg` (the one screen), `<role>-2-landing.jpg` (role
surface), `<role>-3-account.jpg` (open avatar menu / identity — staff shells show name + role).

## What this proves (the founder's pins)

1. **Role-scoped links** — six different links, each token carrying `{node, role}`; each capture
   screen names the role AND the place. No generic link anywhere.
2. **Link is the credential, identity captured** — one friendly screen, then in. Named roles are
   real accounts (their name, their typed email, recorded unverified); DB truth printed in the
   run log confirms zero ghosts.
3. **Landing matches role** — leaders → their node home; teacher → school teacher surface;
   student → player on the class course; learner → player. No leader/teacher ever dumped in the
   player.
4. **Pupil path stays light** — name only, one tap to "Start learning".

## Also fixed in this pass (found while building the pack)

Demo generators never registered classes' `student_join_code` in `invite_codes` — **37 class
join links across the demo estate were dead** ("Invalid code"). Repaired live
(`scripts/demo-data/repair-class-join-codes.mjs`, 37/37) and both generators fixed at source.
