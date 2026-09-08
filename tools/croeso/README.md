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

## The two languages

Kai set the problem on 2026-09-08, and all four parts of it are binding: Welsh
first and shown **no less favourably** is the standard a Welsh-language centre
is judged by; but the readers are people *learning* Welsh, often nervous, so
the English has to be the thing that is obvious; and the doubled text made
every page look twice as long as it is, which is its own reason to give up.

Three mechanisms, one to each part:

1. **The Welsh leads every title** — masthead, contents, every step, every
   caption. Same size as the English, first in order. What differs is *weight*:
   the English is the bold line the eye lands on. Order is where the norm is
   judged, and Welsh has it.
2. **The Welsh body waits behind its own invitation** — one control per block
   (`.cy-open`, inserted by the page's own script), labelled in Welsh with an
   English gloss, rather than one switch at the top. The switch was the wrong
   instrument: it made the Welsh something you turn off wholesale, and asked
   the learner to decide about the whole document before reading a word of it.
   Nothing is cut; the page just stops *reading* as twice its length.
3. **It opens onto its own ground** — tinted panel, green rule, CYMRAEG over
   it, so the eye reads "the same thing in Welsh" and skips it without having
   to parse it as more instructions.

The one switch at the top survives as **open/close them all**, for a confident
reader who wants the whole pack in Welsh.

**Without JavaScript nothing is hidden and no control appears** — the reader
gets both languages in full. That is deliberate: the safe way to fail is
showing too much, never showing English alone.

**The printed copy always carries both, in full.** Nobody can tap a page.
`@media print` opens every panel and hides every control; `.cy-open` is gone
and every `div.cy` is `display:block`. Verify it in the printed file, not in
the template: `pdftotext` the PDF and check the Welsh is there.

## One sheet, one page

Every `section.sheet` is exactly one A4 page: `break-before` starts it on fresh
paper, `break-inside` stops it splitting. A short sheet leaves white at the foot
of its page, which is the price of never asking a learner to turn over
mid-step. If a sheet grows past a page, SPLIT IT IN THE TEMPLATE — `pdf.mjs`
fails when the printed page count is not one more than the number of sheets.

The contents list is real in-document `#` links, and Chrome's print-to-PDF turns
them into PDF link annotations with named destinations, so it is clickable in
the file as well as on the page.

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
