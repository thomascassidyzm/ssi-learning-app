/**
 * Re-export shim — generateScript moved to `@ssi/core` as part of the
 * bundle-cutover Phase 1 promotion (archive/docs-retired-2026-08-24/bundle-cutover-design.md §3, §5
 * step 1). Kept here so existing `from './generateScript'` /
 * `from '../script/generateScript'` imports don't churn. New code should
 * import from `@ssi/core`.
 */
export { generateScript, GENERATOR_VERSION } from '@ssi/core'
