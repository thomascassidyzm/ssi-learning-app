# Kannada / Telugu / Marathi render check — 2026-09-02

`render-check-2026-09-02.png` is a headless Chromium screenshot of the real CSS
cascade — the `:root` tokens, the `[lang]` rule and the `:lang()` coverage block
lifted verbatim from `packages/player-vue/src/styles/design-tokens.css` — over
strings taken straight out of the locale files. Each section carries an `<h1>`
on `var(--font-display)`, which is the path that rendered tofu boxes on a Hindi
interface on staging earlier the same day, plus body copy on `var(--font-body)`.

## What it shows, plainly

**Marathi and Hindi render.** The app ships Noto Sans Devanagari, so they are
typeset in the brand's own coverage face; the browser fetched
`noto-sans-devanagari-400-700.woff2` and nothing more.

**Kannada, Telugu — and Tamil — render as boxes ON THIS MACHINE.** That is a
fact about the machine, not about the languages, and Tamil is the control that
proves it: Tamil has been a shipped interface language for months, is live in
front of real learners, and has never been reported as broken. It appears in
this screenshot in exactly the same state as the two new languages.

The cause is that this build box has **eight fonts installed in total** and none
of them covers an Indic script other than Devanagari:

```
fc-list :lang=kn | wc -l   → 0     (Kannada)
fc-list :lang=te | wc -l   → 0     (Telugu)
fc-list :lang=ta | wc -l   → 0     (Tamil — already live, already fine)
fc-list          | wc -l   → 8
```

## The gap, stated honestly

**This probe cannot answer the question a learner's phone answers.** Where the
app ships no face for a script, the glyphs come from the device's own font
fallback — and a headless Linux CI box has essentially no fallback to give,
where an Android or iOS handset ships full Indic coverage. Nothing on this
machine can measure that, and no amount of re-running it will change the
result.

What stands in its place is stronger than the box: Kannada courses already run
in this app, and Tamil, Bengali, Gujarati, Arabic, Korean and Thai interfaces
are all live today under exactly the same arrangement. If the arrangement did
not work, most of the catalogue would be visibly broken.

`coverageLanguages.ts`'s `NO_COVERED_FONT` table is easy to misread as "this
text is invisible". It does not say that. It says *no font this app itself
ships* covers the script — which is a note about who supplies the face, not
about whether the letters appear.
