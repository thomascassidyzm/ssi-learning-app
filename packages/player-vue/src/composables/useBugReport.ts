/**
 * useBugReport — the learner's side of the postbox.
 *
 * ONE WAY (Tom, 2026-09-12): a learner sends a report; the only reply is the
 * automatic thank-you on their screen. This composable assembles the client
 * half of the envelope — what the learner cannot tell us — and posts it to
 * /api/report/bug, which resolves identity from the bearer and pulls the last
 * five minutes of player_events itself.
 *
 * POSITION IS THE LEGO, never a seed number (Tom, 2026-07-06): the cursor is
 * the shared belt-progress instance's lastLegoId, rendered as that lego's own
 * known and target text plus the belt name. Looked up best-effort from
 * course_legos, the same table Settings' furthest-point readout reads.
 */
import { inject, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { getSharedBeltProgress, BELTS } from './useBeltProgress'
import { flushAllPlayerLogs, pendingPlayerEvents } from './usePlayerLog'
import { platform } from '@/platform/capabilities'
import { apiUrl } from '@/platform/apiBase'

export interface BugReportPosition {
  lego_id?: string
  known_text?: string
  target_text?: string
  belt?: string
}

export interface BugReportEnvelope {
  course_code: string | null
  position: BugReportPosition | null
  device: {
    user_agent: string
    platform: string
    viewport: string
    online: boolean
    standalone: boolean
  }
  app_version: string
  app_shell: string
  route: string
}

declare const __BUILD_NUMBER__: string | undefined
declare const __BUILD_BRANCH__: string | null | undefined

/** `__BUILD_NUMBER__` plus `__BUILD_BRANCH__`, the pair scanBuildIdentity guards. */
export function buildStamp(): string {
  const sha = typeof __BUILD_NUMBER__ !== 'undefined' ? String(__BUILD_NUMBER__) : 'dev'
  const branch = typeof __BUILD_BRANCH__ !== 'undefined' && __BUILD_BRANCH__ ? String(__BUILD_BRANCH__) : null
  return branch ? `${sha} ${branch}` : sha
}

export function deviceSnapshot(): BugReportEnvelope['device'] {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const standalone =
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    Boolean((nav as unknown as { standalone?: boolean } | null)?.standalone)
  return {
    user_agent: nav?.userAgent ?? '',
    platform: nav?.platform ?? '',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    online: nav?.onLine ?? true,
    standalone,
  }
}

export function useBugReport() {
  const supabase = inject<Ref<any> | null>('supabase', null)
  const activeCourse = inject<Ref<{ course_code?: string } | null> | null>('activeCourse', null)
  const router = useRouter()

  async function getToken(): Promise<string | null> {
    const sb = supabase?.value
    if (!sb) return null
    try {
      const { data: { session } } = await sb.auth.getSession()
      return session?.access_token ?? null
    } catch {
      return null
    }
  }

  function courseCode(explicit?: string | null): string | null {
    return explicit || activeCourse?.value?.course_code || null
  }

  async function position(code: string | null): Promise<BugReportPosition | null> {
    const belt = getSharedBeltProgress()
    const legoId = belt?.lastLegoId?.value ?? belt?.highestLegoId?.value ?? null
    const beltName = belt ? BELTS[belt.highestBeltIndex.value]?.name : undefined
    if (!legoId) return beltName ? { belt: beltName } : null
    const out: BugReportPosition = { lego_id: legoId, ...(beltName ? { belt: beltName } : {}) }
    const sb = supabase?.value
    if (sb && code) {
      try {
        const { data } = await sb
          .from('course_legos')
          .select('target_text, target_text_roman, known_text')
          .eq('course_code', code)
          .eq('lego_id', legoId)
          .maybeSingle()
        if (data) {
          const target = data.target_text_roman || data.target_text
          if (target) out.target_text = target
          if (data.known_text) out.known_text = data.known_text
        }
      } catch { /* best effort */ }
    }
    return out
  }

  async function envelope(explicitCourse?: string | null): Promise<BugReportEnvelope> {
    const code = courseCode(explicitCourse)
    return {
      course_code: code,
      position: await position(code),
      device: deviceSnapshot(),
      app_version: buildStamp(),
      app_shell: platform().shell,
      route: router?.currentRoute?.value?.fullPath ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
    }
  }

  /** Send the report. Resolves true when the server accepted it. */
  async function submit(text: string, screenshotUrl: string | null, explicitCourse?: string | null): Promise<boolean> {
    const env = await envelope(explicitCourse)
    // Flush first so the server's own read of player_events sees what the
    // learner just did; whatever is still unflushed rides along as fallback.
    await flushAllPlayerLogs()
    const recent_events = pendingPlayerEvents().map((e) => ({
      event_type: e.event_type,
      occurred_at: e.occurred_at,
      payload: e.payload ?? null,
    }))
    const token = await getToken()
    try {
      const resp = await fetch(apiUrl('/api/report/bug'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text, screenshot_url: screenshotUrl, ...env, recent_events }),
      })
      return resp.ok
    } catch {
      return false
    }
  }

  return { submit, envelope, getToken, supabase }
}
