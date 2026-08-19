import { describe, it, expect } from 'vitest'
import { canFrame } from '../composables/useInAppBrowser'
import {
  HOW_THIS_WORKS_LEARNER,
  WHY_THIS_WORKS,
  type ExplainerSection,
} from './learnerExplainers'

/**
 * The founder's 2026-08-03 rulings as acceptance tests. Every string a learner
 * can read is pulled out and checked against them, so a future edit that drifts
 * back towards streaks, points or internal jargon fails the build.
 */
const SECTIONS: ExplainerSection[] = [HOW_THIS_WORKS_LEARNER, WHY_THIS_WORKS]

function learnerFacingStrings(section: ExplainerSection): string[] {
  return [
    section.linkLabel,
    section.intro,
    ...section.blocks.flatMap((b) => [
      b.heading,
      ...b.body,
      ...(b.points ?? []),
      // Link labels are learner-facing copy too, so they face the same laws.
      ...(b.links ?? []).map((l) => l.label),
    ]),
  ]
}

const ALL_COPY = SECTIONS.flatMap(learnerFacingStrings)
const ALL_TEXT = ALL_COPY.join('\n')

describe('learner explainer copy — the hard laws', () => {
  it('never counts days, never mentions absence, never induces guilt', () => {
    const guilt = [
      /days? since/i,
      /\bmissed\b/i,
      /\byou (?:have not|haven't|didn't|did not)\b/i,
      /back on track/i,
      /catch up/i,
      /keep (?:it|your) (?:up|streak)/i,
      /don'?t break/i,
      /you'?re behind/i,
      /\bfell? behind\b/i,
      /\bshould have\b/i,
    ]
    for (const re of guilt) expect(ALL_TEXT, `guilt language: ${re}`).not.toMatch(re)
  })

  it('offers no incentive points, no score, no XP, no leaderboard', () => {
    // The words appear only inside the sentences that explicitly deny them, so
    // check the denials are intact rather than banning the words outright.
    expect(WHY_THIS_WORKS.blocks.map((b) => b.body.join(' ')).join(' '))
      .toMatch(/no points, no score and no leaderboard/i)
    expect(ALL_TEXT).not.toMatch(/\bXP\b/)
    expect(ALL_TEXT).not.toMatch(/earn (?:points|a badge|badges)/i)
    // Every mention of a leaderboard is a denial of one.
    for (const m of ALL_TEXT.matchAll(/.{0,12}leaderboard/gi)) expect(m[0]).toMatch(/\bno\b/i)
  })

  it('explains the absence of streaks without ever offering one', () => {
    const streakBlock = WHY_THIS_WORKS.blocks.find((b) => /streaks/i.test(b.heading))
    expect(streakBlock).toBeDefined()
    expect(streakBlock!.body.join(' ')).toMatch(/we do not count days in a row, and we never will/i)
    // Nothing anywhere promises, awards or tracks one.
    expect(ALL_TEXT).not.toMatch(/(?:your|a) streak (?:is now|of \d)/i)
    expect(ALL_TEXT).not.toMatch(/\bday streak\b/i)
  })

  it('keeps every internal term behind the language wall', () => {
    const jargon = [
      /\bLEGOs?\b/,
      /\bVAD\b/,
      /\bprosody\b/i,
      /\badherence\b/i,
      /\bseeds?\b/i,
      /\bPODs?\b/,
      /\blatency\b/i,
      /\bspaced repetition\b/i,
      /\bcycle\b/i,
      /\bmanifest\b/i,
      /\bscript\b/i,
    ]
    for (const re of jargon) expect(ALL_TEXT, `jargon leaked: ${re}`).not.toMatch(re)
  })

  it('is British English and never annotates with parentheses', () => {
    expect(ALL_TEXT).not.toMatch(/[()]/)
    const americanisms = [/\bcolor\b/i, /\brealize\b/i, /\bpracticing\b/i, /\bfavorite\b/i, /\btoward\b/i, /\bmemoriz/i]
    for (const re of americanisms) expect(ALL_TEXT, `americanism: ${re}`).not.toMatch(re)
  })
})

