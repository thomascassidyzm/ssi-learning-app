/**
 * SECURITY AUDIT 2026-08-25 — Area B (client), JOB 1 prime suspect.
 *
 * usePublishedExplainers.ts + parseHtwCopy.ts (both NEW since the 2026-08-11
 * client-config audit) fetch learner-facing "How this works" / "Why this
 * works" copy from an external CMS (Popty, a separate service/repo) and
 * render it in the app. This is the highest-value XSS question raised by the
 * brief: does any part of that remote document reach a v-html / innerHTML /
 * markdown-render sink?
 *
 * FINDING: no. `buildSectionsFromMarkdown` → `applyParsedSection` only ever
 * copies plain strings (`body`, `points`, `intro`, `linkLabel`) out of the
 * parsed document onto the hardcoded ExplainerSection shape, and both real
 * consumers (HowThisWorksLearner.vue, WhyThisWorks.vue) render every one of
 * those fields with Vue text interpolation (`{{ }}`), which HTML-escapes.
 * Figure names and link urls/titles are a closed, code-only union — the
 * document can only ever relabel a link the code already trusts, never point
 * one somewhere else. This suite locks that shape as a regression guard: if
 * a future change makes any document-sourced field flow into `v-html`,
 * `innerHTML`, or a link's `url`/`title` (as opposed to its `label`), these
 * tests catch it before a Popty compromise or editor mistake becomes a
 * learner-facing script injection.
 *
 * GAP (documented, not fixed here): this repo cannot verify who can publish
 * to Popty's `doc=htw` endpoint or whether Popty itself sanitises input —
 * that authz lives in ssi-dashboard-v7-clean, a separate repo, out of scope
 * for this audit. The fetch is `credentials: 'omit'`, so a compromised Popty
 * can only serve misleading TEXT to this app, never steal a learner's
 * session — but "misleading text on a trusted page" is still a real editorial
 * risk if Popty's own publish path is weaker than assumed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildSectionsFromMarkdown,
  applyParsedSection,
  parseHtwCopy,
} from '../explainer/parseHtwCopy'
import { HOW_THIS_WORKS_LEARNER, WHY_THIS_WORKS } from '../explainer/learnerExplainers'

const SRC_DIR = resolve(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(resolve(SRC_DIR, relPath), 'utf8')
}

describe('parseHtwCopy — malicious document content never escapes plain-text fields', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>'
  const SCRIPT_PAYLOAD = '<script>alert(document.cookie)</script>'
  const EVIL_URL = 'javascript:alert(1)'

  const maliciousDoc = [
    '## How this works',
    '',
    '*(Section link label: "How this works")*',
    '',
    '**Intro line, shown at the top of the panel:**',
    `> ${PAYLOAD}`,
    '',
    `### What a go is`,
    '',
    `${SCRIPT_PAYLOAD} this is a paragraph.`,
    '',
    `- ${PAYLOAD} a bullet point`,
    '',
  ].join('\n')

  it('carries the raw payload through as an ordinary string (no HTML is stripped, escaping is the renderer\'s job)', () => {
    const parsed = parseHtwCopy(maliciousDoc)
    const section = parsed['how-this-works']
    expect(section).toBeDefined()
    // The parser is honest about what it read — it does not try to sanitise,
    // because sanitising here would be a second, divergent implementation of
    // what Vue's text interpolation already does correctly at render time.
    expect(section!.intro).toBe(PAYLOAD)
    expect(section!.blocks[0].body.join(' ')).toContain(SCRIPT_PAYLOAD)
    expect(section!.blocks[0].points[0]).toContain(PAYLOAD)
  })

  it('merges the payload into the ExplainerSection as plain data — never wrapped in a trusted/html marker', () => {
    const merged = buildSectionsFromMarkdown(maliciousDoc, {
      howThisWorks: HOW_THIS_WORKS_LEARNER,
      whyThisWorks: WHY_THIS_WORKS,
    })
    const block = merged.howThisWorks.blocks.find((b) => b.heading === 'What a go is')
    expect(block).toBeDefined()
    expect(typeof merged.howThisWorks.intro).toBe('string')
    expect(merged.howThisWorks.intro).toBe(PAYLOAD)
    expect(block!.body.some((p) => p.includes(SCRIPT_PAYLOAD))).toBe(true)
  })

  it('link LABELS can be attacker text, but link URL and TITLE always come from the hardcoded base — never the document', () => {
    const linkDoc = [
      '## Why this works',
      '',
      `### Proof`,
      '',
      `${PAYLOAD}`,
      '',
      '| Label | url |',
      '|---|---|',
      `| ${PAYLOAD} | ${EVIL_URL} |`,
      '',
    ].join('\n')

    const parsed = parseHtwCopy(linkDoc)
    const block = parsed['why-this-works']?.blocks[0]
    expect(block).toBeDefined()
    // The parser DOES capture whatever the document's table says as a label —
    // that is by design (labels are learner-visible editable copy).
    expect(block!.linkLabels[0]).toBe(PAYLOAD)

    // But applyParsedSection only ever overwrites `label` on the code's own
    // `links` array — url/title are never touched, so a document cannot ever
    // introduce a javascript: URL or point a button somewhere new.
    const baseWithLink = {
      ...WHY_THIS_WORKS,
      blocks: WHY_THIS_WORKS.blocks.map((b, i) =>
        i === 0 ? { ...b, links: [{ label: 'old label', url: 'https://saysomethingin.com/x', title: 'old title' }] } : b,
      ),
    }
    const parsedSection = { blocks: [{ heading: baseWithLink.blocks[0].heading, body: [], points: [], linkLabels: [PAYLOAD] }] }
    const merged = applyParsedSection(baseWithLink, parsedSection)
    const mergedLink = merged.blocks[0].links![0]
    expect(mergedLink.label).toBe(PAYLOAD) // label IS overwritten — expected
    expect(mergedLink.url).toBe('https://saysomethingin.com/x') // url is NOT
    expect(mergedLink.title).toBe('old title') // title is NOT
  })

  it('figure names are a closed compile-time union — the document cannot select an arbitrary figure', () => {
    // parseHtwCopy has no code path that ever assigns anything to `figure`;
    // grep-level lock so a future change adding one is forced through this
    // file, not silently.
    const src = read('explainer/parseHtwCopy.ts')
    expect(src).not.toMatch(/\.figure\s*=/)
    expect(src).not.toMatch(/figure:\s*(parsed|found|block)\./)
  })
})

describe('HowThisWorksLearner.vue / WhyThisWorks.vue — regression lock: no v-html sink for published copy', () => {
  it('HowThisWorksLearner renders every published field with text interpolation only', () => {
    const src = read('components/me/HowThisWorksLearner.vue')
    expect(src).not.toMatch(/v-html/)
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/)
    // The fields sourced from the parsed document must appear as {{ }} bindings.
    expect(src).toMatch(/\{\{\s*section\.intro\s*\}\}/)
    expect(src).toMatch(/\{\{\s*para\s*\}\}/)
    expect(src).toMatch(/\{\{\s*point\s*\}\}/)
  })

  it('WhyThisWorks renders every published field, including link labels, with text interpolation only', () => {
    const src = read('components/me/WhyThisWorks.vue')
    expect(src).not.toMatch(/v-html/)
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/)
    expect(src).toMatch(/\{\{\s*section\.intro\s*\}\}/)
    expect(src).toMatch(/\{\{\s*para\s*\}\}/)
    expect(src).toMatch(/\{\{\s*point\s*\}\}/)
    expect(src).toMatch(/\{\{\s*link\.label\s*\}\}/)
    // The link's url must only ever drive a JS call (openInApp), never an
    // href/src attribute binding that a browser would navigate directly —
    // that is what makes canFrame()'s allowlist (useInAppBrowser.ts) the
    // single gate a malicious url would have to pass.
    expect(src).toMatch(/@click="openInApp\(link\.url, link\.title\)"/)
    expect(src).not.toMatch(/:href="link\.url"/)
  })
})

describe('usePublishedExplainers.ts — the fetch itself carries no credentials and fails closed', () => {
  it('omits credentials on the cross-origin fetch to Popty', () => {
    const src = read('explainer/usePublishedExplainers.ts')
    expect(src).toMatch(/credentials:\s*'omit'/)
  })

  it('never renders a loading or partial state — hardcoded prose is the only thing on screen until a full parse succeeds', () => {
    const src = read('explainer/usePublishedExplainers.ts')
    // A short-circuit on any falsy/invalid content, before ever assigning `published`.
    expect(src).toMatch(/if \(!doc \|\| typeof doc\.content !== 'string' \|\| !doc\.content\.trim\(\)\) return/)
  })
})
