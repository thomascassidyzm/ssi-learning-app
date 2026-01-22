/**
 * Cycle.ts - Core type definitions for atomic learning cycles
 *
 * A Cycle is an immutable, pre-validated learning unit where text and audio
 * are bound together by ID, making text/audio mismatch structurally impossible.
 */

/**
 * Type of cycle in the learning sequence
 */
export type CycleType = 'intro' | 'debut' | 'practice' | 'review'

/**
 * Audio reference within a cycle
 */
export interface AudioReference {
  /** Text content for this audio */
  text: string
  /** Unique audio ID (never looked up by text) */
  audioId: string
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * A complete learning cycle - atomic unit of instruction
 *
 * Contains all data needed for one 4-phase learning cycle:
 * PROMPT (known) → PAUSE → VOICE_1 (target) → VOICE_2 (target)
 */
export interface Cycle {
  /** Unique identifier for this cycle */
  id: string

  /** Seed ID this cycle belongs to */
  seedId: string

  /** LEGO ID this cycle teaches */
  legoId: string

  /** Type of cycle in learning sequence */
  type: CycleType

  /** Known language (PROMPT phase) */
  known: AudioReference

  /** Target language - two voices for variety */
  target: {
    /** Shared text for both voices */
    text: string
    /** First voice audio ID */
    voice1AudioId: string
    /** First voice duration in ms */
    voice1DurationMs: number
    /** Second voice audio ID */
    voice2AudioId: string
    /** Second voice duration in ms */
    voice2DurationMs: number
  }

  /** Duration of PAUSE phase in milliseconds */
  pauseDurationMs: number
}

/**
 * Cached audio blob stored in IndexedDB
 */
export interface CachedAudio {
  /** Audio ID (matches audioId in Cycle) */
  id: string

  /** Duration in milliseconds */
  durationMs: number

  /** Checksum for integrity verification */
  checksum: string
}

/**
 * Result of validating a cycle or session against audio cache
 */
export type ValidationResult =
  | { ready: true }
  | { ready: false; missing: string[] }
