// ============================================================================
// FILE 4 — Frostwell ECharts theme (theme.ts)
//
// Centralises the Frostwell palette the GALLERY uses so widgets read THEME colours,
// never hex literals. The gallery palette lives inline in public/docs/insight-examples.html
// (NOT design-tokens.css, which is the Mist player theme). This module is the one place
// those colours are named for ECharts.
//
// ECharts paints to a <canvas> and cannot read CSS custom properties, so we resolve the
// Frostwell tokens from the live DOM at registration time (an admin-surface element under
// .schools-surface), falling back to the gallery's canonical hex when a token is absent.
//
// Exposes:
//   · INSIGHT_THEME_NAME              — the registered ECharts theme id
//   · registerInsightTheme(echarts)   — idempotent registration; returns the theme name
//   · tone(t)                          — Tone -> colour string (neutral/good/warn/alarm)
//   · frameTag(f)                      — Frame -> 'a' | 'b' (Lens A blue / Lens B red chrome)
//   · palette()                        — the resolved Frostwell colour record (for widget option-building)
//   · FONT_DISPLAY / FONT_MONO         — Frostwell type families (Arsenal / Spline Sans Mono)
//
// NO widget hardcodes hex; they import palette()/tone()/the theme name from here.
// ============================================================================

import type { Tone, Frame } from './spec'

// Minimal structural type for the lazily-imported echarts module. Widgets pass their
// `import('echarts')` namespace in; we only touch registerTheme + (optionally) graphic.
export interface EChartsLike {
  registerTheme: (name: string, theme: Record<string, unknown>) => void
  graphic?: {
    LinearGradient: new (
      x0: number, y0: number, x1: number, y1: number,
      colorStops: { offset: number; color: string }[],
    ) => unknown
  }
}

export const INSIGHT_THEME_NAME = 'frostwell'

// Frostwell type families (the gallery's, NOT the player's design-tokens.css fonts).
export const FONT_DISPLAY = "'Arsenal', 'Noto Sans JP', serif"
export const FONT_MONO = "'Spline Sans Mono', 'JetBrains Mono', monospace"

// ---- the canonical Frostwell palette (gallery hex; the runtime fallbacks) ----
export interface FrostwellPalette {
  ink: string        // --ink   #2C2622
  ink2: string       // --ink-2 #5b534c
  ink3: string       // --ink-3 #8A8078
  inkFaint: string   // --ink-faint #b8b0a6
  card: string       // --card  #fff
  paper2: string     // --paper-2 #efece4 (muted/tile fills, treemap gaps)
  line: string       // --line  rgba(44,38,34,.12)
  lineSoft: string   // --line-soft rgba(44,38,34,.07)
  red: string        // --red   #DB1E17  (Lens B / alarm)
  blue: string       // --blue  #60A5FA  (Lens A)
  gold: string       // --gold  #C59840  (warn)
  green: string      // --green #3A9E60  (good)
}

const FALLBACK: FrostwellPalette = {
  ink: '#2C2622',
  ink2: '#5b534c',
  ink3: '#8A8078',
  inkFaint: '#b8b0a6',
  card: '#ffffff',
  paper2: '#efece4',
  line: 'rgba(44,38,34,0.12)',
  lineSoft: 'rgba(44,38,34,0.07)',
  red: '#DB1E17',
  blue: '#60A5FA',
  gold: '#C59840',
  green: '#3A9E60',
}

// Read a CSS custom property off the admin surface (or :root) — returns '' if unset/SSR.
function cssVar(name: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return ''
  const host = document.querySelector('.schools-surface') ?? document.documentElement
  if (!host) return ''
  return getComputedStyle(host as Element).getPropertyValue(name).trim()
}

// A Frostwell tonal triplet is stored as "r, g, b"; widgets want an opaque/over-alpha colour.
function rgbTriplet(name: string, fallback: string, alpha = 1): string {
  const v = cssVar(name)
  if (!v) return fallback
  return alpha >= 1 ? `rgb(${v})` : `rgba(${v}, ${alpha})`
}

// Resolve the live palette once. Memoised so repeated widget mounts don't re-read the DOM.
let _palette: FrostwellPalette | null = null
export function palette(): FrostwellPalette {
  if (_palette) return _palette
  _palette = {
    ink: cssVar('--ink-primary') || FALLBACK.ink,
    ink2: cssVar('--ink-secondary') || FALLBACK.ink2,
    ink3: cssVar('--ink-muted') || FALLBACK.ink3,
    inkFaint: cssVar('--ink-faint') || FALLBACK.inkFaint,
    card: FALLBACK.card,
    paper2: FALLBACK.paper2,
    line: FALLBACK.line,
    lineSoft: FALLBACK.lineSoft,
    red: rgbTriplet('--tone-red', FALLBACK.red),
    blue: rgbTriplet('--tone-blue', FALLBACK.blue),
    gold: rgbTriplet('--tone-gold', FALLBACK.gold),
    green: rgbTriplet('--tone-green', FALLBACK.green),
  }
  return _palette
}

