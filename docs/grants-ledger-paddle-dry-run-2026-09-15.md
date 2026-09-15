# Paddle grant backfill — live read-only dry run

2026-09-15T12:14:37.244Z

No database or Paddle writes. All grants use source paddle and catalogue-wide access, matching the existing resolver.

| Learner | Paddle subscription | Status | Starts | Expires |
|---|---|---|---|---|
| 36afb73b-1d2b-4ea2-b6d7-a1e5b2105e5b | sub_01m1z3z0k2b6htg77tctxwa5ty | active | 2026-09-07T23:41:27.378361+00:00 | 2026-10-07T23:41:26.033896+00:00 |
| 7434474c-24a4-4612-8310-76992571cc83 | sub_01kwkx7vje0jwspsza2hgx5n6c | active | 2026-07-03T11:53:50.358325+00:00 | 2026-10-03T11:53:47.961897+00:00 |
| db5735b2-5204-46de-8883-04e5e02ab1cd | sub_01kt4ccdasp1xfvdpkpe7nsz7n | active | 2026-06-02T14:39:13.913932+00:00 | 2026-10-09T14:39:11.701+00:00 |
| dddd6325-59ef-4912-a5d5-16093dfdc4b5 | sub_01kts4ysq4dqbdrd3zypane7z7 | active | 2026-06-10T16:13:31.069968+00:00 | 2026-09-17T16:13:28.672+00:00 |
| c430906f-7c05-47c7-b0ed-9c3407f505d2 | sub_01m29x6z0frf3dmf6ng916vh8n | active | 2026-09-12T04:15:06.730354+00:00 | 2026-10-12T04:15:05.285338+00:00 |
| 1f9a123c-55b5-4a81-8ebd-bb0430b307d4 | sub_01ky6vt3z4sw3bvtpswhe2qj0r | active | 2026-07-23T06:50:07.570879+00:00 | 2026-09-23T06:50:05.246315+00:00 |
| ac447d6f-ed12-4524-ae50-72c6c33d6f7b | sub_01m2gs3tc8q4jj0wvecrb2rc1e | active | 2026-09-14T20:18:11.185579+00:00 | 2027-09-14T20:18:09.019259+00:00 |

## Explicit gaps

- sub_01kt4n3qjqb0q7ed94c93z8wy6: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01kt4ravc4f7342vy6gpn742a6: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01ksxqr3rc9enp09db1p2pmsc3: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01ktvg6mhm2tmexsc5zg59gk74: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01ksxysnj4abeamf904sny1rnd: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01ksxz8q5bhs0fjnjrergg90xp: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01ksycm8y3x4k13e2rrbaxswdq: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01ksydp2yjadn25tkb4j7pm3tq: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01ktkejgwrs31j45g2ydcfgztz: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01kwrr1y331cpy59tmkqw3hkrp: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01kt4cw13db4ngmak8ps1rjn1p: cancelled, period end missing. Excluded; no historical expiry invented.
- sub_01kvx8a6dbetnqzbzwxqwg3xka: cancelled, period end missing. Excluded; no historical expiry invented.

Apply after schema migration: repeat dry run with SNAPSHOT_PATH, review the report, then DRY_RUN=false with that snapshot. The RPC locks and checks each subscription against the snapshot; any change aborts the whole batch. It never overwrites an existing grant.
