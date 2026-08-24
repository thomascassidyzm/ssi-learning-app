# The IME demo students — what's actually in the live database

*Queried directly against the live Supabase database, 6 August 2026. Nothing here comes from an earlier report.*

## The three numbers

- **381 students** in the IME Demo Programme right now. Your memory of "something like 360" is right — it's 381.
- **0 of them have any VAD data.** Not some. None.
- The 52% VAD split that was built this morning went to a **different, smaller demo world** — 168 students across Ireland, Japan and Wales. 88 of those 168 (52%) carry VAD.

So the thing you're most interested in showing is the one thing that has no VAD in it.

---

## 1. What demo worlds exist, and how big each is

Six separate demo populations exist in the live database. Student counts are live:

| Demo world | Students | Has VAD data? |
|---|---|---|
| **IME Demo Programme** (India) | **381** | **No — zero** |
| Japan 2026 (Sherbourne + Hillcrest) | 90 | No — zero |
| Gaelscoileanna Píolótach (Irish) | 72 | Yes — 40 of 72 |
| Ysgol Gynradd y Garn (Welsh) | 50 | Yes — 27 of 50 |
| Sakura International School (Japanese) | 46 | Yes — 21 of 46 |
| Salesian-2 (stray test) | 1 | No |

**Inside IME**, three regions:

| Region | Schools | Students |
|---|---|---|
| Pilot Districts Region | Sunrise Pune (82), St. Mary's Kochi (60), Green Valley Jaipur (60) | 202 |
| Coastal Districts Region | Seaside Chennai (60), Harbour View Visakhapatnam (40) | 100 |
| Metro International Schools | Global Edge Mumbai (41), Lotus Valley Delhi (34), Oakridge Bengaluru (25) | 79 |
| **Total** | **8 schools** | **381** |

(402 class memberships across 381 people — 21 Metro students sit in two classes each, which is the deliberate dual-enrolment showcase.)

IME is also the richest world by course spread: **11 different courses** running — English for Hindi/Gujarati/Kannada/Marathi/Tamil/Telugu speakers, plus Spanish, French, German, Mandarin and Welsh classes.

**Was IME touched by this morning's regeneration? No.** Verified from the timestamps on the membership records: every IME student was created on 14, 19 or 20 July and has not been written since. The three worlds regenerated this morning (Irish 72, Japanese 46, Welsh 50 = 168) all carry today's date. The claim that the regen was scoped away from IME is true.

---

## 2. Where the ~360 figure comes from

It's not a misremembering of another population, and there was never a script with "360" written in it. IME was built by **three scripts over a week in July**, and 381 is simply what they added up to:

- **14 July** — the original IME generator: the programme, the govt-admin persona, three schools in the Pilot region (~80 students).
- **19 July** — a second region added (Coastal, Chennai + Visakhapatnam) so region-vs-region comparison would light up (~100 more).
- **20 July** — a "rich world" pass: a third region (Metro: Mumbai, Delhi, Bengaluru), plus extra classes, extra courses and dual-enrolled students across the existing schools (~200 more).

Class sizes are randomised per class, so the total is emergent rather than a set number. **It was never exactly 360, it is 381 today, and it has not changed since 20 July.** Your recollection was accurate to within 5%.

The 168-student figure from this morning's work is a genuinely different, smaller population — that's the gap between what you remember and what the recent report described.

---

## 3. The VAD gap, and what it would take to close

**Current state, queried per learner:**

| | Students | With VAD | Coverage |
|---|---|---|---|
| Schools demo (built today) | 168 | 88 | **52%** |
| **IME Demo Programme** | **381** | **0** | **0%** |
| Japan 2026 | 90 | 0 | 0% |

The schools demo carries 752 mastery-metric rows and 1,225 real prosody traces behind that 52%. IME carries none of either — the VAD tables have no row for any Indian demo student.

**Why:** the "roughly half the learners have VAD" ruling landed this morning and was written into the schools-demo generator only. IME was built in July by different scripts, before that ruling existed, and this morning's run was deliberately scoped away from IME so it wouldn't destroy the hand-built India world. That protection was correct — but it means IME never received the VAD half.

**What closing it would take** (sizing only — nothing built, nothing written):

- **Population:** all 381 existing IME students, in place. No regeneration.
- **Target:** ~195–200 of them carrying VAD, drawn per class at 40–60% so classes look genuinely uneven rather than every-other. The rest get *nothing* in the VAD tables — which is exactly how a real learner without a working mic presents, and is the honest half of the story.
- **Volume:** roughly 1,700 mastery-metric rows and ~2,700 prosody traces. Small — a single run of a few minutes.
- **Approach: reuse, don't rewrite.** The VAD-generation logic built this morning (per-class uptake rate, the 60-frames-per-second energy envelope, the prosody payload shaped exactly like the live player writes it) is already written and proven against the schools demo. The work is a **top-up script that runs over IME's existing learners** — read who's there, coin-flip per class, write the two tables — rather than a new generator or a regeneration.
- **Why top-up and not regenerate:** regenerating IME would destroy the July world — three regions, 11 courses, the dual-enrolment showcase, the unclaimed-school scenario, and the join codes. Those took three passes to build and aren't reproducible from one script.

**Recommendation:** do the top-up. It's the smallest possible change that makes the India demo show what you actually want to show, and it touches nothing that already works.

---

*All figures queried live from the production database, read-only. No writes were made.*
