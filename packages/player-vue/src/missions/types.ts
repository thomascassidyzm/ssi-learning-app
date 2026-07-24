/**
 * Guided missions — missions as DATA.
 *
 * A mission poses a real task against demo data in the REAL schools UI,
 * recognises completion by watching the route (never by instrumenting
 * components), and celebrates quietly. Learn by doing, never by lecturing.
 *
 * The engine (useMission.ts) renders one small collapsible card, arms at
 * most ONE nudge after meaningful idle time, and detects completion purely
 * from route arrival — so a mission definition is data plus one setup hook
 * that arranges the demo world.
 */

export interface MissionCompletion {
  /** Exact route path that counts as "done", e.g. '/schools/analytics'. */
  path: string
  /** Query params that must ALL match (string equality) on that route. */
  query?: Record<string, string>
}

export interface MissionDefinition {
  id: string
  title: string
  /** The task, Script-voiced: invitational, never patronising. */
  brief: string
  /** Where the mission drops the user when started from an affordance. */
  startRoute: string
  completion: MissionCompletion
  /** Silence is the default. One nudge max, only after idle time, a hint not an answer. */
  nudge?: { afterMs: number; text: string }
  closing: { note: string; link?: { label: string; href: string } }
  /**
   * Arrange the demo world (persona + isDemoMode + primed data refs).
   * Called once, after the schools Supabase client bridge is set.
   */
  setup: () => void
}
