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
  setEnrollmentCursor: (
    learnerId: string, courseId: string, legoId: string, roundIndex: number,
    /** Observability only — telemetry context, never affects the write. */
    opts?: { reason?: string; from?: { legoId: string | null; roundIndex: number | null } | null }
  ) => Promise<void>
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
  /**
   * The playback ledger (`learner_speaking_opportunities`) for the CLASS
   * account (job #778). The base store has no such method — own accounts
   * write it through the `bump_speaking_opportunities` RPC in
   * useLearningSession, which the class account can never pass (its user_id
   * is nobody's login). Resolves `true` when the class route handled the
   * write, `false` outside class mode so the caller falls through to the RPC.
   */
  bumpSpeakingOpportunities?: (
    learnerId: string, courseId: string, oppsDelta: number, secondsDelta: number, phrasesDelta: number,
  ) => Promise<boolean>
  /**
   * LEGO co-firing (`learner_lego_pairings`) for the CLASS account (job #52).
   * Same shape and same reason as bumpSpeakingOpportunities: the base store
   * has no such method — own accounts write it through the
   * `record_lego_pairings` RPC in usePairingsTelemetry, which is SECURITY
   * INVOKER against an own-row policy the class account can never satisfy
   * (its user_id is the literal `class-learner:<classId>`, nobody's login),
   * so every class flush was refused and only console.warned. Resolves `true`
   * when the class route handled the write, `false` outside class mode so the
   * caller falls through to the RPC.
   */
  recordLegoPairings?: (
    learnerId: string, courseId: string, pairs: string[][], counts: number[],
  ) => Promise<boolean>
  /**
   * Listening-pod persistence for the CLASS account. Same reason and same
   * shape as the two above: `learner_pod_state` and the
   * `course_enrollments.completed_pod_rounds`/`rounds_since_pod` ratchet are
   * both written straight from the browser by usePodLapScheduler, both under
   * own-row RLS, so every class write was refused and only console.warned —
   * zero pod-state rows for any class ever, and every class enrollment stuck
   * at a ratchet of 0 (verified live 2026-09-17).
   *
   * The READS are here too, which the earlier fixes did not need: RLS HIDES
   * rows rather than erroring, so a class that wrote its ratchet through this
   * door and read it back through the browser would still see nothing and
   * restart from zero. Read and write must use the same door.
   *
   * Every method resolves `null`/`false` outside class mode, so the caller
   * falls through to its own direct path untouched.
   */
  getPodRatchet?: () => Promise<{ rounds_since_pod: number | null; completed_pod_rounds: number | null } | null>
  persistPodRatchet?: (completedPodRounds: number, roundsSincePod: number) => Promise<boolean>
  resetPodRatchet?: () => Promise<boolean>
  loadPodState?: () => Promise<Array<{ sentence_id: string; exposures: number }> | null>
  upsertPodState?: (rows: Array<{ sentence_id: string; exposures: number }>) => Promise<boolean>
  deletePodState?: () => Promise<boolean>
  /** Instruction-exposure progress (`learner_meta_commentary_state`) — per
   *  learner, not per course, hence no course argument. */
  getMetaCommentaryState?: () => Promise<{ instruction_index: number | null; instructions_complete: boolean | null } | null>
  saveMetaCommentaryState?: (instructionIndex: number, instructionsComplete: boolean) => Promise<boolean>
  /** The belt sync's last_practiced_at touch (useBeltProgress.syncToRemote). */
  touchLastPracticed?: () => Promise<boolean>
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
    async setEnrollmentCursor(learnerId, courseId, legoId, roundIndex, opts) {
      if (!inClass()) return baseStore.value?.setEnrollmentCursor(learnerId, courseId, legoId, roundIndex, opts)
      // `opts` is telemetry-only and stays client-side: the class write goes
      // through the server endpoint, whose payload shape is unchanged.
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
    async bumpSpeakingOpportunities(_learnerId, _courseId, oppsDelta, secondsDelta, phrasesDelta) {
      if (!inClass()) return false
      await call('bumpSpeakingOpportunities', [oppsDelta, secondsDelta, phrasesDelta])
      return true
    },
    async recordLegoPairings(_learnerId, _courseId, pairs, counts) {
      if (!inClass()) return false
      await call('recordLegoPairings', [pairs, counts])
      return true
    },
    async getPodRatchet() {
      if (!inClass()) return null
      return call('getPodRatchet', [])
    },
    async persistPodRatchet(completedPodRounds, roundsSincePod) {
      if (!inClass()) return false
      await call('persistPodRatchet', [completedPodRounds, roundsSincePod])
      return true
    },
    async resetPodRatchet() {
      if (!inClass()) return false
      await call('resetPodRatchet', [])
      return true
    },
    async loadPodState() {
      if (!inClass()) return null
      return call('loadPodState', [])
    },
    async upsertPodState(rows) {
      if (!inClass()) return false
      await call('upsertPodState', [rows])
      return true
    },
    async deletePodState() {
      if (!inClass()) return false
      await call('deletePodState', [])
      return true
    },
    async getMetaCommentaryState() {
      if (!inClass()) return null
      return call('getMetaCommentaryState', [])
    },
    async saveMetaCommentaryState(instructionIndex, instructionsComplete) {
      if (!inClass()) return false
      await call('saveMetaCommentaryState', [instructionIndex, instructionsComplete])
      return true
    },
    async touchLastPracticed() {
      if (!inClass()) return false
      await call('touchLastPracticed', [])
      return true
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
