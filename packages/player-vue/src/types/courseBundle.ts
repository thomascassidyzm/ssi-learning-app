/**
 * Re-export shim — CourseBundle wire-format types moved to `@ssi/core` as
 * part of the bundle-cutover Phase 1 promotion
 * (docs/bundle-cutover-design.md §3, §5 step 1). Kept here so existing
 * `from '../types/courseBundle'` / `from './courseBundle'` imports don't
 * churn (including `api/courses/[code]/bundle.ts`'s relative import into
 * this file). New code should import from `@ssi/core`.
 */
export type {
  AudioLifecycle,
  BundleAudioRef,
  BundleLego,
  BundlePhraseRole as PhraseRole,
  BundlePhrase,
  BundleSeed,
  BundleRoundMapEntry,
  BundlePodSentence,
  BundlePod,
  BundleScriptShape,
  CourseBundle,
} from '@ssi/core'
export { phrasesByLego, phrasesByLegoAndRole, legosById, seedsBySeedId } from '@ssi/core'
