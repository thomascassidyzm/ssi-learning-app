import { computed, type Ref } from 'vue'

/**
 * Class-aware progress store — wraps the normal (RLS-bound, own-row)
 * ProgressStore so that while playing AS A CLASS (owner ruling 2026-07-16:
 * a class is a first-class learner, own uuid, own course_enrollments row),
 * every write lands on the CLASS's learner id instead of the driving staff
 * member's own row.
 *
 * Direct client writes to another learner's course_enrollments/lego_progress
 * row are impossible under RLS (own-row only, via current_learner_id()) — so
 * class mode routes through the server-mediated /api/school/class-progress
 * endpoint instead, which authorizes the caller against the class and
 * resolves the class's learner id itself (the client never gets to say which
 * learner_id to write).
 *
 * Covers every ProgressStore method actually invoked during play —
 * LearningPlayer.vue's own direct calls (getEnrollment, setEnrollmentCursor,
 * setLivePosition, setMode, bumpInfplayRound, updateCurrentCycle) plus the
 * ones useLearningSession's recordCycleComplete/endSession call internally
 * (createEnrollment, getLegoProgressById, saveLegoProgress, updateLegoProgress,
 * updateEnrollmentActivity). A drop-in substitute, not a new interface —
 * outside class mode every call forwards straight to the base store.
 */

interface MinimalProgressStore {
  getEnrollment: (learnerId: string, courseId: string) => Promise<any>
  createEnrollment: (learnerId: string, courseId: string) => Promise<any>
  setEnrollmentCursor: (learnerId: string, courseId: string, legoId: string, roundIndex: number) => Promise<void>
  setLivePosition: (
    learnerId: string, courseId: string, legoId: string, roundIndex: number, cycleIndex: number,
    opts?: { touchPracticedAt?: boolean },
  ) => Promise<void>
  setMode: (
    learnerId: string, courseId: string, mode: 'main' | 'infplay',
    ratchetHighestTo?: { legoId: string; roundIndex: number },
  ) => Promise<void>
  bumpInfplayRound: (learnerId: string, courseId: string) => Promise<void>
  updateCurrentCycle: (learnerId: string, courseId: string, cycleIndex: number) => Promise<void>
  updateEnrollmentActivity: (learnerId: string, courseId: string, highestSeed: number, practiceMinutes: number) => Promise<void>
  getLegoProgressById: (learnerId: string, legoId: string, courseId: string) => Promise<any>
  saveLegoProgress: (progress: Record<string, unknown>) => Promise<any>
  updateLegoProgress: (id: string, updates: Record<string, unknown>) => Promise<void>
}

export interface ClassContextForProgress {
  id: string
}

type SupabaseSessionLike = { auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> } }

export function createClassAwareProgressStore(
  baseStore: Ref<MinimalProgressStore | null | undefined>,
  classContext: Ref<ClassContextForProgress | null | undefined>,
  supabase: Ref<SupabaseSessionLike | null | undefined>,
): MinimalProgressStore {
  async function call(method: string, args: unknown[]): Promise<any> {
    const classId = classContext.value?.id
    if (!classId) throw new Error('createClassAwareProgressStore: no active class context')
    const { data: { session } } = (await supabase.value?.auth.getSession()) ?? { data: { session: null } }
    const token = session?.access_token
    if (!token) throw new Error('createClassAwareProgressStore: no auth session')

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
    async getEnrollment(learnerId, courseId) {
      if (!inClass()) return baseStore.value?.getEnrollment(learnerId, courseId) ?? null
      const row = await call('getEnrollment', [])
      if (!row) return row
      // The class-progress endpoint returns raw JSON, so timestamps arrive as
      // ISO strings — but the base ProgressStore.getEnrollment hydrates them to
      // Date, and callers (the resume gap rule, daysSinceLastPractice) call
      // .getTime() on last_practiced_at. Without this, launching play-as-class
      // for a class whose enrollment has ever been practised white-screens the
      // player ("Gn.value.getTime is not a function"). Match the base contract.
      return {
        ...row,
        last_practiced_at: row.last_practiced_at ? new Date(row.last_practiced_at) : null,
        enrolled_at: row.enrolled_at ? new Date(row.enrolled_at) : (row.enrolled_at ?? null),
      }
    },
    async createEnrollment(learnerId, courseId) {
      if (!inClass()) return baseStore.value?.createEnrollment(learnerId, courseId)
      return call('createEnrollment', [])
    },
    async setEnrollmentCursor(learnerId, courseId, legoId, roundIndex) {
      if (!inClass()) return baseStore.value?.setEnrollmentCursor(learnerId, courseId, legoId, roundIndex)
      await call('setEnrollmentCursor', [legoId, roundIndex])
    },
    async setLivePosition(learnerId, courseId, legoId, roundIndex, cycleIndex, opts) {
      if (!inClass()) return baseStore.value?.setLivePosition(learnerId, courseId, legoId, roundIndex, cycleIndex, opts)
      await call('setLivePosition', [legoId, roundIndex, cycleIndex, opts])
    },
    async setMode(learnerId, courseId, mode, ratchetHighestTo) {
      if (!inClass()) return baseStore.value?.setMode(learnerId, courseId, mode, ratchetHighestTo)
      await call('setMode', [mode, ratchetHighestTo])
    },
    async bumpInfplayRound(learnerId, courseId) {
      if (!inClass()) return baseStore.value?.bumpInfplayRound(learnerId, courseId)
      await call('bumpInfplayRound', [])
    },
    async updateCurrentCycle(learnerId, courseId, cycleIndex) {
      if (!inClass()) return baseStore.value?.updateCurrentCycle(learnerId, courseId, cycleIndex)
      await call('updateCurrentCycle', [cycleIndex])
    },
    async updateEnrollmentActivity(learnerId, courseId, highestSeed, practiceMinutes) {
      if (!inClass()) return baseStore.value?.updateEnrollmentActivity(learnerId, courseId, highestSeed, practiceMinutes)
      await call('updateEnrollmentActivity', [highestSeed, practiceMinutes])
    },
    async getLegoProgressById(learnerId, legoId, courseId) {
      if (!inClass()) return baseStore.value?.getLegoProgressById(learnerId, legoId, courseId) ?? null
      return call('getLegoProgressById', [legoId])
    },
    async saveLegoProgress(progress) {
      if (!inClass()) return baseStore.value?.saveLegoProgress(progress)
      return call('saveLegoProgress', [progress])
    },
    async updateLegoProgress(id, updates) {
      if (!inClass()) return baseStore.value?.updateLegoProgress(id, updates)
      await call('updateLegoProgress', [id, updates])
    },
  }
}

export function useClassAwareProgressStore(
  baseStore: Ref<MinimalProgressStore | null | undefined>,
  classContext: Ref<ClassContextForProgress | null | undefined>,
  supabase: Ref<SupabaseSessionLike | null | undefined>,
) {
  return computed(() => createClassAwareProgressStore(baseStore, classContext, supabase))
}
