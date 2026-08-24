import { computed, type Ref } from 'vue'

/**
 * Class-aware session store — wraps the normal (RLS-bound, own-row)
 * SessionStore so that while playing AS A CLASS (owner ruling 2026-07-16:
 * a class is a first-class learner, own uuid, own `sessions` rows), the
 * practice-hours spine actually records class practice.
 *
 * Direct client writes to `sessions` with learner_id = the class's learner
 * id are rejected by RLS (`sessions_own_insert` requires
 * learner_id = current_learner_id(), which resolves to the STAFF's own row,
 * never the class's) — real play-as-class produced ZERO `sessions` rows for
 * the class identity (docs/the-view/play-as-class-REPORT.md §1.2). Class
 * mode routes through the server-mediated /api/school/class-progress
 * endpoint instead, which resolves the class's learner id server-side —
 * same pattern as useClassProgressStore.ts.
 *
 * Covers only the SessionStore methods useLearningSession actually calls:
 * startSession, checkpointSession, endSession. saveMetrics is a no-op in
 * class mode (response_metrics is per-individual-learner data; the metrics
 * arrays useLearningSession passes are empty today regardless).
 */

interface MinimalSessionStore {
  startSession: (learnerId: string, courseId: string) => Promise<{ id: string; [key: string]: unknown }>
  checkpointSession: (sessionId: string, itemsPracticed: number, durationSeconds: number) => Promise<void>
  endSession: (sessionId: string, metrics: { items_practiced: number; started_at: Date; ended_at?: Date | null; [key: string]: unknown }, playSeconds: number) => Promise<unknown>
  saveMetrics: (sessionId: string, metrics: unknown[]) => Promise<void>
}

export interface ClassContextForSession {
  id: string
}

type SupabaseSessionLike = { auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> } }

export function createClassAwareSessionStore(
  baseStore: Ref<MinimalSessionStore | null | undefined>,
  classContext: Ref<ClassContextForSession | null | undefined>,
  supabase: Ref<SupabaseSessionLike | null | undefined>,
): MinimalSessionStore {
  async function call(method: string, args: unknown[]): Promise<any> {
    const classId = classContext.value?.id
    if (!classId) throw new Error('createClassAwareSessionStore: no active class context')
    const { data: { session } } = (await supabase.value?.auth.getSession()) ?? { data: { session: null } }
    const token = session?.access_token
    if (!token) throw new Error('createClassAwareSessionStore: no auth session')

    const resp = await fetch('/api/school/class-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ classId, method, args }),
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error(data.error || `class-progress ${method} failed (${resp.status})`)
    }
    const { result } = await resp.json()
    return result
  }

  const inClass = () => !!classContext.value

  return {
    async startSession(learnerId, courseId) {
      if (!inClass()) return baseStore.value!.startSession(learnerId, courseId)
      return call('startSession', [])
    },
    async checkpointSession(sessionId, itemsPracticed, durationSeconds) {
      if (!inClass()) return baseStore.value?.checkpointSession(sessionId, itemsPracticed, durationSeconds)
      await call('checkpointSession', [sessionId, itemsPracticed, durationSeconds])
    },
    // playSeconds is accumulated PLAYBACK time, passed straight through — a
    // class session is measured the same way a solo one is (owner ruling
    // 2026-08-19). This used to compute ended_at - started_at here, so a
    // class left open on an interactive whiteboard over lunch billed the
    // whole lunch to the pupils' practice time.
    async endSession(sessionId, metrics, playSeconds) {
      if (!inClass()) return baseStore.value!.endSession(sessionId, metrics as any, playSeconds)
      return call('endSession', [sessionId, metrics.items_practiced, Math.max(0, Math.floor(playSeconds))])
    },
    async saveMetrics(sessionId, metrics) {
      // No-op in class mode — see file header.
      if (!inClass()) return baseStore.value?.saveMetrics(sessionId, metrics)
    },
  }
}

export function useClassAwareSessionStore(
  baseStore: Ref<MinimalSessionStore | null | undefined>,
  classContext: Ref<ClassContextForSession | null | undefined>,
  supabase: Ref<SupabaseSessionLike | null | undefined>,
) {
  return computed(() => createClassAwareSessionStore(baseStore, classContext, supabase))
}
