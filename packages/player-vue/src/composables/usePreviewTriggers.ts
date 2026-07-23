import { computed } from 'vue'

/**
 * Dev/staging/prod host classifier — the same production hostname check
 * LearningPlayer's envLabel used to compute inline. Shared here so the
 * in-app preview-trigger buttons (TesterFeedback panel) gate on exactly
 * the same dev/staging-only rule as the query-param cheats they trigger,
 * instead of drifting from a second copy of the hostname list.
 */
export const envLabel = computed<'DEV' | 'STAGING' | null>(() => {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname
  const isProduction = host === 'saysomethingin.app'
    || host === 'www.saysomethingin.app'
    || host === 'app.saysomethingin.com'
  if (isProduction) return null
  if (host.startsWith('staging.') || host.includes('-staging')) return 'STAGING'
  return 'DEV'
})

export type PreviewTriggerParam = 'l1' | 'pod' | 'podview'

/**
 * Arms a listening-layer preview cheat (?l1=1 / ?pod=1 / ?podview=1) by
 * setting its query param and reloading — the exact one-shot arm logic
 * LearningPlayer reads from window.location.search at boot (see
 * forceLayer1PreviewCheat / forcePodPreviewCheat / podPreviewMode there).
 * Shared entry point for both the URL-typed cheat and the in-app preview
 * buttons in TesterFeedback's panel — a reload re-runs the same parsing
 * code rather than duplicating the arm logic in a second, in-memory path.
 */
export function triggerPreviewCheat(param: PreviewTriggerParam) {
  if (typeof window === 'undefined' || !envLabel.value) return
  const url = new URL(window.location.href)
  url.searchParams.set(param, '1')
  window.location.href = url.toString()
}
