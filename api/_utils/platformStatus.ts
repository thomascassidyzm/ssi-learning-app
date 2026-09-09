/**
 * Re-export shim. The platform gate itself now lives in @ssi/core
 * (packages/core/src/platform/platformStatus.ts) because BOTH sides need it:
 * every api/ caller here, and the client's own dashboard gate in
 * packages/player-vue/src/composables/schools/useSchoolContext.ts. It used to
 * be a hand-kept mirror in each; one definition means the 24h grace can never
 * be 24h on the server and forever in the browser.
 *
 * Every existing `from './platformStatus'` import keeps working.
 */
export {
  isPlatformActive,
  isWithinTrialGrace,
  isUnstampedTrialLapsed,
  PLATFORM_TRIAL_GRACE_MS,
} from '../../packages/core/src/platform/platformStatus'
