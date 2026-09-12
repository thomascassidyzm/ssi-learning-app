/**
 * Pins the three learner-facing pod states on the Dialogues pod cards
 * (job #428) and the grouping that builds one card per pod slot.
 */
import { describe, it, expect } from 'vitest'
import { groupScenesByPod, podAudioIds, cachedFraction, podReadiness } from './podReadiness'
import { OFFLINE_READY_MIN_FRACTION } from './useOfflineDownloadStatus'
import type { PodScene } from './useListeningPods'

const scene = (podId: string, podIndex: number, n: number, clips: string[], podTitle: string | null = `Pod ${podIndex + 1}`): PodScene => ({
  sceneNumber: n,
  sceneKey: `${podId}:${n}`,
  podId,
  podIndex,
  podTitle,
  title: `Scene ${n}`,
  sentenceCount: clips.length,
  speakers: [],
  turns: clips.map((id, i) => ({
    id: `${podId}-${n}-${i}`,
    speaker: 'a',
    speakerName: 'A',
    colorIndex: 0,
    audioIds: [id],
    globalOrder: i,
    targetText: '',
    knownText: '',
    sentences: [{ targetAudioId: id, targetText: '', knownText: '', knownAudioId: null, explainerAudioId: null }],
  } as unknown as PodScene['turns'][number])),
})

describe('groupScenesByPod', () => {
  it('builds one card per pod in podIndex order, with counts, and keeps a single-pod course as one card', () => {
    const scenes = [
      scene('method', 1, 1, ['m1', 'm2'], 'Italian Method Pod'),
      scene('pod1', 0, 1, ['a1']),
      scene('pod1', 0, 2, ['a2', 'a3']),
    ]
    const cards = groupScenesByPod(scenes)
    expect(cards.map((c) => [c.podId, c.podTitle, c.sceneCount, c.sentenceCount])).toEqual([
      ['pod1', 'Pod 1', 2, 3],
      ['method', 'Italian Method Pod', 1, 2],
    ])
    expect(cards[0].scenes.map((s) => s.sceneKey)).toEqual(['pod1:1', 'pod1:2'])
    expect(groupScenesByPod([scene('only', 0, 1, ['x'])])).toHaveLength(1)
    expect(groupScenesByPod([])).toEqual([])
  })
})

describe('podAudioIds + cachedFraction', () => {
  it('collects each sentence target clip once and measures how many are on the device', () => {
    const scenes = [scene('p', 0, 1, ['a', 'b']), scene('p', 0, 2, ['b', 'c', 'd'])]
    const ids = podAudioIds(scenes)
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd'])
    const have = new Set(['a', 'b'])
    expect(cachedFraction(ids, (id) => have.has(id))).toBe(0.5)
    expect(cachedFraction([], () => true)).toBe(0)
  })
})

describe('podReadiness: the three states', () => {
  const idle = { downloadActive: false, offline: false }
  it('ready offline at or above the estate threshold', () => {
    expect(podReadiness(1, idle)).toBe('ready')
    expect(podReadiness(OFFLINE_READY_MIN_FRACTION, { downloadActive: false, offline: true })).toBe('ready')
  })
  it('downloading while a download is in flight, or partly cached and online', () => {
    expect(podReadiness(0, { downloadActive: true, offline: false })).toBe('downloading')
    expect(podReadiness(0.5, idle)).toBe('downloading')
  })
  it('not yet when nothing is cached and nothing is on its way, or offline with only part of the pod', () => {
    expect(podReadiness(0, idle)).toBe('notYet')
    expect(podReadiness(0.01, { downloadActive: false, offline: true })).toBe('notYet')
    expect(podReadiness(0.5, { downloadActive: false, offline: true })).toBe('notYet')
  })
})
