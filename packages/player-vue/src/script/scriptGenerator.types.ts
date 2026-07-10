/**
 * Re-export shim — scriptGenerator types moved to `@ssi/core` as part of the
 * bundle-cutover Phase 1 promotion (docs/bundle-cutover-design.md §3, §5
 * step 1). Kept here so existing `from './scriptGenerator.types'` /
 * `from '../script/scriptGenerator.types'` imports don't churn. New code
 * should import from `@ssi/core`.
 */
export type {
  ScriptMode,
  MainPosition,
  InfPlayPosition,
  ScriptPosition,
  GenerateScriptOptions,
  GenerateScriptResult,
  GenerateScript,
} from '@ssi/core'
