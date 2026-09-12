/**
 * Listening Mode per-clip telemetry (job #325).
 *
 * ListeningOverlay used to emit nothing per clip, only a 30 s `listening_tick`
 * heartbeat, so Listening Mode could be sized but never inspected. Every clip
 * it plays now logs an `audio_play` built here, with the SAME keys a main-flow
 * pod play carries (url, role, cycleType, legoId, seedId, playbackSpeed,
 * elapsedMs, cacheHit, reason, playIndex, sentenceIdx) and a `cycleType` that
 * names Listening Mode, so one query can put "listening pods in the main flow"
 * and "listening in Listening Mode" side by side. What only Listening Mode has,
 * because the learner is free to navigate, rides along as `view`, `listenMode`
 * and `scene`. The tick stays: session span and "time engaged" read it.
 */

export const LISTENING_MODE_CYCLE_TYPE = 'listening_mode'

export interface ListeningModePlayInput {
  audioId: string
  url: string | null
  role: 'target' | 'known'
  /** Overlay tab: pods | seeds | phrases. */
  view: string
  /** immersion | drill. */
  listenMode: string
  /** Pod scene number when a dialogue scene is open; null otherwise. */
  sceneNumber?: number | null
  /** Index of the row in the overlay's list. */
  phraseIndex: number
  /** Position of this clip within the row's play queue, and the queue length. */
  clipIndex: number
  clipCount: number
  playbackSpeed: number
  elapsedMs: number
  cacheHit: boolean | null
  /** False when audioController.play threw. */
  ok: boolean
  seedNumber?: number | null
  legoId?: string | null
}

const seedIdFor = (n: number | null | undefined): string | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? `S${String(n).padStart(4, '0')}` : null

export function buildListeningModePlayEvent(i: ListeningModePlayInput): Record<string, unknown> {
  return {
    url: i.url,
    audioId: i.audioId,
    role: i.role,
    cycleType: LISTENING_MODE_CYCLE_TYPE,
    legoId: i.legoId || null,
    seedId: seedIdFor(i.seedNumber),
    playbackSpeed: i.playbackSpeed,
    elapsedMs: i.elapsedMs,
    cacheHit: i.cacheHit,
    reason: i.ok ? 'ended' : 'error',
    playIndex: i.clipIndex,
    playCount: i.clipCount,
    sentenceIdx: i.phraseIndex,
    view: i.view,
    listenMode: i.listenMode,
    scene: i.sceneNumber ?? null,
  }
}
