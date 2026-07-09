/**
 * Re-export shim — computePauseDuration moved to `@ssi/core` as part of the
 * bundle-cutover Phase 1 promotion (docs/bundle-cutover-design.md §3, §5
 * step 1). Kept here so existing `from '../playback/computePauseDuration'`
 * imports don't churn. New code should import from `@ssi/core`.
 */
export { computePauseDuration } from '@ssi/core'
export type { PauseModeConfig } from '@ssi/core'
