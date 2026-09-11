# Human test passes

One file per pass, named by the seven-character staging sha it was tested against. They are
committed on purpose: a pass file is the record of why a ship was allowed, and it has to survive a
fresh clone.

Written by `record-pass.mjs` from the tester's own words, never invented. Read by `human-pass.mjs`,
which is what `promote.sh` refuses on. Every step of `../TESTER-SHEET.md` must read `pass` on both
the web run and the Android run; an unanswered step blocks exactly as a failed one does.
