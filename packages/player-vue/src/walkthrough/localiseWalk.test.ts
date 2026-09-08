/**
 * The walkthrough mirror in eng.json must BE the prose in pack.json.
 *
 * pack.json is recompiled by tools/walkthrough whenever a walk is edited. If a
 * step's words change and the mirror does not, the learner reads the OLD
 * sentence translated — worse than the new one in English, because it is wrong
 * and looks deliberate. This is what makes that a red CI run.
 *
 * It also asserts the coverage: EVERY walk is mirrored. It used to be learner
 * walks only, because the teacher and leader surfaces were English by product
 * decision. That decision was reversed on 2026-09-07 — a teacher reading a
 * Welsh dashboard was still spoken to in English by the twelve staff walks —
 * so the split is gone and the assertion is now completeness.
 */
import { describe, it, expect } from 'vitest'
import pack from './pack.json'
import { localiseWalk } from './localiseWalk'
import type { Walk } from './useWalkthrough'
import eng from '@/locales/eng.json'

const MIRROR = (eng as Record<string, any>).walkthrough as Record<string, any>
const walks = (pack as { walks: Walk[] }).walks

describe('walkthrough locale mirror', () => {
  it('mirrors every walk, and nothing that is not a walk', () => {
    expect(Object.keys(MIRROR).sort()).toEqual(walks.map((w) => w.id).sort())
  })

  it.each(walks.map((w) => [w.id, w] as const))('%s is mirrored string-for-string', (_id, walk) => {
    const m = MIRROR[walk.id]
    expect(m.title).toBe(walk.title)
    expect(m.topic).toBe(walk.topic)
    expect(Object.keys(m.steps)).toHaveLength(walk.steps.length)
    walk.steps.forEach((step, i) => {
      expect(m.steps[String(i)].say).toBe(step.say)
      expect(m.steps[String(i)].terminal).toBe(step.terminal)
    })
  })

  it('localises to itself under English', () => {
    for (const walk of walks) expect(localiseWalk(walk)).toEqual(walk)
  })
})
