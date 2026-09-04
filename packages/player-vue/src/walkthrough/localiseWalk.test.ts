/**
 * The walkthrough mirror in eng.json must BE the prose in pack.json.
 *
 * pack.json is recompiled by tools/walkthrough whenever a walk is edited. If a
 * step's words change and the mirror does not, the learner reads the OLD
 * sentence translated — worse than the new one in English, because it is wrong
 * and looks deliberate. This is what makes that a red CI run.
 *
 * It also asserts the split: every learner walk is mirrored, and no staff walk
 * is — the staff surfaces are English by product decision, and a stray mirrored
 * key there would be translation budget spent on nobody.
 */
import { describe, it, expect } from 'vitest'
import pack from './pack.json'
import { localiseWalk } from './localiseWalk'
import type { Walk } from './useWalkthrough'
import eng from '@/locales/eng.json'

const MIRROR = (eng as Record<string, any>).walkthrough as Record<string, any>
const walks = (pack as { walks: Walk[] }).walks
const learnerWalks = walks.filter((w) => w.personas.includes('learner'))

describe('walkthrough locale mirror', () => {
  it('mirrors every learner walk and only learner walks', () => {
    expect(Object.keys(MIRROR).sort()).toEqual(learnerWalks.map((w) => w.id).sort())
  })

  it.each(learnerWalks.map((w) => [w.id, w] as const))('%s is mirrored string-for-string', (_id, walk) => {
    const m = MIRROR[walk.id]
    expect(m.title).toBe(walk.title)
    expect(m.topic).toBe(walk.topic)
    expect(Object.keys(m.steps)).toHaveLength(walk.steps.length)
    walk.steps.forEach((step, i) => {
      expect(m.steps[String(i)].say).toBe(step.say)
      expect(m.steps[String(i)].terminal).toBe(step.terminal)
    })
  })

  it('localises to itself under English, staff walks included', () => {
    for (const walk of walks) expect(localiseWalk(walk)).toEqual(walk)
  })
})
