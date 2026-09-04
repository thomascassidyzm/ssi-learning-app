/**
 * The mirror in eng.json must BE the prose in learnerExplainers.ts.
 *
 * Keys are positional, so a block inserted, removed or reordered in the module
 * without regenerating the mirror would silently show a learner the wrong
 * translated sentence under the right heading. This test is what turns that
 * into a red CI run: it walks both structures together and compares every
 * string, so the only way to move the prose is to move the mirror with it.
 */
import { describe, it, expect } from 'vitest'
import { HOW_THIS_WORKS_LEARNER, WHY_THIS_WORKS, type ExplainerSection } from './learnerExplainers'
import { localiseSection } from './localiseExplainers'
import eng from '@/locales/eng.json'

const MIRROR = (eng as Record<string, any>).explainer

const CASES: Array<[string, ExplainerSection]> = [
  ['howThisWorks', HOW_THIS_WORKS_LEARNER],
  ['whyThisWorks', WHY_THIS_WORKS],
]

describe('explainer locale mirror', () => {
  it.each(CASES)('%s is mirrored string-for-string in eng.json', (key, section) => {
    const m = MIRROR[key]
    expect(m).toBeDefined()
    expect(m.linkLabel).toBe(section.linkLabel)
    expect(m.intro).toBe(section.intro)
    // The mirror indexes by numeric STRING key rather than by array, because
    // the parity flattener treats an array as one leaf and would then police
    // the whole of "How this works" as a single key.
    const list = (o: unknown): unknown[] => Object.values(o as Record<string, unknown>)
    expect(list(m.blocks)).toHaveLength(section.blocks.length)
    section.blocks.forEach((block, i) => {
      const mb = m.blocks[String(i)]
      expect(mb.heading).toBe(block.heading)
      expect(list(mb.body)).toEqual(block.body)
      expect(mb.points ? list(mb.points) : undefined).toEqual(block.points)
      expect(mb.links ? list(mb.links) : undefined).toEqual(block.links?.map((l) => l.label))
    })
  })

  it.each(CASES)('%s localises to itself under English', (_key, section) => {
    expect(localiseSection(section)).toEqual(section)
  })
})
