# Pecyn Croeso — the Canolfan welcome pack

The page the Canolfan Cymraeg email links to, alongside its sign-up link. It
replaces a lost PowerPoint that showed a version of the app that no longer
exists.

- **Read at** `/croeso` — `packages/player-vue/public/croeso/index.html`,
  reached through the two rewrites in `vercel.json`.
- **Edit** `page.tpl.html`, then `python3 tools/croeso/build.py`. Commit both
  the template and the built file.
- **Re-shoot** with `capture.mjs` when a screen changes; see its header for the
  two environment variables headless Chrome needs here.

## Why it is one file

Older, less confident learners on phones, often on a weak signal. So: no
framework, no build step in the deploy, no CDN, no web font, and every picture
inlined as a `data:` URI. A third-party stylesheet is a real boot hazard — on a
bad connection it hangs and nothing paints at all. Nothing here can half-load.

It also prints: `@media print` gives A4, keeps a picture with its caption, and
prints both languages whatever the on-screen toggle says.

## Why the pictures are real

They are the running app driven through the actual journey, not mock-ups. A
welcome pack whose pictures do not match the screen is worse than none: the
learner it is written for is the one who cannot tell which of the two is wrong.
