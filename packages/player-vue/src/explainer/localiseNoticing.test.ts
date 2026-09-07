/**
 * @vitest-environment node
 *
 * The noticing mirror in eng.json must BE the prose in pack.json.
 *
 * pack.json is recompiled whenever an invitation is reworded. If the words
 * change and the mirror does not, a Welsh-reading head of school gets the OLD
 * sentence translated — worse than the new one in English, because it is
 * wrong and looks deliberate. This makes that a red run.
 */
import { describe, it, expect } from 'vitest'
import pack from './pack.json'
import { localiseNoticingRule } from './localiseNoticing'
import type { NoticingRule } from './evaluateRules'
import eng from '@/locales/eng.json'

const MIRROR = (eng as Record<string, any>).noticing as Record<string, any>
const rules = (pack as { rules: NoticingRule[] }).rules

describe('noticing locale mirror', () => {
  it('mirrors every rule, and nothing that is not a rule', () => {
    expect(Object.keys(MIRROR).sort()).toEqual(rules.map((r) => r.id).sort())
  })

  it.each(rules.map((r) => [r.id, r] as const))('%s is mirrored string-for-string', (_id, rule) => {
    expect(MIRROR[rule.id].invitation).toBe(rule.invitation)
    expect(MIRROR[rule.id].ctaLabel).toBe(rule.cta.label)
  })

  it('localises to itself under English, placeholders intact', () => {
    for (const rule of rules) expect(localiseNoticingRule(rule)).toEqual(rule)
  })
})
