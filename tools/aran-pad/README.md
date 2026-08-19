# Aran pad

A tiny standalone service that gives Aran **one forwardable link** to directly edit the
How This Works learner copy, with every save versioned so his edits are diffable back
against the original.

## What it is

- `server.cjs` — plain Node, no dependencies. Binds `127.0.0.1:4796`. Serves exactly two
  routes and 404s everything else:
  - `GET  /pad/<token>` — the editing page (one textarea, autosave, manual Save button)
  - `POST /pad/<token>/save` — whole-document save, capped at 1 MB
- Public path in is Tailscale Funnel: `tailscale funnel --bg --https=10000 http://localhost:4796`.
  The unguessable token in the URL **is** the access control — same model as an
  anyone-with-link Google Doc. There is no login.
- Runs as a systemd **user** unit `aran-pad.service` (`Restart=always`), so it survives
  logout and reboot.

## Data (outside the repo, so Aran's keystrokes never touch git)

```
~/aran-pad-data/
  config.json          { "token": "..." }   — the secret; never commit it
  original.md          frozen seed = docs/htw-copy-for-aran.md @ 270edaf6. Never written again.
  current.md           what Aran is editing right now
  versions/<iso>.md    one file per successful save
```

## Seeing what Aran changed

```bash
./tools/aran-pad/diff.sh            # unified + word-level diff, original -> current
./tools/aran-pad/diff.sh --export   # same, plus writes docs/htw-copy-for-aran.edited.md
```

## Operating it

```bash
systemctl --user status aran-pad     # is it up
systemctl --user restart aran-pad    # after editing server.cjs
tailscale funnel status              # should read "Funnel on" for :10000
```

To rotate the link, put a new 32+ hex-char token in `~/aran-pad-data/config.json` and restart.
