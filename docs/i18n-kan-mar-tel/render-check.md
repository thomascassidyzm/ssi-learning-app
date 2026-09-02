# Kannada / Telugu / Marathi render check — 2026-09-02

`render-check-2026-09-02.png` is a headless Chromium screenshot of the real CSS
cascade — `:root` tokens, the `[lang]` rule and the `:lang()` coverage block
lifted verbatim from `packages/player-vue/src/styles/design-tokens.css` — over
strings taken straight out of the three new locale files.

Each section carries an `<h1>` set to `var(--font-display)`, which is the exact
path that rendered tofu boxes on a Hindi interface on staging earlier the same
day, plus body copy on `var(--font-body)`.

**What it proves.** All three scripts render whole and in one typeface, headings
included. The decisive evidence is not the pixels but the font files the browser
chose to fetch:

```
fonts.css
noto-sans-latin-400-700.woff2
noto-sans-devanagari-400-700.woff2      ← Marathi
noto-sans-kannada-kannada-400-700.woff2 ← Kannada
noto-sans-telugu-telugu-400-700.woff2   ← Telugu
```

Only those. The unicode-range gating routed each script to its own subset and
nothing else was downloaded — which is the per-language economy the vendoring
script exists to protect, holding after the two new families were added.