// ---- Tone -> colour (the spine's tonal map; widgets call this, never a hex) ----
export function tone(t: Tone): string {
  const p = palette()
  switch (t) {
    case 'good': return p.green
    case 'warn': return p.gold
    case 'alarm': return p.red
    case 'neutral':
    default: return p.ink2
  }
}

// Same map but as an "r, g, b" triplet ref so widgets can build rgba(...) fills/ripples.
export function toneRgb(t: Tone): string {
  switch (t) {
    case 'good': return cssVar('--tone-green') || '74, 222, 128'
    case 'warn': return cssVar('--tone-gold') || '197, 152, 64'
    case 'alarm': return cssVar('--tone-red') || '219, 30, 23'
    case 'neutral':
    default: return cssVar('--tone-blue') || '96, 165, 250'
  }
}

// ---- Frame -> chrome class ('a' = Lens A / blue ; 'b' = Lens B / red) ----
export function frameTag(f: Frame): 'a' | 'b' {
  return (f === 'self' || f === 'group') ? 'a' : 'b'
}

// ---- the ECharts theme object (axes/text/colour defaults; widgets inherit, then override per-series) ----
function buildTheme(p: FrostwellPalette): Record<string, unknown> {
  const axisCommon = {
    axisLine: { lineStyle: { color: p.line } },
    axisTick: { show: false },
    axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11 },
    splitLine: { lineStyle: { color: p.line } },
    nameTextStyle: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11 },
  }
  return {
    // default categorical ramp — Frostwell, Lens-B-led (matches the gallery's editorial feel)
    color: [p.red, p.gold, p.blue, p.green, p.ink3, p.inkFaint, '#b8443e', '#7c8aa0'],
    backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT_MONO, color: p.ink2 },
    title: { textStyle: { fontFamily: FONT_DISPLAY, color: p.ink, fontWeight: 700 } },
    tooltip: {
      backgroundColor: p.card,
      borderColor: p.line,
      borderWidth: 1,
      textStyle: { fontFamily: FONT_MONO, color: p.ink, fontSize: 12 },
      extraCssText: 'box-shadow:0 8px 24px rgba(44,38,34,.14);border-radius:8px;',
    },
    categoryAxis: axisCommon,
    valueAxis: axisCommon,
    logAxis: axisCommon,
    timeAxis: axisCommon,
    line: { smooth: true, symbol: 'none', lineStyle: { width: 2 } },
    bar: { itemStyle: { borderRadius: 3 } },
    animationDuration: 700,
    animationEasing: 'cubicOut',
  }
}

// ---- registration — idempotent (registering the same theme twice is harmless but we skip it) ----
let _registered = false
export function registerInsightTheme(echarts: EChartsLike): string {
  if (_registered) return INSIGHT_THEME_NAME
  echarts.registerTheme(INSIGHT_THEME_NAME, buildTheme(palette()))
  _registered = true
  return INSIGHT_THEME_NAME
}

// Convenience: a vertical linear gradient builder (the gallery's gradV) bound to the live echarts.
export function vGradient(echarts: EChartsLike, c1: string, c2: string): unknown {
  if (!echarts.graphic) return c1
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: c1 },
    { offset: 1, color: c2 },
  ])
}

// Horizontal linear gradient (the gallery's grad).
export function hGradient(echarts: EChartsLike, c1: string, c2: string): unknown {
  if (!echarts.graphic) return c1
  return new echarts.graphic.LinearGradient(0, 0, 1, 0, [
    { offset: 0, color: c1 },
    { offset: 1, color: c2 },
  ])
}

// ---- Gallery gradient start-stops (c-standing canonical colours) ----
// These are the ONLY hex values permitted in widgets; they live here so no
// widget file contains a hex literal. Use via hGradient(ec, GRAD_BLUE_LIGHT, palette().blue)
// and hGradient(ec, GRAD_GOLD_LIGHT, palette().gold).
export const GRAD_BLUE_LIGHT = '#9cc6f5'   // c-standing self-bar gradient start
export const GRAD_GOLD_LIGHT = '#e6c48a'   // c-standing peer-bar gradient start
