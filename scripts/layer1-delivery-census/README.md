# Layer-1 cup delivery census (2026-09-06, read-only)

Answers "are Layer-1 seed cups reaching learners, per course?".
Report: `docs/layer1-delivery/layer1-cup-delivery-census-2026-09-06.md`.

Run order, from the repo root, with `ENVFILE=$PWD/.env` and `CS_SCRATCH` set to a writable dir:

    node q.mjs "<postgrest path>"   # ad-hoc read
    node l1plays.mjs                # all audio_play rows with payload.stage=0  -> l1plays.json
    node enroll.mjs                 # course_enrollments + learners             -> enroll.json/learners.json
    node act.mjs                    # per-course activation round from course_legos -> activation.json
    node audio.mjs                  # per-course seed-audio + bookend coverage  -> audio.json
    node final.mjs                  # verdict table                             -> final.json

`q.mjs` reads the service-role key from `.env` and only ever issues GETs.

THE READER: a Layer-1 play is `audio_play` with `payload.cycleType='pod_play'` and
`payload.stage = 0`. `stage: 0` is written only by the two Layer-1 code paths
(`podSegue.ts`, `LearningPlayer.vue`); pods always carry `stage >= 1`. Do NOT use
`role='ps'/'trans'` (pods share those) and do not rely on `pod_lap_start.isLayer1`
(exists only since 2026-08-31, and is false on a pod lap with a cup segued onto it).
