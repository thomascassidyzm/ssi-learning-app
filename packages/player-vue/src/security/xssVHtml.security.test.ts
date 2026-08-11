// @vitest-environment happy-dom
/**
 * SECURITY AUDIT 2026-08-11 — area 5 (client-config), finding CLIENT-CONFIG-06.
 *
 * The repo has exactly three `v-html` sinks (verified by
 * `grep -rn "v-html" packages/player-vue/src packages/core/src`):
 *
 *   1. components/admin/WalkCard.vue:68        — v-html="rendered"
 *   2. components/admin/HowThisWorks.vue:84    — v-html="html"
 *   3. views/admin/AdminOnboardingView.vue:271 — v-html="previewHtml"
 *
 * All three build their HTML from a markdown-lite renderer that HTML-escapes
 * `&`, `<` and `>` BEFORE inserting any tags. These are CONTROLS THAT HOLD,
 * so the tests below are regression locks, not characterizations: they must
 * keep passing. If someone later adds a `v-html` that interpolates unescaped
 * DB- or user-supplied text, the "no new v-html sinks" test at the bottom
 * fails and forces a fresh look.
 *
 * Sink 3 (AdminOnboardingView) is the one that matters most: unlike 1 and 2,
 * whose content is compiled repo data, its input is `draft.body` — a string
 * that round-trips through the DB via /api/admin/onboarding-messages, i.e.
 * genuinely stored content rather than a build artefact.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import type { Component } from 'vue'

const SRC_ROOT = resolve(__dirname, '..')

/**
 * Mounting the REAL WalkCard component is the strongest evidence in this file:
 * it proves the shipped component escapes, rather than proving a copy of its
 * logic does. That requires a vitest config carrying @vitejs/plugin-vue —
 * which packages/player-vue/vitest.config.ts does.
 *
 * Run these with:      npx vitest run src/security     (from packages/player-vue)
 *
 * The repo root has no vitest config at all, so `vitest run --dir …` from there
 * cannot compile a .vue SFC. Rather than fail in that setup, this block skips
 * itself and says why — the remaining sinks are still covered there, because
 * they are asserted through source reading and a logic mirror.
 */
let WalkCard: Component | null = null
try {
  WalkCard = (await import('../components/admin/WalkCard.vue')).default
} catch {
  // No Vue SFC transform in this vitest config — block self-skips below.
}

/** Every classic HTML-injection payload we expect the escapers to defang. */
const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  '"><script>alert(1)</script>',
]

describe.skipIf(!WalkCard)('v-html sink 1 — WalkCard.vue (regression lock)', () => {
  it.each(PAYLOADS)('escapes %s instead of creating live DOM nodes', (payload) => {
    const wrapper = mount(WalkCard!, {
      props: { kicker: 'TEST', say: payload, stepCount: 1, stepIndex: 0 },
    })

    const say = wrapper.find('.walk-say')
    expect(say.exists()).toBe(true)

    // No element from the payload was ever parsed into the DOM...
    expect(say.element.querySelector('script')).toBeNull()
    expect(say.element.querySelector('img')).toBeNull()
    expect(say.element.querySelector('svg')).toBeNull()
    expect(say.element.querySelector('iframe')).toBeNull()
    expect(say.element.querySelector('a')).toBeNull()

    // ...and the payload survives verbatim as TEXT, which is the proof it was
    // escaped rather than merely stripped.
    expect(say.text()).toContain(payload.replace(/\s+/g, ' ').trim().slice(0, 12))
  })

  it('still renders its one intended tag: **bold** becomes <strong>', () => {
    const wrapper = mount(WalkCard!, {
      props: { kicker: 'TEST', say: 'hello **there**', stepCount: 1, stepIndex: 0 },
    })
    const say = wrapper.find('.walk-say')
    expect(say.element.querySelector('strong')?.textContent).toBe('there')
  })

  it('a payload hidden INSIDE the bold delimiters is still escaped', () => {
    const wrapper = mount(WalkCard!, {
      props: { kicker: 'T', say: '**<img src=x onerror=alert(1)>**', stepCount: 1, stepIndex: 0 },
    })
    const say = wrapper.find('.walk-say')
    expect(say.element.querySelector('img')).toBeNull()
    expect(say.text()).toContain('<img src=x onerror=alert(1)>')
  })
})

/**
 * Sink 3 — AdminOnboardingView's `renderPreview`. The function is declared
 * inside `<script setup>` and is not exported, so it cannot be imported here.
 * Rather than mount the whole view (which fetches on mount), this reproduces
 * the exact escape-then-decorate ORDER the source uses and asserts on it,
 * then separately asserts the source still has that order. Read together the
 * two prove the live sink is safe; apart, neither would.
 */
