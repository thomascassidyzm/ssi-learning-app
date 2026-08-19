/**
 * The acceptance test for reading the How-This-Works copy live.
 *
 * The document in fixtures/ is the frozen original that was seeded into Popty's
 * store as this doc's starting point, byte for byte. So the bar is exact: feed
 * the parser that document and every learner-facing string the app ships today
 * must come back out of it identically. Anything that does not round-trip is a
 * string an editor cannot actually edit, and the test says so out loud rather
 * than being relaxed.
 */
import { describe, it, expect } from 'vitest'
import {
  HOW_THIS_WORKS_LEARNER,
  WHY_THIS_WORKS,
  type ExplainerSection,
} from './learnerExplainers'
import { parseHtwCopy, applyParsedSection, buildSectionsFromMarkdown } from './parseHtwCopy'
import ORIGINAL from './fixtures/htw-copy-original.md?raw'

const parsed = parseHtwCopy(ORIGINAL)

describe('parseHtwCopy — the document rebuilds the shipped copy', () => {
  it('finds exactly the two sections the app models, and nothing else', () => {
    expect(Object.keys(parsed).sort()).toEqual(['how-this-works', 'why-this-works'])
  })

  const cases: Array<[ExplainerSection, ExplainerSection['id']]> = [
    [HOW_THIS_WORKS_LEARNER, 'how-this-works'],
    [WHY_THIS_WORKS, 'why-this-works'],
  ]

  for (const [section, id] of cases) {
    describe(id, () => {
      const found = parsed[id]!

      it('recovers the link label', () => {
        expect(found.linkLabel).toBe(section.linkLabel)
      })

      it('recovers the intro line', () => {
        expect(found.intro).toBe(section.intro)
      })

      it('carries a heading for every block the app ships', () => {
        const headings = found.blocks.map((b) => b.heading)
        for (const block of section.blocks) expect(headings).toContain(block.heading)
      })

      for (const block of section.blocks) {
        describe(block.heading, () => {
          const doc = () => found.blocks.find((b) => b.heading === block.heading)!

          it('recovers every body paragraph, in order', () => {
            expect(doc().body).toEqual(block.body)
          })

          it('recovers every point, in order', () => {
            expect(doc().points).toEqual(block.points ?? [])
          })

          it('recovers every link label, in order', () => {
            expect(doc().linkLabels).toEqual((block.links ?? []).map((l) => l.label))
          })
        })
      }
    })
  }

  it('drops the editorial asides — no SETTLED note or drawing description reaches a learner', () => {
    const prose = Object.values(parsed)
      .flatMap((s) => s.blocks)
      .flatMap((b) => [b.heading, ...b.body, ...b.points, ...b.linkLabels])
      .join('\n')
    expect(prose).not.toMatch(/SETTLED/)
    expect(prose).not.toMatch(/A drawing sits here/)
    expect(prose).not.toMatch(/Section link label/)
  })

  it('ignores the sections the app does not model', () => {
    const prose = Object.values(parsed)
      .flatMap((s) => s.blocks)
      .map((b) => b.heading)
      .join('\n')
    expect(prose).not.toMatch(/Library entry screen/)
    expect(prose).not.toMatch(/What's missing/)
  })
})

describe('buildSectionsFromMarkdown — the whole document round-trips to the shipped objects', () => {
  const base = { howThisWorks: HOW_THIS_WORKS_LEARNER, whyThisWorks: WHY_THIS_WORKS }

  it('rebuilds How this works exactly as shipped', () => {
    expect(buildSectionsFromMarkdown(ORIGINAL, base).howThisWorks).toEqual(HOW_THIS_WORKS_LEARNER)
  })

  it('rebuilds Why this works exactly as shipped', () => {
    expect(buildSectionsFromMarkdown(ORIGINAL, base).whyThisWorks).toEqual(WHY_THIS_WORKS)
  })

  it('never invents a block: the player-screen heading is not one', () => {
    const headings = buildSectionsFromMarkdown(ORIGINAL, base).howThisWorks.blocks.map((b) => b.heading)
    expect(headings).toEqual(HOW_THIS_WORKS_LEARNER.blocks.map((b) => b.heading))
  })
})

describe('applyParsedSection — the hardcoded copy is always the floor', () => {
  const base = HOW_THIS_WORKS_LEARNER

  it('returns the hardcoded section untouched when there is nothing parsed', () => {
    expect(applyParsedSection(base, undefined)).toBe(base)
  })

  it('returns the hardcoded section untouched when the document is empty', () => {
    expect(applyParsedSection(base, parseHtwCopy('')['how-this-works'])).toEqual(base)
  })

  it('keeps a block whose heading the document no longer carries', () => {
    const edited = ORIGINAL.replace('### Part 2d — Changing course', '### Something else entirely')
    const out = applyParsedSection(base, parseHtwCopy(edited)['how-this-works'])
    const changing = out.blocks.find((b) => b.heading === 'Changing course')!
    expect(changing).toEqual(base.blocks.find((b) => b.heading === 'Changing course'))
  })

  it('takes edited prose but never the figure or the link urls', () => {
    const edited = ORIGINAL
      .replace(
        'A go is one of those gaps where you opened your mouth and had a crack at it.',
        'A go is any time you had a crack at it.',
      )
      .replace(
        '| Ten days of Japanese | saysomethingin.com/intensive-japanuary |',
        '| Ten days of Japanese, start to finish | saysomethingin.com/example |',
      )
    const parsedEdit = parseHtwCopy(edited)
    const how = applyParsedSection(base, parsedEdit['how-this-works'])
    const why = applyParsedSection(WHY_THIS_WORKS, parsedEdit['why-this-works'])

    const go = how.blocks.find((b) => b.heading === 'What a go is')!
    expect(go.body[0]).toBe('A go is any time you had a crack at it.')
    expect(go.figure).toBe('three-gaps')

    const proof = why.blocks.find((b) => b.heading === 'Where all this comes from')!
    expect(proof.links![2].label).toBe('Ten days of Japanese, start to finish')
    expect(proof.links!.map((l) => l.url)).toEqual(WHY_THIS_WORKS.blocks.at(-1)!.links!.map((l) => l.url))
    expect(proof.links!.map((l) => l.title)).toEqual(WHY_THIS_WORKS.blocks.at(-1)!.links!.map((l) => l.title))
  })

  it('drops link edits wholesale rather than mismatching them against the code rows', () => {
    const edited = ORIGINAL.replace(
      '| Ten days of Japanese | saysomethingin.com/intensive-japanuary |\n',
      '',
    )
    const why = applyParsedSection(WHY_THIS_WORKS, parseHtwCopy(edited)['why-this-works'])
    const proof = why.blocks.find((b) => b.heading === 'Where all this comes from')!
    expect(proof.links).toEqual(WHY_THIS_WORKS.blocks.at(-1)!.links)
  })
})
