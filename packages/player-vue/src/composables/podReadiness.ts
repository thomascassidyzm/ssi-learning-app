/**
 * Per-pod offline readiness for the Dialogues pod cards (job #428).
 *
 * The Dialogues tab lists pod CARDS, one per pod slot the course lists, and
 * each card carries a learner-facing state so a pod that is missing offline
 * reads as a state rather than a bug: "Ready offline", "Downloading", or
 * "Not yet". This module is the one owner of that computation. It is pure:
 * the caller hands it the cache membership read (`audioCache.has`, a
 * synchronous non-reactive Set read) and the download context, and gets a
 * state back. Nothing here polls, subscribes or fetches.
 *
 * The ready threshold is the estate's existing one, OFFLINE_READY_MIN_FRACTION
 * from useOfflineDownloadStatus: a pod with 98% of its clips on the device is
 * a playable pod, and the missing tail is skipped at play time.
 */
import { OFFLINE_READY_MIN_FRACTION } from './useOfflineDownloadStatus'
import type { PodScene } from './useListeningPods'

export type PodReadiness = 'ready' | 'downloading' | 'notYet'

/** At or below this cached fraction a pod has "almost nothing" on the device. */
export const POD_NOT_YET_MAX_FRACTION = 0.02

export interface PodCard {
  podId: string
  podIndex: number
  /** The pod's own `listening_pods.title`; null when the row carried none. */
  podTitle: string | null
  scenes: PodScene[]
  sceneCount: number
  sentenceCount: number
}

/**
 * Group the flat scene list into one card per pod, in list order (podIndex 0
 * first). A single-pod course still yields its one card: the card is where
 * the readiness state lives, so it earns its place alone.
 */
export function groupScenesByPod(scenes: readonly PodScene[]): PodCard[] {
  const byId = new Map<string, PodCard>()
  for (const scene of scenes) {
    let card = byId.get(scene.podId)
    if (!card) {
      card = { podId: scene.podId, podIndex: scene.podIndex, podTitle: scene.podTitle ?? null, scenes: [], sceneCount: 0, sentenceCount: 0 }
      byId.set(scene.podId, card)
    }
    card.scenes.push(scene)
    card.sceneCount += 1
    card.sentenceCount += scene.sentenceCount || 0
  }
  return [...byId.values()].sort((a, b) => a.podIndex - b.podIndex)
}

/**
 * Every target clip a pod's scenes play in Immersion, deduplicated. This is
 * the same set `availablePhrases` tests per row offline: one target clip per
 * sentence, or the turn's first audio id when a row carries no sentence
 * detail. Drill's extra known-language clips are deliberately not counted;
 * a pod whose dialogue clips are on the device is a listenable pod.
 */
export function podAudioIds(scenes: ReadonlyArray<Pick<PodScene, 'turns'>>): string[] {
  const ids = new Set<string>()
  for (const scene of scenes) {
    for (const turn of scene.turns || []) {
      const sentences = Array.isArray(turn.sentences) ? turn.sentences : []
      if (sentences.length > 0) {
        for (const s of sentences) if (s.targetAudioId) ids.add(s.targetAudioId)
      } else if (turn.audioIds?.[0]) {
        ids.add(turn.audioIds[0])
      }
    }
  }
  return [...ids]
}

/** Fraction of `ids` for which `has` answers true. A pod with no clips is 0. */
export function cachedFraction(ids: readonly string[], has: (id: string) => boolean): number {
  if (ids.length === 0) return 0
  let hit = 0
  for (const id of ids) if (has(id)) hit += 1
  return hit / ids.length
}

/**
 * The learner-facing state for one pod.
 *
 * - ready:       cached fraction at or above OFFLINE_READY_MIN_FRACTION.
 * - downloading: a download is in flight, or the pod is partly cached and the
 *                device is online, so more of it is on its way.
 * - notYet:      nothing or almost nothing cached and nothing on its way; or,
 *                offline with only part of the pod and no download running,
 *                since nothing more can arrive until the device reconnects.
 */
export function podReadiness(
  fraction: number,
  ctx: { downloadActive: boolean; offline: boolean },
): PodReadiness {
  if (fraction >= OFFLINE_READY_MIN_FRACTION) return 'ready'
  if (ctx.downloadActive) return 'downloading'
  if (fraction <= POD_NOT_YET_MAX_FRACTION) return 'notYet'
  return ctx.offline ? 'notYet' : 'downloading'
}
