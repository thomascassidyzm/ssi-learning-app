# SSi Insights AFTER — the rebuilt teacher and leader pages, populated (staging 48d05b2, 2026-09-16)

The "after" to the populated pack at https://watson-1.tail4968cb.ts.net/d/dd91fb3a, captured the same way: IME demo **Sunrise Public School, Pune** (is_demo), teacher **Amit Pawar** on Grade 7A and school leader **Kavita Deshmukh**, real minted sessions, full-content captures against **staging** build 48d05b2. Every number on screen is the live server's.

## Teacher — Insights (/schools/analytics)

| Viewport | Content height | Link |
|---|---|---|
| phone 390×844 | 1369px — **1.6 screens** (was 2.8 on staging) | https://watson-1.tail4968cb.ts.net/d/95954ffd/file |
| desktop 1280×900 | 1069px — **1.2 screens** (was 1.9) | https://watson-1.tail4968cb.ts.net/d/8c20fd1e/file |

One card. This week / Last week, one Compare to (opens on School average, the smallest container with more than one class). Three numbers down the left with the school's beside each: Play as class 25m / 25m, Students on their own 0m / 0m, Total 25m / 25m, New phrases 5 / 3; a thin 12-week line under the total; "Sunrise Public School, Pune average · 3 classes"; then all-time on its own: "Since 9 Aug 2026 · 5h 4m practised · 96 phrases reached". Under the card: "Year 7 — guessed from the name — confirm · change" and "English department — guessed from the course". No course picker, no measure picker, no paragraph, no rank.

## School leader — Insights (/org/<school>/insights)

| Viewport | Content height | Link |
|---|---|---|
| phone 390×844 | 1701px — **2.0 screens** (was **17.5**) | https://watson-1.tail4968cb.ts.net/d/8d815820/file |
| desktop 1280×900 | 1089px — **1.2 screens** (was 10.8) | https://watson-1.tail4968cb.ts.net/d/919744d2/file |

The school's card first (1h 14m vs the Pilot Districts Region average 1h 3m; 9 vs 4 new phrases; 3 schools), then **Each class, quietest first**: Grade 7A, Grade 6A, Grade 6B, each with when it last practised and its week. Then two closed lines: "More about this level" (the four-week org questions) and "Voice & pause". No pupil is named anywhere, on the glance or behind a tap (Tom, 16:31Z).

## Honest notes

- Grade 8A is on a different course (English for Marathi speakers) and so sits outside the school's default course and outside this list; the Course picker on the leader page switches to it.
- The first capture on this build's predecessor caught the old rate widget ("+53%", "1st of 3") rendering under the leader card — a v-if chain break, fixed in 48d05b2 and pinned by a test.
- The teacher card on a phone starts about one screen down because the schools shell's "Where you are" rail and the class header sit above it; that chrome is the shell's, not the card's.
