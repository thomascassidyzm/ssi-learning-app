/**
 * useSectorThread — the one client-side reader for the sector helix's data
 * layer: the walk list (GET /api/courses/:code/sectors) and the learner's own
 * thread state (GET/POST /api/me/threads).
 *
 * WHY THE HELIX EXISTS (founder, 2026-09-01): "I'm a nurse and I want rn to be
 * learning things that relate to my work — not after I've done 30 hours of
 * core content SEEDS that all learners get." A sector thread runs ALONGSIDE
 * the core course from the start. So this composable's job is to make the
 * choice available immediately and cheaply — not to gate it behind progress.
 *
 * ONE OWNERSHIP LEDGER, TWO SCHEDULERS. What lives here is the SCHEDULING
 * half: the sector thread's cursor, ceiling, cycle index and pod ratchet.
 * Ownership (what content the learner has met) is global and content-keyed and
 * is emphatically NOT in this shape.
 *
 * AN EMPTY WALK LIST IS CORRECT and expected — the shell ships before the
 * segment registrations do. Nothing here treats `sectors: []` as a failure.
 *
 * ONE SECTOR THREAD IS ACTIVE AT A TIME. `chooseSector` activating a new walk
 * parks any other active row for that enrolment; the server does the parking,
 * atomically, so the client can never leave two walks live. PARKING IS NEVER
 * DESTRUCTIVE — the parked thread's cursor is untouched and toggling it back
 * on resumes exactly where it stopped.
 *
 * camelCase is the boundary here; snake_case never crosses it.
 */

import { ref, computed, inject, getCurrentInstance, type Ref, type ComputedRef } from 'vue'

export interface SectorAnchor {
  legoId: string
  known: string
  target: string
}

export interface SectorOption {
  slug: string
  sectorCourseCode: string
  roles: string[]
  status: 'draft' | 'live'
  /**
   * The core lego the walk opens after, in the learner's own content, both
   * languages — so the UI renders "opens after —" as words, never a number and
   * never the internal terminology. `null` when it cannot be resolved: the
   * walk still lists, it just can't say when it opens.
   */
  anchor: SectorAnchor | null
}

export interface SectorThread {
  sectorCourseCode: string
  role: string
  active: boolean
  lastCompletedRoundIndex: number | null
  currentCycleIndex: number
  highestCompletedRoundIndex: number | null
  highestCompletedLegoId: string | null
  completedPodRounds: number
  podActivationRound: number | null
}

export interface UseSectorThread {
  sectors: Ref<SectorOption[]>
  loadingSectors: Ref<boolean>
  sectorsError: Ref<string | null>
  threads: Ref<SectorThread[]>
  /** The single active walk, or null. One at a time, by construction. */
  activeThread: ComputedRef<SectorThread | null>
  loadSectors: (courseCode: string) => Promise<void>
  loadThreads: (courseCode: string) => Promise<void>
  chooseSector: (
    courseCode: string,
    sectorCourseCode: string,
    role?: string
  ) => Promise<SectorThread>
  setThreadActive: (
    courseCode: string,
    sectorCourseCode: string,
    active: boolean
  ) => Promise<void>
}

export function useSectorThread(getToken?: () => Promise<string | null>): UseSectorThread {
  // Default token source is the app's provided Supabase client, matching
  // useAdminClient — but the composable stays callable with no arguments, and
  // callable outside a component (inject falls back rather than throwing).
  const supabaseRef = getCurrentInstance() ? inject<Ref<any> | null>('supabase', null) : null
  const resolveToken =
    getToken ??
    (async (): Promise<string | null> => {
      const client = supabaseRef?.value
      if (!client) return null
      try {
        const { data } = await client.auth.getSession()
        return data?.session?.access_token ?? null
      } catch {
        return null
      }
    })

  const sectors = ref<SectorOption[]>([])
  const loadingSectors = ref(false)
  const sectorsError = ref<string | null>(null)
  const threads = ref<SectorThread[]>([])

  const activeThread = computed<SectorThread | null>(
    () => threads.value.find((t) => t.active) ?? null
  )

  async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await resolveToken()
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra }
  }

  async function loadSectors(courseCode: string): Promise<void> {
    if (!courseCode) return
    loadingSectors.value = true
    sectorsError.value = null
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseCode)}/sectors`)
      if (!res.ok) throw new Error(`Sector list failed (${res.status})`)
      const body = await res.json()
      // An empty list is a correct answer, not an error state.
      sectors.value = Array.isArray(body?.sectors) ? body.sectors : []
    } catch (err: any) {
      sectorsError.value = err?.message || 'Could not load walks'
      sectors.value = []
    } finally {
      loadingSectors.value = false
    }
  }

  async function loadThreads(courseCode: string): Promise<void> {
    if (!courseCode) return
    try {
      const res = await fetch(
        `/api/me/threads?course=${encodeURIComponent(courseCode)}`,
        { headers: await authHeaders() }
      )
      if (!res.ok) {
        threads.value = []
        return
      }
      const body = await res.json()
      threads.value = Array.isArray(body?.threads) ? body.threads : []
    } catch {
      // A missing thread read is "no walk chosen", never an error wall.
      threads.value = []
    }
  }

  /**
   * Writes are LOUD — a failed choose throws, because a silently-unsaved walk
   * choice would leave the learner watching core content she didn't pick.
   */
  async function postThread(
    courseCode: string,
    sectorCourseCode: string,
    role: string | undefined,
    active: boolean
  ): Promise<SectorThread> {
    const res = await fetch('/api/me/threads', {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ course: courseCode, sectorCourseCode, role, active }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || `Could not save this walk (${res.status})`)
    const thread: SectorThread = body?.thread
    if (!thread?.sectorCourseCode) throw new Error('Could not save this walk')

    // Mirror the server's one-active-walk rule locally so the UI is correct
    // before any refetch: parking is a flag change, never a removal.
    const next = threads.value
      .filter((t) => t.sectorCourseCode !== thread.sectorCourseCode)
      .map((t) => (active ? { ...t, active: false } : t))
    threads.value = [...next, thread]
    return thread
  }

  async function chooseSector(
    courseCode: string,
    sectorCourseCode: string,
    role = 'general'
  ): Promise<SectorThread> {
    return postThread(courseCode, sectorCourseCode, role, true)
  }

  async function setThreadActive(
    courseCode: string,
    sectorCourseCode: string,
    active: boolean
  ): Promise<void> {
    // Keep the role the learner already chose; only the toggle moves.
    const existing = threads.value.find((t) => t.sectorCourseCode === sectorCourseCode)
    await postThread(courseCode, sectorCourseCode, existing?.role, active)
  }

  return {
    sectors,
    loadingSectors,
    sectorsError,
    threads,
    activeThread,
    loadSectors,
    loadThreads,
    chooseSector,
    setThreadActive,
  }
}
