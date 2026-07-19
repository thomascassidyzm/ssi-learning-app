# THE VIEW — deployed-dev verification (2026-07-19)

Run against the live dev deployment (`ssi-learning-app-git-dev-zenjin.vercel.app`)
with a real ssi_admin session (minted magic-link, nothing emailed), driving the
real pages headless. Same grammar verified at three depths + all lenses.

| Depth | URL | Identity | Stats (L/T/C/hours) | Map rail |
|---|---|---|---|---|
| Programme | `/admin/groups/2d98bc20…` | IME Demo Programme | **80 / 6 / 6 / 266.4h** | IME (you're here) → 3 schools below, 20 siblings one tap away |
| School (by school id) | `/admin/schools/2fd27c83…` | Sunrise Public School, Pune | **42 / 3 / 4 / 135.1h** | IME → Sunrise (you're here) |
| Class | `/admin/classes/e2bbe2de…` | Grade 6A · Taught by Rohit Kulkarni (lead) | **11 / 1 / 1 / 29.5h** | IME → Sunrise → Grade 6A (you're here) |

The programme's 80/6/6/266.4h matches the old group dashboard exactly — every
level tells the same story (shared `computeNodeExtras` resolver + subtree
`school_summary` hours).

**Lenses (filters over the one view, live rows):**
- All schools → 3 rows with teacher names ("Amit Pawar, Rohit Kulkarni, Sneha
  Joshi"; Green Valley shows "No teachers yet")
- All teachers → 6 rows, each captioned with their classes
- All classes → 6 rows captioned "school · teacher" with student counts + hours

**Navigation rules:**
- Old Full-schools URL `/admin/groups/:id/schools` → redirects to node home
  with `?lens=schools` ✓ (URL lives, design dies)
- Structure panel's open verbs land on these routes unchanged (openDashboard
  targets are now node homes)

Screenshots in this directory (downscaled): `node-home-programme.jpg`,
`node-home-programme-all-{schools,teachers,classes}.jpg`,
`node-home-school.jpg`, `node-home-class.jpg`.

Suites at commit `c03e3510`: typecheck ✓ · player-vue 893 ✓ · api 552 ✓.
