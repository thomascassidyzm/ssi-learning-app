# send-own-account-teaching-note.mts

Sends the approved "Starting a lesson on the class, not on you" note to the two
teachers named in `docs/teachers-teaching-from-own-account-2026-09-17.md`
(leejames, hughesr310), with the `acknowledge` ("Understood") action attached.

**Run only after this repo's acknowledge action (job #77) has reached `main`
through the normal dev → staging → main promotion**, so the Understood button
the recipient taps actually works in production — a message with an action
kind the deployed client doesn't know about is a silent dead button.

```bash
SB_URL='https://swfvymspfxmnfhevgdkg.supabase.co' \
SB_KEY='<service role key, e.g. from ~/SSi/ssi-dashboard-v7-clean/.env SUPABASE_SERVICE_KEY>' \
npx tsx tools/admin-messages/send-own-account-teaching-note.mts
```

It sends once per run (fresh broadcast id each time) — do not run it twice.
