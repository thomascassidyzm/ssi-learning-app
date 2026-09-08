# Pecyn Croeso — the Canolfan welcome pack

The page the Canolfan Cymraeg email links to, alongside its sign-up link. It
replaces a lost PowerPoint that showed a version of the app that no longer
exists.

**Two outputs, one source.** The Canolfan can attach the PDF to their email or
link the page; both are built from the same template, so neither can go stale
against the other.

- **The page:** `/croeso` — `packages/player-vue/public/croeso/index.html`,
  reached through the two rewrites in `vercel.json`.
- **The PDF:** `/croeso/Pecyn-Croeso.pdf` — same directory, so Vercel serves it
  straight off the filesystem, before any rewrite is consulted.
- **Edit** `page.tpl.html`, then:

      python3 tools/croeso/build.py     # template + shots -> index.html
      node    tools/croeso/pdf.mjs      # index.html -> Pecyn-Croeso.pdf

  in that order, and commit all three. `pdf.mjs` refuses to print a page that
  is not there rather than reprinting yesterday's.
- **Re-shoot** with `capture.mjs` when a screen changes; see its header for the
  environment variables headless Chrome needs here.

## Never author the PDF separately

It is printed from the page by headless Chrome. Two hand-kept copies diverge,
and the one that gets emailed to a few thousand learners is always the stale
one. If the PDF needs to look different, change the `@media print` block.

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
