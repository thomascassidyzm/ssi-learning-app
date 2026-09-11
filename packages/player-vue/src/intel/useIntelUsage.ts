/**
 * The surface records its OWN use — which question was opened, about whom.
 *
 * Why this exists: the design's fossil record was read from CODE, not from
 * USE. Admin pages emit no usage telemetry, so nobody knows which of the
 * seven old learner-progress views anyone actually opened, and the ten
 * questions were chosen on that unexamined premise. The room with no hand
 * named this as the detector for the whole design (2026-09-10): in a month
 * the premise is measured rather than assumed, and a question nobody opens
 * is a page that should not exist.
 *
 * It rides the existing player_events endpoint, which attributes the row
 * from the VERIFIED bearer, stamps env, device and country, and already
 * carries admin events in the same table (admin_signin_link_minted). One
 * event type, one payload shape, no new table:
 *
 *   event_type: intel_question_opened
 *   payload:    { question: <slug>, scope: 'everyone' | 'course', course? }
 *
 * The population resolver excludes staff, so these rows can never leak into
 * a learner number. Fire-and-forget: a failed record must never touch the
 * page.
 */
import { apiUrl } from '@/platform/apiBase'
import { useAdminClient } from '@/composables/useAdminClient'

export const INTEL_USAGE_EVENT = 'intel_question_opened'

export interface QuestionOpened {
  question: string
  course?: string | null
}

export function usageEvent(opened: QuestionOpened) {
  return {
    event_type: INTEL_USAGE_EVENT,
    course_code: opened.course ?? null,
    payload: {
      question: opened.question,
      scope: opened.course ? 'course' : 'everyone',
      ...(opened.course ? { course: opened.course } : {}),
    },
    occurred_at: new Date().toISOString(),
  }
}

export function useIntelUsage() {
  const { getAuthToken } = useAdminClient()

  async function recordOpened(opened: QuestionOpened): Promise<void> {
    try {
      const token = await getAuthToken()
      if (!token) return
      await fetch(apiUrl('/api/player-events'), {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ events: [usageEvent(opened)] }),
      })
    } catch {
      // Recording use is never allowed to cost the reader anything.
    }
  }

  return { recordOpened }
}
