/**
 * useLearnerProfile — the one client-side reader for the learner's
 * motivation/profile layer (GET /api/me/profile).
 *
 * Founder design ruling 2026-08-03. Three layers, three energies: celebrate
 * adherence (dog energy) · reflect execution (the mirror) · estimate level
 * (the portrait). The weighting behind the portrait is server-side and stays
 * there; this composable only ever renders numbers a learner could count
 * themselves — goes, minutes, milliseconds.
 *
 * NOTE ON WHAT IS ABSENT, DELIBERATELY: there is no streak, no gap, no "days
 * since", no lapse, nowhere in this type. Absence is not representable. If
 * this shape could ever express "streak: 0", the design would already have
 * failed its acceptance test.
 *
 * Every block carries its own `source` so the UI can label invented data as
 * sample data rather than passing it off as live.
 */

import { ref, computed, type Ref } from 'vue'

export type SourceTag = 'real' | 'mock'

export interface MirrorPoint { hours: number; ms: number }

export interface LearnerProfile {
  courseCode: string | null
  adherence: {
    goesThisWeek: number
    goesTotal: number
    speakingMinutesThisWeek: number
    listeningMinutesThisWeek: number
    daysPresentThisWeek: number
    source: SourceTag
  }
  mirror: {
    latencyNowMs: number | null
    latencyEarlyMs: number | null
    directionPct: number | null
    curve: MirrorPoint[]
    smoothShare: number | null
    unitsSteady: number
    source: SourceTag
  }
  portrait: {
    positionKnown: string | null
    positionTarget: string | null
    unitsMet: number
    confidence: number
    cefr: { band: string; low: string; high: string }
    source: SourceTag
  }
  plan: {
    hoursDone: number
    targetHours: number
    source: SourceTag
  }
}

export interface UseLearnerProfile {
  profile: Ref<LearnerProfile | null>
  loading: Ref<boolean>
  /** True when any block on the surface is sample data — the UI says so plainly. */
  hasMock: Ref<boolean>
  load: (courseCode?: string | null) => Promise<void>
}

/**
 * The mode the app should be nudging, from the learner's place on the arc
 * (project_ssi_mode_phasing_30_100): ~0–30h mostly speaking with listening
 * folded in; ~30–100h increasingly bulk listening on harder material.
 *
 * This is GUIDANCE in the dog voice — bring the right ball — never a score,
 * and never phrased as a correction of what the learner chose.
 */
export function suggestedMode(hoursDone: number): { mode: 'speaking' | 'listening'; line: string } {
  if (hoursDone < 25) {
    return {
      mode: 'speaking',
      line: 'Speaking is the one that pays right now — that is where it all comes from early on.',
    }
  }
  if (hoursDone < 40) {
    return {
      mode: 'listening',
      line: 'Good moment to start dropping into longer listening. Your ears are ready for it.',
    }
  }
  return {
    mode: 'listening',
    line: 'Long listening on the harder stuff is where it gets fun from here. Speaking stays in the mix.',
  }
}

export function useLearnerProfile(getToken?: () => Promise<string | null>): UseLearnerProfile {
  const profile = ref<LearnerProfile | null>(null)
  const loading = ref(false)

  const hasMock = computed(() => {
    const p = profile.value
    if (!p) return false
    return [p.adherence.source, p.mirror.source, p.portrait.source, p.plan.source].includes('mock')
  })

  async function load(courseCode?: string | null): Promise<void> {
    loading.value = true
    try {
      const token = getToken ? await getToken() : null
      const qs = courseCode ? `?course=${encodeURIComponent(courseCode)}` : ''
      const res = await fetch(`/api/me/profile${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) profile.value = await res.json()
    } catch {
      /* non-fatal — the surface renders its empty state, never an error wall */
    } finally {
      loading.value = false
    }
  }

  return { profile, loading, hasMock, load }
}
