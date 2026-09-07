/**
 * localiseWalk — puts the in-app walkthroughs through the locale system.
 *
 * WHY: pack.json is compiled English, and nothing between it and the overlay
 * had ever met t(). A learner with the interface in Hindi tapped a walk and got
 * three cards of English spoken over their own screen.
 *
 * WHAT IS LOCALISED. All eighteen walks, mirrored into eng.json under
 * `walkthrough.<id>.*` and read through t() here. It was six — the learner
 * ones — until 2026-09-07, when the teacher and leader surfaces were localised
 * and the twelve staff walks stopped being the odd English voice speaking over
 * a Welsh dashboard.
 *
 * pack.json stays the source. It is a BUILD ARTEFACT of tools/walkthrough, so
 * hand-editing it would be undone by the next compile; the mirror in eng.json
 * is generated from it and a drift test compares the two string for string.
 *
 * `keywords` are deliberately left English: they are search aliases, not copy,
 * and they sit alongside the localised title and topic in the same search text
 * rather than replacing them. A learner searching in their own language matches
 * the localised title; a learner searching in English still matches the alias.
 * Localised keyword lists are a real gap and are named as one in the report.
 */
import { t } from '@/composables/useI18n'
import type { Walk } from './useWalkthrough'

/** The same walk with its learner-facing strings taken from the locale. */
export function localiseWalk(walk: Walk): Walk {
  const root = `walkthrough.${walk.id}`
  return {
    ...walk,
    title: t(`${root}.title`, walk.title),
    ...(walk.topic ? { topic: t(`${root}.topic`, walk.topic) } : {}),
    steps: walk.steps.map((step, i) => ({
      ...step,
      say: t(`${root}.steps.${i}.say`, step.say),
      ...(step.terminal ? { terminal: t(`${root}.steps.${i}.terminal`, step.terminal) } : {}),
    })),
  }
}
