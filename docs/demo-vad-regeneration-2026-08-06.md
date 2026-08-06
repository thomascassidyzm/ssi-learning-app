# Demo VAD regeneration — run live, 6 August 2026

**Outcome: done.** The school demo data on the live shared DB now has ~half its learners
carrying real VAD/prosody data and half carrying none at all — the honest picture, where
not everyone in a class ends up with their own account and mic.

**168 students regenerated. 88 (52%) have VAD data. 80 have no rows whatsoever in the
VAD-fed tables** — not zeros, not empty-but-present rows. Nothing.

Per school, the uptake looks like a real roster rather than every-other:

| School | Students | With VAD | With none |
|---|---|---|---|
| Gaelscoil na Mara | 72 | 40 (56%) | 32 |
| Sakura International School | 46 | 21 (46%) | 25 |
| Ysgol Gynradd y Garn | 50 | 27 (54%) | 23 |

The two halves are cleanly separated: every learner has **either** metrics **and** prosody,
**or** neither. Zero mixed cases out of 168. The VAD half carries 752 real latency series
(average 14 samples each) and 1,225 prosody events with genuine envelope data from the real
extractor, not invented numbers.

---

## The thing worth knowing

The script was going to take out far more than it rebuilt, and it took two tries to find that.

Its reset was written as "delete everything marked demo, then regenerate". That was true when
it was written. Since then the demo estate has grown a lot of neighbours that also carry the
demo mark — **the IME Demo Programme, the Coastal and Metro regions, the Pilot districts, the
org and workplace demo nodes**. Each of those has its own separate generator. This script
cannot rebuild any of them. So "delete everything marked demo" had quietly become "destroy the
IME demo world and hope".

It never got that far, because the database refused: the delete hit a foreign key on the govt
admins, and the whole thing rolled back untouched. Then, once that was cleared, it hit a second
one — the school node groups that the org hierarchy work hangs off the same rows. Two
independent constraints, both saying the same thing: these rows are load-bearing now.

There was a further one with no constraint to catch it. The cleanup step deleted **every** demo
login persona by email pattern, including the IME programme's — the personas its own generator
documents as safe from this script.

So the reset is now scoped to what this script actually creates: its three scenario schools,
their classes, learners and telemetry. **The school and group rows themselves survive and get
reused**, because they are org identity — the node tree hangs off them — not per-run content.
Reruns are now genuinely repeatable rather than destructive, which is what "sack and rebuild any
which way" was always meant to mean.

Everything neighbouring is intact and verified after the run: 21 groups, 15 schools, 720
learners, 26 govt admins — identical to the snapshot taken before touching anything. The IME
programme, both regions and the Metro schools are all present with their rosters. The three
scenario schools kept their node linkage.

A full backup of every demo row was taken before the run and is kept at
`~/demo-backups/is_demo-pre-vad-regen-2026-08-06.json` (92 MB). Nothing needed it, but it exists.

---

## How the empty half looks in the app

The surface that shows this is the admin user view for an individual learner. Its "Adaptive
pause mastery" section is drawn only when the learner has mastery rows at all — so a no-VAD
learner shows **no section**, which is a real absence rather than a row of zeros. That is the
behaviour we wanted, and it is what the code does.

Two matched learners in the same class, if you want to look:

- **Has VAD** — Saoirse Ó Flaithearta, `/admin/users/82cf5384-4791-4f6d-a5aa-8546d51a943a`
- **Has none** — Lorcán Nic Gearailt, `/admin/users/0216ee57-5979-446d-bb5c-5306dc96d3f4`

Both in Rang a Trí, Gaelscoil na Mara.

---

## Two things for you, neither urgent

**The difficulty-turns board will never show this demo telemetry.** The generator was written
to give that board demo learners to display. Four days later, a deliberate policy migration
excluded every demo learner from all analytics aggregates — so the board filters them straight
back out. The policy is almost certainly right and I have not touched it; the generator's claim
about its own purpose is just now stale. The telemetry does still feed the per-learner admin
view, which reads the table directly. Worth knowing if you were expecting to demo that board
off this data.

**Demo students cannot show the learner-facing mirror.** They are synthetic identities with no
login by design, so the prosody panel a real learner sees on their own profile cannot be
exercised with them. Only the staff personas can log in.

---

*Backup: `~/demo-backups/is_demo-pre-vad-regen-2026-08-06.json`. Credentials for the demo staff
logins were written to `~/Desktop/SSi-demo-credentials-2026-08-06.md` as usual.*
