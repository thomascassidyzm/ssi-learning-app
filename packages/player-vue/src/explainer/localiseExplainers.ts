/**
 * localiseExplainers — puts the two learner-side explainer sections through the
 * locale system.
 *
 * WHY: on 2026-09-04 the whole of "How this works" and "Why this works" was
 * English for every learner in the app, in all 22 interface languages. Not one
 * string was a missing translation — the prose lives in a TypeScript module the
 * locale system had never been pointed at, so no translation could reach it.
 * A Hindi speaker learning English read Hindi chrome down the profile and then
 * hit six blocks of English the moment they tapped "How this works".
 *
 * THE SHAPE. learnerExplainers.ts stays exactly what it was — the English
 * floor, and the single authored source of the prose, figures and link urls.
 * eng.json carries a mirror of its STRINGS under `explainer.*`, generated from
 * it, and a test asserts the two are identical so they cannot drift. This
 * module walks a section positionally and swaps each string for its t() value,
 * which is the translation where one exists and the English original where one
 * does not — so a locale mid-translation degrades string by string rather than
 * section by section.
 *
 * Keys are POSITIONAL — `explainer.howThisWorks.blocks.2.body.0`. That is what
 * lets the mirror be generated rather than hand-maintained; the drift test is
 * what makes a reordered block a red CI run instead of a wrong sentence.
 *
 * Figures, link urls and link titles are NOT localised: they are code, not
 * copy, and the pages the links open are English pages.
 */
import { t } from '@/composables/useI18n'
import type { ExplainerSection } from './learnerExplainers'

const SECTION_KEY: Record<ExplainerSection['id'], string> = {
  'how-this-works': 'howThisWorks',
  'why-this-works': 'whyThisWorks',
}

/**
 * The same section with every learner-facing string taken from the locale.
 * Pure — call it inside a computed so it re-runs when the locale lands.
 */
export function localiseSection(section: ExplainerSection): ExplainerSection {
  const root = `explainer.${SECTION_KEY[section.id]}`
  return {
    ...section,
    linkLabel: t(`${root}.linkLabel`, section.linkLabel),
    intro: t(`${root}.intro`, section.intro),
    blocks: section.blocks.map((block, i) => ({
      ...block,
      heading: t(`${root}.blocks.${i}.heading`, block.heading),
      body: block.body.map((line, j) => t(`${root}.blocks.${i}.body.${j}`, line)),
      ...(block.points
        ? { points: block.points.map((p, j) => t(`${root}.blocks.${i}.points.${j}`, p)) }
        : {}),
      ...(block.links
        ? {
            links: block.links.map((link, j) => ({
              ...link,
              label: t(`${root}.blocks.${i}.links.${j}`, link.label),
            })),
          }
        : {}),
    })),
  }
}
