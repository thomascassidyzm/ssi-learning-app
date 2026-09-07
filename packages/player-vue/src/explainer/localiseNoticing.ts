/**
 * localiseNoticing — puts the noticing invitations through the locale system.
 *
 * WHY: pack.json is compiled English, and nothing between it and the school
 * admin's dashboard had ever met t(). A head of school reading the app in
 * Welsh saw a Welsh page with two English cards on it — "None of the 1 classes
 * below have practised together this week" and "No teachers here yet — want a
 * 30-second tour of bringing the first one in?".
 *
 * This is the same shape as walkthrough/localiseWalk.ts, deliberately: the
 * pack stays the source of truth, the mirror in eng.json is generated from it,
 * and a drift test compares the two string for string.
 *
 * The substitution happens on the RULE, before evaluateRules interpolates it,
 * so {name} and {classPractice.classCount} are still filled from live data —
 * a translator moves the placeholder inside the sentence and it keeps working.
 */
import { t } from '@/composables/useI18n'
import type { NoticingRule } from './evaluateRules'

/** The same rule with its two learner-visible strings taken from the locale. */
export function localiseNoticingRule(rule: NoticingRule): NoticingRule {
  const root = `noticing.${rule.id}`
  return {
    ...rule,
    invitation: t(`${root}.invitation`, rule.invitation),
    cta: { ...rule.cta, label: t(`${root}.ctaLabel`, rule.cta.label) },
  }
}

export const localiseNoticingRules = (rules: NoticingRule[]): NoticingRule[] =>
  rules.map(localiseNoticingRule)