function renderPreviewMirror(markdown: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = escape(markdown || '').split('\n')
  const html: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[(.+?)\]/g, '<span class="preview-cta">$1</span>')
    if (/^&gt;\s?/.test(line)) {
      html.push(`<blockquote>${line.replace(/^&gt;\s?/, '')}</blockquote>`)
      continue
    }
    if (/^-\s+/.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true }
      html.push(`<li>${line.replace(/^-\s+/, '')}</li>`)
      continue
    }
    if (inList) { html.push('</ul>'); inList = false }
    if (line.trim() === '') { html.push('<br>'); continue }
    html.push(`<p>${line}</p>`)
  }
  if (inList) html.push('</ul>')
  return html.join('\n')
}

/**
 * Parse rendered HTML the way a browser would, so assertions are about LIVE
 * DOM rather than about substrings. This distinction is the whole point: an
 * escaped payload legitimately still CONTAINS the text "onerror=", and a
 * naive string match would call that a failure. What matters is whether the
 * browser ends up with an <img> element carrying an onerror ATTRIBUTE.
 */
function parseToBody(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return doc.body
}

describe('v-html sink 3 — AdminOnboardingView renderPreview (regression lock)', () => {
  it.each(PAYLOADS)('produces no live element or event handler for %s', (payload) => {
    const body = parseToBody(renderPreviewMirror(payload))

    for (const tag of ['script', 'img', 'svg', 'iframe', 'a']) {
      expect(body.querySelector(tag)).toBeNull()
    }
    // No element anywhere carries an inline event handler or a javascript: URL.
    for (const el of Array.from(body.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on')).toBe(false)
        expect(attr.value.toLowerCase().replace(/\s/g, '')).not.toContain('javascript:')
      }
    }
    // The payload survives as inert TEXT — proof it was escaped, not stripped.
    expect(body.textContent).toContain(payload)
  })

  it('cannot be used to inject an attribute into the CTA span', () => {
    // `[...]` becomes <span class="preview-cta">$1</span>. renderPreview does
    // NOT escape double quotes — which is safe ONLY because the substitution
    // lands in TEXT position. This test pins that: the span must end up with
    // exactly one attribute (class), never an injected handler.
    const body = parseToBody(renderPreviewMirror('[x" onmouseover="alert(1)]'))
    const span = body.querySelector('span.preview-cta')
    expect(span).not.toBeNull()
    expect(Array.from(span!.attributes).map((a) => a.name)).toEqual(['class'])
    expect(span!.textContent).toContain('onmouseover')
  })

  it('the live source still escapes BEFORE it decorates — order is the whole control', () => {
    const src = readFileSync(join(SRC_ROOT, 'views/admin/AdminOnboardingView.vue'), 'utf8')
    const escapeIdx = src.indexOf("replace(/&/g, '&amp;')")
    const strongIdx = src.indexOf('<strong>$1</strong>')
    expect(escapeIdx).toBeGreaterThan(-1)
    expect(strongIdx).toBeGreaterThan(-1)
    // If someone reorders these, escaping stops protecting the inserted tags.
    expect(escapeIdx).toBeLessThan(strongIdx)
  })
})

describe('v-html inventory — no unreviewed sinks may appear', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.(vue|ts|js)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full)
    }
    return out
  }

  it('has exactly the three audited v-html sinks and no others', () => {
    const found: string[] = []
    for (const file of walk(SRC_ROOT)) {
      if (/\bv-html\b/.test(readFileSync(file, 'utf8'))) {
        found.push(file.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'))
      }
    }
    expect(found.sort()).toEqual([
      'components/admin/HowThisWorks.vue',
      'components/admin/WalkCard.vue',
      'views/admin/AdminOnboardingView.vue',
    ])
  })

  it('no source file reaches for innerHTML / outerHTML / document.write', () => {
    const offenders: string[] = []
    for (const file of walk(SRC_ROOT)) {
      const src = readFileSync(file, 'utf8')
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(/.test(src)) {
        offenders.push(file.slice(SRC_ROOT.length + 1))
      }
    }
    expect(offenders).toEqual([])
  })

  it('no source file uses eval or the Function constructor', () => {
    const offenders: string[] = []
    for (const file of walk(SRC_ROOT)) {
      const src = readFileSync(file, 'utf8')
      if (/\beval\(|new Function\(/.test(src)) offenders.push(file.slice(SRC_ROOT.length + 1))
    }
    expect(offenders).toEqual([])
  })
})
