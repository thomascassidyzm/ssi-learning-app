# Teacher-play sweep — the dry-run plan

Read-only pass over the live database, 2026-09-14. Nothing has been written. The apply is armed behind `--apply` and one sentence from you runs it.

## What it found

| | |
|---|---|
| Schools scanned | 43 |
| Classes scanned | 183 |
| Class-and-teacher pairs checked | 190 |
| **Unambiguous copies planned** | **5** |
| Rows those copies would write | 336 |
| Practice minutes they would add | 0 |
| Ambiguous, left untouched | 182 |
| Test and probe accounts excluded | 3 |

The headline is the size. Under your rule — one teacher, one class, no play on the class account — the whole platform yields five copies and 336 rows, not the thirteen or twenty-seven Chepstow alone listed under the looser #662 rule. Every one of the five is a teacher two or three LEGOs into the course with a handful of sessions on her own account, so what moves is a start, not a term's work. That is still the right thing to move: the class account stops reading as never started, and she can skip back if she wants.

None of the five carries any practice minutes, because none of those teachers' own enrolments has any recorded. So no headline hours change anywhere; what changes is the class's position and its diary.

## The five copies

| School | Class | Teacher | Course | Rows | Class ends at |
|---|---|---|---|---|---|
| Ysgol Cas-gwent Chepstow School | 11E | davidlane | cym_s_for_eng | 90 | S0002L01 |
| Ysgol Cas-gwent Chepstow School | 11H | marielane | cym_s_for_eng | 85 | S0002L01 |
| Ysgol Gyfun Tredegar | 10R | Miss Smith | cym_s_for_eng | 8 | S0001L01 |
| Ysgol Gyfun Tredegar | SR | Mrs Ruttley | cym_s_for_eng | 102 | S0003L01 |
| Ysgol Gyfun Trefynwy/ Monmouth Comprehensive School | 7GSN | Mr Snelgrove | cym_s_for_eng | 51 | S0002L01 |

Per-table detail, so nothing is hidden behind a total:

| Class | Teacher | sessions | diary | speaking | everything else |
|---|---|---|---|---|---|
| 11E | davidlane | 5 | 84 | 1 | 0 |
| 11H | marielane | 4 | 79 | 2 | 0 |
| 10R | Miss Smith | 1 | 7 | 0 | 0 |
| SR | Mrs Ruttley | 2 | 99 | 1 | 0 |
| 7GSN | Mr Snelgrove | 3 | 47 | 1 | 0 |

Each class already has its Play as class account; none has to be created. Each copy writes one audit row, stamped `sweep:copy-teacher-play:2026-09-14` so it is never mistaken for a school admin's own run, and each teacher gets one in-app message with a one-tap Undo.

## What was left alone, and why

| Why it is ambiguous | Pairs |
|---|---|
| The teacher teaches more than one class, so which class her play belongs to is a guess | 91 |
| The class account already has play on the course, so a copy would mix two records | 38 |
| More than one teacher on the class, so whose play the class should carry is a guess | 24 |
| The class belongs to no school, so it is outside a schools sweep | 11 |
| The teacher has no own-account play on the class course, so there is nothing to move | 10 |
| The class’s only teacher is the school admin, which reads as an admin or test class | 8 |

These stay on the per-pair admin card from #662, which is untouched: Angharad and every other school admin can still run any of them by hand, one at a time, with the figures in front of her.

The full ambiguous list, every pair with its school, class, teacher, course, own-account minutes, class-account minutes and the condition it failed, is in `tools/copy-teacher-play-sweep-dryrun-log.json` on branch `cs/685-one-off-teacher-play-sweep-copy-`, and is published beside this as the ambiguous list.

## Excluded as test accounts

- ZZ Test — Chepstow scenario / ZZ Test — Year 7 Welsh / Angharad ZZ Test
- ZZ Test — Chepstow scenario / ZZ Test — Year 7 Welsh / Bethan ZZ Cover
- ZZ Probe 147 School / ZZ Probe 147 Class / zz-probe-147-1788786910

## To run it

One sentence from you. The apply re-derives all four conditions from the database at the moment it writes, skips and names any pair that has drifted since this plan, stops at the pair rather than the run if anything fails, and then re-runs this same scan to reconcile: every applied pair must come back with nothing to copy and the ambiguous list must be unchanged.