describe('learner explainer copy — where the thirty-hour promise lives', () => {
  it('appears in Why this works and nowhere else', () => {
    expect(learnerFacingStrings(WHY_THIS_WORKS).join('\n')).toMatch(/thirty hours/i)
    expect(learnerFacingStrings(HOW_THIS_WORKS_LEARNER).join('\n')).not.toMatch(/thirty|30 hours/i)
  })

  it('is not a headline — it sits inside the methodology, never in the link or intro', () => {
    expect(WHY_THIS_WORKS.linkLabel).not.toMatch(/thirty|30/i)
    expect(WHY_THIS_WORKS.intro).not.toMatch(/thirty|30/i)
  })

  it('makes the three checkable claims the founder specified', () => {
    const block = WHY_THIS_WORKS.blocks.find((b) => /thirty hours/i.test(b.heading))
    expect(block?.points).toHaveLength(3)
    expect(block!.points!.join(' ')).toMatch(/conversations/i)
    expect(block!.points!.join(' ')).toMatch(/listening/i)
    expect(block!.points!.join(' ')).toMatch(/impossible before/i)
  })

  it('names the cadence choice, including that tiny-daily is the hardest road', () => {
    const text = learnerFacingStrings(WHY_THIS_WORKS).join(' ')
    expect(text).toMatch(/an hour a day for a month/i)
    expect(text).toMatch(/six hours a day for five days/i)
    expect(text).toMatch(/five minutes a day/i)
  })

  it('carries the mode phasing: speaking first, deep listening later', () => {
    const text = learnerFacingStrings(WHY_THIS_WORKS).join(' ')
    expect(text).toMatch(/mostly speaking/i)
    expect(text).toMatch(/listening deep dives/i)
  })

  it('cites the action research since 2009', () => {
    expect(learnerFacingStrings(WHY_THIS_WORKS).join(' ')).toMatch(/action research since 2009/i)
  })
})

describe('learner explainer copy — How this works covers using the app', () => {
  it('explains play, a go, a session, the modes and switching course', () => {
    const headings = HOW_THIS_WORKS_LEARNER.blocks.map((b) => b.heading).join(' | ')
    expect(headings).toMatch(/pressing play/i)
    expect(headings).toMatch(/a go/i)
    expect(headings).toMatch(/session/i)
    expect(headings).toMatch(/changing course/i)
    const text = learnerFacingStrings(HOW_THIS_WORKS_LEARNER).join(' ')
    expect(text).toMatch(/listening is audio only/i)
    // Turbo retired 2026-08-06 — the copy names the two modes that replaced it.
    expect(text).toMatch(/\beasy\b/i)
    expect(text).toMatch(/\bfast\b/i)
    expect(text).not.toMatch(/turbo/i)
    expect(text).toMatch(/offline/i)
    expect(text).toMatch(/library/i)
  })

  it('defines a go as having a crack at it, not as getting it right', () => {
    const go = HOW_THIS_WORKS_LEARNER.blocks.find((b) => /a go/i.test(b.heading))
    expect(go!.body.join(' ')).toMatch(/getting it wrong is still a go/i)
  })
})

/**
 * The proof rows in "Where all this comes from". That block asserts evidence,
 * so every row has to actually go somewhere — and go there *inside* the app,
 * because a standalone-PWA learner sent to Safari mid-session loses their place.
 *
 * canFrame() is imported rather than the host list being repeated here: if a
 * host ever drops off the in-app browser's allowlist, this test fails and the
 * rows get revisited, instead of two copies of the list drifting apart.
 */
describe('explainer proof links', () => {
  const ALL_LINKS = SECTIONS.flatMap((s) => s.blocks.flatMap((b) => b.links ?? []))

  it('ships the named proof rows on "Where all this comes from"', () => {
    const block = WHY_THIS_WORKS.blocks.find((b) => /where all this comes from/i.test(b.heading))
    expect(block).toBeDefined()
    expect(block!.links?.length).toBeGreaterThanOrEqual(4)
    // The Croatian row leads: the paragraph above it already names Croatian,
    // so the first link reads as the receipt for the sentence just read.
    expect(block!.links![0].url).toContain('intensive-croatia')
  })

  it('gives every row a real, non-empty destination and label', () => {
    expect(ALL_LINKS.length).toBeGreaterThan(0)
    for (const link of ALL_LINKS) {
      expect(link.url.trim()).not.toBe('')
      expect(link.label.trim()).not.toBe('')
      expect(link.title.trim()).not.toBe('')
    }
  })

  it('only links to https pages the in-app browser will actually frame', () => {
    for (const link of ALL_LINKS) {
      expect(link.url.startsWith('https://')).toBe(true)
      expect(canFrame(link.url), `${link.label} -> ${link.url}`).toBe(true)
    }
  })

  it('never names a broadcaster it would have to keep in sync', () => {
    const labels = ALL_LINKS.map((l) => l.label).join(' ')
    expect(labels).not.toMatch(/RTÉ|RTE|BBC|S4C|Liveline|Raidió/i)
  })

  it('points every row at a distinct page', () => {
    const urls = ALL_LINKS.map((l) => l.url)
    expect(new Set(urls).size).toBe(urls.length)
  })
})
